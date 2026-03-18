/**
 * Search presets management hook
 *
 * Provides React hook for managing saved filter presets with
 * loading, saving, and deletion functionality.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  type SearchPreset,
  savePreset,
  loadPresets,
  deletePreset as deletePresetFromDB,
  updatePreset,
} from '@/lib/search/search-presets';
import type { FilterState } from '@/lib/search/filter-types';
import type { SortOption, SortDirection } from '@/lib/search/sort-cards';

/**
 * Return type for useSearchPresets hook
 */
export interface UseSearchPresetsReturn {
  presets: SearchPreset[];
  isLoading: boolean;
  savePreset: (
    name: string,
    filters: FilterState,
    sortOption?: SortOption,
    sortDirection?: SortDirection
  ) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  updatePreset: (
    id: string,
    updates: Partial<Omit<SearchPreset, 'id' | 'createdAt'>>
  ) => Promise<void>;
  error: Error | null;
  refreshPresets: () => Promise<void>;
}

/**
 * Hook for managing saved search presets
 *
 * Provides:
 * - presets: Array of saved SearchPreset objects
 * - isLoading: Whether presets are being loaded
 * - savePreset: Function to save current filters as a new preset
 * - deletePreset: Function to delete a preset by ID
 * - updatePreset: Function to update an existing preset
 * - error: Any error that occurred during operations
 * - refreshPresets: Function to reload presets from storage
 */
export function useSearchPresets(): UseSearchPresetsReturn {
  const [presets, setPresets] = useState<SearchPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Load presets from IndexedDB
   */
  const refreshPresets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadedPresets = await loadPresets();
      setPresets(loadedPresets);
    } catch (err) {
      console.error('Failed to load presets:', err);
      setError(err instanceof Error ? err : new Error('Failed to load presets'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load presets on mount
  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  /**
   * Save current filter state as a new preset
   */
  const savePresetFn = useCallback(
    async (
      name: string,
      filters: FilterState,
      sortOption?: SortOption,
      sortDirection?: SortDirection
    ): Promise<void> => {
      setError(null);

      try {
        const newPreset = await savePreset({
          name,
          filters,
          sortOption,
          sortDirection,
        });

        // Update state with new preset at the beginning (newest first)
        setPresets((prev) => [newPreset, ...prev]);
      } catch (err) {
        console.error('Failed to save preset:', err);
        setError(err instanceof Error ? err : new Error('Failed to save preset'));
        throw err;
      }
    },
    []
  );

  /**
   * Delete a preset by ID
   */
  const deletePresetFn = useCallback(async (id: string): Promise<void> => {
    setError(null);

    try {
      await deletePresetFromDB(id);

      // Remove from local state
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to delete preset:', err);
      setError(err instanceof Error ? err : new Error('Failed to delete preset'));
      throw err;
    }
  }, []);

  /**
   * Update an existing preset
   */
  const updatePresetFn = useCallback(
    async (
      id: string,
      updates: Partial<Omit<SearchPreset, 'id' | 'createdAt'>>
    ): Promise<void> => {
      setError(null);

      try {
        const updated = await updatePreset(id, updates);

        // Update local state
        setPresets((prev) =>
          prev.map((p) => (p.id === id ? updated : p))
        );
      } catch (err) {
        console.error('Failed to update preset:', err);
        setError(err instanceof Error ? err : new Error('Failed to update preset'));
        throw err;
      }
    },
    []
  );

  return {
    presets,
    isLoading,
    savePreset: savePresetFn,
    deletePreset: deletePresetFn,
    updatePreset: updatePresetFn,
    error,
    refreshPresets,
  };
}
