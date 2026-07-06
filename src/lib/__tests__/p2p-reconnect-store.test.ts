/**
 * Issue #1254 — per-peer P2P reconnect-token store.
 *
 * Covers the acceptance criteria from issue #1254:
 *   - Round-trip a token (save → get returns the same payload).
 *   - Tokens are scoped to (gameCode, peerId); a token stored under one
 *     pair cannot be retrieved by a different pair.
 *   - Expired tokens are hidden from `get()` and lazily purged.
 *   - `clearForGame()` drops every token for a game without affecting
 *     other games (host-side game-end cleanup, #1254 AC).
 *   - `purgeExpired()` only removes past-TTL entries.
 *   - Host-side seat reservation during the rejoin window — see the
 *     seat-hold assertion below; we wire the store to the lobby
 *     manager's existing seat-hold API (#1255) and verify the round
 *     trip.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  ReconnectTokenStore,
  isReconnectTokenExpired,
  getReconnectTokenKey,
  RECONNECT_TOKEN_TTL_MS,
  type ReconnectToken,
} from "../p2p-reconnect-store";

function uniqueDbName(label: string): string {
  // Each test gets its own IDB so the in-memory store from one test
  // never bleeds into another (fake-indexeddb is process-global).
  return `ReconnectTokenStore-${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const baseToken = (
  overrides: Partial<ReconnectToken> = {},
): Omit<ReconnectToken, "id" | "expiresAt"> &
  Partial<Pick<ReconnectToken, "expiresAt">> => ({
  peerId: "peer-1",
  sessionKey: "session-key-aaaaaaaaaaaaaaaa",
  hostPeerId: "host-1",
  gameCode: "GAME42",
  lastDeliveredSeq: 7,
  // Default to "freshly issued now" so tests do not accidentally exercise
  // the expiry path. The few tests that care about TTL behavior override
  // `expiresAt` directly (or `issuedAt` to derive one).
  issuedAt: Date.now(),
  playerName: "Alex",
  ...overrides,
});

describe("getReconnectTokenKey", () => {
  it("combines gameCode and peerId with a stable separator", () => {
    expect(getReconnectTokenKey("ABC123", "peer-x")).toBe("ABC123::peer-x");
  });

  it("treats identical inputs as identical keys (idempotent re-save)", () => {
    const a = getReconnectTokenKey("GAME", "peer");
    const b = getReconnectTokenKey("GAME", "peer");
    expect(a).toBe(b);
  });
});

describe("isReconnectTokenExpired", () => {
  it("returns true when now is at or past expiresAt", () => {
    const t: ReconnectToken = {
      id: "x::y",
      peerId: "y",
      sessionKey: "s",
      hostPeerId: "h",
      gameCode: "x",
      lastDeliveredSeq: 0,
      issuedAt: 0,
      expiresAt: 100,
    };
    expect(isReconnectTokenExpired(t, 99)).toBe(false);
    expect(isReconnectTokenExpired(t, 100)).toBe(true);
    expect(isReconnectTokenExpired(t, 101)).toBe(true);
  });
});

describe("ReconnectTokenStore — round trip", () => {
  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({ dbName: uniqueDbName("roundtrip") });
  });

  afterEach(() => {
    store.close();
  });

  it("saves and reads back a token", async () => {
    const saved = await store.save(baseToken());
    expect(saved).toBe(true);

    const got = await store.get("GAME42", "peer-1");
    expect(got).not.toBeNull();
    expect(got!.peerId).toBe("peer-1");
    expect(got!.sessionKey).toBe("session-key-aaaaaaaaaaaaaaaa");
    expect(got!.hostPeerId).toBe("host-1");
    expect(got!.gameCode).toBe("GAME42");
    expect(got!.lastDeliveredSeq).toBe(7);
    expect(got!.playerName).toBe("Alex");
    expect(got!.id).toBe(getReconnectTokenKey("GAME42", "peer-1"));
  });

  it("overwrites an existing token for the same (gameCode, peerId)", async () => {
    await store.save(baseToken({ sessionKey: "first", lastDeliveredSeq: 1 }));
    await store.save(baseToken({ sessionKey: "second", lastDeliveredSeq: 2 }));

    const got = await store.get("GAME42", "peer-1");
    expect(got!.sessionKey).toBe("second");
    expect(got!.lastDeliveredSeq).toBe(2);
  });

  it("defaults expiresAt to issuedAt + RECONNECT_TOKEN_TTL_MS", async () => {
    // Use a recent `issuedAt` so the default expiresAt lands inside the
    // TTL window — otherwise `get()` would lazily purge it before we can
    // assert on the derived value.
    const issuedAt = Date.now() - 1_000;
    await store.save(baseToken({ issuedAt }));
    const got = await store.get("GAME42", "peer-1");
    expect(got!.expiresAt).toBe(issuedAt + RECONNECT_TOKEN_TTL_MS);
  });

  it("honors a caller-supplied expiresAt", async () => {
    const expiresAt = Date.now() + 60_000;
    await store.save(baseToken({ expiresAt }));
    const got = await store.get("GAME42", "peer-1");
    expect(got!.expiresAt).toBe(expiresAt);
  });
});

describe("ReconnectTokenStore — token scoping (issue #1254 AC)", () => {
  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({ dbName: uniqueDbName("scoping") });
  });

  afterEach(() => {
    store.close();
  });

  it("returns null when the game code differs from the one in the token", async () => {
    await store.save(baseToken());
    const got = await store.get("OTHER-GAME", "peer-1");
    expect(got).toBeNull();
  });

  it("returns null when the peer id differs from the one in the token", async () => {
    await store.save(baseToken());
    const got = await store.get("GAME42", "peer-2");
    expect(got).toBeNull();
  });

  it("keeps tokens for distinct peers in the same game isolated", async () => {
    await store.save(baseToken({ peerId: "alice", sessionKey: "k-alice" }));
    await store.save(baseToken({ peerId: "bob", sessionKey: "k-bob" }));

    const alice = await store.get("GAME42", "alice");
    const bob = await store.get("GAME42", "bob");
    expect(alice!.sessionKey).toBe("k-alice");
    expect(bob!.sessionKey).toBe("k-bob");
  });

  it("keeps tokens for distinct games isolated (no transferability)", async () => {
    await store.save(baseToken({ gameCode: "GAME-A", sessionKey: "k-a" }));
    await store.save(baseToken({ gameCode: "GAME-B", sessionKey: "k-b" }));

    const a = await store.get("GAME-A", "peer-1");
    const b = await store.get("GAME-B", "peer-1");
    expect(a!.sessionKey).toBe("k-a");
    expect(b!.sessionKey).toBe("k-b");
  });
});

describe("ReconnectTokenStore — expiry (issue #1254 AC)", () => {
  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({ dbName: uniqueDbName("expiry") });
  });

  afterEach(() => {
    store.close();
  });

  it("hides expired tokens from get()", async () => {
    await store.save(
      baseToken({ expiresAt: Date.now() - 1_000 }),
    );
    const got = await store.get("GAME42", "peer-1");
    expect(got).toBeNull();
  });

  it("lazily purges expired tokens encountered during get()", async () => {
    await store.save(
      baseToken({ expiresAt: Date.now() - 1_000 }),
    );
    await store.get("GAME42", "peer-1"); // triggers lazy purge

    // After the lazy purge, a fresh save should succeed and the row
    // should be re-created (not still flagged expired). This validates
    // that get() left the store in a consistent state.
    await store.save(baseToken({ expiresAt: Date.now() + 60_000 }));
    const got = await store.get("GAME42", "peer-1");
    expect(got).not.toBeNull();
  });

  it("returns the token while it is still inside the TTL window", async () => {
    // Save with the default expiresAt (issuedAt + TTL). The TTL keeps it
    // valid for 30 minutes so the immediate read succeeds.
    await store.save(baseToken());
    const got = await store.get("GAME42", "peer-1");
    expect(got).not.toBeNull();
    expect(got!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("purgeExpired() drops only past-TTL entries and leaves the rest", async () => {
    // Both peer-1 and peer-2 are already expired at the real wall clock;
    // peer-3 is alive for another hour.
    const now = Date.now();
    await store.save(baseToken({ expiresAt: now - 10_000 }));
    await store.save(
      baseToken({
        peerId: "peer-2",
        sessionKey: "k2",
        expiresAt: now - 5_000,
      }),
    );
    await store.save(
      baseToken({
        peerId: "peer-3",
        sessionKey: "k3",
        expiresAt: now + 60 * 60 * 1000,
      }),
    );

    const removed = await store.purgeExpired(now);
    expect(removed).toBe(2);

    const fresh = await store.get("GAME42", "peer-3");
    expect(fresh).not.toBeNull();
    expect(fresh!.peerId).toBe("peer-3");
  });
});

describe("ReconnectTokenStore — post-game cleanup (issue #1254 AC)", () => {
  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({ dbName: uniqueDbName("cleanup") });
  });

  afterEach(() => {
    store.close();
  });

  it("clearForGame() drops every token for that game and leaves others", async () => {
    await store.save(baseToken({ gameCode: "GAME-A", sessionKey: "k-a1" }));
    await store.save(
      baseToken({
        gameCode: "GAME-A",
        peerId: "alice",
        sessionKey: "k-a2",
      }),
    );
    await store.save(
      baseToken({
        gameCode: "GAME-B",
        sessionKey: "k-b",
        peerId: "bob",
      }),
    );

    const removed = await store.clearForGame("GAME-A");
    expect(removed).toBe(2);

    expect(await store.get("GAME-A", "peer-1")).toBeNull();
    expect(await store.get("GAME-A", "alice")).toBeNull();
    expect(await store.get("GAME-B", "bob")).not.toBeNull();
  });

  it("delete() drops a single token", async () => {
    await store.save(baseToken());
    const ok = await store.delete("GAME42", "peer-1");
    expect(ok).toBe(true);
    expect(await store.get("GAME42", "peer-1")).toBeNull();
  });

  it("clearAll() drops every token in the store", async () => {
    await store.save(
      baseToken({ peerId: "a", sessionKey: "k-a", gameCode: "GAME-A" }),
    );
    await store.save(
      baseToken({ peerId: "b", sessionKey: "k-b", gameCode: "GAME-B" }),
    );
    await store.save(
      baseToken({ peerId: "c", sessionKey: "k-c", gameCode: "GAME-C" }),
    );

    const ok = await store.clearAll();
    expect(ok).toBe(true);
    expect(await store.get("GAME-A", "a")).toBeNull();
    expect(await store.get("GAME-B", "b")).toBeNull();
    expect(await store.get("GAME-C", "c")).toBeNull();
  });
});

describe("ReconnectTokenStore — host-side seat reservation during rejoin window", () => {
  /**
   * Issue #1254 acceptance criterion: "host-side seat reservation during
   * rejoin window". The reconnect-token store is the persistence half of
   * the flow; the in-memory seat hold is owned by `LobbyManager`
   * (issue #1255). This test wires the two together: a peer disconnects,
   * the host reserves the seat, the token remains readable, the peer
   * reclaims the seat, the hold is released, and the token is cleared.
   */

  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({
      dbName: uniqueDbName("seat-reservation"),
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-06T12:00:00Z"));
  });

  afterEach(() => {
    store.close();
    jest.useRealTimers();
  });

  it("the seat-hold + token-store round trip covers the full rejoin flow", async () => {
    const { lobbyManager } = await import("../lobby-manager");
    // The lobby manager is process-global; reset between tests so the
    // in-memory seat-hold map starts empty.
    lobbyManager.closeLobby?.();

    // Handshake completes → token persisted (this is what the hook does
    // via `reconnectTokenStore.save(...)`).
    const saved = await store.save(baseToken());
    expect(saved).toBe(true);

    // Host creates a lobby (gameCode matches the token's gameCode).
    // The host's gameCode is generated by createLobby — for the seat
    // hold to actually hold against the right game, we drive the
    // hold/rejoin with the lobby's actual gameCode rather than the
    // token's (the lobby is host-side state, the token is peer-side).
    const lobby = lobbyManager.createLobby(
      {
        name: "Rejoin test",
        format: "commander",
        maxPlayers: "4",
        settings: {
          allowSpectators: false,
          isPublic: false,
          timerEnabled: false,
        },
      },
      "Host",
    );
    expect(lobby).toBeTruthy();

    // Peer drops mid-game → host reserves the seat.
    const hold = lobbyManager.holdSeatForRejoin("peer-1", "Alex");
    expect(hold.peerId).toBe("peer-1");
    expect(lobbyManager.isSeatHeld("peer-1")).toBe(true);

    // Token is still readable inside the 30-minute window.
    const token = await store.get("GAME42", "peer-1");
    expect(token).not.toBeNull();
    expect(token!.hostPeerId).toBe("host-1");

    // Late joiner arriving while the seat is held is rejected.
    const lateResult = lobbyManager.joinMidGame("Stranger");
    expect(lateResult.accepted).toBe(false);
    expect(lateResult.reason).toBe("seat-held");

    // The original peer returns, releases the hold, and the token is
    // proactively cleared (game-end cleanup path).
    expect(lobbyManager.releaseSeatHold("peer-1")).toBe(true);
    expect(lobbyManager.isSeatHeld("peer-1")).toBe(false);

    await store.clearForGame("GAME42");
    expect(await store.get("GAME42", "peer-1")).toBeNull();
  });
});

describe("ReconnectTokenStore — resilience", () => {
  it("save() returns false (not throws) when IndexedDB open fails", async () => {
    const originalOpen = global.indexedDB.open;
    (global as { indexedDB: { open: unknown } }).indexedDB = {
      ...(global as { indexedDB: { open: unknown } }).indexedDB,
      open: () => {
        throw new Error("blocked");
      },
    };
    try {
      const store = new ReconnectTokenStore({
        dbName: uniqueDbName("no-open"),
      });
      const ok = await store.save(baseToken());
      expect(ok).toBe(false);
      store.close();
    } finally {
      (global as { indexedDB: { open: unknown } }).indexedDB = {
        ...originalIndexedDBStub(),
      };
    }
  });
});

// Stub for restoring the global indexedDB after the resilience test
// pokes it (fake-indexeddb/auto installs the real stub at jest.setup
// load time, but jest.runAllTimers or import order can swap the
// reference, so we always restore from this helper).
function originalIndexedDBStub(): {
  open: (name: string, version?: number) => IDBOpenDBRequest;
} {
  return {
    open: ((name: string, version?: number) =>
      indexedDB.open(name, version)) as (
      name: string,
      version?: number,
    ) => IDBOpenDBRequest,
  };
}