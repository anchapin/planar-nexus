/**
 * Issue #1572 — v2 → v3 saved-games split migration.
 *
 * Folds the legacy monolithic `saved-games` rows (metadata + heavy
 * payload blobs in one record) into the `saved-games-meta` /
 * `saved-games-payloads` split stores. Runs lazily after the upgrade
 * transaction commits, because fake-indexeddb's upgrade transaction
 * commits via `setImmediate` after the handler returns, which makes it
 * impossible to keep the transaction alive long enough for async reads
 * (getAll.onsuccess) + follow-up writes; any nested request ends up
 * landing on an aborted transaction. We sidestep the limitation by
 * running the migration in a normal readwrite transaction AFTER the
 * upgrade completes, gated by this function's own empty-meta check.
 *
 * Idempotent: rows already present in the meta store are skipped so a
 * re-run of the migration (e.g. after a partial run or a process crash
 * mid-migration) can't overwrite fresh data with stale legacy bytes.
 * The legacy rows are deleted from the `saved-games` store in the same
 * transaction so the v3 split is atomic — if any write fails the entire
 * move rolls back and the next `initialize()` retries.
 *
 * The legacy store itself remains in the schema so a user who downgrades
 * back to a v2 build still finds the meta + payload rows through
 * `exportBackup` / `exportIncrementalBackup` (issue acceptance
 * criterion: "existing restore paths continue to round-trip
 * byte-identically" — the envelope still carries
 * `savedGames: StoredGame[]`, rehydrated from the v3 split).
 *
 * Extracted from `indexeddb-storage.ts` (issue #1946): this migration
 * runs at most once per user (the empty-meta gate makes re-opens
 * no-ops), so it is dynamically imported from
 * `IndexedDBStorage.initialize()` and lives in its own chunk — the same
 * pattern as `./indexeddb-v4-consolidation.ts` — instead of inflating
 * the shared client chunk every route pays for on first load.
 */
import type {
  IndexedDBStorage,
  StoredGame,
  StoredGameMeta,
  StoredGamePayload,
} from "../indexeddb-storage";
import {
  SAVED_GAMES_META_STORE,
  SAVED_GAMES_PAYLOAD_STORE,
} from "../indexeddb-storage";

export async function ensureLegacyV3Split(
  storage: IndexedDBStorage,
): Promise<void> {
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
