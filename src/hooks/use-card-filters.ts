/**
 * Filter state management hook for card search
 *
 * Provides React hook for managing filter state with set/remove/reset
 * operations. Follows the pattern from useLocalSearch hook.
 */
import { useState, useCallback, useMemo } from 'react';
import type { FilterState } from '@/lib/search/filter-types';

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
}

/**
 * Hook for managing card filter state
 *
 * Provides:
 * - filters: current FilterState
 * - setFilter: update a single filter key
 * - resetFilters: clear all filters to default
 * - removeFilter: remove a specific filter
 * - hasActiveFilters: whether any filters are active
 */
export function useCardFilters(initialFilters: FilterState = DEFAULT_FILTERS): UseCardFiltersReturn {
  const [filters, setFilters] = useState<FilterState>(initialFilters);

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

  return {
    filters,
    setFilter,
    resetFilters,
    removeFilter,
    hasActiveFilters,
  };
}
