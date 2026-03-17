import { useState, useEffect, useCallback } from 'react';
import { oramaManager, SearchParams } from '../lib/search/orama-manager';
import { backgroundIndexingManager, IndexingProgress } from '../lib/search/background-indexing';
import { Results } from '@orama/orama';

export interface UseLocalSearchOptions extends SearchParams {
  debounceMs?: number;
  enabled?: boolean;
}

export function useLocalSearch(options: UseLocalSearchOptions = {}) {
  const { debounceMs = 300, enabled = true, ...searchParams } = options;
  const [results, setResults] = useState<Results<any> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress>(
    backgroundIndexingManager.getProgress()
  );

  useEffect(() => {
    return backgroundIndexingManager.subscribe(setIndexingProgress);
  }, []);

  const performSearch = useCallback(async (params: SearchParams) => {
    setIsLoading(true);
    setError(null);
    try {
      const searchResults = await oramaManager.search(params);
      setResults(searchResults);
    } catch (err) {
      console.error('Local search failed:', err);
      setError(err instanceof Error ? err : new Error('Unknown search error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const timer = setTimeout(() => {
      performSearch(searchParams);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [
    enabled,
    debounceMs,
    searchParams.term,
    searchParams.vector,
    searchParams.similarity,
    JSON.stringify(searchParams.where),
    searchParams.limit,
    searchParams.offset,
    performSearch
  ]);

  return {
    results,
    isLoading,
    error,
    indexingProgress,
    isIndexing: indexingProgress.status === 'indexing',
    search: performSearch,
  };
}
