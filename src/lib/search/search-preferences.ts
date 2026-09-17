/**
 * Search preferences persistence with IndexedDB.
 *
 * Issue #1811 (PERSISTENCE_ARCHITECTURE section 6 stage 1): this module
 * no longer hand-rolls its own indexedDB.open against a standalone
 * PlanarNexusSearchDB. All reads and writes go through the canonical
 * indexedDBStorage singleton's 'search-preferences' store. The legacy
 * DB is emptied by the v3 to v4 lazy migration in indexeddb-storage.ts,
 * so a downgrade that still opens PlanarNexusSearchDB v1 will find no
 * rows.
 *
 * Provides IndexedDB-based storage for user search preferences including:
 * - Sort option and direction
 * - Fuzzy search threshold
 * - Last search query
 *
 * Uses the same IndexedDB pattern as card-database.ts for consistency.
 */
import type { SortOption, SortDirection } from "./sort-cards";
import {
  indexedDBStorage,
  SEARCH_PREFERENCES_STORE,
} from "../indexeddb-storage";

/**
 * Search preferences interface
 */
export interface SearchPreferences {
  sortOption: SortOption;
  sortDirection: SortDirection;
  fuzzyThreshold: number; // Levenshtein distance
  lastSearchQuery?: string;
}

/**
 * Default preferences
 */
const DEFAULT_PREFERENCES: SearchPreferences = {
  sortOption: "name",
  sortDirection: "asc",
  fuzzyThreshold: 2,
};

/**
 * Storage row shape for the consolidated search-preferences store
 * (issue #1811). The wrapper class keys every store on 'id', so we
 * use the fixed id "user-prefs" (matching the legacy keyPath-less
 * lookup by KEY_NAME).
 */
interface SearchPreferencesRow {
  id: string;
  prefs: SearchPreferences;
  updatedAt: number;
}

const KEY_NAME = "user-prefs";

/**
 * Module-level init promise (mirrors the original `initPromise`
 * lifecycle). IndexedDBStorage handles its own concurrency, so this
 * only guards re-entrancy from the (now removed) module-level DB
 * handle.
 */
let initPromise: Promise<void> | null = null;

/**
 * Initialize the preferences database exactly once per module load.
 * Delegates to the canonical indexedDBStorage singleton, which carries
 * the v3 to v4 lazy consolidation that empties the legacy
 * PlanarNexusSearchDB (issue #1811).
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await indexedDBStorage.initialize();
    } catch (error) {
      console.error("Failed to initialize search preferences DB:", error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Load preferences from IndexedDB.
 *
 * @returns Promise resolving to SearchPreferences
 */
export async function loadPreferences(): Promise<SearchPreferences> {
  await initDB();

  try {
    const row = await indexedDBStorage.get<SearchPreferencesRow>(
      SEARCH_PREFERENCES_STORE,
      KEY_NAME,
    );
    if (row?.prefs) {
      // Merge with defaults to ensure all fields present.
      return {
        ...DEFAULT_PREFERENCES,
        ...row.prefs,
      };
    }
  } catch (error) {
    console.warn("Failed to load preferences, returning defaults", error);
  }
  return { ...DEFAULT_PREFERENCES };
}

/**
 * Save preferences to IndexedDB.
 *
 * @param prefs - Partial preferences to save (merged with existing)
 */
export async function savePreferences(
  prefs: Partial<SearchPreferences>,
): Promise<void> {
  await initDB();

  // Load existing first to merge.
  const existing = await loadPreferences();
  const merged = { ...existing, ...prefs };

  try {
    await indexedDBStorage.set<SearchPreferencesRow>(SEARCH_PREFERENCES_STORE, {
      id: KEY_NAME,
      prefs: merged,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn("Failed to save preferences", error);
  }
}

/**
 * Reset preferences to defaults
 */
export async function resetPreferences(): Promise<void> {
  await savePreferences(DEFAULT_PREFERENCES);
}

/**
 * Get a single preference value
 *
 * @param key - Preference key to get
 * @returns Promise resolving to preference value or undefined
 */
export async function getPreference<K extends keyof SearchPreferences>(
  key: K,
): Promise<SearchPreferences[K] | undefined> {
  const prefs = await loadPreferences();
  return prefs[key];
}

/**
 * Set a single preference value
 *
 * @param key - Preference key to set
 * @param value - Value to set
 */
export async function setPreference<K extends keyof SearchPreferences>(
  key: K,
  value: SearchPreferences[K],
): Promise<void> {
  await savePreferences({ [key]: value });
}

/**
 * Clear all preferences from storage
 */
export async function clearPreferences(): Promise<void> {
  await initDB();

  try {
    await indexedDBStorage.delete(SEARCH_PREFERENCES_STORE, KEY_NAME);
  } catch (error) {
    console.warn("Failed to clear preferences", error);
  }
}

/**
 * Subscribe to preference changes
 *
 * @param callback - Called when preferences change
 * @returns Unsubscribe function
 */
export function subscribeToPreferences(
  callback: (prefs: SearchPreferences) => void,
): () => void {
  // For now, this is a simple implementation
  // Could be extended to use BroadcastChannel for cross-tab sync
  callback(DEFAULT_PREFERENCES); // Initial call

  // Return unsubscribe function
  return () => {
    // No-op for now
  };
}
