/**
 * Recent card-search persistence with IndexedDB.
 *
 * Issue #1811 (PERSISTENCE_ARCHITECTURE section 6 stage 1): this module
 * no longer hand-rolls its own indexedDB.open against a standalone
 * PlanarNexusRecentSearchesDB. All reads and writes go through the
 * canonical indexedDBStorage singleton's 'recent-searches' store. The
 * legacy DB is emptied by the v3 to v4 lazy migration in
 * indexeddb-storage.ts, so a downgrade that still opens
 * PlanarNexusRecentSearchesDB v1 will find no rows.
 *
 * Provides IndexedDB-backed storage for raw, recently-used card search
 * query strings. Mirrors the storage shape of search-presets.ts but
 * stores only the bare query strings, no filter snapshots, no result
 * payloads, so storage cost stays bounded and no card data is leaked.
 *
 * Ordering: most-recently-used first (LRU). The on-disk record holds
 * `{ id (=query), query, lastUsedAt }` so re-recording an existing
 * query bumps it to the top instead of duplicating it. The hook layer
 * is responsible for enforcing the visible-chip cap; this module just
 * persists what it is given.
 *
 * Issue: #1544, surface recent card searches as click-to-rerun chips.
 */
import { indexedDBStorage, RECENT_SEARCHES_STORE } from "../indexeddb-storage";

/**
 * Row shape for the consolidated recent-searches store (issue #1811).
 * The wrapper class keys every store on 'id', so we carry an `id`
 * field that mirrors `query` — re-recording an existing query upserts
 * by id rather than duplicating rows.
 */
export interface RecentSearchRecord {
  /** Row primary key. Equal to `query` (the wrapper-class convention). */
  id: string;
  /** Raw query string (case-preserved as the user typed it). */
  query: string;
  /** Unix epoch ms of the most recent time this query was recorded. */
  lastUsedAt: number;
}

/**
 * Module-level init promise (mirrors the original `initPromise`
 * lifecycle). IndexedDBStorage handles its own concurrency, so this
 * only guards re-entrancy from the (now removed) module-level DB
 * handle.
 */
let initPromise: Promise<void> | null = null;

/**
 * Initialize the recent-searches database exactly once per module load.
 * Delegates to the canonical indexedDBStorage singleton, which carries
 * the v3 to v4 lazy consolidation that empties the legacy
 * PlanarNexusRecentSearchesDB (issue #1811).
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await indexedDBStorage.initialize();
    } catch (error) {
      console.error("Failed to initialize recent-searches DB:", error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Record (or refresh) a recent search query. Re-recording an existing
 * query updates its `lastUsedAt` rather than creating a duplicate row,
 * which keeps the on-disk row count flat and preserves LRU ordering.
 *
 * @param query - Raw query string as typed by the user (case preserved).
 */
export async function saveRecentSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return;
  }

  await initDB();

  await indexedDBStorage.set<RecentSearchRecord>(RECENT_SEARCHES_STORE, {
    id: trimmed,
    query: trimmed,
    lastUsedAt: Date.now(),
  });
}

/**
 * Load all recorded recent searches, most-recently-used first.
 *
 * @returns Array of query strings (not records) sorted by `lastUsedAt`
 *   descending so callers can render the array directly as chip labels.
 */
export async function loadRecentSearches(): Promise<string[]> {
  await initDB();

  try {
    const records = await indexedDBStorage.getAll<RecentSearchRecord>(
      RECENT_SEARCHES_STORE,
    );
    records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return records.map((r) => r.query);
  } catch (error) {
    console.warn("Failed to load recent searches, returning empty list", error);
    return [];
  }
}

/**
 * Remove a single recent search by its exact (trimmed) query string.
 *
 * No-op if the query isn't present.
 */
export async function deleteRecentSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return;
  }

  await initDB();
  await indexedDBStorage.delete(RECENT_SEARCHES_STORE, trimmed);
}

/**
 * Wipe all recorded recent searches. Used by the test suite and
 * available for future "Clear history" affordances.
 */
export async function clearRecentSearches(): Promise<void> {
  await initDB();
  await indexedDBStorage.clear(RECENT_SEARCHES_STORE);
}
