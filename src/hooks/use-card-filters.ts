/**
 * Filter state management hook for card search
 *
 * Provides React hook for managing filter state with set/remove/reset
 * operations. Also integrates fuzzy search, sorting, and preference persistence.
 *
 * Performance: `search()` and `filteredCards()` are memoized behind an
 * LRU cache keyed on a stable signature of `(query, filters, sortConfig,
 * cards contents)` so the 5k-card filter+sort walk does not repeat on
 * every keystroke or unrelated re-render (issue #1425).
 */
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { LRUCache } from "lru-cache";
import type { MinimalCard } from "@/lib/card-database";
import type { FilterState } from "@/lib/search/filter-types";
import { applyFilters, FILTER_ORDER } from "@/lib/search/filter-cards";
import { fuzzySearch } from "@/lib/search/fuzzy-search";
import { sortCards, SortConfig, DEFAULT_SORT } from "@/lib/search/sort-cards";
import {
  loadPreferences,
  savePreferences,
} from "@/lib/search/search-preferences";

/**
 * Default empty filter state
 */
export const DEFAULT_FILTERS: FilterState = {};

/**
 * LRU result cache configuration for `search()`.
 *
 * Mirrors the configuration of `cardSearchIndex.resultCache`
 * (`src/lib/search/card-search-index.ts`) — same TTL, a smaller `max`
 * because this cache holds full `MinimalCard[]` payloads (one entry per
 * distinct `(query, filters, sortConfig, cards)` tuple) rather than the
 * slim `{id, name}[]` payloads cached at the index layer.
 *
 * 128 entries comfortably covers a full typing session
 * ("l" -> "li" -> "lig" -> ... -> "lightning bolt", plus backspaces
 * and corrections) while staying well above the issue #1425 floor
 * of `max >= 32`.
 */
export const SEARCH_CACHE_MAX_SIZE = 128;
export const SEARCH_CACHE_TTL_MS = 60_000;

/**
 * Build a deterministic signature for a `FilterState`.
 *
 * Arrays are sorted before serialization so `['W', 'U']` and
 * `['U', 'W']` (semantically identical filter values) produce the same
 * key. `JSON.stringify` drops `undefined` values, so filter states that
 * differ only in which optional keys are explicitly `undefined` collapse
 * to the same signature.
 *
 * Exported so tests can verify key stability directly.
 */
export function getFilterSignature(filters: FilterState): string {
  return JSON.stringify(filters, (_key, value) =>
    Array.isArray(value) ? [...value].sort() : value,
  );
}

/**
 * Build a sort-config signature.
 *
 * Sort configs are flat `{ option, direction }` objects, so a simple
 * template literal is enough — no canonicalization needed.
 */
export function getSortSignature(sortConfig: SortConfig): string {
  return `${sortConfig.option}:${sortConfig.direction}`;
}

/**
 * Per-array-reference signature cache. Avoids recomputing the O(n)
 * fingerprint when the same `cards` reference is passed to `search()`
 * or `filteredCards()` on every render.
 *
 * A `WeakMap` is safe here: when the array is GC'd, its signature entry
 * is too — no manual cleanup, no memory leak.
 */
const cardsSignatureCache = new WeakMap<readonly MinimalCard[], string>();

/**
 * Build a stable content fingerprint for a card array.
 *
 * The fingerprint folds every field read by `applyFilters`, `sortCards`,
 * and `fuzzySearch`: `id`, `name`, `cmc`, `colors`, `color_identity`,
 * `type_line`, `rarity`, `set`, `power`, `toughness`, and `legalities`.
 * Two arrays with identical contents always produce the same signature,
 * regardless of whether they are the same reference.
 *
 * The result is memoized per-array-reference via {@link cardsSignatureCache}
 * so the O(n) walk runs at most once per distinct reference — subsequent
 * calls with the same reference are O(1). This is the same trick
 * `getDeckSignature` uses in `src/hooks/use-deck-statistics.ts`, just
 * lifted to a WeakMap so it survives across hook renders.
 *
 * Exported so tests can verify key stability directly.
 */
export function getCardsSignature(cards: readonly MinimalCard[]): string {
  const cached = cardsSignatureCache.get(cards);
  if (cached !== undefined) return cached;

  let signature = "";
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    signature +=
      String(card.id) +
      "\u0001" +
      (card.name ?? "") +
      "\u0001" +
      (card.cmc ?? 0) +
      "\u0001" +
      (card.colors && card.colors.length > 0 ? card.colors.join(",") : "") +
      "\u0001" +
      (card.color_identity && card.color_identity.length > 0
        ? card.color_identity.join(",")
        : "") +
      "\u0001" +
      (card.type_line ?? "") +
      "\u0001" +
      (card.rarity ?? "") +
      "\u0001" +
      (card.set ?? "") +
      "\u0001" +
      (card.power ?? "") +
      "\u0001" +
      (card.toughness ?? "") +
      "\u0001" +
      (card.legalities ? JSON.stringify(card.legalities) : "") +
      "\u0002";
  }
  cardsSignatureCache.set(cards, signature);
  return signature;
}

/**
 * Normalize a raw query for use as part of the cache key.
 *
 * `fuzzySearch` is internally case- and whitespace-insensitive (it
 * delegates to `cardSearchIndex.search`, which normalizes the term with
 * `trim().toLowerCase()` before lookup), so equivalent user inputs share
 * a cache entry without changing observable behavior.
 *
 * Only used to build the cache key — the original `query` is still
 * handed to `fuzzySearch` unchanged.
 */
function normalizeQuery(query: string): string {
  return (query ?? "").trim().toLowerCase();
}

/**
 * Return type for useCardFilters hook
 */
export interface UseCardFiltersReturn {
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => void;
  resetFilters: () => void;
  removeFilter: (key: keyof FilterState) => void;
  hasActiveFilters: boolean;
  filteredCards: (cards: MinimalCard[]) => MinimalCard[];
  // Sorting additions
  sortConfig: SortConfig;
  setSort: (config: SortConfig) => void;
  search: (query: string, cards: MinimalCard[]) => Promise<MinimalCard[]>;
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
export function useCardFilters(
  initialFilters: FilterState = DEFAULT_FILTERS,
): UseCardFiltersReturn {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);

  // Stable content signatures for filters / sortConfig. Used as cache
  // keys so referentially-different-but-equal inputs (a fresh filters
  // object, a re-issued sort config) collapse to the same key. Without
  // this, every parent re-render that allocates a fresh object would
  // bust the cache.
  const filterSignature = useMemo(() => getFilterSignature(filters), [filters]);
  const sortSignature = useMemo(
    () => getSortSignature(sortConfig),
    [sortConfig],
  );

  // LRU result cache for `search()`. Lazily allocated once per hook
  // instance and persisted across renders via `useRef`. Each entry maps
  // a stable `${query}|${filterSig}|${sortSig}|${cardsSig}` key to the
  // fully-filtered + sorted `MinimalCard[]` result.
  const searchCacheRef = useRef<LRUCache<string, MinimalCard[]> | null>(null);
  if (searchCacheRef.current === null) {
    searchCacheRef.current = new LRUCache<string, MinimalCard[]>({
      max: SEARCH_CACHE_MAX_SIZE,
      ttl: SEARCH_CACHE_TTL_MS,
    });
  }
  const searchCache = searchCacheRef.current;

  // Single-entry memo for `filteredCards()`. Unlike `search()`, there is
  // no per-keystroke `query` axis — only `(filters, cards)` — so a
  // one-slot cache keyed on `(filterSignature, cardsSignature)` is
  // sufficient to make the result reference-stable across re-renders.
  const filteredCardsMemoRef = useRef<{
    key: string;
    result: MinimalCard[];
  } | null>(null);

  // Drop cached search results whenever the filter or sort context
  // changes. Not strictly required for correctness (the cache key
  // already encodes filterSignature / sortSignature, so old entries
  // would simply miss), but it bounds memory use to the active context
  // and matches the `cardSearchIndex.invalidateCache` pattern at the
  // index layer.
  useEffect(() => {
    searchCache.clear();
  }, [filterSignature, sortSignature, searchCache]);

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
        console.warn("Failed to load search preferences:", error);
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
  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
  );

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
   * Apply current filters to a card array.
   *
   * Memoized on `(filterSignature, cardsSignature)` so a parent that
   * hands down a freshly-allocated array each render (common in the
   * deck builder) does not re-walk the filter pipeline. Two calls with
   * content-identical inputs return the same array reference.
   */
  const filteredCards = useCallback(
    (cards: MinimalCard[]): MinimalCard[] => {
      const cardsSignature = getCardsSignature(cards);
      const key = `${filterSignature}\u0000${cardsSignature}`;
      const cached = filteredCardsMemoRef.current;
      if (cached !== null && cached.key === key) {
        return cached.result;
      }
      const result = applyFilters(cards, filters);
      filteredCardsMemoRef.current = { key, result };
      return result;
    },
    [filterSignature, filters],
  );

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
      console.warn("Failed to save sort preferences:", error);
    });
  }, []);

  /**
   * Combined search: fuzzy search + filters + sorting
   *
   * Memoized + LRU-cached on a stable signature of every input that
   * affects the output (`query`, `filters`, `sortConfig`, and the
   * `cards` contents). Repeated identical calls return the cached
   * result array in O(1) without re-running the fuzzy + filter + sort
   * pipeline — the hottest main-thread path on the deck-builder page
   * (issue #1425).
   *
   * Cache hits skip the work entirely; misses compute the full pipeline
   * and store the result. The cache is bounded (LRU, max 128, TTL 60s)
   * and cleared on filter/sort changes (see the effect above).
   *
   * @param query - Search query string
   * @param cards - Array of cards to search
   * @returns Filtered, searched, and sorted card array
   */
  const search = useCallback(
    async (query: string, cards: MinimalCard[]): Promise<MinimalCard[]> => {
      const normalizedQuery = normalizeQuery(query);
      const cardsSignature = getCardsSignature(cards);
      const cacheKey = `${normalizedQuery}\u0000${filterSignature}\u0000${sortSignature}\u0000${cardsSignature}`;

      const cached = searchCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      let results = cards;

      // Step 1: Fuzzy search (requires at least 2 characters). The
      // original (un-normalized) query is forwarded so behavior is
      // byte-identical to the uncached path.
      if (query.length >= 2) {
        results = await fuzzySearch(results, query);
      }

      // Step 2: Apply filters
      results = applyFilters(results, filters);

      // Step 3: Sort results
      results = sortCards(results, sortConfig);

      searchCache.set(cacheKey, results);
      return results;
    },
    [filterSignature, sortSignature, filters, sortConfig, searchCache],
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
