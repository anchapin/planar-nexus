/**
 * @fileOverview Comprehensive IndexedDB Storage Implementation
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - IndexedDB wrapper for large datasets
 * - Cross-platform compatibility (browser + Tauri)
 * - Export/import functionality for backups
 * - Storage quota management
 * - Migration from localStorage
 *
 * OWNERSHIP (issue #1722): this module owns the Tier-1 user-data database
 * (`PlanarNexusStorage`) AND the app-wide backup/export machinery (paired with
 * `backup-compression.ts` and the `use-storage-backup.ts` UI hook). New
 * user-data-of-record stores belong here (version bump per the in-file
 * recipe), not in a new database. Persistence decision record:
 * docs/PERSISTENCE_ARCHITECTURE.md.
 */

import {
  classifyWriteError,
  getStorageEstimate,
  QUOTA_WARN_THRESHOLD,
  FALLBACK_QUOTA_BYTES,
} from "./storage-quota";
import {
  calculateChecksumAsync,
  type CalculateChecksumOptions,
  type CalculateChecksumProgress,
} from "./backup/backup-checksum-bridge";
import type { CoachConversation } from "./coach-conversation-storage";
import type { MatchRecord } from "./db/local-intelligence-db";
import type { LimitedSession } from "./limited/types";
import {
  IndexedDBBlockedError,
  registerVersionChangeClose,
} from "./indexeddb-open-events";

/**
 * Schema version of the backup envelope produced by this build. Bumped in
 * lockstep with `BACKUP_SCOPE_SCHEMA_VERSION` in `./backup/backup-scope.ts`
 * (they share a value — duplicated here so the storage layer can stay
 * runtime-independent of the scope helpers, which form a small cycle
 * through `coach-conversation-storage.ts`). The type-only imports above keep
 * the type-graph clean; the functions imported from `backup/backup-scope`
 * are loaded dynamically inside the methods that need them.
 */
const BACKUP_SCOPE_SCHEMA_VERSION = 2;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Database name */
  dbName: string;
  /** Database version */
  version: number;
  /** Object store names */
  stores: string[];
}

/**
 * Incremental backup data — only records changed since a given timestamp
 */
export interface IncrementalBackupData {
  type: "incremental";
  version: string;
  since: string;
  exportedAt: string;
  decks: StoredDeck[];
  savedGames: StoredGame[];
  deletedRecords: Array<{ store: string; id: string }>;
  checksum: string;
}

/**
 * Backup manifest tracking full and incremental backup history
 *
 * Issue #1812 — the manifest row is stamped with `version: 1` on first
 * creation so future schema changes can branch on the persisted value
 * rather than re-deriving it from `backupHistory`. Legacy manifests written
 * before this field existed load with `version === undefined`; readers
 * tolerate that via the `?? 1` convention used by the import path.
 */
export interface BackupManifest {
  id: "backup-manifest";
  /** Schema version of the manifest row itself. Defaults to `1` for legacy rows. */
  version?: number;
  lastFullBackupAt: string | null;
  lastIncrementalBackupAt: string | null;
  backupHistory: Array<{ type: "full" | "incremental"; exportedAt: string }>;
}

/**
 * Export data format for backups
 *
 * Issue #1812 — three additional optional fields (`coachConversations`,
 * `matchRecords`, `limitedSessions`) carry content from the three "not in
 * backup until #1812" databases (persistence ADR §5.6 / §7). They are
 * additive: legacy envelopes that pre-date the field are still valid
 * `BackupData` shapes because each new field is `?`. `schemaVersion` (also
 * optional) names the wire-format version that produced the envelope so
 * future forwards-incompatible changes can branch on the value; legacy
 * envelopes read with `schemaVersion === 1` by the `?? 1` convention used
 * in `importBackup`.
 */
export interface BackupData {
  /** Backup wire-format version (`"1.0.0"`, `"2.0.0"`, ...). */
  version: string;
  /** Schema version of this envelope; legacy envelopes default to `1`. */
  schemaVersion?: number;
  /** When exported */
  exportedAt: string;
  /** All decks */
  decks: StoredDeck[];
  /** All saved games */
  savedGames: StoredGame[];
  /** User preferences */
  preferences: Record<string, unknown>;
  /** Usage tracking */
  usageTracking?: UsageRecord[];
  /** Achievements */
  achievements?: PlayerAchievements[];
  /**
   * Every row in `PlanarNexusCoach.coach-conversations` (issue #1812).
   * Optional because legacy envelopes pre-date this field and continue to
   * import cleanly without it; restore is a no-op when absent.
   */
  coachConversations?: CoachConversationForBackup[];
  /**
   * Every row in `LocalIntelligenceDB.match_records` (issue #1812).
   * Optional; the same legacy-compat rule applies.
   */
  matchRecords?: MatchRecordForBackup[];
  /**
   * Every row in `PlanarNexusLimited.sessions` (issue #1812). Optional;
   * the same legacy-compat rule applies.
   */
  limitedSessions?: LimitedSessionForBackup[];
  /** Integrity checksum */
  checksum: string;
}

/**
 * The wire-shape of a `CoachConversation` as persisted by
 * `PlanarNexusCoach.coach-conversations`. Aliased to the concrete type
 * (imported with `import type` so this file stays free of cross-DB runtime
 * coupling — see the ownership declaration at the top of this file).
 */
export type CoachConversationForBackup = CoachConversation;

/**
 * Wire-shape alias of a `LocalIntelligenceDB.match_records` row.
 */
export type MatchRecordForBackup = MatchRecord;

/**
 * Wire-shape alias of a `PlanarNexusLimited.sessions` row.
 */
export type LimitedSessionForBackup = LimitedSession;

/**
 * Stored deck schema
 */
export interface StoredDeck {
  /** Unique identifier */
  id: string;
  /** Deck name */
  name: string;
  /** Format */
  format: string;
  /** Cards with quantities */
  cards: StoredDeckCard[];
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Deck card with quantity, as persisted in IndexedDB.
 *
 * NOTE (issue #1593): this is intentionally NOT the canonical flat `DeckCard`
 * from "@/lib/card-database" — the serialized storage format wraps the card
 * fields in a nested `card` object. Renamed from the misleading `DeckCard`
 * (which duplicated the canonical name with a different shape) to
 * `StoredDeckCard`, matching the mirror type in deck-storage.ts.
 */
export interface StoredDeckCard {
  /** Card object */
  card: {
    id: string;
    name: string;
    cmc: number;
    colors: string[];
    color_identity: string[];
    type_line: string;
    image_uris?: {
      normal?: string;
      large?: string;
    };
    card_faces?: Array<{
      image_uris?: {
        normal?: string;
        large?: string;
      };
    }>;
  };
  /** Quantity */
  count: number;
}

/**
 * Stored game schema — historical / pre-#1572 monolithic row.
 *
 * New code MUST use {@link StoredGameMeta} (cheap read for the list view)
 * + {@link StoredGamePayload} (heavy blobs) instead. The monolithic type is
 * kept so legacy backups / migration readers can still decode pre-#1572
 * rows that exist transiently during a v2 → v3 upgrade.
 */
export interface StoredGame {
  /** Unique identifier */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When saved */
  savedAt: number;
  /** When created */
  createdAt: number;
  /** Current turn */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: "not_started" | "in_progress" | "paused" | "completed";
  /** Winners */
  winners?: string[];
  /** Auto-save flag */
  isAutoSave: boolean;
  /** Auto-save slot */
  autoSaveSlot?: number;
  /** Game state (serialized) */
  gameStateJson: string;
  /** Replay data (optional) */
  replayJson?: string;
  /** Metadata */
  metadata: Record<string, unknown>;
}

/**
 * Cheap metadata row for the saved-games list view (issue #1572).
 *
 * Persisted to the `saved-games-meta` object store. Carries NO
 * {@code gameStateJson} / {@code replayJson} payloads — those live in the
 * sibling `saved-games-payloads` store and are loaded on demand via
 * {@link StoredGamePayload}.
 *
 * The {@link hasReplay} flag exists so the list view can render the "Share
 * Replay" affordance without paying the cost of fetching the payload row.
 */
export interface StoredGameMeta {
  /** Unique identifier (matches the corresponding payload row, if any). */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When saved */
  savedAt: number;
  /** When created */
  createdAt: number;
  /** Current turn */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: "not_started" | "in_progress" | "paused" | "completed";
  /** Winners */
  winners?: string[];
  /** Auto-save flag */
  isAutoSave: boolean;
  /** Auto-save slot */
  autoSaveSlot?: number;
  /** True iff this save has a replayJson payload row. */
  hasReplay: boolean;
}

/**
 * Heavy payload row for a saved game (issue #1572).
 *
 * Persisted to the `saved-games-payloads` object store keyed by `id`
 * (mirroring the meta row's primary key). Holds the bytes the list view
 * must NOT pull on mount: `gameStateJson` (gzip-compressed JSON, see
 * `game-state-compression.ts`) and the optional `replayJson` (already
 * stringified by the off-thread bridge in #1577).
 */
export interface StoredGamePayload {
  /** Unique identifier (matches the corresponding meta row). */
  id: string;
  /** Compressed game state JSON (see {@link StoredGame.gameStateJson}). */
  gameStateJson: string;
  /** Optional replay JSON (already stringified). */
  replayJson?: string;
}

/**
 * Object-store names introduced by the v2 → v3 split migration (#1572).
 * Exported so callers don't repeat the kebab-case strings and so test
 * fixtures can reference the same constants the production code uses.
 */
export const SAVED_GAMES_META_STORE = "saved-games-meta";
export const SAVED_GAMES_PAYLOAD_STORE = "saved-games-payloads";

/**
 * Usage record for AI tracking
 */
export interface UsageRecord {
  id: string;
  provider: string;
  timestamp: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  model?: string;
  feature?: string;
}

/**
 * Player achievements data
 */
export interface PlayerAchievements {
  id: string;
  playerId: string;
  achievements: Array<{
    achievementId: string;
    currentProgress: number;
    unlocked: boolean;
    unlockedAt?: number;
  }>;
  totalPoints: number;
  lastUpdated: number;
}

/**
 * Storage quota info
 */
export interface StorageQuotaInfo {
  /** Current usage in bytes */
  usage: number;
  /** Quota in bytes */
  quota: number;
  /** Usage percentage */
  percentage: number;
  /** Is approaching limit */
  approachingLimit: boolean;
}

// ============================================================================
// V4 CONSOLIDATION CONSTANTS (issue #1811)
// ============================================================================

/**
 * Issue #1811 — names of the four stores introduced in v3 → v4. Folded in
 * from standalone single-store databases that were "not blessed" by the
 * persistence ADR (docs/PERSISTENCE_ARCHITECTURE.md §1 / §6 stage 1):
 *   - `local-game-state`     ← `PlanarNexusGameDB.games`
 *   - `local-game-codes`     ← `PlanarNexusGameDB.gameCodes`
 *   - `search-preferences`   ← `PlanarNexusSearchDB.preferences`
 *   - `search-presets`       ← `PlanarNexusPresetsDB.search-presets`
 *   - `recent-searches`      ← `PlanarNexusRecentSearchesDB.recent-searches`
 *
 * Exported so callers (and tests) don't repeat the kebab-case strings
 * and so test fixtures reference the same constants the production code
 * uses.
 */
export const LOCAL_GAME_STATE_STORE = "local-game-state";
export const LOCAL_GAME_CODES_STORE = "local-game-codes";
export const SEARCH_PREFERENCES_STORE = "search-preferences";
export const SEARCH_PRESETS_STORE = "search-presets";
export const RECENT_SEARCHES_STORE = "recent-searches";

// ============================================================================
// INDEXEDDB STORAGE CLASS
// ============================================================================

/**
 * Split every row of the legacy monolithic `saved-games` store into the new
 * `saved-games-meta` + `saved-games-payloads` pair (issue #1572, v2 → v3).
 *
 * The onupgradeneeded handler only creates the v3 stores and indexes —
 * it does NOT do the data move. fake-indexeddb's upgrade transaction
 * commits via `setImmediate` after the handler returns, which makes it
 * impossible to keep the transaction alive long enough for async reads
 * (getAll.onsuccess) + follow-up writes; any nested request ends up
 * landing on an aborted transaction. We sidestep the limitation by
 * running the migration in a normal readwrite transaction AFTER the
 * upgrade completes, gated by {@link ensureLegacyV3Split}.
 *
 * Idempotent: rows already present in the meta store are skipped so a
 * re-run of the migration (e.g. after a partial run or a process
 * crash mid-migration) can't overwrite fresh data with stale legacy
 * bytes. The legacy rows are deleted from the `saved-games` store in
 * the same transaction so the v3 split is atomic — if any write fails
 * the entire move rolls back and the next `initialize()` retries.
 *
 * The legacy store itself remains in the schema so a user who
 * downgrades back to a v2 build still finds the meta + payload rows
 * through `exportBackup` / `exportIncrementalBackup` (issue
 * acceptance criterion: "existing restore paths continue to round-trip
 * byte-identically" — the envelope still carries `savedGames: StoredGame[]`,
 * rehydrated from the v3 split via {@link collectSavedGamesForExport}).
 */
async function ensureLegacyV3Split(storage: IndexedDBStorage): Promise<void> {
  if (!storage.hasStore(SAVED_GAMES_META_STORE)) return;
  if (!storage.hasStore(SAVED_GAMES_PAYLOAD_STORE)) return;
  if (!storage.hasStore("saved-games")) return;

  // Cheap fast-path: if meta is non-empty, assume already migrated.
  const existingMeta = await storage.count(SAVED_GAMES_META_STORE);
  if (existingMeta > 0) return;

  const legacyCount = await storage.count("saved-games");
  if (legacyCount === 0) return;

  const legacy = await storage.getAll<StoredGame>("saved-games");
  if (legacy.length === 0) return;

  // Open a readwrite transaction across all three stores and move
  // every legacy row. Skips rows that already have a meta twin so the
  // migration is safe to re-run. The legacy store is cleared in the
  // same transaction so the split is atomic — if any write fails the
  // entire move rolls back and the next `initialize()` retries.
  await new Promise<void>((resolve, reject) => {
    const db = (storage as unknown as { db: IDBDatabase | null }).db;
    if (!db) {
      resolve();
      return;
    }
    const tx = db.transaction(
      ["saved-games", SAVED_GAMES_META_STORE, SAVED_GAMES_PAYLOAD_STORE],
      "readwrite",
    );
    const legacyStore = tx.objectStore("saved-games");
    const meta = tx.objectStore(SAVED_GAMES_META_STORE);
    const payload = tx.objectStore(SAVED_GAMES_PAYLOAD_STORE);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("v3 split tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("v3 split tx aborted"));

    for (const row of legacy) {
      // Idempotency probe — same transaction so the read is consistent
      // with the writes.
      const probe = meta.getKey(row.id);
      probe.onsuccess = () => {
        if (probe.result !== undefined) {
          // Already split (re-run / pre-existing v3 row). Drop the
          // stale legacy copy so the store ends up empty.
          legacyStore.delete(row.id);
          return;
        }
        const metaRow: StoredGameMeta = {
          id: row.id,
          name: row.name,
          format: row.format,
          playerNames: row.playerNames,
          savedAt: row.savedAt,
          createdAt: row.createdAt,
          turnNumber: row.turnNumber,
          currentPhase: row.currentPhase,
          status: row.status,
          winners: row.winners,
          isAutoSave: row.isAutoSave,
          autoSaveSlot: row.autoSaveSlot,
          hasReplay:
            typeof row.replayJson === "string" && row.replayJson.length > 0,
        };
        const payloadRow: StoredGamePayload = {
          id: row.id,
          gameStateJson: row.gameStateJson,
          replayJson: row.replayJson,
        };
        meta.put(metaRow);
        payload.put(payloadRow);
        legacyStore.delete(row.id);
      };
    }
  });
}

// ============================================================================
// V4 CONSOLIDATION (issue #1811) — lazy-loaded module.
//
// The migration code (≈300 lines of IndexedDB cursor + delete logic) lives
// in `./migrations/indexeddb-v4-consolidation.ts` and is dynamically
// imported from `initialize()` below. This keeps the migration out of the
// shared client chunk so every route does not pay ~3 kB minified for code
// that only runs once per user, on first open after the v3 → v4 upgrade.
// See `scripts/check-bundle-budget.mjs` for the per-route shared-chunk
// budget that motivated the split.
// ============================================================================

/**
 * IndexedDB storage implementation with backup support
 */
export class IndexedDBStorage {
  private config: StorageConfig;
  private db: IDBDatabase | null = null;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  /**
   * Initialize database connection
   *
   * Issue #1709: multi-tab version-safety. An open with a higher schema
   * version PENDS FOREVER when another tab holds an older version open
   * (the request fires `blocked` and, unhandled, never settles). This
   * initialize now:
   *
   *   - rejects with `IndexedDBBlockedError` (stable `name`) on
   *     `blocked` — the actionable "another tab holds an older version"
   *     state; callers can surface it and retry once the other tab
   *     closes, instead of hanging.
   *   - registers `onversionchange` on the opened connection (the
   *     reverse direction): when another tab wants to upgrade, we close
   *     promptly, null the cached handle (so the next
   *     `ensureInitialized()` re-opens at the new version), and
   *     broadcast `planar-nexus:db-versionchange` so UI layers can offer
   *     a reload. No UI is rendered from this storage layer.
   */
  async initialize(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
      };

      // Issue #1709: the upgrade is blocked by an open connection in
      // another tab. Reject with a stable, actionable error name instead
      // of pending forever.
      request.onblocked = () => {
        // If the other tab closes later, this request may STILL succeed
        // after we already rejected. Close that late connection instead
        // of leaking it for the rest of the session (the retry opens its
        // own).
        request.onsuccess = () => {
          try {
            request.result.close();
          } catch {
            // already closed — nothing to do
          }
        };
        reject(new IndexedDBBlockedError(this.config.dbName));
      };

      request.onsuccess = () => {
        this.db = request.result;
        // Issue #1709 (reverse direction): another tab requesting a
        // higher version must not stay blocked on us. Close on
        // `versionchange`, drop the cached handle so the next
        // `ensureInitialized()` re-opens, and notify the UI.
        registerVersionChangeClose(request.result, () => {
          this.db = null;
        });
        resolve();
      };

      // request.onupgradeneeded fires below.

      // request.onupgradeneeded fires below.

      // ============================================================================
      // SCHEMA AUDIT (Phase 34)
      // ============================================================================
      // Database: PlanarNexusStorage
      // Current version: 4
      //
      // Object stores (all use keyPath: "id"):
      //
      // | Store                  | Purpose                                | Indexes (keyPath, unique)              |
      // |------------------------|----------------------------------------|----------------------------------------|
      // | decks                  | User-authored decklists                | name, format, createdAt, updatedAt     |
      // | saved-games            | LEGACY pre-#1572 monolithic rows       | name, format, status, savedAt,         |
      // |                        | (empty post-v2→v3 migration; kept      | isAutoSave                             |
      // |                        | for downgrade safety)                  |                                        |
      // | saved-games-meta       | Cheap saved-game metadata for the list | name, format, status, savedAt,         |
      // |                        | view (#1572)                           | isAutoSave                             |
      // | saved-games-payloads   | Heavy payload blobs (gameStateJson +   | (none — id lookup only)                |
      // |                        | replayJson) per save (#1572)           |                                        |
      // | preferences            | User preferences (key/value)           | (none — keyPath lookup only)           |
      // | usage-tracking         | AI provider usage telemetry            | provider, timestamp                    |
      // | achievements           | Per-player achievement progress        | (none — keyPath lookup only)           |
      // | game-history           | Aggregated completed-game records      | date, result, mode                     |
      // | local-game-state       | Per-game session rows for hot-seat /   | gameCode (non-unique — uniqueness      |
      // |                        | local P2P (#1811 — folded from         | is enforced by the                     |
      // |                        | PlanarNexusGameDB v1)                  | local-game-codes store), status,       |
      // |                        |                                        | updatedAt                              |
      // | local-game-codes       | Game-code → gameId lookup index        | (none — id lookup only)                |
      // |                        | (#1811 — folded from                   |                                        |
      // |                        | PlanarNexusGameDB v1)                  |                                        |
      // | search-preferences     | Deck-builder search prefs              | (none — id lookup only)                |
      // |                        | (#1811 — folded from                   |                                        |
      // |                        | PlanarNexusSearchDB v1)                |                                        |
      // | search-presets         | User-authored filter presets          | name, updatedAt                        |
      // |                        | (#1811 — folded from                   |                                        |
      // |                        | PlanarNexusPresetsDB v1)               |                                        |
      // | recent-searches        | LRU list of recent deck-builder        | lastUsedAt                             |
      // |                        | queries (#1811 — folded from           |                                        |
      // |                        | PlanarNexusRecentSearchesDB v1)        |                                        |
      //
      // Version history:
      //   v1 — initial schema (lazy onupgradeneeded creates stores on first open)
      //   v2 — semantic-equivalent to v1, but adds documentation + migration
      //        tests. No destructive changes; existing v1 data is preserved
      //        because the onupgradeneeded handler only creates stores/indexes
      //        that are missing.
      //   v3 — issue #1572 (perf: split saved-games into metadata + payload
      //        stores). Adds saved-games-meta + saved-games-payloads and
      //        migrates every existing saved-games row into the new shape.
      //        The old saved-games store is left in the schema but emptied
      //        so a user who downgrades back to a v2 build still sees the
      //        legacy monolithic rows in the backup envelope (no data loss
      //        in either direction).
      //   v4 — issue #1811 (PERSISTENCE_ARCHITECTURE §6 stage 1). Adds
      //        five new stores — local-game-state, local-game-codes,
      //        search-preferences, search-presets, recent-searches —
      //        folded in from the four standalone single-store
      //        "not blessed" databases listed in the persistence ADR
      //        (PlanarNexusGameDB, PlanarNexusSearchDB, PlanarNexusPresetsDB,
      //        PlanarNexusRecentSearchesDB). The schema is created in
      //        the upgrade handler; the actual data move is run lazily
      //        by ensureLegacyV4Consolidation after open, gated on the
      //        `v4-consolidation-done` marker in `preferences`. The
      //        legacy databases are deleted once their rows land in the
      //        consolidated stores.
      //
      // Migration rules when bumping the schema version:
      //   1. Increment DEFAULT_STORAGE_CONFIG.version.
      //   2. Add the new `else if (oldVersion < N)` branch in the upgrade
      //      handler below. Read `event.oldVersion` to detect the source
      //      version and migrate incrementally.
      //   3. Update the table above.
      //   4. Add a v(N-1)→vN test case to indexeddb-migration.test.ts.
      //
      // NEVER call db.deleteObjectStore() on a store that holds user data
      // without an explicit export + user consent step first.
      // ============================================================================
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // Create object stores if they don't exist
        for (const storeName of this.config.stores) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "id" });

            // Create indexes for common queries
            if (storeName === "decks") {
              store.createIndex("name", "name", { unique: false });
              store.createIndex("format", "format", { unique: false });
              store.createIndex("createdAt", "createdAt", { unique: false });
              store.createIndex("updatedAt", "updatedAt", { unique: false });
            } else if (storeName === "saved-games") {
              store.createIndex("name", "name", { unique: false });
              store.createIndex("format", "format", { unique: false });
              store.createIndex("status", "status", { unique: false });
              store.createIndex("savedAt", "savedAt", { unique: false });
              store.createIndex("isAutoSave", "isAutoSave", { unique: false });
            } else if (storeName === SAVED_GAMES_META_STORE) {
              // #1572 — saved-games-meta mirrors the index set of the legacy
              // saved-games store so list-view filters (format / status /
              // auto-save / savedAt sort) keep working unchanged.
              store.createIndex("name", "name", { unique: false });
              store.createIndex("format", "format", { unique: false });
              store.createIndex("status", "status", { unique: false });
              store.createIndex("savedAt", "savedAt", { unique: false });
              store.createIndex("isAutoSave", "isAutoSave", { unique: false });
            } else if (storeName === SAVED_GAMES_PAYLOAD_STORE) {
              // Payloads are keyed by `id` and only ever fetched by primary
              // key (open-game flow); no secondary indexes needed.
            } else if (storeName === "usage-tracking") {
              store.createIndex("provider", "provider", { unique: false });
              store.createIndex("timestamp", "timestamp", { unique: false });
            } else if (storeName === "game-history") {
              store.createIndex("date", "date", { unique: false });
              store.createIndex("result", "result", { unique: false });
              store.createIndex("mode", "mode", { unique: false });
            } else if (storeName === LOCAL_GAME_STATE_STORE) {
              // #1811 — fold `PlanarNexusGameDB.games`. The original
              // schema had a UNIQUE index on gameCode, but uniqueness is
              // enforced upstream by the `local-game-codes` store (keyPath
              // = gameCode, so duplicate keys overwrite). Marking this
              // index non-unique makes the migration robust against any
              // legacy rows that would have collided on the old unique
              // constraint (the local-game-codes store remains the
              // authoritative gameCode → gameId index).
              store.createIndex("gameCode", "gameCode", { unique: false });
              store.createIndex("status", "status", { unique: false });
              store.createIndex("updatedAt", "updatedAt", { unique: false });
            } else if (storeName === SEARCH_PRESETS_STORE) {
              // #1811 — fold `PlanarNexusPresetsDB.search-presets`.
              store.createIndex("name", "name", { unique: false });
              store.createIndex("updatedAt", "updatedAt", { unique: false });
            } else if (storeName === RECENT_SEARCHES_STORE) {
              // #1811 — fold `PlanarNexusRecentSearchesDB.recent-searches`.
              // LRU eviction walks all entries sorted by `lastUsedAt`, so
              // we index it for an efficient cursor pass.
              store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
            }
            // LOCAL_GAME_CODES_STORE and SEARCH_PREFERENCES_STORE are
            // keyed-by-id-only with no secondary indexes — primary-key
            // lookup is the only access pattern.
          }
        }

        // Reserved for future versioned migrations.
        // v1 → v2: no-op (schema is unchanged; this audit + tests are the
        // only delta). The branch is kept as a marker so future bumps have
        // a clear insertion point.
        if (oldVersion < 2) {
          // intentional no-op
        }

        // v2 → v3 (issue #1572): split every legacy `saved-games` row into
        // its (cheap) meta twin and (heavy) payload row. The legacy store is
        // cleared AFTER the copy so the migration is non-destructive — a
        // user who downgrades back to a v2 build will still find the
        // monolithic rows in their backup envelope (we re-emit them in the
        // backup format) but not in the live store (downgrade is a "best
        // effort" — see #1572 acceptance criteria).
        if (oldVersion < 3 && oldVersion >= 1) {
          // v2 → v3 (#1572) — schema is created in the loop above.
          // The actual data move runs as a lazy migration in
          // {@link ensureLegacyV3Split}, invoked from `initialize()`
          // once the versionchange transaction has committed. Doing
          // the move inside onupgradeneeded trips fake-indexeddb's
          // upgrade-tx auto-commit semantics (and adds risk in real
          // browsers if the user closes the tab mid-handler).
        }

        // v3 → v4 (issue #1811 — PERSISTENCE_ARCHITECTURE §6 stage 1):
        // add local-game-state, local-game-codes, search-preferences,
        // search-presets, recent-searches — schema is created in the
        // loop above. The actual data move (folding rows from
        // PlanarNexusGameDB / PlanarNexusSearchDB / PlanarNexusPresetsDB
        // / PlanarNexusRecentSearchesDB into the new stores, then
        // deleting the legacy DBs) runs lazily in
        // {@link ensureLegacyV4Consolidation} for the same reason as
        // the v3 split (fake-indexeddb's upgrade-tx auto-commit + real
        // browsers' tab-close risk).
        if (oldVersion < 4 && oldVersion >= 1) {
          // schema-only branch — data move is lazy, see
          // {@link ensureLegacyV4Consolidation}.
        }
      };
    });

    // Issue #1572 — once the upgrade (if any) has committed, lazily
    // migrate any remaining legacy saved-games rows into the v3 split.
    // The migration is gated by the meta store being empty, so re-opens
    // are no-ops. Errors are swallowed and logged so a corrupt legacy
    // store can't take the rest of the app down with it.
    if (this.hasStore(SAVED_GAMES_META_STORE)) {
      try {
        await ensureLegacyV3Split(this);
      } catch (error) {
        console.warn(
          "[indexeddb-storage] v3 saved-games split migration failed:",
          error,
        );
      }
    }

    // Issue #1811 — PERSISTENCE_ARCHITECTURE §6 stage 1. Once the v4
    // upgrade has committed, lazily fold every row of the four
    // standalone legacy DBs (PlanarNexusGameDB, PlanarNexusSearchDB,
    // PlanarNexusPresetsDB, PlanarNexusRecentSearchesDB) into the new
    // consolidated stores, then delete the legacy DBs. Gated by a
    // marker row in `preferences`, so re-opens are no-ops. Errors are
    // swallowed and logged (a corrupt legacy store cannot take the
    // rest of the app down).
    //
    // The migration module is dynamically imported so its code lives in
    // a separate webpack chunk and does not bloat the shared client
    // bundle. Re-runs of `initialize()` pay this cost only when the
    // marker row is absent (i.e. the user is mid-upgrade).
    try {
      const { ensureLegacyV4Consolidation } =
        await import("./migrations/indexeddb-v4-consolidation");
      await ensureLegacyV4Consolidation(this);
    } catch (error) {
      console.warn(
        "[indexeddb-storage] v4 consolidation migration failed:",
        error,
      );
    }
  }

  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }
  }

  /**
   * Issue #1572 — defensive guard for callers that want to know whether
   * the v3 stores exist on the currently-opened database before they
   * touch them (test fixtures, hand-crafted configs, pre-upgrade
   * downgrades). Returns false if the DB has not been opened yet.
   */
  hasStore(storeName: string): boolean {
    return !!this.db && this.db.objectStoreNames.contains(storeName);
  }

  /**
   * Get a single item by key
   */
  async get<T>(storeName: string, key: string): Promise<T | null> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get item: ${request.error}`));
      };
    });
  }

  /**
   * Set a single item
   */
  async set<T>(storeName: string, value: T & { id: string }): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(
          classifyWriteError(request.error, "Failed to set item", storeName),
        );
      };
    });
  }

  /**
   * Get all items from a store
   */
  async getAll<T>(storeName: string): Promise<T[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to get all items: ${request.error}`));
      };
    });
  }

  /**
   * Set multiple items in a store using a single transaction.
   * All items are queued before any success callbacks fire.
   */
  async setAll<T>(
    storeName: string,
    values: (T & { id: string })[],
  ): Promise<void> {
    await this.ensureInitialized();

    if (values.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);

      let error: Error | null = null;

      transaction.oncomplete = () => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      transaction.onerror = () => {
        if (!error) {
          error = classifyWriteError(
            transaction.error,
            "Transaction failed",
            storeName,
          );
        }
        reject(error);
      };

      transaction.onabort = () => {
        if (!error && transaction.error) {
          error = classifyWriteError(
            transaction.error,
            "Transaction aborted",
            storeName,
          );
        }
        reject(error || new Error("Transaction aborted"));
      };

      for (const value of values) {
        const request = store.put(value);

        request.onerror = () => {
          if (!error) {
            error = classifyWriteError(
              request.error,
              "Failed to put item",
              storeName,
            );
            transaction.abort();
          }
        };
      }
    });
  }

  /**
   * Bulk put items with optional progress callback.
   * Uses a single transaction for all items.
   * Progress callback fires at batch boundaries to avoid per-item overhead.
   *
   * @param storeName - The object store name
   * @param values - Array of items with id property
   * @param options - Optional settings including batchSize for progress and onProgress callback
   */
  async bulkPut<T>(
    storeName: string,
    values: (T & { id: string })[],
    options?: {
      batchSize?: number;
      onProgress?: (imported: number, total: number) => void;
    },
  ): Promise<void> {
    await this.ensureInitialized();

    if (values.length === 0) return;

    const { batchSize = 500, onProgress } = options ?? {};
    let imported = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);

      let error: Error | null = null;

      transaction.oncomplete = () => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      transaction.onerror = () => {
        if (!error) {
          error = classifyWriteError(
            transaction.error,
            "Transaction failed",
            storeName,
          );
        }
        reject(error);
      };

      transaction.onabort = () => {
        if (!error && transaction.error) {
          error = classifyWriteError(
            transaction.error,
            "Transaction aborted",
            storeName,
          );
        }
        reject(error || new Error("Transaction aborted"));
      };

      let index = 0;

      const queueBatch = () => {
        const batchEnd = Math.min(index + batchSize, values.length);

        while (index < batchEnd) {
          const value = values[index];
          const request = store.put(value);

          request.onerror = () => {
            if (!error) {
              error = classifyWriteError(
                request.error,
                "Failed to put item",
                storeName,
              );
              transaction.abort();
            }
          };

          index++;
        }

        imported = batchEnd;
        if (onProgress) {
          onProgress(imported, values.length);
        }

        if (index < values.length) {
          queueBatch();
        }
      };

      queueBatch();
    });
  }

  /**
   * Delete a single item
   */
  async delete(storeName: string, key: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to delete item: ${request.error}`));
      };
    });
  }

  /**
   * Clear all items from a store
   */
  async clear(storeName: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to clear store: ${request.error}`));
      };
    });
  }

  /**
   * Get count of items in a store
   */
  async count(storeName: string): Promise<number> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error(`Failed to count items: ${request.error}`));
      };
    });
  }

  /**
   * Query items using an index
   */
  async queryByIndex<T>(
    storeName: string,
    indexName: string,
    value: IDBValidKey | IDBKeyRange,
    count?: number,
  ): Promise<T[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);

      const request = index.getAll(value, count);

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(new Error(`Failed to query by index: ${request.error}`));
      };
    });
  }

  /**
   * Export a store as JSON
   */
  async exportStore(storeName: string): Promise<string> {
    const items = await this.getAll(storeName);
    return JSON.stringify(items, null, 2);
  }

  /**
   * Import data into a store
   */
  async importStore(storeName: string, data: string): Promise<void> {
    try {
      const items = JSON.parse(data);
      if (!Array.isArray(items)) {
        throw new Error(`Invalid data for store ${storeName}: expected array`);
      }
      await this.setAll(storeName, items as Array<{ id: string }>);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(
          `Failed to parse JSON for store ${storeName}: ${err.message}`,
        );
      }
      throw err;
    }
  }

  /**
   * Get the backup manifest from preferences store
   */
  async getBackupManifest(): Promise<BackupManifest | null> {
    return this.get<BackupManifest>("preferences", "backup-manifest");
  }

  /**
   * Update the backup manifest after a backup operation
   *
   * Issue #1812 — when the manifest row is created for the first time it
   * is stamped with `version: 1` so future readers can branch on the
   * persisted schema of the row itself. Existing rows loaded from disk
   * keep whatever `version` they carried (usually `undefined` for pre-
   * #1812 rows), which the import path reads as `1` by the convention in
   * `BackupManifest.version`.
   */
  private async updateBackupManifest(
    type: "full" | "incremental",
  ): Promise<void> {
    const existing = await this.getBackupManifest();
    const now = new Date().toISOString();
    const manifest: BackupManifest = existing ?? {
      id: "backup-manifest",
      version: 1,
      lastFullBackupAt: null,
      lastIncrementalBackupAt: null,
      backupHistory: [],
    };

    if (type === "full") {
      manifest.lastFullBackupAt = now;
    } else {
      manifest.lastIncrementalBackupAt = now;
    }

    manifest.backupHistory = [
      ...manifest.backupHistory,
      { type, exportedAt: now },
    ].slice(-20);

    await this.set("preferences", manifest as BackupManifest & { id: string });
  }

  /**
   * Calculate checksum for incremental backup integrity
   */
  private async calculateIncrementalChecksum(
    data: Omit<IncrementalBackupData, "checksum">,
  ): Promise<string> {
    const json = JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(json);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Export only records modified after the given timestamp
   */
  async exportIncrementalBackup(since: Date): Promise<IncrementalBackupData> {
    const sinceISO = since.toISOString();

    const changedDecks = await this.queryByIndex<StoredDeck>(
      "decks",
      "updatedAt",
      IDBKeyRange.lowerBound(sinceISO, true),
    );

    // Issue #1572 — rehydrate the split (meta + payload) stores back into
    // the legacy monolithic `StoredGame[]` shape so the backup envelope is
    // byte-identical to the pre-split format. Restore paths see a single
    // `savedGames` array and import via {@link writeStoredGameToV3} below.
    const savedGames = await this.collectSavedGamesForExport();
    const changedGames = savedGames.filter((g) => g.savedAt > since.getTime());

    const partial: Omit<IncrementalBackupData, "checksum"> = {
      type: "incremental",
      version: "1.0.0",
      since: sinceISO,
      exportedAt: new Date().toISOString(),
      decks: changedDecks,
      savedGames: changedGames,
      deletedRecords: [],
    };

    const checksum = await this.calculateIncrementalChecksum(partial);

    await this.updateBackupManifest("incremental");

    return { ...partial, checksum };
  }

  /**
   * Merge records from an incremental backup without clearing existing data
   */
  async importIncrementalBackup(data: IncrementalBackupData): Promise<void> {
    const { checksum, ...dataToVerify } = data;
    const expected = await this.calculateIncrementalChecksum(dataToVerify);
    if (expected !== checksum) {
      throw new Error(
        "Incremental backup integrity check failed: checksum mismatch",
      );
    }

    for (const deck of data.decks) {
      await this.set("decks", deck);
    }

    // Issue #1572 — write through the meta + payload split (idempotent
    // for rows already migrated). Falls back to the legacy monolithic
    // store if the v3 split stores are missing.
    for (const game of data.savedGames) {
      await this.writeStoredGameToV3(game);
    }

    for (const entry of data.deletedRecords) {
      // Issue #1572 — also delete any v3 meta/payload rows that share
      // the same primary key so a `deletedRecords` entry cleans up
      // every place the record might live.
      if (entry.store === "saved-games") {
        await this.deleteSavedGameEverywhere(entry.id);
      } else {
        await this.delete(entry.store, entry.id);
      }
    }
  }

  /**
   * Issue #1572 — collect every saved-game row (across the legacy
   * `saved-games` store and the new meta + payload split) and join them
   * back into the monolithic `StoredGame` shape that the backup envelope
   * still uses. Prefers the v3 split (more authoritative after the
   * migration has run); falls back to the legacy store for rows that
   * somehow survived without being migrated (e.g. downgrade in flight).
   *
   * Defensive about the v3 stores: if the current `IndexedDBStorage`
   * instance was constructed with a config that doesn't include them
   * (test fixtures, pre-v3 databases, hand-crafted configs), the legacy
   * store is read directly without touching the v3 stores.
   */
  private async collectSavedGamesForExport(): Promise<StoredGame[]> {
    const dbHasMeta =
      this.db &&
      this.db.objectStoreNames.contains(SAVED_GAMES_META_STORE) &&
      this.db.objectStoreNames.contains(SAVED_GAMES_PAYLOAD_STORE);
    const db = this.db;
    if (dbHasMeta && db) {
      const metas = await this.getAll<StoredGameMeta>(SAVED_GAMES_META_STORE);
      if (metas.length > 0) {
        const byId = new Map<string, StoredGamePayload>();
        const payloadRows = await this.getAll<StoredGamePayload>(
          SAVED_GAMES_PAYLOAD_STORE,
        );
        for (const p of payloadRows) byId.set(p.id, p);
        const legacy = await this.getAll<StoredGame>("saved-games");
        const legacyById = new Map<string, StoredGame>();
        for (const g of legacy) legacyById.set(g.id, g);

        return metas.map((m) => {
          const payload = byId.get(m.id);
          const fallback = legacyById.get(m.id);
          return {
            ...m,
            gameStateJson:
              payload?.gameStateJson ?? fallback?.gameStateJson ?? "",
            replayJson: payload?.replayJson ?? fallback?.replayJson,
            metadata: {},
          } satisfies StoredGame;
        });
      }
    }

    // No meta store yet — pre-#1572 backup envelope, just read the
    // legacy store directly.
    return this.getAll<StoredGame>("saved-games");
  }

  /**
   * Issue #1572 — write a legacy {@link StoredGame} into the v3 split
   * (meta + payload) stores. Idempotent for already-split rows. Falls
   * back to the legacy `saved-games` store if the v3 stores are missing
   * (the user is on a database that hasn't been upgraded).
   *
   * Public so module-level helpers like {@link migrateFromLocalStorage}
   * can route through the same code path; not exposed via the singleton.
   */
  async writeStoredGameToV3(game: StoredGame): Promise<void> {
    const meta: StoredGameMeta = {
      id: game.id,
      name: game.name,
      format: game.format,
      playerNames: game.playerNames,
      savedAt: game.savedAt,
      createdAt: game.createdAt,
      turnNumber: game.turnNumber,
      currentPhase: game.currentPhase,
      status: game.status,
      winners: game.winners,
      isAutoSave: game.isAutoSave,
      autoSaveSlot: game.autoSaveSlot,
      hasReplay:
        typeof game.replayJson === "string" && game.replayJson.length > 0,
    };
    const payload: StoredGamePayload = {
      id: game.id,
      gameStateJson: game.gameStateJson,
      replayJson: game.replayJson,
    };

    if (
      this.hasStore(SAVED_GAMES_META_STORE) &&
      this.hasStore(SAVED_GAMES_PAYLOAD_STORE)
    ) {
      await this.set(SAVED_GAMES_META_STORE, meta);
      await this.set(SAVED_GAMES_PAYLOAD_STORE, payload);
      return;
    }

    // Pre-v3 database — write the legacy monolithic row so the data is
    // visible to a v2 reader, and the v2→v3 migration on next open will
    // split it.
    await this.set("saved-games", game);
  }

  /**
   * Issue #1572 — delete a saved game from every store that could hold
   * one (meta + payload + legacy). Used by {@link importIncrementalBackup}
   * when a `deletedRecords` entry targets the saved-games domain.
   */
  private async deleteSavedGameEverywhere(id: string): Promise<void> {
    const targets: string[] = ["saved-games"];
    if (this.db) {
      if (this.db.objectStoreNames.contains(SAVED_GAMES_META_STORE)) {
        targets.push(SAVED_GAMES_META_STORE);
      }
      if (this.db.objectStoreNames.contains(SAVED_GAMES_PAYLOAD_STORE)) {
        targets.push(SAVED_GAMES_PAYLOAD_STORE);
      }
    }
    await Promise.all(targets.map((store) => this.delete(store, id)));
  }

  /**
   * Export all user data as backup.
   *
   * Accepts an optional `onChecksumProgress` callback (issue #1249) so the
   * UI can advance its progress bar in ≤5% increments during the SHA-256
   * digest, instead of appearing to freeze while the worker computes the
   * checksum off-thread.
   *
   * Backward-compatible: callers that pre-date #1249 can `await` this with
   * no arguments; the checksum still completes successfully (the worker
   * simply runs without a progress listener).
   *
   * Issue #1812 — the envelope now also carries `coachConversations`,
   * `matchRecords`, and `limitedSessions` from the three databases that the
   * §5.6 "in backup?" table newly lists as in-scope. The gather step
   * (`collectBackupScopeData`) is fail-soft so a missing / unavailable
   * external DB produces an empty slice and the envelope remains valid.
   */
  async exportBackup(options?: {
    onChecksumProgress?: (progress: CalculateChecksumProgress) => void;
  }): Promise<BackupData> {
    const decks = await this.getAll<StoredDeck>("decks");
    // Issue #1572 — rehydrate meta + payload back into the legacy
    // monolithic shape so the envelope is byte-identical to pre-split
    // backups (the issue's acceptance criterion: existing restore paths
    // round-trip byte-identically).
    const savedGames = await this.collectSavedGamesForExport();
    const preferences =
      await this.getAll<Record<string, unknown>>("preferences");
    const usageTracking = await this.getAll<UsageRecord>("usage-tracking");
    const achievements = await this.getAll<PlayerAchievements>("achievements");

    // Issue #1812 — gather the three excluded databases so a restore
    // recovers user-authored coach conversations, match history, and
    // limited-format pool sessions. Each leg is fail-soft and returns
    // `[]` on error, so a backup taken on a device that never opened the
    // coach route (or never sealed a pool) still produces a well-formed
    // envelope.
    //
    // The scope module is dynamically imported to break an import cycle
    // (`backup-scope.ts` → `coach-conversation-storage.ts` →
    // `indexeddb-storage.ts`) that would otherwise leave the helper
    // undefined at module-load time. The dynamic import is paid only on
    // the first backup, after which the module is cached.
    const { collectBackupScopeData } = await import("./backup/backup-scope");
    const scope = await collectBackupScopeData();

    const backupData: BackupData = {
      version: "1.0.0",
      schemaVersion: BACKUP_SCOPE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      decks,
      savedGames,
      preferences: preferences.reduce(
        (acc, pref) => {
          if (pref && typeof pref === "object" && "id" in pref && pref.id) {
            acc[pref.id as string] = pref as { id: string } & Record<
              string,
              unknown
            >;
          }
          return acc;
        },
        {} as Record<string, { id: string } & Record<string, unknown>>,
      ),
      usageTracking,
      achievements,
      coachConversations: scope.coachConversations,
      matchRecords: scope.matchRecords,
      limitedSessions: scope.limitedSessions,
      checksum: "",
    };

    // Calculate checksum — delegates to the backup-checksum worker bridge
    // (issue #1249) so the SHA-256 digest runs off the main thread.
    backupData.checksum = await this.calculateChecksum(backupData, {
      onProgress: options?.onChecksumProgress,
    });

    await this.updateBackupManifest("full");

    return backupData;
  }

  /**
   * Import data from backup
   *
   * Issue #1812 — legacy envelopes that pre-date the schema versioning
   * surface a `schemaVersion === undefined` here; the `?? 1` reading keeps
   * them on the original restore path while new envelopes land at schema
   * version 2 and may carry the three optional fields described on
   * {@link BackupData}. The three restore legs are fail-soft and skip on
   * an empty / missing array, so the absence of a field in a legacy
   * envelope is indistinguishable from an empty array — both restore
   * without touching the external DBs.
   */
  async importBackup(backupData: BackupData): Promise<void> {
    // Verify checksum
    const checksum = await this.calculateChecksum(backupData);
    if (checksum !== backupData.checksum) {
      throw new Error("Backup integrity check failed: checksum mismatch");
    }

    // Issue #1812 — log the schema version we accepted so an audit trail
    // of legacy-vs-new imports is available. The literal is informational,
    // not a gate: every so-far-defined schemaVersion is forwards-compatible
    // with the current import path because the three new fields are
    // additive.
    const schemaVersion = backupData.schemaVersion ?? 1;
    if (schemaVersion > BACKUP_SCOPE_SCHEMA_VERSION) {
      console.warn(
        "[indexeddb-storage] importing a backup with a newer schemaVersion " +
          `(${schemaVersion}) than this build understands (${BACKUP_SCOPE_SCHEMA_VERSION}); ` +
          "the unknown fields will be ignored.",
      );
    }

    // Import decks
    if (backupData.decks) {
      await this.clear("decks");
      await this.setAll("decks", backupData.decks);
    }

    // Import saved games — issue #1572: split into meta + payload so the
    // list view never loads the heavy payload bytes. The import writes
    // through {@link writeStoredGameToV3}, which falls back to the
    // monolithic store for pre-v3 databases. The clear() calls are
    // guarded by store presence so test fixtures / hand-crafted configs
    // that don't include the v3 stores don't blow up.
    if (backupData.savedGames) {
      await this.clear("saved-games");
      if (this.hasStore(SAVED_GAMES_META_STORE)) {
        await this.clear(SAVED_GAMES_META_STORE);
      }
      if (this.hasStore(SAVED_GAMES_PAYLOAD_STORE)) {
        await this.clear(SAVED_GAMES_PAYLOAD_STORE);
      }
      for (const game of backupData.savedGames) {
        await this.writeStoredGameToV3(game);
      }
    }

    // Import preferences
    if (backupData.preferences) {
      await this.clear("preferences");
      for (const [key, value] of Object.entries(backupData.preferences)) {
        await this.set("preferences", {
          id: key,
          ...(value as Record<string, unknown>),
        });
      }
    }

    // Import usage tracking
    if (backupData.usageTracking) {
      await this.clear("usage-tracking");
      await this.setAll("usage-tracking", backupData.usageTracking);
    }

    // Import achievements
    if (backupData.achievements) {
      await this.clear("achievements");
      await this.setAll("achievements", backupData.achievements);
    }

    // Issue #1812 — restore the three excluded stores (coach conversations,
    // match records, limited sessions) when the envelope carries them. A
    // legacy envelope omits these fields and the restore is a no-op — that
    // is the post-#1812 backward-compat behaviour for backups produced
    // before this issue landed.
    //
    // Dynamic import for the same cycle-avoidance reason as in
    // {@link exportBackup}.
    const { restoreBackupScopeData } = await import(
      "./backup/backup-scope"
    );
    await restoreBackupScopeData({
      coachConversations: backupData.coachConversations ?? [],
      matchRecords: backupData.matchRecords ?? [],
      limitedSessions: backupData.limitedSessions ?? [],
    });
  }

  /**
   * Calculate checksum for backup integrity.
   *
   * Delegates to the backup-checksum worker bridge (issue #1249) so the
   * SHA-256 digest runs off the main thread. Falls back to a synchronous
   * main-thread digest if the worker is unavailable (jsdom, SSR, worker
   * init failure) so the checksum stays byte-identical to the pre-#1249
   * implementation in all environments.
   *
   * Backward compatibility: callers that pre-date the worker integration
   * (`exportBackup`, `importBackup`) can `await` this method without
   * passing options and get identical behaviour. New callers that want
   * progress feedback (e.g. `useStorageBackup`) pass an optional
   * `onProgress` callback that receives `{phase, bytesProcessed, totalBytes}`
   * ticks during the digest.
   */
  private async calculateChecksum(
    data: BackupData,
    options?: CalculateChecksumOptions,
  ): Promise<string> {
    return calculateChecksumAsync(data, options);
  }

  /**
   * Get storage quota information.
   *
   * Delegates to navigator.storage.estimate() (via getStorageEstimate) and the
   * shared QUOTA_WARN_THRESHOLD so the warning boundary is consistent across
   * the app (issue #1085). When the Storage API is unavailable, falls back to a
   * rough payload-size estimate against FALLBACK_QUOTA_BYTES.
   */
  async getStorageQuota(): Promise<StorageQuotaInfo> {
    const estimate = await getStorageEstimate();
    if (estimate.available) {
      return {
        usage: estimate.usage,
        quota: estimate.quota,
        percentage: estimate.ratio * 100,
        approachingLimit:
          estimate.level === "warning" || estimate.level === "critical",
      };
    }

    // Fallback: approximate usage from the stored payload size. Issue
    // #1572 — read the cheap meta store for the size estimate so the
    // fallback itself doesn't pull the heavy payloads. Defensive about
    // the v3 stores: if the current instance wasn't constructed with
    // them (test fixture, pre-v3 database), read the legacy store
    // instead so the call still succeeds.
    const decks = await this.getAll("decks");
    const db = this.db;
    const savedGames: unknown[] = db?.objectStoreNames.contains(
      SAVED_GAMES_META_STORE,
    )
      ? await this.getAll<StoredGameMeta>(SAVED_GAMES_META_STORE)
      : await this.getAll("saved-games");
    const usage = new Blob([JSON.stringify({ decks, savedGames })]).size;
    const percentage = (usage / FALLBACK_QUOTA_BYTES) * 100;

    return {
      usage,
      quota: FALLBACK_QUOTA_BYTES,
      percentage,
      approachingLimit: percentage / 100 >= QUOTA_WARN_THRESHOLD,
    };
  }

  /**
   * Clear all stores
   */
  async clearAll(): Promise<void> {
    for (const storeName of this.config.stores) {
      await this.clear(storeName);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// ============================================================================
// DEFAULT INSTANCE
// ============================================================================

/**
 * Default storage configuration for Planar Nexus
 */
const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  dbName: "PlanarNexusStorage",
  // Issue #1811 — v4 folds the four "not blessed" standalone single-store
  // databases (PlanarNexusGameDB, PlanarNexusSearchDB, PlanarNexusPresetsDB,
  // PlanarNexusRecentSearchesDB) into this DB. Schema is created in the
  // upgrade handler; the data move runs lazily via
  // ensureLegacyV4Consolidation so re-opens are no-ops and a corrupt
  // legacy store cannot take the rest of the app down.
  version: 4,
  stores: [
    "decks",
    "saved-games",
    SAVED_GAMES_META_STORE,
    SAVED_GAMES_PAYLOAD_STORE,
    "preferences",
    "usage-tracking",
    "achievements",
    "game-history",
    LOCAL_GAME_STATE_STORE,
    LOCAL_GAME_CODES_STORE,
    SEARCH_PREFERENCES_STORE,
    SEARCH_PRESETS_STORE,
    RECENT_SEARCHES_STORE,
  ],
};

/**
 * Default IndexedDB storage instance
 */
export const indexedDBStorage = new IndexedDBStorage(DEFAULT_STORAGE_CONFIG);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as { __TAURI__?: unknown }).__TAURI__ !== undefined
  );
}

/**
 * Get appropriate storage implementation
 */
export async function getStorage(): Promise<IndexedDBStorage> {
  // For now, we always use IndexedDB
  // In the future, this could return FileSystemStorage for Tauri
  return indexedDBStorage;
}

/**
 * Migrate game history from localStorage to IndexedDB
 */
export async function migrateGameHistoryToIndexedDB(
  storageInstance?: IndexedDBStorage,
): Promise<void> {
  const storage = storageInstance || (await getStorage());
  const gameHistoryKey = "planar-nexus-game-history";
  const gameHistoryData = localStorage.getItem(gameHistoryKey);

  if (gameHistoryData) {
    try {
      const gameHistory = JSON.parse(gameHistoryData);
      if (Array.isArray(gameHistory)) {
        await storage.setAll("game-history", gameHistory);
        // localStorage.removeItem(gameHistoryKey);
      }
    } catch (error) {
      console.error("Failed to migrate game history:", error);
    }
  }
}

/**
 * Migrate data from localStorage to IndexedDB
 */
export async function migrateFromLocalStorage(): Promise<void> {
  const storage = await getStorage();

  // Migrate game history
  await migrateGameHistoryToIndexedDB();

  // Migrate decks
  const decksKey = "planar_nexus_decks";
  const decksData = localStorage.getItem(decksKey);
  if (decksData) {
    try {
      const decks = JSON.parse(decksData);
      if (Array.isArray(decks)) {
        await storage.setAll("decks", decks);
        // Keep localStorage for now for backward compatibility
        // localStorage.removeItem(decksKey);
      }
    } catch (error) {
      console.error("Failed to migrate decks:", error);
    }
  }

  // Migrate saved games — issue #1572: split each row into meta + payload
  // via the same v3 path the in-place upgrade uses.
  const savedGamesKey = "planar_nexus_saved_games";
  const savedGamesData = localStorage.getItem(savedGamesKey);
  if (savedGamesData) {
    try {
      const savedGames = JSON.parse(savedGamesData);
      if (Array.isArray(savedGames)) {
        for (const game of savedGames) {
          await (storage as IndexedDBStorage).writeStoredGameToV3(game);
        }
        // localStorage.removeItem(savedGamesKey);
      }
    } catch (error) {
      console.error("Failed to migrate saved games:", error);
    }
  }

  // Migrate usage tracking
  const usageKey = "planar_nexus_ai_usage";
  const usageData = localStorage.getItem(usageKey);
  if (usageData) {
    try {
      const usageRecords = JSON.parse(usageData);
      if (Array.isArray(usageRecords)) {
        // Add id to each record for IndexedDB
        const recordsWithIds = usageRecords.map((record, index) => ({
          ...record,
          id: `usage_${record.timestamp}_${index}`,
        }));
        await storage.setAll("usage-tracking", recordsWithIds);
        // localStorage.removeItem(usageKey);
      }
    } catch (error) {
      console.error("Failed to migrate usage tracking:", error);
    }
  }

  // Migrate achievements
  const achievementsPattern = /^planar_nexus_achievements_/;
  const achievementKeys = Object.keys(localStorage).filter((key) =>
    achievementsPattern.test(key),
  );

  for (const key of achievementKeys) {
    try {
      const playerId = key.replace("planar_nexus_achievements_", "");
      const data = localStorage.getItem(key);
      if (data) {
        const achievement = JSON.parse(data);
        await storage.set("achievements", {
          id: playerId,
          ...achievement,
        });
        // localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Failed to migrate achievements for ${key}:`, error);
    }
  }

  console.info("Migration from localStorage to IndexedDB completed");
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
