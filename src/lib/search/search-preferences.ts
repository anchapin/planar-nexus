/**
 * Search preferences persistence with IndexedDB
 *
 * Provides IndexedDB-based storage for user search preferences including:
 * - Sort option and direction
 * - Fuzzy search threshold
 * - Last search query
 *
 * Uses the same IndexedDB pattern as card-database.ts for consistency.
 */
import type { SortOption, SortDirection } from './sort-cards';

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
  sortOption: 'name',
  sortDirection: 'asc',
  fuzzyThreshold: 2,
};

/**
 * IndexedDB configuration
 * Uses separate DB from card-database for cleaner separation
 */
const DB_NAME = 'PlanarNexusSearchDB';
const DB_VERSION = 1;
const STORE_NAME = 'preferences';
const KEY_NAME = 'user-prefs';

// Database state
let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Open IndexedDB and create schema if needed
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object store for preferences
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Initialize the preferences database
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      db = await openDatabase();
    } catch (error) {
      console.error('Failed to initialize search preferences DB:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Load preferences from IndexedDB
 *
 * @returns Promise resolving to SearchPreferences
 */
export async function loadPreferences(): Promise<SearchPreferences> {
  await initDB();

  if (!db) {
    console.warn('Preferences DB not available, returning defaults');
    return { ...DEFAULT_PREFERENCES };
  }

  return new Promise((resolve, resolveDefault) => {
    const transaction = db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(KEY_NAME);

    request.onsuccess = () => {
      const result = request.result;
      if (result && result.prefs) {
        // Merge with defaults to ensure all fields present
        resolve({
          ...DEFAULT_PREFERENCES,
          ...result.prefs,
        });
      } else {
        resolveDefault({ ...DEFAULT_PREFERENCES });
      }
    };

    request.onerror = () => {
      console.warn('Failed to load preferences, returning defaults');
      resolveDefault({ ...DEFAULT_PREFERENCES });
    };
  });
}

/**
 * Save preferences to IndexedDB
 *
 * @param prefs - Partial preferences to save (merged with existing)
 */
export async function savePreferences(prefs: Partial<SearchPreferences>): Promise<void> {
  await initDB();

  if (!db) {
    console.warn('Preferences DB not available, preferences will not persist');
    return;
  }

  // Load existing first to merge
  const existing = await loadPreferences();
  const merged = { ...existing, ...prefs };

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put({
      id: KEY_NAME,
      prefs: merged,
      updatedAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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
  key: K
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
  value: SearchPreferences[K]
): Promise<void> {
  await savePreferences({ [key]: value });
}

/**
 * Clear all preferences from storage
 */
export async function clearPreferences(): Promise<void> {
  await initDB();

  if (!db) {
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(KEY_NAME);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Subscribe to preference changes
 *
 * @param callback - Called when preferences change
 * @returns Unsubscribe function
 */
export function subscribeToPreferences(
  callback: (prefs: SearchPreferences) => void
): () => void {
  // For now, this is a simple implementation
  // Could be extended to use BroadcastChannel for cross-tab sync
  callback(DEFAULT_PREFERENCES); // Initial call

  // Return unsubscribe function
  return () => {
    // No-op for now
  };
}
