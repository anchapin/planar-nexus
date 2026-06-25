/**
 * WebRTC Connection Pool & Mesh Topology Manager
 * Issue #1021: Implement WebRTC connection reuse for multi-player games
 *
 * Each {@link WebRTCConnection} historically created a fresh RTCPeerConnection
 * with its own ICE handling and ping interval, yielding O(n^2) connections for
 * 3+ player games with no reuse or pooling. This module introduces:
 *
 * 1. A {@link WebRTCConnectionPool} that reuses connections for known peers,
 *    caps concurrent RTCPeerConnection instances, and caches dropped peer
 *    state to accelerate reconnect.
 * 2. A {@link MeshTopologyManager} that maintains a full-mesh topology for a
 *    multi-player game and shares data channels via the pool.
 * 3. A single consolidated ping sweep that drives health checks for every
 *    pooled connection from one interval instead of N independent timers.
 */

import {
  WebRTCConnection,
  type P2PConnectionOptions,
  type P2PConnectionState,
  type P2PMessage,
  type PeerInfo,
} from "./webrtc-p2p";

/** Default hard cap on concurrent RTCPeerConnection instances. */
const DEFAULT_MAX_CONNECTIONS = 8;
/** Default cadence (ms) of the consolidated ping sweep. */
const DEFAULT_PING_INTERVAL_MS = 5000;
/** Default time-to-live (ms) for cached dropped-peer state. */
const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * Snapshot of a peer's connection state captured when its connection dropped,
 * so a near-term reconnect can restore peer identity without re-discovery.
 */
export interface CachedConnectionState {
  peerId: string;
  peerInfo: PeerInfo;
  state: P2PConnectionState;
  lastConnectedAt: number;
  lastDroppedAt: number;
}

/**
 * Event hooks fired by the connection pool. All are optional.
 */
export interface ConnectionPoolEvents {
  /** Fired when a previously-seen peer reuses a pooled connection. */
  onReuse?: (peerId: string) => void;
  /** Fired when state is cached for a dropped peer. */
  onCache?: (peerId: string, cached: CachedConnectionState) => void;
  /** Fired when a connection is refused because the pool is at capacity. */
  onPoolFull?: (peerId: string) => void;
}

/**
 * Options for constructing a {@link WebRTCConnectionPool}.
 */
export interface ConnectionPoolOptions {
  /** Local player id that owns this pool (used as the ping sender id). */
  localPlayerId: string;
  /** Hard cap on concurrent RTCPeerConnection instances in the pool. */
  maxConnections?: number;
  /** Cadence (ms) of the single consolidated ping sweep. */
  pingIntervalMs?: number;
  /** How long (ms) cached dropped-peer state stays valid. */
  cacheTtlMs?: number;
  /** Pool lifecycle events. */
  events?: ConnectionPoolEvents;
  /**
   * Factory used to build a fresh per-peer connection. Defaults to a
   * {@link WebRTCConnection} created with {@link defaultConnectionFactory}'s
   * base options so production behavior is unchanged.
   */
  createConnection?: (peerId: string) => WebRTCConnection;
}

/**
 * Base options handed to every connection the default factory creates.
 * Exposed so callers (and tests) can construct equivalent connections.
 */
export interface PoolConnectionBaseOptions {
  playerId: string;
  /** Defer pinging to the pool's consolidated sweep. */
  externalPing: boolean;
}

/**
 * Build the default base options for a pooled connection. The pool merges
 * these with any caller-provided overrides before constructing each
 * connection, ensuring every pooled connection defers its ping cadence to the
 * consolidated sweep.
 */
export function defaultConnectionFactory(
  peerId: string,
  overrides: Partial<P2PConnectionOptions> = {},
): WebRTCConnection {
  return new WebRTCConnection({
    playerId: peerId,
    playerName: overrides.playerName ?? `Peer-${peerId}`,
    isHost: overrides.isHost ?? false,
    externalPing: true,
    ...overrides,
  });
}

/**
 * A reusable pool of WebRTC peer connections.
 *
 * - <b>Reuse:</b> {@link acquire} returns an existing connection for a known
 *   peer instead of creating a duplicate, so re-establishing a link to a
 *   known peer never spawns a second RTCPeerConnection.
 * - <b>Capacity:</b> a hard {@link ConnectionPoolOptions.maxConnections} cap
 *   limits how many concurrent RTCPeerConnection instances exist.
 * - <b>Consolidated ping:</b> a single {@link start} interval drives ping
 *   health checks for every pooled connection, replacing N per-connection
 *   timers.
 * - <b>State caching:</b> when a connection is released or drops, its peer
 *   identity is cached so a near-term reconnect skips re-discovery.
 */
export class WebRTCConnectionPool {
  private readonly localPlayerId: string;
  private readonly maxConnections: number;
  private readonly pingIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly events: ConnectionPoolEvents;
  private readonly createConnection: (peerId: string) => WebRTCConnection;

  /** Active, reusable connections keyed by peer id. */
  private readonly connections: Map<string, WebRTCConnection> = new Map();
  /** Cached state for dropped peers. */
  private readonly cache: Map<string, CachedConnectionState> = new Map();
  /** Single consolidated ping timer sweeping all pooled connections. */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ConnectionPoolOptions) {
    if (!options.localPlayerId) {
      throw new Error("ConnectionPoolOptions.localPlayerId is required");
    }
    this.localPlayerId = options.localPlayerId;
    this.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.events = options.events ?? {};
    this.createConnection =
      options.createConnection ??
      ((peerId: string) => defaultConnectionFactory(peerId));
  }

  /**
   * Start the consolidated ping sweep. Idempotent. The sweep pings every
   * connected pooled connection on a single interval.
   */
  start(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => this.pingAll(), this.pingIntervalMs);
  }

  /**
   * Stop the consolidated ping sweep. Pooled connections are left intact.
   */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Return the existing connection for a peer (reuse), or create a new one if
   * the peer is unknown and the pool is under capacity. Returns null — and
   * fires {@link ConnectionPoolEvents.onPoolFull} — when at capacity.
   */
  acquire(peerId: string): WebRTCConnection | null {
    if (!peerId) {
      throw new Error("acquire requires a non-empty peerId");
    }
    const existing = this.connections.get(peerId);
    if (existing) {
      this.events.onReuse?.(peerId);
      return existing;
    }

    if (this.connections.size >= this.maxConnections) {
      this.events.onPoolFull?.(peerId);
      return null;
    }

    const connection = this.createConnection(peerId);
    this.connections.set(peerId, connection);
    return connection;
  }

  /**
   * Look up an existing connection without creating one.
   */
  get(peerId: string): WebRTCConnection | undefined {
    return this.connections.get(peerId);
  }

  /**
   * Whether a connection for this peer currently lives in the pool.
   */
  has(peerId: string): boolean {
    return this.connections.has(peerId);
  }

  /**
   * Number of active connections in the pool.
   */
  get size(): number {
    return this.connections.size;
  }

  /** Maximum concurrent connections this pool will hold. */
  get capacity(): number {
    return this.maxConnections;
  }

  /**
   * All active connections in the pool.
   */
  getAll(): WebRTCConnection[] {
    return Array.from(this.connections.values());
  }

  /** All peer ids with an active connection. */
  getPeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Remove and close a peer's connection, caching its state so a near-term
   * reconnect can reuse it. No-op if the peer is unknown.
   */
  release(peerId: string): void {
    const connection = this.connections.get(peerId);
    if (!connection) return;
    this.cacheState(peerId, connection);
    connection.close();
    this.connections.delete(peerId);
  }

  /**
   * Snapshot a peer's current connection state into the cache. Called
   * automatically on {@link release}; safe to call manually when a peer drops
   * but its connection should remain in the pool.
   */
  cacheState(peerId: string, connection: WebRTCConnection): void {
    const peers = connection.getPeers();
    const peerInfo: PeerInfo =
      peers.find((p) => p.peerId === peerId) ??
      peers[0] ?? {
        peerId,
        playerId: peerId,
        playerName: `Peer-${peerId}`,
        connectionState: connection.getConnectionState(),
        connectedAt: Date.now(),
      };
    const cached: CachedConnectionState = {
      peerId,
      peerInfo,
      state: connection.getConnectionState(),
      lastConnectedAt: Date.now(),
      lastDroppedAt: Date.now(),
    };
    this.cache.set(peerId, cached);
    this.events.onCache?.(peerId, cached);
  }

  /**
   * Return cached state for a peer, or null if absent or expired.
   */
  getCachedState(peerId: string): CachedConnectionState | null {
    const cached = this.cache.get(peerId);
    if (!cached) return null;
    if (Date.now() - cached.lastDroppedAt > this.cacheTtlMs) {
      this.cache.delete(peerId);
      return null;
    }
    return cached;
  }

  /** Whether a non-expired cache entry exists for a peer. */
  hasCachedState(peerId: string): boolean {
    return this.getCachedState(peerId) !== null;
  }

  /** Drop a peer's cache entry. */
  clearCachedState(peerId: string): void {
    this.cache.delete(peerId);
  }

  /**
   * Broadcast a message across the pool by reusing each pooled connection's
   * open data channel. Returns the number of peers the message was sent to.
   */
  broadcast(message: P2PMessage): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (connection.isConnected()) {
        connection.send(message);
        sent++;
      }
    }
    return sent;
  }

  /**
   * Close every connection, stop the ping sweep, and clear all cached state.
   */
  closeAll(): void {
    this.stop();
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.cache.clear();
  }

  /**
   * Single sweep that pings every connected pooled connection. Replaces the
   * N independent per-connection ping intervals from webrtc-p2p.ts.
   */
  private pingAll(): void {
    for (const connection of this.connections.values()) {
      if (connection.isConnected()) {
        connection.ping();
      }
    }
  }
}

/**
 * Options for {@link MeshTopologyManager}.
 */
export interface MeshTopologyManagerOptions {
  /** Local player id at the center of the mesh. */
  localPlayerId: string;
  /** Pool backing every mesh link. */
  pool: WebRTCConnectionPool;
  /** Peer ids (excluding local) already known to be in the game. */
  peers?: string[];
}

/**
 * Maintains a full-mesh topology for a multi-player game on top of a
 * {@link WebRTCConnectionPool}.
 *
 * In a full mesh every participant connects directly to every other
 * participant; for n players that is n*(n-1)/2 links total, and the local
 * node holds n-1 links. The manager guarantees the local node has a pooled
 * connection for each peer ({@link buildMesh}), exposes the topology edges
 * ({@link getTopology}), and broadcasts over the shared data channels
 * ({@link broadcast}).
 */
export class MeshTopologyManager {
  private readonly localPlayerId: string;
  private readonly pool: WebRTCConnectionPool;
  private readonly peers: Set<string> = new Set();

  constructor(options: MeshTopologyManagerOptions) {
    if (!options.localPlayerId) {
      throw new Error("MeshTopologyManagerOptions.localPlayerId is required");
    }
    if (!options.pool) {
      throw new Error("MeshTopologyManagerOptions.pool is required");
    }
    this.localPlayerId = options.localPlayerId;
    this.pool = options.pool;
    for (const peer of options.peers ?? []) {
      if (peer && peer !== this.localPlayerId) {
        this.peers.add(peer);
      }
    }
  }

  /** The backing connection pool. */
  getPool(): WebRTCConnectionPool {
    return this.pool;
  }

  /** Add a peer to the mesh (idempotent). The local player is never added. */
  addPeer(peerId: string): void {
    if (!peerId || peerId === this.localPlayerId) return;
    this.peers.add(peerId);
  }

  /** Remove a peer and release its pooled connection. */
  removePeer(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    this.pool.release(peerId);
  }

  /** Peer ids currently in the mesh (excluding local). */
  getPeers(): string[] {
    return Array.from(this.peers);
  }

  /** Number of peers in the mesh. */
  peerCount(): number {
    return this.peers.size;
  }

  /**
   * Ensure the local node has a pooled connection for every known peer.
   * Returns the list of peer ids for which a NEW connection was created
   * (signaling must complete the handshake for those); reused peers are
   * excluded from the result.
   */
  buildMesh(): string[] {
    const created: string[] = [];
    for (const peerId of this.peers) {
      if (this.pool.has(peerId)) continue;
      const connection = this.pool.acquire(peerId);
      if (connection) {
        created.push(peerId);
      }
    }
    return created;
  }

  /**
   * Unordered mesh edges among all participants (local + peers). For n
   * participants this is n*(n-1)/2 pairs. An empty or single-participant mesh
   * yields no edges.
   */
  getTopology(): Array<[string, string]> {
    const participants = [this.localPlayerId, ...this.peers];
    const edges: Array<[string, string]> = [];
    for (let i = 0; i < participants.length; i++) {
      for (let j = i + 1; j < participants.length; j++) {
        edges.push([participants[i], participants[j]]);
      }
    }
    return edges;
  }

  /**
   * Broadcast a message to every peer over the pooled, shared data channels.
   * Returns the number of peers reached.
   */
  broadcast(message: P2PMessage): number {
    return this.pool.broadcast(message);
  }

  /**
   * Tear down the mesh: release every peer's pooled connection. The pool
   * itself is not closed so it can be reused for a new game.
   */
  destroy(): void {
    for (const peerId of Array.from(this.peers)) {
      this.pool.release(peerId);
    }
    this.peers.clear();
  }
}
