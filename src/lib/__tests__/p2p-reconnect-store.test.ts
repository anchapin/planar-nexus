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
import {
  DB_VERSIONCHANGE_EVENT,
  INDEXEDDB_BLOCKED_ERROR_NAME,
  IndexedDBBlockedError,
  type DBVersionChangeEventDetail,
} from "../indexeddb-open-events";

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

  // Issue #1811 — list() is the public read-only enumeration API that
  // replaces the second `indexedDB.open` use-reconnect-tokens.ts used
  // to do. The semantics are "every token currently in the store"
  // (no scoping / expiry filtering) — the caller decides what to do
  // with stale rows.
  it("list() returns every persisted token", async () => {
    await store.save(baseToken());
    await store.save(
      baseToken({ peerId: "alice", sessionKey: "k-a", gameCode: "GAME-A" }),
    );
    await store.save(
      baseToken({ peerId: "bob", sessionKey: "k-b", gameCode: "GAME-B" }),
    );

    const all = await store.list();
    expect(all).toHaveLength(3);
    const peerIds = all.map((t) => t.peerId).sort();
    expect(peerIds).toEqual(["alice", "bob", "peer-1"]);
  });

  it("list() returns an empty array when the store is empty", async () => {
    const all = await store.list();
    expect(all).toEqual([]);
  });

  it("list() returns expired tokens alongside live ones (caller decides)", async () => {
    // list() is intentionally unfiltered — issue #1811 leaves expiry
    // handling to the caller (the hook calls purgeExpired() first,
    // then list()). This test pins that contract so a future refactor
    // does not silently re-introduce expiry filtering.
    await store.save(baseToken()); // fresh
    await store.save(
      baseToken({
        peerId: "stale",
        sessionKey: "k-stale",
        expiresAt: Date.now() - 1_000,
      }),
    );

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.peerId === "stale")).toBeDefined();
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
    await store.save(baseToken({ expiresAt: Date.now() - 1_000 }));
    const got = await store.get("GAME42", "peer-1");
    expect(got).toBeNull();
  });

  it("lazily purges expired tokens encountered during get()", async () => {
    await store.save(baseToken({ expiresAt: Date.now() - 1_000 }));
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

describe("ReconnectTokenStore — open lifecycle (issue #1861, §1709)", () => {
  /**
   * Issue #1861 — `ReconnectTokenStore` used to log a warn on
   * `onblocked` and never settle, so the open would pend forever the
   * moment another tab held an older version of
   * `PlanarNexusReconnectTokens` open. The full #1709 lifecycle now
   * rejects with `IndexedDBBlockedError` (matching
   * `IndexedDBStorage.initialize`) and registers `onversionchange` via
   * `registerVersionChangeClose` so other tabs' upgrades never wedge
   * on us. The `PERSISTENCE_ARCHITECTURE.md §5.5` rule 3 (no DB may
   * ship its first version bump until rules 1–2 are in place) is now
   * satisfied for this store.
   *
   * Mirrors the setup of `indexeddb-storage-blocked-upgrade.test.ts`:
   * fake-indexeddb's real multi-connection semantics, plus explicit
   * short jest timeouts so a regression back to a pending open fails
   * fast instead of hanging the suite.
   *
   * Issue #1938: the resilience describe block below used to clobber
   * `global.indexedDB` and restore only a partial stub, so this block
   * had to be declared first to avoid the poison. The resilience test
   * now restores the original global reference, so declaration order
   * no longer matters under `--randomize`.
   */

  /** Raw open of `name` at `version`, resolving with the live connection. */
  const openRaw = (name: string, version: number) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        /* schema content is irrelevant */
      };
    });

  /** Delete `name` ignoring all outcomes (cleanup between tests). */
  const deleteDb = (name: string) =>
    new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });

  /** Let fake-indexeddb drain queued open/upgrade callbacks. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

  /** Capture `planar-nexus:db-versionchange` events on `window`. */
  const captureVersionChangeEvents = () => {
    const seen: DBVersionChangeEventDetail[] = [];
    const listener = (event: Event) => {
      seen.push((event as CustomEvent<DBVersionChangeEventDetail>).detail);
    };
    window.addEventListener(DB_VERSIONCHANGE_EVENT, listener);
    return {
      seen,
      stop: () => window.removeEventListener(DB_VERSIONCHANGE_EVENT, listener),
    };
  };

  // Issue #1861 mirror: openDb() must reject with the stable
  // IndexedDBBlockedError name when another tab holds an older
  // version open. The original implementation logged a warn and
  // never settled (forever pending), so the test carries an
  // explicit short timeout to fail fast on regression. ONE expect
  // per blocked-state test: a second openDb() while oldTab is still
  // open would queue behind the first blocked request in
  // fake-indexeddb (sequential open queue), so the retry case is
  // its own test below.
  it("openDb() rejects with IndexedDBBlockedError when another tab holds an older version open", async () => {
    const dbName = uniqueDbName("blocked");
    // Tab A: open v1 and KEEP the connection open (never closes on
    // versionchange — the pre-#1861 misbehaving tab).
    const oldTab = await openRaw(dbName, 1);
    try {
      const store = new ReconnectTokenStore({ dbName, version: 2 });
      // openDb() is private — reach in to assert the rejection contract.
      await expect(
        (
          store as unknown as {
            openDb: () => Promise<IDBDatabase | null>;
          }
        ).openDb(),
      ).rejects.toMatchObject({ name: INDEXEDDB_BLOCKED_ERROR_NAME });
      store.close();
    } finally {
      oldTab.close();
    }
  }, 4000);

  // Issue #1861 synergy: once the blocking tab closes, a fresh
  // openDb() succeeds — the rejection did not poison the singleton
  // (matching the #1726 init-retry pattern on `card-database`).
  it("openDb() succeeds on retry after the blocking tab closes", async () => {
    const dbName = uniqueDbName("blocked-retry");
    const oldTab = await openRaw(dbName, 1);
    const store = new ReconnectTokenStore({ dbName, version: 2 });

    await expect(
      (
        store as unknown as {
          openDb: () => Promise<IDBDatabase | null>;
        }
      ).openDb(),
    ).rejects.toMatchObject({ name: INDEXEDDB_BLOCKED_ERROR_NAME });

    // The other tab goes away — the upgrade unblocks.
    oldTab.close();
    await tick();

    await expect(
      (
        store as unknown as {
          openDb: () => Promise<IDBDatabase | null>;
        }
      ).openDb(),
    ).resolves.toBeDefined();

    store.close();
  }, 4000);

  // Issue #1861: the public-API contract — connectivity errors never
  // throw to the caller — must survive the new rejection. Each
  // public method is asserted in its own `it()` because
  // fake-indexeddb processes opens for a given db sequentially, and
  // a single blocked request queues every subsequent open for the
  // same db behind the older-version connection. Per-method isolation
  // (fresh dbName + fresh oldTab) keeps each blocked round-trip
  // independent. The contract under test is the graceful-degradation
  // shape, not the open queueing behavior.

  const blockedCases: Array<{
    label: string;
    run: (store: ReconnectTokenStore) => Promise<unknown>;
    expect: (result: unknown) => void;
  }> = [
    {
      label: "save",
      run: (s) => s.save(baseToken()),
      expect: (r) => expect(r).toBe(false),
    },
    {
      label: "get",
      run: (s) => s.get("GAME42", "peer-1"),
      expect: (r) => expect(r).toBeNull(),
    },
    {
      label: "list",
      run: (s) => s.list(),
      expect: (r) => expect(r).toEqual([]),
    },
    {
      label: "delete",
      run: (s) => s.delete("GAME42", "peer-1"),
      expect: (r) => expect(r).toBe(false),
    },
    {
      label: "purgeExpired",
      run: (s) => s.purgeExpired(),
      expect: (r) => expect(r).toBe(0),
    },
    {
      label: "clearForGame",
      run: (s) => s.clearForGame("GAME42"),
      expect: (r) => expect(r).toBe(0),
    },
    {
      label: "clearAll",
      run: (s) => s.clearAll(),
      expect: (r) => expect(r).toBe(false),
    },
  ];

  for (const c of blockedCases) {
    it(`public API method ${c.label}() degrades gracefully when openDb() rejects`, async () => {
      const dbName = uniqueDbName(`blocked-${c.label}`);
      const store = new ReconnectTokenStore({ dbName, version: 2 });
      const oldTab = await openRaw(dbName, 1);
      try {
        const result = await c.run(store);
        c.expect(result);
      } finally {
        oldTab.close();
        store.close();
      }
    });
  }

  // Issue #1861 (reverse direction): when another tab requests a
  // version upgrade, our open connection must auto-close (so the
  // other tab's open completes), the cached handle must be cleared
  // (so the next openDb() re-opens at the new version), and
  // `planar-nexus:db-versionchange` must be broadcast so UI layers
  // can offer a reload prompt.
  it("auto-closes its connection, drops the cached handle, and broadcasts the versionchange event on upgrade", async () => {
    const dbName = uniqueDbName("versionchange");
    const store = new ReconnectTokenStore({ dbName, version: 1 });
    const db = await (
      store as unknown as { openDb: () => Promise<IDBDatabase | null> }
    ).openDb();
    expect(db).not.toBeNull();
    // Grab the live handle so we can prove it gets closed.
    const handle = db as IDBDatabase;
    expect(handle.version).toBe(1);

    const events = captureVersionChangeEvents();
    try {
      // Another tab upgrades to v2 — only completes because we close.
      const upgraded = await openRaw(dbName, 2);
      expect(upgraded.version).toBe(2);
      upgraded.close();
    } finally {
      events.stop();
    }

    // UI layers get a reload prompt carrying the db name.
    expect(events.seen).toEqual([{ dbName }]);

    // The old connection is really closed: per spec a transaction on
    // a closed connection throws InvalidStateError.
    expect(() => handle.transaction("tokens")).toThrow();

    // The cached handle was nulled so the next openDb() re-opens
    // instead of routing transactions at a dead connection.
    expect((store as unknown as { db: IDBDatabase | null }).db).toBeNull();

    store.close();
    await deleteDb(dbName);
  }, 4000);
});

describe("ReconnectTokenStore — resilience", () => {
  it("save() returns false (not throws) when IndexedDB open fails", async () => {
    // Issue #1938: jest `--randomize` shuffles tests within a file, so this
    // test can run anywhere. Hold the ORIGINAL global reference and restore
    // that exact reference afterwards — a spread copy ({...indexedDB}) is a
    // hollow object because fake-indexeddb's methods live on the prototype,
    // and restoring such a stub poisoned every test that ran after this one
    // (open() recursed → the store's try/catch turned it into null tokens).
    const originalIndexedDB = global.indexedDB;
    (global as { indexedDB: { open: unknown } }).indexedDB = {
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
      (global as { indexedDB: unknown }).indexedDB = originalIndexedDB;
    }
  });
});
