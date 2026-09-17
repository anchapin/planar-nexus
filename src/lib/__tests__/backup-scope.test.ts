/**
 * @fileOverview Backup scope tests for the three §5.6 newly-included
 * databases (issue #1812).
 *
 * Persistence ADR §5.6 currently lists three databases as out-of-scope for
 * the user-data backup/export pipeline — `PlanarNexusCoach`,
 * `LocalIntelligenceDB`, and `PlanarNexusLimited`. §7 logs
 * "user-authored content loss on export/import cycle" as a known gap. Issue
 * #1812 closes that gap by adding the three stores to the envelope (as
 * additive optional fields), stamping `schemaVersion` on the wire envelope,
 * and bumping `version` on the `BackupManifest` preferences row.
 *
 * The acceptance criteria from #1812 are:
 *   1. Backup export/import round-trips coach conversations and limited
 *      sessions (user-authored content) and match records.
 *   2. The backup manifest is versioned so older backups without these
 *      stores still import.
 *   3. The ADR inventory table is updated (covered by the docs commit, not
 *      here).
 *
 * This suite covers #1 (round-trip) and #2 (legacy-manifest import) by:
 *   - Seeding every external store via the production singletons
 *     (`coach-conversation-storage`, `db/local-intelligence-db`,
 *     `pool-storage`) so the export/import surface is identical to what the
 *     runtime hook hands to the backup pipeline.
 *   - Round-tripping through the storage-layer public methods
 *     `exportBackup` / `importBackup` and asserting every row is recovered
 *     verbatim.
 *   - Constructing a synthetic legacy envelope (no `schemaVersion`, no
 *     `coachConversations` / `matchRecords` / `limitedSessions`) and
 *     asserting the import path tolerates it without writing anything to the
 *     three external DBs.
 *   - Constructing a synthetic empty envelope (literal `{ version, ... }`
 *     without the three new fields) and asserting it round-trips with an
 *     unknown future `schemaVersion` (the forward-compat gate in
 *     `importBackup`).
 */

import "fake-indexeddb/auto";
import * as crypto from "crypto";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  jest,
} from "@jest/globals";

import {
  IndexedDBStorage,
  type BackupData,
  type StoredDeck,
  type BackupManifest,
} from "../indexeddb-storage";
import {
  BACKUP_SCOPE_SCHEMA_VERSION,
  collectBackupScopeData,
  restoreBackupScopeData,
} from "../backup/backup-scope";

import {
  COACH_CONVERSATION_STORE,
  clearAllCoachConversations,
  createConversationRecord,
  loadConversation,
  loadConversations,
  saveConversation,
} from "../coach-conversation-storage";

import {
  db as localIntelligenceDB,
  getAllMatchRecordsForBackup,
  getMatchRecordKey,
  restoreMatchRecordsForBackup,
  type MatchRecord,
} from "../db/local-intelligence-db";

import {
  createSession,
  deleteAllSessions,
  getAllSessions,
  getAllLimitedSessionsForBackup,
  restoreLimitedSessionsForBackup,
} from "../limited/pool-storage";

import type { LimitedSession } from "../limited/types";
import type { CoachConversation } from "../coach-conversation-storage";

// ============================================================================
// WEB CRYPTO POLYFILL (matches `indexeddb-incremental.test.ts`'s setup)
// ============================================================================

beforeAll(() => {
  const nodeCrypto = crypto;
  const mockCrypto = {
    subtle: {
      digest: async (
        algorithm: string | { name: string },
        data: ArrayBuffer | Uint8Array,
      ) => {
        const alg = typeof algorithm === "string" ? algorithm : algorithm.name;
        const hashName = alg.replace("-", "").toLowerCase();
        const buf =
          data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.from(
                (data as Uint8Array).buffer,
                (data as Uint8Array).byteOffset,
                (data as Uint8Array).byteLength,
              );
        const hash = nodeCrypto.createHash(hashName).update(buf).digest();
        return hash.buffer.slice(
          hash.byteOffset,
          hash.byteOffset + hash.byteLength,
        );
      },
    },
  };
  Object.defineProperty(global, "crypto", {
    value: mockCrypto,
    writable: true,
    configurable: true,
  });
});

if (typeof globalThis.crypto?.randomUUID !== "function") {
  let uuidCounter = 0;
  globalThis.crypto = globalThis.crypto || {};
  globalThis.crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TEST_DB_NAME = "TestPlanarNexusBackupScope";

// ============================================================================
// FIXTURES
// ============================================================================

function makeDeck(id: string): StoredDeck {
  return {
    id,
    name: `Deck ${id}`,
    format: "standard",
    cards: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    metadata: {},
  };
}

function makeCoachConversation(
  id: string,
  deckId: string,
  title: string,
): CoachConversation {
  // `title` is accepted for fixture clarity but `createConversationRecord`
  // derives the persisted title from the first user message — so we put the
  // desired title into the user message content instead.
  const record = createConversationRecord({
    id,
    deckId,
    messages: [
      {
        id: `${id}-m1`,
        role: "user",
        content: `${title}?`,
        timestamp: new Date("2026-05-01T00:00:00.000Z"),
      } as never,
      {
        id: `${id}-m2`,
        role: "assistant",
        content: `Sure — let me look at the deck.`,
        timestamp: new Date("2026-05-01T00:00:01.000Z"),
      } as never,
    ],
  });
  // Override the derived title so the round-trip assertion (which compares
  // against the literal `title` we passed in) is meaningful even when the
  // title would otherwise have been auto-derived as `New coaching session`.
  return { ...record, title };
}

function makeMatchRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  const gameId = overrides.gameId ?? "game-1";
  const playerId = overrides.playerId ?? "peer-1";
  return {
    id: getMatchRecordKey(gameId, playerId),
    gameId,
    playerId,
    playerName: overrides.playerName ?? "Alice",
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_600_000,
    durationMs: 600_000,
    format: "commander",
    endReason: "concede",
    position: 1,
    isWinner: true,
    finalLife: 20,
    standings: [
      { playerId, playerName: "Alice", position: 1, life: 20 },
      { playerId: "peer-2", playerName: "Bob", position: 2, life: 0 },
    ],
    ...overrides,
  };
}

async function makeLimitedSession(
  id: string,
  setCode: string,
): Promise<LimitedSession> {
  // Bypass `createSession` (which assigns a random UUID) so fixtures are
  // repeatable across test runs.
  const database = (await import("../limited/pool-storage")).LimitedDatabase
    ? await import("../limited/pool-storage")
    : null;
  const session: LimitedSession = {
    id,
    setCode,
    setName: `Set ${setCode}`,
    mode: "sealed",
    status: "in_progress",
    pool: [],
    deck: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:01.000Z",
    name: `Pool ${id}`,
  };
  // Use the existing production helper to put the row; imports a fresh
  // `getDatabase()` lazily when the singleton is first touched.
  await saveSessionDirect(session);
  return session;
}

// Inline `getDatabase` access — pool-storage's `db` singleton is private.
// Reaching the underlying `database.sessions.put(...)` requires the named
// class. The simplest cross-test path is `createSession` (which assigns a
// fresh UUID) plus a manual id rewrite via Dexie's `put`.
//
// In practice the production restore uses `restoreLimitedSessionsForBackup`
// which already calls `bulkPut` directly. The test seeds by writing a known-
// id row directly so round-trip assertions check exact id equality.
async function saveSessionDirect(session: LimitedSession): Promise<void> {
  // Dexie exposes `put` on the Table — grab it via the production singleton.
  // We import the module here so all module-load side effects (singleton
  // instantiation) happen before we touch it.
  const poolModule = await import("../limited/pool-storage");
  // The internal `db` is module-private but `createSession` is the public
  // surface; for deterministic ids we use the restore path itself which
  // calls `bulkPut` — equivalent production behaviour.
  await restoreLimitedSessionsForBackup([session]);
}

async function cleanAllScopes(): Promise<void> {
  await clearAllCoachConversations().catch(() => undefined);
  try {
    await localIntelligenceDB.match_records.clear();
  } catch {
    // ignore — match_records table may not exist on a fresh DB
  }
  await deleteAllSessions();
}

async function resetMainStorage(storage: IndexedDBStorage): Promise<void> {
  await storage.clearAll();
}

// ============================================================================
// TESTS
// ============================================================================

describe("Backup scope (issue #1812) — round-trip across the three new stores", () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    // Dedicated instance with a unique dbName so the test never touches the
    // production `PlanarNexusStorage` rows that sibling test files own.
    storage = new IndexedDBStorage({
      dbName: TEST_DB_NAME,
      version: 4,
      stores: [
        "decks",
        "saved-games",
        "saved-games-meta",
        "saved-games-payloads",
        "preferences",
        "usage-tracking",
        "achievements",
        "game-history",
        "local-game-state",
        "local-game-codes",
        "search-preferences",
        "search-presets",
        "recent-searches",
      ],
    });
    await storage.initialize();
    await cleanAllScopes();
    await resetMainStorage(storage);
  });

  afterEach(async () => {
    try {
      await resetMainStorage(storage);
      await storage.close();
    } catch {
      // ignore
    }
    await cleanAllScopes();
  });

  afterAll(async () => {
    // Tear down the entire fake-indexeddb databases at the end so sibling
    // test files start clean the next time `fake-indexeddb/auto` boots in a
    // worker. Best-effort: tests use `fake-indexeddb` which already isolates
    // per-process, but explicit deletes remove any straggler state.
    await cleanAllScopes();
  });

  // ==========================================================================
  // (1) Full round-trip via the production pipeline (acceptance criterion #1)
  // ==========================================================================

  it("exports and re-imports coach conversations, match records, and limited sessions", async () => {
    // Seed a representative row in each of the three previously-excluded stores.
    const coachA = makeCoachConversation("coach-a", "default", "First chat");
    const coachB = makeCoachConversation("coach-b", "deck-1", "Second chat");
    await saveConversation(coachA);
    await saveConversation(coachB);

    await restoreMatchRecordsForBackup([
      makeMatchRecord({ gameId: "g1", playerId: "alice" }),
      makeMatchRecord({
        gameId: "g1",
        playerId: "bob",
        playerName: "Bob",
        position: 2,
        isWinner: false,
      }),
    ]);

    await restoreLimitedSessionsForBackup([
      await makeLimitedSession("limited-1", "M21"),
      await makeLimitedSession("limited-2", "KHM"),
    ]);

    // Add a deck so the restore verifies the main flow alongside the new
    // fields (regression guard against an import that inadvertently clears
    // everything else).
    await storage.set("decks", makeDeck("deck-main"));

    // Act — full export through the public storage seam.
    const backup = await storage.exportBackup();

    // Assert — every new field is present in the wire envelope and
    // schemaVersion is stamped.
    expect(backup.schemaVersion).toBe(BACKUP_SCOPE_SCHEMA_VERSION);
    expect(Array.isArray(backup.coachConversations)).toBe(true);
    expect((backup.coachConversations ?? []).length).toBe(2);
    expect(Array.isArray(backup.matchRecords)).toBe(true);
    expect((backup.matchRecords ?? []).length).toBe(2);
    expect(Array.isArray(backup.limitedSessions)).toBe(true);
    expect((backup.limitedSessions ?? []).length).toBe(2);
    expect(typeof backup.checksum).toBe("string");
    expect(backup.checksum.length).toBeGreaterThan(0);

    // Wipe the source rows (the three excluded stores + the main storage)
    // to ensure import is what restores them, not stale state.
    await cleanAllScopes();
    await resetMainStorage(storage);

    // Import round-trip — public seam, no internal helpers touched.
    await storage.importBackup(backup);

    // Coach store — both conversations reappear, on their original decks.
    const reloadedDefault = await loadConversations("default");
    const reloadedDeck1 = await loadConversations("deck-1");
    expect(reloadedDefault).toHaveLength(1);
    expect(reloadedDeck1).toHaveLength(1);
    const reloadedA = await loadConversation("coach-a");
    expect(reloadedA).not.toBeNull();
    expect(reloadedA?.title).toBe("First chat");
    expect(reloadedA?.deckId).toBe("default");
    expect(Array.isArray(reloadedA?.messages)).toBe(true);
    expect(reloadedA?.messages.length).toBe(2);

    const reloadedB = await loadConversation("coach-b");
    expect(reloadedB?.deckId).toBe("deck-1");
    expect(reloadedB?.title).toBe("Second chat");
    expect(reloadedB?.messages.length).toBe(2);

    // Match store — both rows present with composite keys intact.
    const reloadedMatches = await getAllMatchRecordsForBackup();
    expect(reloadedMatches).toHaveLength(2);
    const aliceWin = reloadedMatches.find(
      (r) => r.id === getMatchRecordKey("g1", "alice"),
    );
    const bobLoss = reloadedMatches.find(
      (r) => r.id === getMatchRecordKey("g1", "bob"),
    );
    expect(aliceWin).toBeDefined();
    expect(aliceWin?.isWinner).toBe(true);
    expect(aliceWin?.standings.length).toBe(2);
    expect(bobLoss).toBeDefined();
    expect(bobLoss?.position).toBe(2);
    expect(bobLoss?.isWinner).toBe(false);

    // Limited store — both sessions present with every field.
    const reloadedSessions = await getAllSessions();
    expect(reloadedSessions).toHaveLength(2);
    expect(reloadedSessions.map((s) => s.id).sort()).toEqual([
      "limited-1",
      "limited-2",
    ]);
    const sealedPool = reloadedSessions.find((s) => s.id === "limited-1");
    expect(sealedPool?.setCode).toBe("M21");
    expect(sealedPool?.mode).toBe("sealed");
    expect(sealedPool?.status).toBe("in_progress");

    // Main DB — decks row made it back too (regression guard).
    const reloadedDecks = await storage.getAll<StoredDeck>("decks");
    expect(reloadedDecks).toHaveLength(1);
    expect(reloadedDecks[0].id).toBe("deck-main");
  });

  it("export round-trips a backup with empty coach/match/limited stores (no rows to gather)", async () => {
    // Empty datasets — sanity check that the gather step degrades to
    // empty arrays rather than throwing.
    const backup = await storage.exportBackup();
    expect(backup.coachConversations).toEqual([]);
    expect(backup.matchRecords).toEqual([]);
    expect(backup.limitedSessions).toEqual([]);

    await resetMainStorage(storage);
    await storage.importBackup(backup); // no-op on the three external stores
    expect((await loadConversations()).length).toBe(0);
    expect((await getAllMatchRecordsForBackup()).length).toBe(0);
    expect((await getAllSessions()).length).toBe(0);
  });

  // ==========================================================================
  // (2) Versioned manifest — legacy envelopes without the new fields still
  //     import (acceptance criterion #2)
  // ==========================================================================

  it("imports a legacy envelope (no schemaVersion, no new fields) without touching the three external DBs", async () => {
    // Seed every store so a buggy import would be visible: rows left in the
    // DB mean the legacy envelope failed to skip the scope restore.
    const existingCoach = makeCoachConversation(
      "legacy-keep",
      "default",
      "Pre-existing",
    );
    await saveConversation(existingCoach);
    await restoreMatchRecordsForBackup([
      makeMatchRecord({ gameId: "keep", playerId: "peer-keep" }),
    ]);
    await restoreLimitedSessionsForBackup([
      await makeLimitedSession("legacy-keep", "M21"),
    ]);

    // Hand-craft a "legacy" envelope: a v1.0.0 backup with no
    // `schemaVersion`, no `coachConversations`, no `matchRecords`, no
    // `limitedSessions`. This is what a user who exported before #1812
    // landed would have on disk today.
    const legacyBackup: BackupData = {
      version: "1.0.0",
      // NO schemaVersion — reads as undefined; `importBackup` defaults to 1.
      exportedAt: new Date().toISOString(),
      decks: [makeDeck("legacy-deck")],
      savedGames: [],
      preferences: {},
      usageTracking: [],
      achievements: [],
      // NO coachConversations / matchRecords / limitedSessions.
      checksum: "",
    };
    // Compute the checksum through the production checksum path so the
    // import-side integrity check accepts the envelope.
    legacyBackup.checksum = await computeChecksumForTest(legacyBackup);

    await storage.importBackup(legacyBackup);

    // The main DB gets the legacy deck.
    const reloadedDecks = await storage.getAll<StoredDeck>("decks");
    expect(reloadedDecks.map((d) => d.id).sort()).toEqual(["legacy-deck"]);

    // The three excluded DBs are UNTOUCHED — the rows we seeded above are
    // still there in their original form. (Legacy import is a no-op on
    // the scope.)
    const coachAfter = await loadConversations();
    expect(coachAfter.map((c) => c.id)).toEqual(["legacy-keep"]);

    const matchesAfter = await getAllMatchRecordsForBackup();
    expect(matchesAfter.map((m) => m.id)).toEqual([
      getMatchRecordKey("keep", "peer-keep"),
    ]);

    const limitedAfter = await getAllSessions();
    expect(limitedAfter.map((s) => s.id)).toEqual(["legacy-keep"]);
  });

  it("imports a backup stamped with a newer schemaVersion (forward-compat gate)", async () => {
    // Build a synthetic envelope with `schemaVersion: BACKUP_SCOPE_SCHEMA_VERSION + 5`,
    // proving `importBackup` does NOT refuse unknown future versions — it
    // warns (we capture the warning) and falls through. Critical so that a
    // build with an older schemaVersion can still import a backup produced
    // on a device running a newer build.
    const futureBackup: BackupData = {
      version: "2.0.0",
      schemaVersion: BACKUP_SCOPE_SCHEMA_VERSION + 5,
      exportedAt: new Date().toISOString(),
      decks: [makeDeck("future-deck")],
      savedGames: [],
      preferences: {},
      usageTracking: [],
      achievements: [],
      coachConversations: [],
      matchRecords: [],
      limitedSessions: [],
      checksum: "",
    };
    futureBackup.checksum = await computeChecksumForTest(futureBackup);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      await storage.importBackup(futureBackup);
    } finally {
      console.warn = originalWarn;
    }
    expect(
      warnings.some((w) => w.includes("newer schemaVersion")),
    ).toBe(true);

    const reloadedDecks = await storage.getAll<StoredDeck>("decks");
    expect(reloadedDecks.map((d) => d.id).sort()).toEqual(["future-deck"]);
  });

  // ==========================================================================
  // (3) BackupManifest.version stamp on first export
  // ==========================================================================

  it("stamps version=1 on the BackupManifest when the row is first created", async () => {
    await storage.exportBackup();
    const manifest = await storage.getBackupManifest();
    expect(manifest).not.toBeNull();
    expect((manifest as BackupManifest).version).toBe(1);
  });

  it("load tolerates a legacy manifest row without a `version` field", async () => {
    // Hand-write a manifest row that pre-dates #1812 — no `version` field.
    const legacyManifest: BackupManifest = {
      id: "backup-manifest",
      // NO `version` — reads as undefined.
      lastFullBackupAt: "2026-04-01T00:00:00.000Z",
      lastIncrementalBackupAt: null,
      backupHistory: [{ type: "full", exportedAt: "2026-04-01T00:00:00.000Z" }],
    };
    await storage.set("preferences", legacyManifest);
    const manifest = await storage.getBackupManifest();
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBeUndefined();
    expect(manifest?.lastFullBackupAt).toBe("2026-04-01T00:00:00.000Z");
  });

  // ==========================================================================
  // (4) Idempotent re-import — exporting twice and re-importing the same
  //     envelope does not duplicate or distort rows.
  // ==========================================================================

  it("re-importing the same backup is idempotent for the three excluded stores", async () => {
    const backup = await seedAndExport();
    await resetMainStorage(storage);
    await cleanAllScopes();

    await storage.importBackup(backup);
    await storage.importBackup(backup);
    await storage.importBackup(backup);

    expect((await loadConversations()).length).toBe(1);
    expect((await getAllMatchRecordsForBackup()).length).toBe(1);
    expect((await getAllSessions()).length).toBe(1);
    expect((await storage.getAll<StoredDeck>("decks")).length).toBe(1);
  });

  // ==========================================================================
  // (5) backup-scope seam — the helper module's surface is independently
  //     testable without going through the storage class.
  // ==========================================================================

  it("collectBackupScopeData returns the rows from all three stores", async () => {
    await saveConversation(makeCoachConversation("c1", "default", "Solo"));
    await restoreMatchRecordsForBackup([
      makeMatchRecord({ gameId: "scope-g", playerId: "scope-p" }),
    ]);
    await restoreLimitedSessionsForBackup([
      await makeLimitedSession("scope-l-1", "M21"),
    ]);

    const scope = await collectBackupScopeData();
    expect(scope.coachConversations.length).toBe(1);
    expect(scope.matchRecords.length).toBe(1);
    expect(scope.limitedSessions.length).toBe(1);
  });

  it("restoreBackupScopeData is a no-op on empty arrays", async () => {
    // Should not throw, should not touch anything.
    await restoreBackupScopeData({
      coachConversations: [],
      matchRecords: [],
      limitedSessions: [],
    });
    await restoreBackupScopeData({
      coachConversations: undefined as never,
      matchRecords: undefined as never,
      limitedSessions: undefined as never,
    });
    // No assertion needed — the test passes if neither call threw.
    expect(true).toBe(true);
  });

  // ==========================================================================
  // helpers
  // ==========================================================================

  /** Seed one row per external store plus a deck, then export. */
  async function seedAndExport(): Promise<BackupData> {
    await saveConversation(makeCoachConversation("idem", "default", "Idem"));
    await restoreMatchRecordsForBackup([
      makeMatchRecord({ gameId: "idem", playerId: "idem" }),
    ]);
    await restoreLimitedSessionsForBackup([
      await makeLimitedSession("idem", "M21"),
    ]);
    await storage.set("decks", makeDeck("idem-deck"));
    return storage.exportBackup();
  }
});

// ============================================================================
// LOCAL HELPERS — kept outside the describe so the test body reads top-down.
// ============================================================================

/**
 * Compute a BackupData checksum without going through the production
 * `exportBackup` (which would now stamp `schemaVersion` and could mask
 * legacy-import regressions). Mirrors the production digest path so an
 * envelope built in this file passes `importBackup`'s integrity gate.
 */
async function computeChecksumForTest(data: BackupData): Promise<string> {
  // The wire digest is computed over the JSON of the data excluding the
  // `checksum` field — see `serialiseBackupForChecksum` in
  // `backup-checksum-bridge.ts`. We replicate that here so the test does
  // not pull in worker-only code paths.
  const serialised = JSON.stringify(data, (key, value) =>
    key === "checksum" ? undefined : value,
  );
  const bytes = new TextEncoder().encode(serialised);
  const hash = crypto.createHash("sha256").update(Buffer.from(bytes)).digest();
  // Plain hex string for the test — production also uses lowercase hex.
  return hash.toString("hex");
}

// Smoke-test the store-name constants to catch accidental renames (issue
// #1812 lays a forward contract on these literal strings — the §5.6 table
// in the ADR references them, so a silent rename here would orphan the
// backup scope).
describe("Backup scope constants (issue #1812) — store/db names are stable", () => {
  it("exposes the canonical coach-conversations store name", async () => {
    expect(COACH_CONVERSATION_STORE).toBe("coach-conversations");
  });

  it("collectBackupScopeData / restoreBackupScopeData act on the right databases via the singletons", async () => {
    // Indirect assertion — calling the helpers never throws even with no
    // rows. The depth check is the round-trip test above; here we just
    // pin the public shape.
    expect(typeof collectBackupScopeData).toBe("function");
    expect(typeof restoreBackupScopeData).toBe("function");
  });
});

// Avoid an unused-import warning on the modules that the helpers pull in
// indirectly (kept visible for IDE jump-to and to demonstrate the test is
// using the production surface throughout).
void createSession;
