/**
 * Search presets persistence with IndexedDB.
 *
 * Issue #1811 (PERSISTENCE_ARCHITECTURE section 6 stage 1): this module
 * no longer hand-rolls its own indexedDB.open against a standalone
 * PlanarNexusPresetsDB. All reads and writes go through the canonical
 * indexedDBStorage singleton's 'search-presets' store. The legacy DB is
 * emptied by the v3 to v4 lazy migration in indexeddb-storage.ts, so a
 * downgrade that still opens PlanarNexusPresetsDB v1 will find no rows.
 *
 * Provides IndexedDB-based storage for saved filter presets including:
 * - Preset name and configuration
 * - Filter state (CMC, type, rarity, set, color, power/toughness, format)
 * - Sort option and direction
 * - Created/updated timestamps
 *
 * Uses the same IndexedDB pattern as search-preferences.ts for consistency.
 */
import type { FilterState } from "./filter-types";
import type { SortOption, SortDirection } from "./sort-cards";
import { indexedDBStorage, SEARCH_PRESETS_STORE } from "../indexeddb-storage";

/**
 * Search preset interface. Stored rows in the consolidated store carry
 * an `id` field that mirrors this row's id (the wrapper class keys
 * every store on 'id').
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
 * Module-level init promise (mirrors the original `initPromise`
 * lifecycle). IndexedDBStorage handles its own concurrency, so this
 * only guards re-entrancy from the (now removed) module-level DB
 * handle.
 */
let initPromise: Promise<void> | null = null;

/**
 * Generate a unique ID for presets
 */
function generateId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Initialize the presets database exactly once per module load.
 * Delegates to the canonical indexedDBStorage singleton, which carries
 * the v3 to v4 lazy consolidation that empties the legacy
 * PlanarNexusPresetsDB (issue #1811).
 */
async function initDB(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await indexedDBStorage.initialize();
    } catch (error) {
      console.error("Failed to initialize presets DB:", error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Save a new preset to IndexedDB.
 *
 * @param preset - Preset data without id, createdAt, updatedAt
 * @returns The saved preset with generated id and timestamps
 */
export async function savePreset(
  preset: Omit<SearchPreset, "id" | "createdAt" | "updatedAt">,
): Promise<SearchPreset> {
  await initDB();

  const now = Date.now();
  const newPreset: SearchPreset = {
    ...preset,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };

  await indexedDBStorage.set<SearchPreset>(SEARCH_PRESETS_STORE, newPreset);
  return newPreset;
}

/**
 * Load all presets from IndexedDB, sorted by updatedAt (newest first).
 *
 * @returns Array of presets sorted by updatedAt descending.
 */
export async function loadPresets(): Promise<SearchPreset[]> {
  await initDB();

  try {
    const presets =
      await indexedDBStorage.getAll<SearchPreset>(SEARCH_PRESETS_STORE);
    presets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return presets;
  } catch (error) {
    console.warn("Failed to load presets, returning empty array", error);
    return [];
  }
}

/**
 * Get a single preset by ID
 *
 * @param id - Preset ID to retrieve
 * @returns The preset or null if not found
 */
export async function getPreset(id: string): Promise<SearchPreset | null> {
  await initDB();

  try {
    const row = await indexedDBStorage.get<SearchPreset>(
      SEARCH_PRESETS_STORE,
      id,
    );
    return row ?? null;
  } catch (error) {
    console.warn("Failed to get preset", error);
    return null;
  }
}

/**
 * Delete a preset by ID
 *
 * @param id - Preset ID to delete
 */
export async function deletePreset(id: string): Promise<void> {
  await initDB();
  await indexedDBStorage.delete(SEARCH_PRESETS_STORE, id);
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
  updates: Partial<Omit<SearchPreset, "id" | "createdAt">>,
): Promise<SearchPreset> {
  await initDB();

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

  await indexedDBStorage.set<SearchPreset>(SEARCH_PRESETS_STORE, updatedPreset);
  return updatedPreset;
}

/**
 * Clear all presets from storage
 */
export async function clearPresets(): Promise<void> {
  await initDB();
  await indexedDBStorage.clear(SEARCH_PRESETS_STORE);
}
