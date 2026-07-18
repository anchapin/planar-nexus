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
 * 4. <b>Idle/LRU eviction</b> (issue #1427): when the pool is full,
 *    {@link WebRTCConnectionPool.acquire} no longer refuses new peers out of
 *    hand. It first looks for an <i>evictable</i> connection — a dead link
 *    (not {@link WebRTCConnection.isConnected} for longer than
 *    {@link ConnectionPoolOptions.idleFailureMs}) or a connected-but-idle peer
 *    (no traffic for longer than {@link ConnectionPoolOptions.idleConnectedMs})
 *    — and removes the least-recently-used one to make room. A connection
 *    used within {@link ConnectionPoolOptions.activeMs} is never evicted.
 *    {@link ConnectionPoolEvents.onPoolFull} therefore fires only on true
 *    capacity exhaustion; per-eviction visibility is delivered via
 *    {@link ConnectionPoolEvents.onEvict}.
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
 * Default grace period (ms) before a non-connected (disconnected / failed /
 * connecting / reconnecting) pooled connection becomes evictable. Gives a
 * dropped peer time to reconnect before its slot is reclaimed.
 */
const DEFAULT_IDLE_FAILURE_MS = 60_000;
/**
 * Default threshold (ms) after which a connected-but-silent pooled connection
 * becomes evictable. Pings keep the link up but do not reset this; only real
 * traffic (or an explicit {@link WebRTCConnectionPool.markConnectionUsed})
 * keeps a peer "fresh".
 */
const DEFAULT_IDLE_CONNECTED_MS = 600_000;
/**
 * Default window (ms) within which a connection is considered actively in use
 * and is therefore never an eviction candidate.
 */
const DEFAULT_ACTIVE_MS = 30_000;

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
 * Supplementary payload for {@link ConnectionPoolEvents.onPoolFull}.
 *
 * `evictedPeerIds` is always empty when `onPoolFull` fires: `acquire` only
 * fires `onPoolFull` after determining that <i>no</i> pooled connection is
 * evictable (real capacity exhaustion). When an eviction does make room,
 * `acquire` succeeds instead, and each evicted peer is reported via
 * {@link ConnectionPoolEvents.onEvict}. The field is retained on the payload
 * so the host layer can assert the "nothing was evicted" contract explicitly.
 */
export interface PoolFullInfo {
  /** Always `[]` when `onPoolFull` fires (see type doc). */
  evictedPeerIds: string[];
}

/**
 * Event hooks fired by the connection pool. All are optional.
 */
export interface ConnectionPoolEvents {
  /** Fired when a previously-seen peer reuses a pooled connection. */
  onReuse?: (peerId: string) => void;
  /** Fired when state is cached for a dropped peer. */
  onCache?: (peerId: string, cached: CachedConnectionState) => void;
  /**
   * Fired when a connection is refused because the pool is at capacity AND no
   * pooled connection was evictable. When an idle/LRU connection WAS evicted
   * to make room, {@link acquire} succeeds and this event does not fire;
   * instead {@link onEvict} reports the eviction.
   */
  onPoolFull?: (peerId: string, info: PoolFullInfo) => void;
  /**
   * Fired for each connection evicted by the idle/LRU policy (either
   * proactively via {@link WebRTCConnectionPool.evictIdle} or reactively inside
   * {@link acquire}). The peer's state is cached first (so
   * {@link onCache} also fires), enabling a fast reconnect.
   */
  onEvict?: (peerId: string) => void;
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
  /**
   * Grace period (ms) before a non-connected pooled connection becomes
   * evictable. Defaults to {@link DEFAULT_IDLE_FAILURE_MS} (60s).
   */
  idleFailureMs?: number;
  /**
   * Threshold (ms) after which a connected-but-idle pooled connection becomes
   * evictable. Defaults to {@link DEFAULT_IDLE_CONNECTED_MS} (10 min).
   */
  idleConnectedMs?: number;
  /**
   * Window (ms) within which a connection is considered actively in use and is
   * never evicted. Defaults to {@link DEFAULT_ACTIVE_MS} (30s).
   */
  activeMs?: number;
  /**
   * Clock injected for deterministic eviction behaviour. Defaults to
   * `Date.now`. All internal time reads go through this, so eviction tests can
   * advance time without `jest.useFakeTimers`.
   */
  now?: () => number;
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
 * - <b>Idle/LRU eviction:</b> {@link acquire} on a full pool first tries to
 *   reclaim a slot by evicting the least-recently-used evictable connection
 *   (dead links first, then connected-but-idle peers). A peer used within
 *   {@link ConnectionPoolOptions.activeMs} is always retained. See
 *   {@link selectEvictionCandidate} for the exact order.
 *
 * Each pooled connection has a `lastUsedAt` timestamp (readable via
 * {@link getLastUsedAt}), bumped on acquire-reuse, on every successful
 * broadcast {@link send}, on every successful healthy {@link ping}, and on an
 * explicit {@link markConnectionUsed}. Callers that send over a pooled
 * connection without going through {@link broadcast} should call
 * {@link markConnectionUsed} so the LRU order stays accurate.
 */
export class WebRTCConnectionPool {
  private readonly localPlayerId: string;
  private readonly maxConnections: number;
  private readonly pingIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly idleFailureMs: number;
  private readonly idleConnectedMs: number;
  private readonly activeMs: number;
  private readonly now: () => number;
  private readonly events: ConnectionPoolEvents;
  private readonly createConnection: (peerId: string) => WebRTCConnection;

  /** Active, reusable connections keyed by peer id. */
  private readonly connections: Map<string, WebRTCConnection> = new Map();
  /** Cached state for dropped peers. */
  private readonly cache: Map<string, CachedConnectionState> = new Map();
  /**
   * Last-used timestamp (epoch ms) per pooled peer, driving the LRU order.
   * Bumped by {@link markUsed}.
   */
  private readonly lastUsedAt: Map<string, number> = new Map();
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
    this.idleFailureMs = options.idleFailureMs ?? DEFAULT_IDLE_FAILURE_MS;
    this.idleConnectedMs = options.idleConnectedMs ?? DEFAULT_IDLE_CONNECTED_MS;
    this.activeMs = options.activeMs ?? DEFAULT_ACTIVE_MS;
    this.now = options.now ?? (() => Date.now());
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
   * the peer is unknown and the pool is under capacity.
   *
   * When the pool is full, this first tries to evict an idle/LRU connection
   * (see {@link selectEvictionCandidate}) to make room. Only if NO connection
   * is evictable does it return `null` and fire
   * {@link ConnectionPoolEvents.onPoolFull}. Each successful eviction is
   * reported via {@link ConnectionPoolEvents.onEvict} (and the peer's state is
   * cached first via {@link cacheState} so reconnect is fast).
   */
  acquire(peerId: string): WebRTCConnection | null {
    if (!peerId) {
      throw new Error("acquire requires a non-empty peerId");
    }
    const existing = this.connections.get(peerId);
    if (existing) {
      this.markUsed(peerId);
      this.events.onReuse?.(peerId);
      return existing;
    }

    if (this.connections.size >= this.maxConnections) {
      // Pool full: reclaim a slot from the least-recently-used evictable
      // connection before refusing. Falls through to creation on success.
      const evictable = this.selectEvictionCandidate(this.now());
      if (!evictable) {
        this.events.onPoolFull?.(peerId, { evictedPeerIds: [] });
        return null;
      }
      this.evictPeer(evictable);
    }

    const connection = this.createConnection(peerId);
    this.connections.set(peerId, connection);
    this.markUsed(peerId);
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
   * Last-used timestamp (epoch ms) for a pooled peer, or `null` if the peer is
   * unknown. Drives the LRU eviction order.
   */
  getLastUsedAt(peerId: string): number | null {
    return this.lastUsedAt.has(peerId)
      ? (this.lastUsedAt.get(peerId) as number)
      : null;
  }

  /**
   * Stamp a pooled connection as freshly used without going through
   * {@link broadcast} (e.g. a caller sending over a connection obtained via
   * {@link acquire}). No-op for unknown peers. Required to keep the LRU order
   * accurate when traffic bypasses the pool.
   */
  markConnectionUsed(peerId: string): void {
    if (this.connections.has(peerId)) {
      this.markUsed(peerId);
    }
  }

  /** Bump a peer's last-used timestamp to the current pool time. */
  private markUsed(peerId: string): void {
    this.lastUsedAt.set(peerId, this.now());
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
    this.lastUsedAt.delete(peerId);
  }

  /**
   * Proactively evict every currently-evictable pooled connection (dead links
   * past {@link ConnectionPoolOptions.idleFailureMs} first, then connected-
   * but-idle peers past {@link ConnectionPoolOptions.idleConnectedMs}). Returns
   * the evicted peer ids. {@link acquire} does NOT call this — it evicts at
   * most one connection via {@link selectEvictionCandidate}; this method is
   * for periodic maintenance sweeps.
   */
  evictIdle(now: number = this.now()): string[] {
    const evicted: string[] = [];
    let candidate = this.selectEvictionCandidate(now);
    while (candidate) {
      this.evictPeer(candidate);
      evicted.push(candidate);
      candidate = this.selectEvictionCandidate(now);
    }
    return evicted;
  }

  /**
   * Pick the single best eviction candidate at `now`, or `null` if nothing is
   * evictable.
   *
   * Eviction order:
   * 1. <b>Dead links first</b> — connections whose {@link WebRTCConnection.isConnected}
   *    is `false` AND whose last-used age exceeds
   *    {@link ConnectionPoolOptions.idleFailureMs}. Among these, the
   *    least-recently-used (oldest `lastUsedAt`) is chosen.
   * 2. <b>Connected-but-idle</b> — `isConnected === true` AND last-used age
   *    exceeds {@link ConnectionPoolOptions.idleConnectedMs}. Again the LRU
   *    peer is chosen.
   *
   * A connection used within {@link ConnectionPoolOptions.activeMs} is never
   * returned (it is actively in use).
   */
  private selectEvictionCandidate(now: number): string | null {
    let zombieLRU: string | null = null;
    let zombieLRUAt = Infinity;
    let idleLRU: string | null = null;
    let idleLRUAt = Infinity;
    for (const [peerId, connection] of this.connections) {
      const lastUsed = this.lastUsedAt.get(peerId) ?? now;
      const age = now - lastUsed;
      // Actively in use — never evict, regardless of connected state.
      if (age <= this.activeMs) continue;
      if (connection.isConnected()) {
        if (age > this.idleConnectedMs && lastUsed < idleLRUAt) {
          idleLRU = peerId;
          idleLRUAt = lastUsed;
        }
      } else if (age > this.idleFailureMs && lastUsed < zombieLRUAt) {
        zombieLRU = peerId;
        zombieLRUAt = lastUsed;
      }
    }
    // Prefer reclaiming a dead/zombie slot over dropping a live-but-idle peer.
    return zombieLRU ?? idleLRU;
  }

  /**
   * Tear down a single pooled connection: cache its state (so
   * {@link ConnectionPoolEvents.onCache} fires and reconnect is fast), close
   * it, remove it from the pool, drop its last-used stamp, and fire
   * {@link ConnectionPoolEvents.onEvict}. Mirrors {@link release} but signals
   * eviction.
   */
  private evictPeer(peerId: string): void {
    const connection = this.connections.get(peerId);
    if (!connection) return;
    this.cacheState(peerId, connection);
    connection.close();
    this.connections.delete(peerId);
    this.lastUsedAt.delete(peerId);
    this.events.onEvict?.(peerId);
  }

  /**
   * Snapshot a peer's current connection state into the cache. Called
   * automatically on {@link release}; safe to call manually when a peer drops
   * but its connection should remain in the pool.
   */
  cacheState(peerId: string, connection: WebRTCConnection): void {
    const peers = connection.getPeers();
    const peerInfo: PeerInfo = peers.find((p) => p.peerId === peerId) ??
      peers[0] ?? {
        peerId,
        playerId: peerId,
        playerName: `Peer-${peerId}`,
        connectionState: connection.getConnectionState(),
        connectedAt: this.now(),
      };
    const cached: CachedConnectionState = {
      peerId,
      peerInfo,
      state: connection.getConnectionState(),
      lastConnectedAt: this.now(),
      lastDroppedAt: this.now(),
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
    if (this.now() - cached.lastDroppedAt > this.cacheTtlMs) {
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
   * Each successful send bumps the peer's `lastUsedAt` so active peers are
   * retained by the LRU policy.
   */
  broadcast(message: P2PMessage): number {
    let sent = 0;
    for (const [peerId, connection] of this.connections) {
      if (connection.isConnected()) {
        connection.send(message);
        this.markUsed(peerId);
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
    this.lastUsedAt.clear();
    this.cache.clear();
  }

  /**
   * Single sweep that pings every connected pooled connection. Replaces the
   * N independent per-connection ping intervals from webrtc-p2p.ts. A
   * successful healthy ping bumps the peer's `lastUsedAt` so live links are
   * retained by the LRU policy (disconnected peers are skipped, freezing
   * their stamp so they age into eviction candidates).
   */
  private pingAll(): void {
    for (const [peerId, connection] of this.connections) {
      if (connection.isConnected()) {
        connection.ping();
        this.markUsed(peerId);
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
