/**
 * @fileoverview Orama card-search Web Worker (issue #1389).
 *
 * Moves all Orama index traversal off the main thread so that typing into
 * the deck-builder / card-search no longer blocks the UI on 5k+ card
 * collections. The worker owns its own in-memory Orama index; the main
 * thread feeds it card documents via `index()` and queries it via
 * `search()`.
 *
 * The handler object is exposed via Comlink so the client
 * (`search-worker-client.ts`) receives a typed proxy. The same object is
 * exported as `searchWorker` so Jest can exercise the logic directly
 * without spawning a real Worker (mirroring the convention from
 * `backup-checksum.worker.ts` and `ai-worker.ts`).
 *
 * The Orama schema mirrors `card-search-index.ts` so that a snapshot
 * persisted on the main thread can be restored inside the worker via
 * `init(snapshot)`.
 */

import * as Comlink from "comlink";
import {
  create,
  type AnyOrama,
  insertMultiple,
  search as oramaSearch,
} from "@orama/orama";
import { restore } from "@orama/plugin-data-persistence";
import type { CardSearchDocument, SearchOptions } from "./card-search-index";

const CARD_SCHEMA = {
  id: "string",
  name: "string",
  type_line: "string",
  oracle_text: "string",
  colors: "string",
  set: "string",
  cmc: "number",
} as const;

/**
 * Module-scoped Orama instance — lives inside the worker thread.
 * Kept out of the exposed object so Comlink does not try to proxy it.
 */
let oramaInstance: AnyOrama | null = null;

/**
 * The API surface exposed to the main thread via Comlink.
 * Exported so `search-worker-client.ts` can derive the proxy type.
 */
export interface SearchWorkerAPI {
  init(snapshot?: unknown): Promise<boolean>;
  index(docs: CardSearchDocument[]): Promise<void>;
  search(
    term: string,
    options?: SearchOptions,
  ): Promise<{ id: string; name: string }[]>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

const searchWorker: SearchWorkerAPI = {
  async init(snapshot?: unknown): Promise<boolean> {
    if (snapshot) {
      try {
        oramaInstance = await restore("json", snapshot as string);
        return true;
      } catch {
        // Fall through to creating an empty index.
      }
    }
    if (!oramaInstance) {
      oramaInstance = await create({ schema: CARD_SCHEMA });
    }
    return false;
  },

  async index(docs: CardSearchDocument[]): Promise<void> {
    if (!oramaInstance) {
      await this.init();
    }
    if (docs.length > 0) {
      await insertMultiple(oramaInstance!, docs);
    }
  },

  async search(
    term: string,
    options: SearchOptions = {},
  ): Promise<{ id: string; name: string }[]> {
    if (!oramaInstance) {
      await this.init();
    }
    const results = await oramaSearch(oramaInstance!, {
      term,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      where: options.where,
      properties: ["name", "type_line", "oracle_text"],
    });
    return results.hits.map((hit) => ({
      id: hit.document.id as string,
      name: hit.document.name as string,
    }));
  },

  async clear(): Promise<void> {
    oramaInstance = await create({ schema: CARD_SCHEMA });
  },

  async count(): Promise<number> {
    if (!oramaInstance) return 0;
    try {
      const res = await oramaSearch(oramaInstance, { term: "", limit: 1 });
      return res.count ?? 0;
    } catch {
      return 0;
    }
  },
};

/**
 * Test-only: reset the module-scoped Orama instance between tests.
 * Not part of the Comlink-exposed API; exported for direct unit testing.
 * @internal
 */
export function _resetWorkerForTesting(): void {
  oramaInstance = null;
}

export { searchWorker };

// Expose the API via Comlink when running inside a real Worker context.
// In Node/jsdom (tests, SSR) `self` is either undefined or lacks
// `addEventListener`, so we skip the expose call to avoid runtime errors.
if (
  typeof self !== "undefined" &&
  typeof (self as unknown as { addEventListener?: unknown }).addEventListener ===
    "function"
) {
  Comlink.expose(searchWorker);
}
