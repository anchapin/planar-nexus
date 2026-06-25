/**
 * WebRTC Connection Pool & Mesh Topology Manager Tests
 * Issue #1021: Implement WebRTC connection reuse for multi-player games
 */

import {
  WebRTCConnectionPool,
  MeshTopologyManager,
  defaultConnectionFactory,
} from "../webrtc-connection-pool";
import { WebRTCConnection } from "../webrtc-p2p";
import type { P2PConnectionState, P2PMessage, PeerInfo } from "../webrtc-p2p";

/**
 * Minimal stand-in for a WebRTCConnection that records the operations the
 * pool/mesh perform, without requiring a real RTCPeerConnection.
 */
class MockPooledConnection {
  peerId: string;
  connected: boolean;
  closed = false;
  pingCount = 0;
  sent: P2PMessage[] = [];
  peerInfo: PeerInfo;
  state: P2PConnectionState;

  constructor(peerId: string, connected = true) {
    this.peerId = peerId;
    this.connected = connected;
    this.state = connected ? "connected" : "disconnected";
    this.peerInfo = {
      peerId,
      playerId: peerId,
      playerName: `Peer-${peerId}`,
      connectionState: this.state,
      connectedAt: Date.now(),
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionState(): P2PConnectionState {
    return this.state;
  }

  getPeers(): PeerInfo[] {
    return [this.peerInfo];
  }

  ping(): void {
    this.pingCount++;
  }

  send(message: P2PMessage): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
    this.connected = false;
    this.state = "disconnected";
  }
}

type MockConnection = MockPooledConnection;

/** Build a pool whose factory hands back controllable mock connections. */
function makePool(options: {
  maxConnections?: number;
  pingIntervalMs?: number;
  cacheTtlMs?: number;
  createConnection?: (peerId: string) => MockConnection;
  events?: ConstructorParameters<typeof WebRTCConnectionPool>[0]["events"];
} = {}) {
  const created: Record<string, MockConnection> = {};
  const factory =
    options.createConnection ??
    ((peerId: string) => {
      created[peerId] = new MockPooledConnection(peerId);
      return created[peerId];
    });
  const pool = new WebRTCConnectionPool({
    localPlayerId: "local",
    maxConnections: options.maxConnections,
    pingIntervalMs: options.pingIntervalMs,
    cacheTtlMs: options.cacheTtlMs,
    events: options.events,
    createConnection: factory as unknown as (peerId: string) => WebRTCConnection,
  });
  return { pool, created, factory };
}

describe("WebRTCConnectionPool", () => {
  describe("acquire / reuse", () => {
    it("creates a new connection for an unknown peer", () => {
      const { pool, created } = makePool();
      const conn = pool.acquire("p1");

      expect(conn).not.toBeNull();
      expect(pool.size).toBe(1);
      expect(pool.has("p1")).toBe(true);
      expect(created.p1).toBeDefined();
    });

    it("reuses the existing connection for a known peer (no duplicate)", () => {
      const { pool, factory } = makePool();
      let creations = 0;
      const wrapped: typeof factory = (peerId) => {
        creations++;
        return factory(peerId);
      };
      // rebuild pool with the counting factory to assert call count
      const countingPool = new WebRTCConnectionPool({
        localPlayerId: "local",
        createConnection: wrapped as unknown as (
          peerId: string,
        ) => WebRTCConnection,
      });

      const first = countingPool.acquire("p1");
      const second = countingPool.acquire("p1");

      expect(first).toBe(second);
      expect(creations).toBe(1);
      expect(countingPool.size).toBe(1);
    });

    it("fires onReuse when a known peer re-acquires", () => {
      const onReuse = jest.fn();
      const { pool } = makePool({ events: { onReuse } });
      pool.acquire("p1");
      pool.acquire("p1");

      expect(onReuse).toHaveBeenCalledTimes(1);
      expect(onReuse).toHaveBeenCalledWith("p1");
    });

    it("rejects an empty peer id", () => {
      const { pool } = makePool();
      expect(() => pool.acquire("")).toThrow("non-empty peerId");
    });
  });

  describe("capacity limit", () => {
    it("refuses new connections once maxConnections is reached", () => {
      const onPoolFull = jest.fn();
      const { pool } = makePool({ maxConnections: 2, events: { onPoolFull } });

      expect(pool.acquire("p1")).not.toBeNull();
      expect(pool.acquire("p2")).not.toBeNull();
      // Third peer exceeds the cap of 2.
      expect(pool.acquire("p3")).toBeNull();
      expect(pool.size).toBe(2);
      expect(pool.capacity).toBe(2);
      expect(onPoolFull).toHaveBeenCalledWith("p3");
    });

    it("allows new connections once a slot is released", () => {
      const { pool } = makePool({ maxConnections: 1 });

      pool.acquire("p1");
      expect(pool.acquire("p2")).toBeNull();
      pool.release("p1");
      expect(pool.acquire("p2")).not.toBeNull();
    });
  });

  describe("release / state caching", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("closes the connection and removes it from the pool", () => {
      const { pool, created } = makePool();
      pool.acquire("p1");
      pool.release("p1");

      expect(pool.has("p1")).toBe(false);
      expect(pool.size).toBe(0);
      expect(created.p1.closed).toBe(true);
    });

    it("caches peer state on release", () => {
      const onCache = jest.fn();
      const { pool } = makePool({ events: { onCache } });
      pool.acquire("p1");
      pool.release("p1");

      const cached = pool.getCachedState("p1");
      expect(cached).not.toBeNull();
      expect(cached?.peerId).toBe("p1");
      expect(cached?.peerInfo.playerId).toBe("p1");
      expect(onCache).toHaveBeenCalledTimes(1);
      expect(onCache.mock.calls[0][0]).toBe("p1");
    });

    it("expires cached state after cacheTtlMs", () => {
      const { pool } = makePool({ cacheTtlMs: 1000 });
      pool.acquire("p1");
      pool.release("p1");
      expect(pool.hasCachedState("p1")).toBe(true);

      jest.advanceTimersByTime(1500);
      expect(pool.getCachedState("p1")).toBeNull();
      expect(pool.hasCachedState("p1")).toBe(false);
    });

    it("clearCachedState removes a single entry", () => {
      const { pool } = makePool();
      pool.acquire("p1");
      pool.release("p1");
      pool.clearCachedState("p1");
      expect(pool.getCachedState("p1")).toBeNull();
    });

    it("cacheState snapshots a connection that stays in the pool", () => {
      const { pool, created } = makePool();
      pool.acquire("p1");
      // Manually cache without releasing.
      pool.cacheState("p1", created.p1 as unknown as WebRTCConnection);
      expect(pool.has("p1")).toBe(true);
      expect(pool.hasCachedState("p1")).toBe(true);
    });

    it("release is a no-op for unknown peers", () => {
      const { pool } = makePool();
      expect(() => pool.release("nope")).not.toThrow();
      expect(pool.size).toBe(0);
    });
  });

  describe("consolidated ping sweep", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("pings every connected connection from a single interval", () => {
      const { pool, created } = makePool({ pingIntervalMs: 1000 });
      pool.acquire("p1");
      pool.acquire("p2");
      // A disconnected peer should be skipped.
      created.p2.connected = false;

      pool.start();
      jest.advanceTimersByTime(1000);

      expect(created.p1.pingCount).toBe(1);
      expect(created.p2.pingCount).toBe(0);

      jest.advanceTimersByTime(1000);
      expect(created.p1.pingCount).toBe(2);
    });

    it("start is idempotent (no duplicate intervals)", () => {
      const { pool, created } = makePool({ pingIntervalMs: 1000 });
      pool.acquire("p1");

      pool.start();
      pool.start();
      jest.advanceTimersByTime(1000);

      expect(created.p1.pingCount).toBe(1);
    });

    it("stop halts the sweep", () => {
      const { pool, created } = makePool({ pingIntervalMs: 1000 });
      pool.acquire("p1");

      pool.start();
      jest.advanceTimersByTime(1000);
      pool.stop();
      jest.advanceTimersByTime(5000);

      expect(created.p1.pingCount).toBe(1);
    });
  });

  describe("broadcast", () => {
    it("sends to every connected connection and returns the count", () => {
      const { pool, created } = makePool();
      pool.acquire("p1");
      pool.acquire("p2");
      pool.acquire("p3");
      created.p2.connected = false;

      const msg: P2PMessage = {
        type: "game-action",
        senderId: "local",
        timestamp: Date.now(),
        payload: null,
      };
      const sent = pool.broadcast(msg);

      expect(sent).toBe(2);
      expect(created.p1.sent).toHaveLength(1);
      expect(created.p2.sent).toHaveLength(0);
      expect(created.p3.sent).toHaveLength(1);
    });
  });

  describe("closeAll", () => {
    it("closes every connection, stops the sweep, and clears cache", () => {
      const { pool, created } = makePool({ pingIntervalMs: 1000 });
      pool.acquire("p1");
      pool.acquire("p2");
      pool.release("p2"); // seeds the cache

      pool.closeAll();

      expect(created.p1.closed).toBe(true);
      expect(pool.size).toBe(0);
      expect(pool.getCachedState("p2")).toBeNull();
    });
  });

  describe("construction validation", () => {
    it("requires a local player id", () => {
      expect(
        () =>
          new WebRTCConnectionPool({
            localPlayerId: "",
          }),
      ).toThrow("localPlayerId is required");
    });

    it("uses sensible defaults", () => {
      const pool = new WebRTCConnectionPool({ localPlayerId: "me" });
      expect(pool.capacity).toBe(8);
    });
  });
});

describe("MeshTopologyManager", () => {
  function makeMesh(peers: string[] = [], maxConnections = 8) {
    const { pool, created } = makePool({ maxConnections });
    const mesh = new MeshTopologyManager({
      localPlayerId: "local",
      pool,
      peers,
    });
    return { mesh, pool, created };
  }

  describe("peer membership", () => {
    it("accepts initial peers but excludes the local player", () => {
      const { mesh } = makeMesh(["p1", "p2", "local"]);
      expect(mesh.peerCount()).toBe(2);
      expect(mesh.getPeers().sort()).toEqual(["p1", "p2"]);
    });

    it("addPeer is idempotent and ignores the local player", () => {
      const { mesh } = makeMesh();
      mesh.addPeer("p1");
      mesh.addPeer("p1");
      mesh.addPeer("local");
      expect(mesh.peerCount()).toBe(1);
    });

    it("removePeer releases the pooled connection", () => {
      const { mesh, pool, created } = makeMesh();
      mesh.addPeer("p1");
      mesh.buildMesh();
      mesh.removePeer("p1");

      expect(mesh.peerCount()).toBe(0);
      expect(pool.has("p1")).toBe(false);
      expect(created.p1.closed).toBe(true);
    });
  });

  describe("buildMesh", () => {
    it("creates connections only for peers not already pooled", () => {
      const { mesh, pool } = makeMesh(["p1", "p2", "p3"]);
      // Pre-seed one connection so it is reused, not recreated.
      pool.acquire("p1");

      const created = mesh.buildMesh();

      expect(created.sort()).toEqual(["p2", "p3"]);
      expect(pool.size).toBe(3);
    });

    it("produces no connections when the mesh is empty", () => {
      const { mesh, pool } = makeMesh();
      expect(mesh.buildMesh()).toEqual([]);
      expect(pool.size).toBe(0);
    });
  });

  describe("getTopology", () => {
    it("returns the full-mesh edges for 4 players (6 edges)", () => {
      // local + 3 peers = 4 participants => n*(n-1)/2 = 6 edges.
      const { mesh } = makeMesh(["p1", "p2", "p3"]);
      const edges = mesh.getTopology();

      expect(edges).toHaveLength(6);
      // Every unordered pair of participants appears exactly once.
      const participants = ["local", "p1", "p2", "p3"];
      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const hasEdge = edges.some(
            ([a, b]) =>
              (a === participants[i] && b === participants[j]) ||
              (a === participants[j] && b === participants[i]),
          );
          expect(hasEdge).toBe(true);
        }
      }
    });

    it("yields no edges for a single participant", () => {
      const { mesh } = makeMesh();
      expect(mesh.getTopology()).toEqual([]);
    });
  });

  describe("broadcast / destroy", () => {
    it("broadcast reaches all connected peers via the pool", () => {
      const { mesh, created } = makeMesh(["p1", "p2"]);
      mesh.buildMesh();
      const msg: P2PMessage = {
        type: "chat",
        senderId: "local",
        timestamp: Date.now(),
        payload: null,
      };
      const reached = mesh.broadcast(msg);

      expect(reached).toBe(2);
      expect(created.p1.sent).toHaveLength(1);
      expect(created.p2.sent).toHaveLength(1);
    });

    it("destroy releases every peer connection but keeps the pool usable", () => {
      const { mesh, pool, created } = makeMesh(["p1", "p2"]);
      mesh.buildMesh();
      mesh.destroy();

      expect(mesh.peerCount()).toBe(0);
      expect(pool.size).toBe(0);
      expect(created.p1.closed).toBe(true);
      expect(created.p2.closed).toBe(true);
      // Pool can accept a new game.
      expect(pool.acquire("p9")).not.toBeNull();
    });
  });

  describe("construction validation", () => {
    it("requires a local player id", () => {
      const pool = new WebRTCConnectionPool({ localPlayerId: "me" });
      expect(
        () =>
          new MeshTopologyManager({
            localPlayerId: "",
            pool,
          }),
      ).toThrow("localPlayerId is required");
    });

    it("requires a pool", () => {
      expect(
        () =>
          new MeshTopologyManager({
            localPlayerId: "me",
            pool: undefined as unknown as WebRTCConnectionPool,
          }),
      ).toThrow("pool is required");
    });
  });
});

describe("defaultConnectionFactory", () => {
  /**
   * Minimal RTCPeerConnection stub sufficient for initialize() on a
   * non-host connection with ICE monitoring disabled.
   */
  let stubConstructed = 0;
  class StubRTCPeerConnection {
    onicecandidate: unknown = null;
    onconnectionstatechange: unknown = null;
    oniceconnectionstatechange: unknown = null;
    constructor(_config?: RTCConfiguration) {
      stubConstructed++;
    }
    async createOffer(): Promise<RTCSessionDescriptionInit> {
      return { type: "offer", sdp: "" };
    }
    async createAnswer(): Promise<RTCSessionDescriptionInit> {
      return { type: "answer", sdp: "" };
    }
    async setLocalDescription(): Promise<void> {}
    async setRemoteDescription(): Promise<void> {}
    async addIceCandidate(): Promise<void> {}
    close(): void {}
  }

  const ORIGINAL_RTCP = global.RTCPeerConnection;

  beforeEach(() => {
    stubConstructed = 0;
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      StubRTCPeerConnection as unknown as typeof RTCPeerConnection;
  });
  afterEach(() => {
    (global as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      ORIGINAL_RTCP;
  });

  it("creates a WebRTCConnection whose ping cadence is externally driven", async () => {
    // ICE monitoring disabled to keep the stub minimal; externalPing is the
    // property under test.
    const conn = defaultConnectionFactory("p1", { enableICEMonitoring: false });

    expect(conn).toBeInstanceOf(WebRTCConnection);
    // externalPing connections expose a public ping() for the sweep driver.
    expect(typeof conn.ping).toBe("function");

    // initialize() constructs the underlying RTCPeerConnection.
    await conn.initialize();
    expect(stubConstructed).toBeGreaterThan(0);

    conn.close();
  });
});
