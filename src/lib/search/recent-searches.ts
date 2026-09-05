/**
 * Recent card-search persistence with IndexedDB
 *
 * Provides IndexedDB-backed storage for raw, recently-used card search
 * query strings. Mirrors the storage shape of `search-presets.ts` but
 * stores only the bare query strings — no filter snapshots, no result
 * payloads — so storage cost stays bounded and no card data is leaked.
 *
 * Ordering: most-recently-used first (LRU). The on-disk record holds
 * `{ query, lastUsedAt }` so re-recording an existing query bumps it
 * to the top instead of duplicating it. The hook layer is responsible
 * for enforcing the visible-chip cap; this module just persists what
 * it is given.
 *
 * Issue: #1544 — surface recent card searches as click-to-rerun chips.
 */
export interface RecentSearchRecord {
  /** Raw query string (case-preserved as the user typed it). */
  query: string;
  /** Unix epoch ms of the most recent time this query was recorded. */
  lastUsedAt: number;
}

/**
 * IndexedDB configuration. Uses a separate DB from `PlanarNexusPresetsDB`
 * so the two feature surfaces don't share migrations and the deck-builder
 * can be reset in isolation.
 */
const DB_NAME = "PlanarNexusRecentSearchesDB";
const DB_VERSION = 1;
const STORE_NAME = "recent-searches";

// Module-level DB handle + init promise (mirrors `search-presets.ts`).
let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Open IndexedDB and create the `recent-searches` object store if missing.
 *
 * `query` is the keyPath so re-recording an existing query upserts by
 * `put` rather than duplicating rows.
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "query",
        });
        // LRU eviction walks all entries sorted by `lastUsedAt`, so we
        // index it for an efficient cursor pass.
        store.createIndex("lastUsedAt", "lastUsedAt", { unique: false });
      }
    };
  });
}

/**
 * Initialize the recent-searches database exactly once per module load.
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      db = await openDatabase();
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
  if (!db) {
    throw new Error("Recent-searches DB not available");
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // `put` upserts: existing row with the same `query` key gets its
    // `lastUsedAt` refreshed; new queries become new rows.
    const request = store.put({
      query: trimmed,
      lastUsedAt: Date.now(),
    } satisfies RecentSearchRecord);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
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
  if (!db) {
    console.warn("Recent-searches DB not available, returning empty list");
    return [];
  }

  return new Promise((resolve) => {
    const transaction = db!.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records: RecentSearchRecord[] = request.result || [];
      records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      resolve(records.map((r) => r.query));
    };

    request.onerror = () => {
      console.warn(
        "Failed to load recent searches, returning empty list",
        request.error,
      );
      resolve([]);
    };
  });
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
  if (!db) {
    throw new Error("Recent-searches DB not available");
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(trimmed);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Wipe all recorded recent searches. Used by the test suite and
 * available for future "Clear history" affordances.
 */
export async function clearRecentSearches(): Promise<void> {
  await initDB();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
