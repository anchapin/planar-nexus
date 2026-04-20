/**
 * @fileOverview Stub for the Search Web Worker client.
 *
 * The Orama-powered search worker has not been fully implemented yet.
 * This stub satisfies type-checking for use-search-worker.ts so the
 * build succeeds. Replace with a real implementation when background
 * search indexing is ready.
 */

import type { MinimalCard } from "@/lib/card-database";
import type { SearchResults } from "./worker-types";

interface SearchOptions {
  limit?: number;
  offset?: number;
  where?: Record<string, unknown>;
}

class SearchWorkerClient {
  async search(
    _query: string,
    _options?: SearchOptions,
  ): Promise<SearchResults> {
    return { count: 0, hits: [], elapsed: { formatted: "0ms", raw: 0 } };
  }

  async indexCards(_cards: MinimalCard[]): Promise<number> {
    return 0;
  }

  async clear(): Promise<void> {
    // no-op
  }
}

export const searchWorkerClient = new SearchWorkerClient();
