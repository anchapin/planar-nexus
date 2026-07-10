/**
 * @fileoverview useSearchWorker hook (issue #1389).
 *
 * Lazy-inits the Orama card-search worker client and exposes a `search`
 * function that transparently falls back to the main-thread
 * `cardSearchIndex.search()` when the worker is unavailable (jsdom, SSR,
 * CSP-blocked, init failure).
 *
 * Mirrors the fallback pattern in
 * `src/ai/worker/game-state-evaluator-worker-bridge.ts` — when
 * `searchWorkerClient.getSearchApi()` returns `null`, the hook routes
 * queries through `cardSearchIndex` so results are identical and no
 * unhandled promise rejections surface.
 *
 * Usage in card-search.tsx:
 *
 *   const { search, isReady } = useSearchWorker();
 *   const hits = await search("lightning", { limit: 40 });
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  searchWorkerClient,
  SearchWorkerClient,
  type SearchWorkerStatus,
} from "@/lib/search/search-worker-client";
import { cardSearchIndex, type SearchOptions } from "@/lib/search/card-search-index";

export interface UseSearchWorkerResult {
  /**
   * Search the card index. When the worker is ready the query runs
   * off-main-thread; otherwise it falls back to `cardSearchIndex.search`.
   */
  search: (
    term: string,
    options?: SearchOptions,
  ) => Promise<{ id: string; name: string }[]>;
  /** `true` when the worker proxy is live and ready to accept queries. */
  isReady: boolean;
  /** The init error if the worker failed, or `null`. */
  error: Error | null;
  /** Current worker status for UI diagnostics. */
  status: SearchWorkerStatus;
}

export function useSearchWorker(): UseSearchWorkerResult {
  const [status, setStatus] = useState<SearchWorkerStatus>(() =>
    searchWorkerClient.getStatus(),
  );
  const [error, setError] = useState<Error | null>(() =>
    searchWorkerClient.getInitError(),
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Poll for status transition during initialization. The worker
  // construction is synchronous (inside the constructor), but in real
  // browsers the module load + Comlink handshake settle asynchronously.
  // A short interval picks up the final "ready"/"error" state without
  // coupling the hook to Comlink internals.
  useEffect(() => {
    if (status !== "initializing") return;

    const interval = setInterval(() => {
      const current = searchWorkerClient.getStatus();
      if (current !== status && mountedRef.current) {
        setStatus(current);
        setError(searchWorkerClient.getInitError());
      }
      if (current !== "initializing") {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [status]);

  const search = useCallback(
    async (
      term: string,
      options: SearchOptions = {},
    ): Promise<{ id: string; name: string }[]> => {
      const api = searchWorkerClient.getSearchApi();
      if (api) {
        try {
          return await api.search(term, options);
        } catch (err) {
          console.warn(
            "[useSearchWorker] worker search failed; falling back to main thread:",
            err,
          );
        }
      }
      return cardSearchIndex.search(term, options);
    },
    [],
  );

  return {
    search,
    isReady: status === "ready",
    error,
    status,
  };
}

export { SearchWorkerClient };
