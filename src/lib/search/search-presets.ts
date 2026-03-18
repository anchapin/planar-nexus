/**
 * Search presets persistence with IndexedDB
 *
 * Provides IndexedDB-based storage for saved filter presets including:
 * - Preset name and configuration
 * - Filter state (CMC, type, rarity, set, color, power/toughness, format)
 * - Sort option and direction
 * - Created/updated timestamps
 *
 * Uses the same IndexedDB pattern as search-preferences.ts for consistency.
 */
import type { FilterState } from './filter-types';
import type { SortOption, SortDirection } from './sort-cards';

/**
 * Search preset interface
 */
export interface SearchPreset {
  id: string;
  name: string;
  filters: FilterState;
  sortOption?: SortOption;
  sortDirection?: SortDirection;
  createdAt: number;
  updatedAt: number;
}

/**
 * IndexedDB configuration
 * Uses separate DB from card-database for cleaner separation
 */
const DB_NAME = 'PlanarNexusPresetsDB';
const DB_VERSION = 1;
const STORE_NAME = 'search-presets';

// Database state
let db: IDBDatabase | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Generate a unique ID for presets
 */
function generateId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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

      // Create object store for presets with auto-incrementing key
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // Create index for name for quick lookups
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
}

/**
 * Initialize the presets database
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      db = await openDatabase();
    } catch (error) {
      console.error('Failed to initialize presets DB:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Save a new preset to IndexedDB
 *
 * @param preset - Preset data without id, createdAt, updatedAt
 * @returns The saved preset with generated id and timestamps
 */
export async function savePreset(
  preset: Omit<SearchPreset, 'id' | 'createdAt' | 'updatedAt'>
): Promise<SearchPreset> {
  await initDB();

  if (!db) {
    throw new Error('Presets DB not available');
  }

  const now = Date.now();
  const newPreset: SearchPreset = {
    ...preset,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.add(newPreset);

    request.onsuccess = () => resolve(newPreset);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load all presets from IndexedDB
 *
 * @returns Array of presets sorted by updatedAt (newest first)
 */
export async function loadPresets(): Promise<SearchPreset[]> {
  await initDB();

  if (!db) {
    console.warn('Presets DB not available, returning empty array');
    return [];
  }

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const presets = request.result || [];
      // Sort by updatedAt, newest first
      presets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(presets);
    };

    request.onerror = () => {
      console.warn('Failed to load presets, returning empty array');
      resolve([]);
    };
  });
}

/**
 * Get a single preset by ID
 *
 * @param id - Preset ID to retrieve
 * @returns The preset or null if not found
 */
export async function getPreset(id: string): Promise<SearchPreset | null> {
  await initDB();

  if (!db) {
    console.warn('Presets DB not available');
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.warn('Failed to get preset');
      resolve(null);
    };
  });
}

/**
 * Delete a preset by ID
 *
 * @param id - Preset ID to delete
 */
export async function deletePreset(id: string): Promise<void> {
  await initDB();

  if (!db) {
    throw new Error('Presets DB not available');
  }

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update an existing preset
 *
 * @param id - Preset ID to update
 * @param updates - Partial preset data to update
 * @returns The updated preset
 */
export async function updatePreset(
  id: string,
  updates: Partial<Omit<SearchPreset, 'id' | 'createdAt'>>
): Promise<SearchPreset> {
  await initDB();

  if (!db) {
    throw new Error('Presets DB not available');
  }

  // Get existing preset first
  const existing = await getPreset(id);
  if (!existing) {
    throw new Error(`Preset not found: ${id}`);
  }

  const updatedPreset: SearchPreset = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put(updatedPreset);

    request.onsuccess = () => resolve(updatedPreset);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all presets from storage
 */
export async function clearPresets(): Promise<void> {
  await initDB();

  if (!db) {
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
