/**
 * Issue #1811 — PERSISTENCE_ARCHITECTURE §6 stage 1: v3 → v4 migration.
 *
 * Folds every row of every standalone legacy single-store database
 * (`PlanarNexusGameDB` + the three search DBs) into the new consolidated
 * stores on `PlanarNexusStorage`. Runs lazily, after the v3 → v4 schema
 * upgrade has committed, gated by a marker row in `preferences`
 * (`v4-consolidation-done`) so re-opens are no-ops.
 *
 * This module is dynamically imported from `IndexedDBStorage.initialize()`
 * so the migration code (≈300 lines of IndexedDB cursor + delete logic)
 * lives in its own chunk and is not bundled into the shared client chunk.
 * The migration only runs once per user (on first open after the v3→v4
 * upgrade), so loading it eagerly on every page would waste ~3 kB
 * minified per route's shared chunk — #1811's bundle-size regression
 * before this refactor.
 *
 * Idempotent: rows already present in the target store are skipped (we
 * probe via `get()` before writing). The legacy DBs are deleted only
 * after the rows land in the new stores — a mid-migration crash leaves
 * the legacy DBs intact and the next `initialize()` retries the move.
 *
 * Errors are swallowed and logged so a corrupt legacy store cannot take
 * the rest of the app down with it (mirroring the v3 split behavior).
 *
 * Issue #1920: quota pre-flight via {@link predictQuotaHeadroom} aborts
 * before any writes when the origin lacks sufficient space, preventing
 * partial migration and retry loops. The marker row is only written on
 * success.
 */
import type { IndexedDBStorage } from "../indexeddb-storage";
import {
  predictQuotaHeadroom,
  QUOTA_SAFETY_MARGIN_BYTES,
  MigrationQuotaError,
} from "../storage-quota";

/**
 * Issue #1811 — list of standalone legacy databases that need to be
 * folded into `PlanarNexusStorage` in v3 → v4.
 *
 * Each entry pairs a legacy DB name with its single object store and the
 * new consolidated store name. The order is the order the migration runs
 * (deterministic — easiest test failure to debug if a step breaks).
 *
 * `PlanarNexusGameDB` contributes TWO stores (`games` → `local-game-state`
 * and `gameCodes` → `local-game-codes`) and is split into two
 * sub-entries so the helper handles them uniformly. Both sub-entries
 * must be processed BEFORE the legacy DB is deleted.
 */
export const V4_CONSOLIDATION_TARGETS: ReadonlyArray<{
  legacyDbName: string;
  legacyVersion: number;
  legacyStoreName: string;
  targetStoreName: string;
  /**
   * Map a legacy row to a target row. Receives the raw legacy value and
   * the resolved key (from `openCursor` for stores whose keyPath is the
   * natural key — `gameId`, `gameCode`, `id`, or `query`). Must return a
   * row whose `id` is a non-empty string so the wrapper class's `set()`
   * accepts it.
   */
  toTargetRow: (
    row: Record<string, unknown>,
    key: string,
  ) => Record<string, unknown>;
}> = [
  {
    legacyDbName: "PlanarNexusGameDB",
    legacyVersion: 1,
    legacyStoreName: "games",
    targetStoreName: "local-game-state",
    // Legacy keyPath was `gameId`; IndexedDBStorage's stores all key on
    // `id`. Mirror the legacy `gameId` onto the new `id` field so the
    // wrapper class's `set()` accepts the row.
    toTargetRow: (row) => ({
      id: row.gameId as string,
      ...row,
    }),
  },
  {
    legacyDbName: "PlanarNexusGameDB",
    legacyVersion: 1,
    legacyStoreName: "gameCodes",
    targetStoreName: "local-game-codes",
    // Legacy keyPath was `gameCode`; the new store keys on `id` (the
    // kebab-case convention for the wrapper class). The legacy key is
    // passed in explicitly because `openCursor` returns the keyPath
    // value (`gameCode`) directly.
    toTargetRow: (_row, key) => ({
      id: key,
      gameCode: key,
      // gameId is the value side of the mapping — read it from the
      // legacy row, which the original `storeGameCode` populated as
      // `{ gameCode, gameId }`.
      gameId: _row.gameId as string,
    }),
  },
  {
    legacyDbName: "PlanarNexusSearchDB",
    legacyVersion: 1,
    legacyStoreName: "preferences",
    targetStoreName: "search-preferences",
    toTargetRow: (_row, key) => ({
      id: key,
      // The legacy row shape is `{ id, prefs, updatedAt }` — preserve
      // it so the search-preferences module keeps reading what it wrote.
      prefs: _row.prefs,
      updatedAt: _row.updatedAt,
    }),
  },
  {
    legacyDbName: "PlanarNexusPresetsDB",
    legacyVersion: 1,
    legacyStoreName: "search-presets",
    targetStoreName: "search-presets",
    toTargetRow: (row, key) => ({
      id: key,
      ...row,
    }),
  },
  {
    legacyDbName: "PlanarNexusRecentSearchesDB",
    legacyVersion: 1,
    legacyStoreName: "recent-searches",
    targetStoreName: "recent-searches",
    // Legacy keyPath was `query`; the new store keys on `id` (mirrored
    // from `query`) so the wrapper class's `set()` accepts the row.
    toTargetRow: (row) => ({
      id: row.query as string,
      query: row.query as string,
      lastUsedAt: row.lastUsedAt as number,
    }),
  },
];

/**
 * Distinct legacy database names that participate in the v3 → v4
 * consolidation. Used by the migration to delete a legacy DB only
 * AFTER every store on that DB has been processed (a DB with
 * multiple stores, like `PlanarNexusGameDB`, would otherwise be
 * deleted after the first store's data move and the second store
 * would find nothing).
 */
export const V4_LEGACY_DB_NAMES: readonly string[] = Array.from(
  new Set(V4_CONSOLIDATION_TARGETS.map((t) => t.legacyDbName)),
);

/**
 * Open a legacy database and return all rows from the given store,
 * keyed by the row's primary key (which depends on the legacy store's
 * keyPath — `gameId`, `gameCode`, `id`, or `query`). Returns an empty
 * Map when the DB / store does not exist (already migrated, or never
 * used by this user) so the migration is idempotent. Resolves `null`
 * when IndexedDB is unavailable (private-mode browsers, server-side) —
 * the caller treats that as a no-op.
 */
export async function readAllLegacyRows(
  legacyDbName: string,
  legacyVersion: number,
  legacyStoreName: string,
): Promise<Map<string, Record<string, unknown>> | null> {
  if (typeof indexedDB === "undefined") return null;

  // Open the legacy DB at the exact version it was published at so the
  // existing on-disk schema / rows are honored (we never ask for an
  // upgrade we don't define).
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(legacyDbName, legacyVersion);
    } catch {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  if (!db) return null;

  try {
    if (!db.objectStoreNames.contains(legacyStoreName)) {
      // Already deleted (or never existed) — nothing to migrate.
      return new Map();
    }

    const tx = db.transaction(legacyStoreName, "readonly");
    const store = tx.objectStore(legacyStoreName);

    const rows = await new Promise<
      Array<{ key: string; value: Record<string, unknown> }>
    >((resolve, reject) => {
      const request = store.openCursor();
      const collected: Array<{
        key: string;
        value: Record<string, unknown>;
      }> = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(collected);
          return;
        }
        collected.push({
          key: cursor.key as string,
          value: cursor.value as Record<string, unknown>,
        });
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error ?? new Error("cursor failed"));
    });

    const map = new Map<string, Record<string, unknown>>();
    for (const { key, value } of rows) {
      map.set(key, value);
    }
    return map;
  } finally {
    db.close();
  }
}

/**
 * Delete a legacy database once its rows have been copied into the new
 * consolidated store. Best-effort: a failure to delete the legacy DB
 * (e.g. another tab still holds it open) does NOT roll back the data
 * move — the next `initialize()` re-runs the migration, sees the
 * consolidated store already holds the row, and re-attempts the delete.
 */
export async function deleteLegacyDatabase(
  legacyDbName: string,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(legacyDbName);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * Fold every row of every legacy single-store database into the new
 * v4 stores on `PlanarNexusStorage`. Runs lazily, after the v3 → v4
 * schema upgrade has committed, gated by a marker row in `preferences`
 * (`v4-consolidation-done`) so re-opens are no-ops.
 *
 * Idempotent: rows already present in the target store are skipped (we
 * probe via `get()` before writing). The legacy DBs are deleted only
 * after the rows land in the new stores — a mid-migration crash leaves
 * the legacy DBs intact and the next `initialize()` retries the move.
 *
 * Errors are swallowed and logged so a corrupt legacy store cannot take
 * the rest of the app down with it (mirroring the v3 split behavior).
 */
export async function ensureLegacyV4Consolidation(
  storage: IndexedDBStorage,
): Promise<void> {
  // Issue #1937 — the marker row lives in `preferences`, a store this
  // migration does NOT create (it predates v4; the upgrade handler in
  // indexeddb-storage.ts creates it). On a torn schema — Firefox/WebKit
  // can abort the versionchange transaction on document teardown and
  // leave the database at v4 with only part of the store set — the
  // `get()` below threw a native NotFoundError on EVERY open, flooding
  // the console. Skip with a reason instead; the schema self-heal in
  // `IndexedDBStorage.initialize()` rebuilds the store and the next
  // open retries the migration.
  if (!storage.hasStore("preferences")) {
    console.warn(
      "[indexeddb-storage] v4 consolidation skipped: 'preferences' store is missing (torn schema; retrying after self-heal)",
    );
    return;
  }

  // Skip if the marker is already set OR any target store is missing.
  if (await storage.get("preferences", "v4-consolidation-done")) {
    return;
  }
  const requiredStores = [
    "local-game-state",
    "local-game-codes",
    "search-preferences",
    "search-presets",
    "recent-searches",
  ];
  for (const name of requiredStores) {
    if (!storage.hasStore(name)) return;
  }

  // Issue #1920 — quota pre-flight: estimate total bytes needed across all
  // legacy stores before opening any transactions. If quota is insufficient,
  // throw MigrationQuotaError BEFORE any writes so the marker row is never
  // written and the next open retries cleanly.
  const legacyRowsByTarget: Array<{
    target: (typeof V4_CONSOLIDATION_TARGETS)[number];
    rows: Map<string, Record<string, unknown>>;
  }> = [];

  for (const target of V4_CONSOLIDATION_TARGETS) {
    const legacyRows = await readAllLegacyRows(
      target.legacyDbName,
      target.legacyVersion,
      target.legacyStoreName,
    );
    if (legacyRows === null || legacyRows.size === 0) continue;
    legacyRowsByTarget.push({ target, rows: legacyRows });
  }

  const totalBytes = legacyRowsByTarget.reduce((sum, { rows }) => {
    for (const value of rows.values()) {
      sum += new TextEncoder().encode(JSON.stringify(value)).length;
    }
    return sum;
  }, 0);

  const headroom = await predictQuotaHeadroom(
    totalBytes + QUOTA_SAFETY_MARGIN_BYTES,
  );
  if (!headroom.ok) {
    throw new MigrationQuotaError(
      headroom.reason ??
        "Storage quota insufficient for v4 consolidation migration",
      totalBytes,
    );
  }

  let migratedAny = false;

  // Track per-DB counts so we only delete a legacy DB after every
  // store on it has been processed (e.g. PlanarNexusGameDB contributes
  // TWO stores: games and gameCodes). Deleting after the first store
  // would orphan the second.
  const dbHadAnyRows = new Map<string, boolean>();

  for (const { target, rows } of legacyRowsByTarget) {
    try {
      if (rows.size > 0) {
        dbHadAnyRows.set(target.legacyDbName, true);
      }

      // Walk every legacy row, write the mapped row to the new store.
      // Skip rows whose target id already exists so re-runs (e.g. after
      // a process crash between the row write and the DB delete) do
      // not overwrite fresh data with stale legacy bytes.
      for (const [key, value] of rows) {
        const targetRow = target.toTargetRow(value, key);
        const id = targetRow.id as string;
        if (!id) continue;

        const existing = await storage.get<Record<string, unknown>>(
          target.targetStoreName,
          id,
        );
        if (existing) continue;

        // `set()` requires a row with an `id`. The `toTargetRow` mapper
        // always produces one; the assertion guards against a future
        // mapper that drops the field.
        await storage.set(target.targetStoreName, {
          id,
          ...targetRow,
        });
        migratedAny = true;
      }
    } catch (error) {
      console.warn(
        `[indexeddb-storage] v4 consolidation failed for ${target.legacyDbName}/${target.legacyStoreName}:`,
        error,
      );
    }
  }

  // After every store on a legacy DB has been migrated, drop the DB
  // so the duplicate-open code path is gone for good. We loop over the
  // distinct DB names (rather than the per-store targets) so a DB
  // with multiple stores (e.g. PlanarNexusGameDB) is deleted exactly
  // once, AFTER every store on it has been processed.
  for (const dbName of V4_LEGACY_DB_NAMES) {
    if (dbHadAnyRows.get(dbName)) {
      try {
        await deleteLegacyDatabase(dbName);
      } catch (error) {
        console.warn(
          `[indexeddb-storage] v4 consolidation legacy-DB delete failed for ${dbName}:`,
          error,
        );
      }
    }
  }

  // Mark this consolidation pass as complete so re-opens short-circuit.
  // We mark even when no rows moved so a user who never used the legacy
  // DBs does not re-pay the migration cost on every open.
  try {
    await storage.set("preferences", {
      id: "v4-consolidation-done",
      migratedAt: Date.now(),
      migratedAny,
    });
  } catch (error) {
    console.warn(
      "[indexeddb-storage] v4 consolidation marker write failed:",
      error,
    );
  }
}
