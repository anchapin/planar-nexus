/**
 * Recent card-searches management hook
 *
 * Provides a React-level wrapper around the IndexedDB persistence in
 * `recent-searches.ts`. Mirrors the CRUD shape of `use-search-presets.ts`
 * so callers see a consistent interface for the two related surfaces.
 *
 * Responsibilities:
 *  - Loads the persisted list on mount (`refreshRecent`).
 *  - Records a query (deduped, case-insensitive; moves it to MRU).
 *  - Removes an individual query (e.g. when its chip's dismiss control
 *    is activated).
 *  - Enforces the visible cap (`maxItems`, default 8) on writes so the
 *    LRU eviction promised by issue #1544 stays inside the hook layer
 *    rather than leaking into the UI.
 *
 * Issue: #1544 — surface recent card searches as click-to-rerun chips.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveRecentSearch,
  loadRecentSearches,
  deleteRecentSearch,
  clearRecentSearches,
} from "@/lib/search/recent-searches";

/** Maximum visible chip count. Issue #1544's AC requires LRU eviction above 8. */
export const MAX_RECENT_SEARCHES = 8;

export interface UseRecentSearchesReturn {
  /** Queries ordered most-recently-used first; never longer than `maxItems`. */
  recent: string[];
  /** True until the initial load from IndexedDB has settled. */
  isLoading: boolean;
  /**
   * Record (or refresh) a query. No-op for empty / whitespace-only input.
   * Trims the query, dedupes case-insensitively, preserves the new casing.
   */
  recordSearch: (query: string) => Promise<void>;
  /** Remove a single query by exact match. */
  removeRecent: (query: string) => Promise<void>;
  /** Wipe the persisted list. */
  clearAll: () => Promise<void>;
  /** Last error from any storage operation (e.g. IndexedDB unavailable). */
  error: Error | null;
  /** Force a reload from IndexedDB. */
  refreshRecent: () => Promise<void>;
}

/**
 * Build the deduped, LRU-capped list. Pure helper so the test file can
 * exercise eviction logic without mocking the storage layer.
 */
export function applyLruCap(queries: string[], maxItems: number): string[] {
  if (maxItems <= 0 || queries.length <= maxItems) {
    return [...queries];
  }
  return queries.slice(0, maxItems);
}

/**
 * Normalize a raw user query for dedup purposes (case-insensitive match).
 * The returned value is what gets stored as the IndexedDB key.
 */
export function normalizeQuery(query: string): string {
  return query.trim();
}

/**
 * Hook for managing the recent-searches LRU.
 */
export function useRecentSearches(
  maxItems: number = MAX_RECENT_SEARCHES,
): UseRecentSearchesReturn {
  const [recent, setRecent] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Guard against async races: if a previous record call lands after the
  // user has cleared the list or remounted, we don't want to clobber the
  // newer state. The ref is bumped on every successful setRecent so the
  // in-flight write becomes a no-op.
  const writeEpoch = useRef(0);

  const refreshRecent = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await loadRecentSearches();
      setRecent(applyLruCap(loaded, maxItems));
    } catch (err) {
      console.error("Failed to load recent searches:", err);
      setError(
        err instanceof Error
          ? err
          : new Error("Failed to load recent searches"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [maxItems]);

  useEffect(() => {
    refreshRecent();
  }, [refreshRecent]);

  const recordSearch = useCallback(
    async (query: string): Promise<void> => {
      const trimmed = normalizeQuery(query);
      if (trimmed.length === 0) {
        return;
      }

      const epochAtCall = ++writeEpoch.current;
      setError(null);

      // Optimistic local update first — moves (or adds) the query to
      // the MRU position, evicts the oldest if we're over the cap. The
      // IndexedDB write that lands later is idempotent because `saveRecentSearch`
      // upserts by query key.
      setRecent((prev) => {
        const deduped = prev.filter(
          (q) => q.toLowerCase() !== trimmed.toLowerCase(),
        );
        const next = [trimmed, ...deduped];
        return applyLruCap(next, maxItems);
      });

      try {
        await saveRecentSearch(trimmed);
        // If a newer write started after us, skip the trailing refresh
        // so we don't fight with a fresher state.
        if (epochAtCall !== writeEpoch.current) {
          return;
        }
      } catch (err) {
        console.error("Failed to record recent search:", err);
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to record recent search"),
        );
        // Roll back the optimistic update by reloading from storage.
        try {
          const loaded = await loadRecentSearches();
          if (epochAtCall === writeEpoch.current) {
            setRecent(applyLruCap(loaded, maxItems));
          }
        } catch {
          /* swallow — already in an error state */
        }
      }
    },
    [maxItems],
  );

  const removeRecent = useCallback(
    async (query: string): Promise<void> => {
      const trimmed = normalizeQuery(query);
      if (trimmed.length === 0) {
        return;
      }

      const epochAtCall = ++writeEpoch.current;
      setError(null);

      setRecent((prev) =>
        prev.filter((q) => q.toLowerCase() !== trimmed.toLowerCase()),
      );

      try {
        await deleteRecentSearch(trimmed);
        if (epochAtCall !== writeEpoch.current) {
          return;
        }
      } catch (err) {
        console.error("Failed to remove recent search:", err);
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to remove recent search"),
        );
        try {
          const loaded = await loadRecentSearches();
          if (epochAtCall === writeEpoch.current) {
            setRecent(applyLruCap(loaded, maxItems));
          }
        } catch {
          /* swallow */
        }
      }
    },
    [maxItems],
  );

  const clearAll = useCallback(async (): Promise<void> => {
    const epochAtCall = ++writeEpoch.current;
    setError(null);

    setRecent([]);

    try {
      await clearRecentSearches();
      if (epochAtCall !== writeEpoch.current) {
        return;
      }
    } catch (err) {
      console.error("Failed to clear recent searches:", err);
      setError(
        err instanceof Error
          ? err
          : new Error("Failed to clear recent searches"),
      );
    }
  }, []);

  return {
    recent,
    isLoading,
    recordSearch,
    removeRecent,
    clearAll,
    error,
    refreshRecent,
  };
}
