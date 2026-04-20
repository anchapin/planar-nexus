/**
 * Search worker client stub.
 * The web worker-based search client is not yet implemented.
 * This module provides a placeholder so that dependent modules compile cleanly.
 */

import { MinimalCard } from "@/lib/card-database";
import type { SearchResults } from "./worker-types";

export const searchWorkerClient = {
  async search(
    _query: string,
    _options?: {
      limit?: number;
      offset?: number;
      where?: Record<string, unknown>;
    },
  ): Promise<SearchResults> {
    return { count: 0, hits: [], elapsed: { formatted: "0ms", raw: 0 } };
  },
  async indexCards(_cards: MinimalCard[]): Promise<number> {
    return 0;
  },
};
