/**
 * @fileoverview Issue #1709 — multi-tab IndexedDB upgrades must never hang
 * storage init.
 *
 * Both primary storage layers used to open IndexedDB with only
 * onerror/onsuccess/onupgradeneeded. When another tab holds an older DB
 * version open, the upgrade open fires `blocked` and — unhandled — pends
 * forever (a bricked session). The reverse direction was equally
 * unhandled: open connections never listened for `versionchange`, so the
 * OTHER tab's upgrade hung on us.
 *
 * These tests use fake-indexeddb's real multi-connection semantics to
 * simulate a blocked upgrade in BOTH directions, on BOTH surfaces:
 *
 *   1. Blocked opener — we open a higher version while a lower-version
 *      connection stays open: the open must REJECT with the stable
 *      `IndexedDBBlockedError` name (fast — never hang), and retrying
 *      after the old connection closes must succeed.
 *   2. Versionchange side — another tab bumps the version while OUR
 *      connection is open: our connection must auto-close (the other
 *      tab's open completes), a `planar-nexus:db-versionchange` event
 *      must be dispatched, and stale state must be reset.
 *
 * Every blocked-direction test carries an explicit (short) jest timeout
 * so a regression back to a pending open fails fast instead of hanging
 * the suite for the default 5s per test... and, more importantly, so a
 * hang is attributable to THIS behavior.
 *
 * @jest-environment jsdom
 */

// Mock Orama to avoid ESM issues in Jest (mirrors card-database.test.ts
// and card-database.init-retry.test.ts).
jest.mock("@orama/orama", () => ({
  create: jest.fn().mockResolvedValue({}),
  insertMultiple: jest.fn().mockResolvedValue({}),
  remove: jest.fn().mockResolvedValue({}),
  search: jest.fn().mockResolvedValue({ count: 0, hits: [] }),
}));

jest.mock("@orama/plugin-data-persistence", () => ({
  persist: jest.fn().mockResolvedValue({ some: "data" }),
  restore: jest.fn().mockResolvedValue({}),
}));

import {
  DB_VERSIONCHANGE_EVENT,
  INDEXEDDB_BLOCKED_ERROR_NAME,
  IndexedDBBlockedError,
  registerVersionChangeClose,
  type DBVersionChangeEventDetail,
} from "../indexeddb-open-events";
import { IndexedDBStorage } from "../indexeddb-storage";

/** Raw open of `name` at `version`, resolving with the live connection. */
const openRaw = (name: string, version: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      /* schema content is irrelevant to these scenarios */
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

describe("card database blocked/versionchange handling (issue #1709)", () => {
  const CARD_DB_NAME = "PlanarNexusCardDB";

  beforeEach(() => {
    // Module state (db/searchReady/initPromise/lastInitError) persists
    // across tests in a file — reset to keep each case independent.
    jest.resetModules();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    await deleteDb(CARD_DB_NAME);
  });

  // Re-require after every reset so each test exercises fresh state
  // (mirrors card-database.init-retry.test.ts).
  const fresh = () => {
    let mod: typeof import("../card-database");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh instance per test
      mod = require("../card-database");
    });
    return mod!;
  };

  it(
    "rejects with IndexedDBBlockedError when another tab holds an older version open",
    async () => {
      const { initializeCardDatabase, getDatabaseStatus } = fresh();

      // Tab A: open v1 and KEEP the connection open (never closes on
      // versionchange — the pre-#1709 misbehaving tab).
      const oldTab = await openRaw(CARD_DB_NAME, 1);
      expect(oldTab.version).toBe(1);

      // Tab B (us): initialize at DB_VERSION (2) must reject with the
      // stable blocked-error name instead of pending forever. The jest
      // timeout on this test guards the hang.
      await expect(initializeCardDatabase()).rejects.toMatchObject({
        name: INDEXEDDB_BLOCKED_ERROR_NAME,
      });

      // The failure must be actionable + surfaced via status (#1726).
      const status = await getDatabaseStatus();
      expect(status.loaded).toBe(false);
      expect(status.error).toContain("another tab");

      oldTab.close();
    },
    4000,
  );

  it(
    "retries successfully via #1726 init-retry once the other tab closes",
    async () => {
      const { initializeCardDatabase, getDatabaseStatus } = fresh();

      const oldTab = await openRaw(CARD_DB_NAME, 1);
      await expect(initializeCardDatabase()).rejects.toMatchObject({
        name: INDEXEDDB_BLOCKED_ERROR_NAME,
      });

      // The other tab goes away — the upgrade unblocks.
      oldTab.close();
      await tick();

      // #1726 synergy: the failed init cleared the single-flight cache,
      // so the next call retries the open and now succeeds (no reload,
      // no module reset).
      await expect(initializeCardDatabase()).resolves.toBeUndefined();

      const status = await getDatabaseStatus();
      expect(status.loaded).toBe(true);
      expect(status.error).toBeNull();
    },
    4000,
  );

  it(
    "closes its connection and dispatches the reload event when another tab upgrades",
    async () => {
      const { initializeCardDatabase, getDatabaseStatus } = fresh();

      // Tab B (us) is happily open at DB_VERSION (2)...
      await initializeCardDatabase();
      expect((await getDatabaseStatus()).loaded).toBe(true);

      const events = captureVersionChangeEvents();
      try {
        // Tab A upgrades to v3. Our connection receives `versionchange`
        // and must close promptly — otherwise this open would hang and
        // the test would time out.
        const upgraded = await openRaw(CARD_DB_NAME, 3);
        expect(upgraded.version).toBe(3);
        upgraded.close();
      } finally {
        events.stop();
      }

      // UI layers get a reload prompt carrying the db name (no UI is
      // rendered from the storage layer itself).
      expect(events.seen).toEqual([{ dbName: CARD_DB_NAME }]);

      // Module state was reset — status no longer reports "ready" on the
      // closed connection.
      const status = await getDatabaseStatus();
      expect(status.loaded).toBe(false);
    },
    4000,
  );
});

describe("IndexedDBStorage blocked/versionchange handling (issue #1709)", () => {
  afterEach(async () => {
    await deleteDb("BlockedUpgradeStorage");
    await deleteDb("VersionChangeStorage");
  });

  it(
    "initialize() rejects with IndexedDBBlockedError when another tab holds an older version open",
    async () => {
      const oldTab = await openRaw("BlockedUpgradeStorage", 1);

      const storage = new IndexedDBStorage({
        dbName: "BlockedUpgradeStorage",
        version: 2,
        stores: ["decks"],
      });

      // Must reject with the stable blocked-error name, not hang.
      await expect(storage.initialize()).rejects.toMatchObject({
        name: INDEXEDDB_BLOCKED_ERROR_NAME,
      });

      // The other tab goes away and a fresh initialize succeeds.
      oldTab.close();
      await tick();
      await expect(storage.initialize()).resolves.toBeUndefined();
    },
    4000,
  );

  it(
    "auto-closes its connection, nulls the handle, and dispatches the reload event on versionchange",
    async () => {
      const storage = new IndexedDBStorage({
        dbName: "VersionChangeStorage",
        version: 2,
        stores: ["decks"],
      });
      await storage.initialize();

      // Grab the live handle so we can prove it gets closed.
      const handle = (storage as unknown as { db: IDBDatabase }).db;
      expect(handle.version).toBe(2);

      const events = captureVersionChangeEvents();
      try {
        // Another tab upgrades to v3 — only completes because we close.
        const upgraded = await openRaw("VersionChangeStorage", 3);
        expect(upgraded.version).toBe(3);
        upgraded.close();
      } finally {
        events.stop();
      }

      expect(events.seen).toEqual([{ dbName: "VersionChangeStorage" }]);

      // The old connection is really closed: per spec a transaction on a
      // closed connection throws InvalidStateError.
      expect(() => handle.transaction("decks")).toThrow();

      // The cached handle was nulled so the next ensureInitialized()
      // re-opens instead of routing transactions at a dead connection.
      expect((storage as unknown as { db: IDBDatabase | null }).db).toBeNull();
      expect(storage.hasStore("decks")).toBe(false);
    },
    4000,
  );
});

describe("indexeddb-open-events helpers (issue #1709)", () => {
  it("IndexedDBBlockedError carries the stable name, db name, and actionable message", () => {
    const err = new IndexedDBBlockedError("SomeDB");
    expect(err.name).toBe(INDEXEDDB_BLOCKED_ERROR_NAME);
    expect(err.dbName).toBe("SomeDB");
    expect(err.message).toContain("another tab");
    expect(err).toBeInstanceOf(Error);
  });

  it("registerVersionChangeClose closes, notifies, and survives a repeat fire", async () => {
    const db = await openRaw("OpenEventsHelperDb", 1);
    const closes: string[] = [];
    registerVersionChangeClose(db, () => closes.push(db.name));

    const events = captureVersionChangeEvents();
    try {
      // Only completes because the handler closed `db` on versionchange.
      const v2 = await openRaw("OpenEventsHelperDb", 2);
      expect(v2.version).toBe(2);
      v2.close();
    } finally {
      events.stop();
    }

    expect(closes).toEqual(["OpenEventsHelperDb"]);
    expect(events.seen).toEqual([{ dbName: "OpenEventsHelperDb" }]);
    // The connection really closed (transactions throw per spec).
    expect(() => db.transaction("anything")).toThrow();

    // Defensive repeat fire (the handler stays registered after close):
    // must not throw — close no-ops, the notification re-dispatches.
    // (The handler ignores the event payload; the cast only satisfies
    // the IDBVersionChangeEvent handler signature.)
    expect(() =>
      db.onversionchange?.call(
        db,
        new Event("versionchange") as unknown as IDBVersionChangeEvent,
      ),
    ).not.toThrow();
    expect(closes).toEqual(["OpenEventsHelperDb", "OpenEventsHelperDb"]);

    await deleteDb("OpenEventsHelperDb");
  });
});
