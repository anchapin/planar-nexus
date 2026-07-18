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
function makePool(
  options: {
    maxConnections?: number;
    pingIntervalMs?: number;
    cacheTtlMs?: number;
    idleFailureMs?: number;
    idleConnectedMs?: number;
    activeMs?: number;
    now?: () => number;
    createConnection?: (peerId: string) => MockConnection;
    events?: ConstructorParameters<typeof WebRTCConnectionPool>[0]["events"];
  } = {},
) {
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
    idleFailureMs: options.idleFailureMs,
    idleConnectedMs: options.idleConnectedMs,
    activeMs: options.activeMs,
    now: options.now,
    events: options.events,
    createConnection: factory as unknown as (
      peerId: string,
    ) => WebRTCConnection,
  });
  return { pool, created, factory };
}

/**
 * Mutable clock for deterministic eviction tests. Advance `clock.value` to
 * move the pool's notion of "now".
 */
function makeClock(initial = 1_000_000) {
  const clock = { value: initial };
  return { clock, now: () => clock.value };
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
      const onEvict = jest.fn();
      const { pool } = makePool({
        maxConnections: 2,
        events: { onPoolFull, onEvict },
      });

      expect(pool.acquire("p1")).not.toBeNull();
      expect(pool.acquire("p2")).not.toBeNull();
      // Third peer exceeds the cap of 2; both slots are freshly used (active),
      // so nothing is evictable and the pool refuses.
      expect(pool.acquire("p3")).toBeNull();
      expect(pool.size).toBe(2);
      expect(pool.capacity).toBe(2);
      expect(onPoolFull).toHaveBeenCalledTimes(1);
      expect(onPoolFull).toHaveBeenCalledWith("p3", { evictedPeerIds: [] });
      expect(onEvict).not.toHaveBeenCalled();
    });

    it("allows new connections once a slot is released", () => {
      const { pool } = makePool({ maxConnections: 1 });

      pool.acquire("p1");
      expect(pool.acquire("p2")).toBeNull();
      pool.release("p1");
      expect(pool.acquire("p2")).not.toBeNull();
    });
  });

  describe("idle / LRU eviction (issue #1427)", () => {
    // Each test injects a mutable clock so eviction thresholds are evaluated
    // deterministically without jest fake timers.
    it("acquire succeeds when the pool has room (no eviction)", () => {
      const { clock, now } = makeClock();
      const onEvict = jest.fn();
      const { pool } = makePool({
        maxConnections: 4,
        now,
        events: { onEvict },
      });

      clock.value = 0;
      expect(pool.acquire("p1")).not.toBeNull();
      expect(pool.size).toBe(1);
      expect(onEvict).not.toHaveBeenCalled();
    });

    it("refuses when full and every peer is actively in use (last-used < activeMs)", () => {
      const { clock, now } = makeClock();
      const onPoolFull = jest.fn();
      const onEvict = jest.fn();
      const { pool } = makePool({
        maxConnections: 2,
        activeMs: 30_000,
        now,
        events: { onPoolFull, onEvict },
      });

      clock.value = 0;
      pool.acquire("p1");
      pool.acquire("p2");
      // Only 5s elapse — both peers are still "active".
      clock.value = 5_000;
      expect(pool.acquire("p3")).toBeNull();
      expect(pool.size).toBe(2);
      expect(onEvict).not.toHaveBeenCalled();
      expect(onPoolFull).toHaveBeenCalledWith("p3", { evictedPeerIds: [] });
    });

    it("evicts a dead (disconnected) connection past idleFailureMs to admit a new peer", () => {
      const { clock, now } = makeClock();
      const onEvict = jest.fn();
      const onPoolFull = jest.fn();
      const { pool, created } = makePool({
        maxConnections: 2,
        idleFailureMs: 60_000,
        now,
        events: { onEvict, onPoolFull },
      });

      clock.value = 0;
      pool.acquire("p1");
      pool.acquire("p2");
      // p1 drops and stays gone past the failure grace period.
      created.p1.connected = false;
      clock.value = 61_000;
      // Pool is full, but p1 is a dead, expired candidate.
      const conn = pool.acquire("p3");

      expect(conn).not.toBeNull();
      expect(pool.has("p1")).toBe(false);
      expect(pool.has("p3")).toBe(true);
      expect(pool.size).toBe(2);
      expect(created.p1.closed).toBe(true);
      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith("p1");
      expect(onPoolFull).not.toHaveBeenCalled();
    });

    it("does NOT evict a freshly-disconnected peer within the idleFailureMs grace period", () => {
      const { clock, now } = makeClock();
      const { pool, created } = makePool({
        maxConnections: 2,
        idleFailureMs: 60_000,
        now,
      });

      clock.value = 0;
      pool.acquire("p1");
      pool.acquire("p2");
      created.p1.connected = false;
      // Only 10s since last use — within the grace window.
      clock.value = 10_000;
      expect(pool.acquire("p3")).toBeNull();
      expect(pool.has("p1")).toBe(true);
      expect(pool.size).toBe(2);
    });

    it("evicts the LEAST-recently-used candidate (not an arbitrary one)", () => {
      const { clock, now } = makeClock();
      const { pool, created } = makePool({
        maxConnections: 3,
        idleFailureMs: 60_000,
        now,
      });

      // Stagger last-used timestamps: p1 oldest, p3 newest.
      clock.value = 0;
      pool.acquire("p1");
      clock.value = 1_000;
      pool.acquire("p2");
      clock.value = 2_000;
      pool.acquire("p3");
      // All three drop and age past the failure grace period.
      created.p1.connected = false;
      created.p2.connected = false;
      created.p3.connected = false;
      clock.value = 70_000; // age(p1)=70s, age(p2)=69s, age(p3)=68s — all > 60s

      const conn = pool.acquire("p4");
      expect(conn).not.toBeNull();
      // p1 has the oldest lastUsedAt → it must be the one evicted.
      expect(pool.has("p1")).toBe(false);
      expect(pool.has("p2")).toBe(true);
      expect(pool.has("p3")).toBe(true);
      expect(pool.has("p4")).toBe(true);
      expect(created.p1.closed).toBe(true);
      expect(created.p2.closed).toBe(false);
    });

    it("prefers a dead link over an idle-but-connected peer when both are evictable", () => {
      const { clock, now } = makeClock();
      const { pool, created } = makePool({
        maxConnections: 2,
        idleFailureMs: 60_000,
        idleConnectedMs: 600_000,
        now,
      });

      clock.value = 0;
      pool.acquire("p1");
      pool.acquire("p2");
      // p1 dies; p2 stays connected but idle long enough to be evictable too.
      created.p1.connected = false;
      clock.value = 700_000; // > idleConnectedMs (10min) AND > idleFailureMs
      const conn = pool.acquire("p3");

      expect(conn).not.toBeNull();
      // The dead link (p1) is reclaimed even though p2 is also evictable.
      expect(pool.has("p1")).toBe(false);
      expect(pool.has("p2")).toBe(true);
    });

    it("evicts a connected-but-idle peer past idleConnectedMs when no dead links exist", () => {
      const { clock, now } = makeClock();
      const { pool, created } = makePool({
        maxConnections: 2,
        idleConnectedMs: 600_000,
        now,
      });

      clock.value = 0;
      pool.acquire("p1");
      pool.acquire("p2");
      // Both stay connected and idle past the idle-connected threshold.
      clock.value = 601_000;
      const conn = pool.acquire("p3");

      expect(conn).not.toBeNull();
      expect(pool.size).toBe(2);
      // Exactly one slot was reclaimed; the LRU (p1) was chosen.
      expect(pool.has("p1")).toBe(false);
      expect(pool.has("p2")).toBe(true);
      expect(pool.has("p3")).toBe(true);
      expect(created.p1.closed).toBe(true);
    });

    it("never evicts an actively-trafficked peer even when eviction occurs", () => {
      const { clock, now } = makeClock();
      const onEvict = jest.fn();
      const { pool, created } = makePool({
        maxConnections: 2,
        activeMs: 30_000,
        idleFailureMs: 60_000,
        now,
        events: { onEvict },
      });

      clock.value = 0;
      pool.acquire("active");
      pool.acquire("zombie");
      // "active" was just used (within activeMs); "zombie" is dead and old.
      created.zombie.connected = false;
      clock.value = 70_000;
      // Re-mark "active" as freshly used right before the contested acquire.
      pool.markConnectionUsed("active");
      const conn = pool.acquire("p3");

      expect(conn).not.toBeNull();
      // The active peer is retained; the zombie is reclaimed instead.
      expect(pool.has("active")).toBe(true);
      expect(pool.has("zombie")).toBe(false);
      expect(created.active.closed).toBe(false);
      expect(onEvict).toHaveBeenCalledWith("zombie");
    });

    it("eviction tears down cleanly: caches state, closes, removes, fires onCache + onEvict", () => {
      const { clock, now } = makeClock();
      const onCache = jest.fn();
      const onEvict = jest.fn();
      const { pool, created } = makePool({
        maxConnections: 1,
        idleFailureMs: 60_000,
        now,
        events: { onCache, onEvict },
      });

      clock.value = 0;
      pool.acquire("p1");
      created.p1.connected = false;
      clock.value = 61_000;
      pool.acquire("p2");

      expect(created.p1.closed).toBe(true);
      expect(pool.has("p1")).toBe(false);
      // State cached so reconnect can reuse identity.
      expect(pool.hasCachedState("p1")).toBe(true);
      expect(pool.getCachedState("p1")?.peerId).toBe("p1");
      expect(onCache).toHaveBeenCalledWith("p1", expect.any(Object));
      expect(onEvict).toHaveBeenCalledWith("p1");
    });

    it("regression: a stale occupant does not block a later fresh peer", () => {
      const { clock, now } = makeClock();
      const { pool, created } = makePool({
        maxConnections: 8,
        idleFailureMs: 60_000,
        now,
      });

      // Fill the 8-slot pool.
      clock.value = 0;
      for (let i = 1; i <= 8; i++) pool.acquire(`p${i}`);
      // One occupant (p1) goes stale: dropped and gone past the grace period.
      created.p1.connected = false;
      clock.value = 120_000;
      // A later fresh peer must be admitted by reclaiming the stale slot,
      // instead of being refused because the pool reads as "full".
      const conn = pool.acquire("fresh");

      expect(conn).not.toBeNull();
      expect(pool.has("fresh")).toBe(true);
      expect(pool.has("p1")).toBe(false);
      expect(pool.size).toBe(8);
    });

    describe("lastUsedAt tracking", () => {
      it("is stamped on acquire and re-stamped on reuse", () => {
        const { clock, now } = makeClock();
        const { pool } = makePool({ now });

        clock.value = 100;
        pool.acquire("p1");
        expect(pool.getLastUsedAt("p1")).toBe(100);

        clock.value = 500;
        pool.acquire("p1"); // reuse
        expect(pool.getLastUsedAt("p1")).toBe(500);
        expect(pool.getLastUsedAt("unknown")).toBeNull();
      });

      it("is bumped on every broadcast send to a connected peer", () => {
        const { clock, now } = makeClock();
        const { pool } = makePool({ now });

        clock.value = 0;
        pool.acquire("p1");
        expect(pool.getLastUsedAt("p1")).toBe(0);

        clock.value = 1_000;
        pool.broadcast({
          type: "game-action",
          senderId: "local",
          timestamp: 1_000,
          payload: null,
        });
        expect(pool.getLastUsedAt("p1")).toBe(1_000);
      });

      it("is bumped on every successful pooled ping", () => {
        // Uses fake timers so the consolidated sweep advances Date.now.
        jest.useFakeTimers();
        const { pool, created } = makePool({ pingIntervalMs: 1_000 });
        try {
          pool.acquire("p1");
          const before = pool.getLastUsedAt("p1");
          created.p1.connected = true;

          pool.start();
          jest.advanceTimersByTime(1_000);

          expect(created.p1.pingCount).toBe(1);
          expect(pool.getLastUsedAt("p1")).toBeGreaterThan(before as number);
        } finally {
          jest.useRealTimers();
        }
      });

      it("markConnectionUsed lets external traffic keep a peer fresh", () => {
        const { clock, now } = makeClock();
        const { pool } = makePool({ now });

        clock.value = 0;
        pool.acquire("p1");
        clock.value = 5_000;
        pool.markConnectionUsed("p1");
        expect(pool.getLastUsedAt("p1")).toBe(5_000);
        // No-op for unknown peers.
        pool.markConnectionUsed("ghost");
        expect(pool.getLastUsedAt("ghost")).toBeNull();
      });
    });

    describe("evictIdle (proactive)", () => {
      it("evicts all currently-evictable connections and returns their ids", () => {
        const { clock, now } = makeClock();
        const onEvict = jest.fn();
        const { pool, created } = makePool({
          maxConnections: 4,
          idleFailureMs: 60_000,
          now,
          events: { onEvict },
        });

        clock.value = 0;
        pool.acquire("dead1");
        pool.acquire("dead2");
        pool.acquire("live");
        created.dead1.connected = false;
        created.dead2.connected = false;
        clock.value = 61_000;
        // "live" is re-used right before the sweep so it is retained.
        pool.markConnectionUsed("live");

        const evicted = pool.evictIdle();

        expect(evicted.sort()).toEqual(["dead1", "dead2"]);
        expect(pool.has("dead1")).toBe(false);
        expect(pool.has("dead2")).toBe(false);
        expect(pool.has("live")).toBe(true);
        expect(onEvict).toHaveBeenCalledTimes(2);
      });

      it("is a no-op (returns []) when nothing is evictable", () => {
        const { clock, now } = makeClock();
        const { pool } = makePool({ now });

        clock.value = 0;
        pool.acquire("p1");
        clock.value = 1_000;
        expect(pool.evictIdle()).toEqual([]);
        expect(pool.size).toBe(1);
      });
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
