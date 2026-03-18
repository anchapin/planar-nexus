/**
 * Filter state management hook for card search
 *
 * Provides React hook for managing filter state with set/remove/reset
 * operations. Also integrates fuzzy search, sorting, and preference persistence.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import type { MinimalCard } from '@/lib/card-database';
import type { FilterState } from '@/lib/search/filter-types';
import { applyFilters, FILTER_ORDER } from '@/lib/search/filter-cards';
import { fuzzySearch } from '@/lib/search/fuzzy-search';
import { sortCards, SortConfig, DEFAULT_SORT } from '@/lib/search/sort-cards';
import { loadPreferences, savePreferences } from '@/lib/search/search-preferences';

/**
 * Default empty filter state
 */
export const DEFAULT_FILTERS: FilterState = {};

/**
 * Return type for useCardFilters hook
 */
export interface UseCardFiltersReturn {
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;
  removeFilter: (key: keyof FilterState) => void;
  hasActiveFilters: boolean;
  filteredCards: (cards: MinimalCard[]) => MinimalCard[];
  // Sorting additions
  sortConfig: SortConfig;
  setSort: (config: SortConfig) => void;
  search: (query: string, cards: MinimalCard[]) => MinimalCard[];
  isLoadingPrefs: boolean;
}

// Re-export DEFAULT_SORT for convenience
export { DEFAULT_SORT };

/**
 * Hook for managing card filter state
 *
 * Provides:
 * - filters: current FilterState
 * - setFilter: update a single filter key
 * - resetFilters: clear all filters to default
 * - removeFilter: remove a specific filter
 * - hasActiveFilters: whether any filters are active
 * - filteredCards: function to apply filters to card array
 * - sortConfig: current sort configuration
 * - setSort: update sort (auto-saves to preferences)
 * - search: perform fuzzy search + filter + sort
 * - isLoadingPrefs: whether preferences are loading
 */
export function useCardFilters(initialFilters: FilterState = DEFAULT_FILTERS): UseCardFiltersReturn {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);

  // Load preferences on mount
  useEffect(() => {
    let mounted = true;

    loadPreferences()
      .then((prefs) => {
        if (mounted) {
          setSortConfig({
            option: prefs.sortOption,
            direction: prefs.sortDirection,
          });
        }
      })
      .catch((error) => {
        console.warn('Failed to load search preferences:', error);
      })
      .finally(() => {
        if (mounted) {
          setIsLoadingPrefs(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Set a specific filter by key
   */
  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  /**
   * Reset all filters to empty state
   */
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  /**
   * Remove a specific filter by key
   */
  const removeFilter = useCallback((key: keyof FilterState) => {
    setFilters((prev) => {
      const newFilters = { ...prev };
      delete newFilters[key];
      return newFilters;
    });
  }, []);

  /**
   * Check if any filters are active (non-undefined)
   */
  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some((value) => value !== undefined);
  }, [filters]);

  /**
   * Apply current filters to a card array
   */
  const filteredCards = useCallback((cards: MinimalCard[]) => {
    return applyFilters(cards, filters);
  }, [filters]);

  /**
   * Set sort configuration with auto-save
   */
  const setSort = useCallback((config: SortConfig) => {
    setSortConfig(config);

    // Auto-save to preferences
    savePreferences({
      sortOption: config.option,
      sortDirection: config.direction,
    }).catch((error) => {
      console.warn('Failed to save sort preferences:', error);
    });
  }, []);

  /**
   * Combined search: fuzzy search + filters + sorting
   *
   * @param query - Search query string
   * @param cards - Array of cards to search
   * @returns Filtered, searched, and sorted card array
   */
  const search = useCallback(
    (query: string, cards: MinimalCard[]): MinimalCard[] => {
      let results = cards;

      // Step 1: Fuzzy search (requires at least 2 characters)
      if (query.length >= 2) {
        results = fuzzySearch(results, query);
      }

      // Step 2: Apply filters
      results = applyFilters(results, filters);

      // Step 3: Sort results
      results = sortCards(results, sortConfig);

      return results;
    },
    [filters, sortConfig]
  );

  return {
    filters,
    setFilter,
    resetFilters,
    removeFilter,
    hasActiveFilters,
    filteredCards,
    sortConfig,
    setSort,
    search,
    isLoadingPrefs,
  };
}

/**
 * Filter application order constant for debugging
 * Documents the optimized order in which filters are applied
 */
export { FILTER_ORDER };
