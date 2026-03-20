import { useState, useEffect, useCallback, useRef } from 'react';
import { searchWorkerClient } from '@/lib/search/search-worker-client';
import { SearchHit, SearchResults } from '@/lib/search/worker-types';
import { MinimalCard } from '@/lib/card-database';

interface SearchOptions {
  limit?: number;
  offset?: number;
  where?: Record<string, unknown>;
}

/**
 * Hook for easy access to the Orama-powered background search worker.
 * Handles debouncing and state management for card search.
 */
export function useSearchWorker() {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [resultsCount, setResultsCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastQueryRef = useRef<string>('');

  /**
   * Performs a search query with optional debouncing.
   */
  const search = useCallback((query: string, options?: SearchOptions, debounceMs = 300) => {
    // Clear any existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    lastQueryRef.current = query;

    // If query is empty, clear results immediately
    if (!query.trim()) {
      setResults([]);
      setResultsCount(0);
      setIsSearching(false);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      setError(null);
      
      try {
        const searchResults: SearchResults = await searchWorkerClient.search(query, options);
        
        // Only update if this is still the latest query
        if (lastQueryRef.current === query) {
          setResults(searchResults.hits);
          setResultsCount(searchResults.count);
        }
      } catch (err) {
        if (lastQueryRef.current === query) {
          setError(err instanceof Error ? err.message : 'Search failed');
        }
      } finally {
        if (lastQueryRef.current === query) {
          setIsSearching(false);
        }
      }
    };

    if (debounceMs > 0) {
      searchTimeoutRef.current = setTimeout(performSearch, debounceMs);
    } else {
      performSearch();
    }
  }, []);

  /**
   * Helper to trigger re-indexing and track state.
   */
  const indexCards = useCallback(async (cards: MinimalCard[]) => {
    setIsIndexing(true);
    setError(null);
    try {
      const count = await searchWorkerClient.indexCards(cards);
      return count;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Indexing failed');
      throw err;
    } finally {
      setIsIndexing(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return {
    search,
    indexCards,
    results,
    resultsCount,
    isSearching,
    isIndexing,
    error,
    clearResults: () => {
      setResults([]);
      setResultsCount(0);
    }
  };
}
