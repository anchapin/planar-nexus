import {
  create,
  type AnyOrama,
  insertMultiple,
  search as oramaSearch,
  remove,
} from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { LRUCache } from "lru-cache";
import { db } from "../db/local-intelligence-db";
import type { MinimalCard } from "../card-database";

const CARD_SEARCH_INDEX_ID = "card_search";

/**
 * LRU result cache configuration.
 *
 * Repeated search queries (e.g. while a user types "li" -> "lig" -> "ligh"
 * -> "light") would otherwise each traverse the Orama index and hit
 * IndexedDB for hydration. Caching the small {id, name}[] payloads at the
 * index chokepoint benefits every consumer (searchCardsOffline, fuzzySearch).
 */
const SEARCH_CACHE_MAX_SIZE = 256;
const SEARCH_CACHE_TTL_MS = 60_000;

const CARD_SCHEMA = {
  id: "string",
  name: "string",
  type_line: "string",
  oracle_text: "string",
  colors: "string",
  set: "string",
  cmc: "number",
} as const;

export interface CardSearchDocument {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  colors: string;
  set?: string;
  cmc: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  where?: Record<string, unknown>;
}

export class CardSearchIndex {
  private orama: AnyOrama | null = null;
  private initialized = false;

  /**
   * LRU cache of recent search results, keyed by a normalized query string.
   * Invalidated on any index mutation (insert/remove/clear/reindex).
   */
  private resultCache = new LRUCache<string, { id: string; name: string }[]>({
    max: SEARCH_CACHE_MAX_SIZE,
    ttl: SEARCH_CACHE_TTL_MS,
  });

  async init(): Promise<boolean> {
    if (this.initialized) return false;

    const loaded = await this.loadIndex();
    if (loaded) {
      this.initialized = true;
      return true;
    }

    this.orama = await create({ schema: CARD_SCHEMA });
    this.initialized = true;
    return false;
  }

  async loadIndex(): Promise<boolean> {
    try {
      const snapshot = await db.orama_snapshots.get(CARD_SEARCH_INDEX_ID);
      if (snapshot) {
        this.orama = await restore("json", snapshot.data);
        return true;
      }
    } catch (error) {
      console.error("[CardSearchIndex] Failed to load index:", error);
    }
    return false;
  }

  async saveIndex(): Promise<void> {
    if (!this.orama) return;

    try {
      const data = await persist(this.orama, "json");
      await db.orama_snapshots.put({
        id: CARD_SEARCH_INDEX_ID,
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("[CardSearchIndex] Failed to save index:", error);
    }
  }

  async getOrama(): Promise<AnyOrama> {
    if (!this.orama) {
      await this.init();
    }
    return this.orama!;
  }

  async clear(): Promise<void> {
    try {
      await db.orama_snapshots.delete(CARD_SEARCH_INDEX_ID);
    } catch (error) {
      console.error("[CardSearchIndex] Failed to delete snapshot:", error);
    }
    this.orama = await create({ schema: CARD_SCHEMA });
    this.initialized = true;
    this.invalidateCache();
  }

  async indexCards(cards: MinimalCard[]): Promise<void> {
    const orama = await this.getOrama();

    const documents: CardSearchDocument[] = cards.map((card) => ({
      id: card.id,
      name: card.name,
      type_line: card.type_line || "",
      oracle_text: card.oracle_text || "",
      colors: (card.colors || []).join(","),
      set: card.set,
      cmc: card.cmc,
    }));

    if (documents.length > 0) {
      await insertMultiple(orama, documents);
      this.invalidateCache();
    }
  }

  async removeCard(id: string): Promise<void> {
    if (!this.orama) return;
    try {
      await remove(this.orama, id);
      this.invalidateCache();
    } catch {
      // Card may not be in index
    }
  }

  async search(
    term: string,
    options: SearchOptions = {},
  ): Promise<{ id: string; name: string }[]> {
    const cacheKey = this.buildCacheKey(term, options);
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const orama = await this.getOrama();

    const results = await oramaSearch(orama, {
      term,
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      where: options.where,
      properties: ["name", "type_line", "oracle_text"],
    });

    const hits = results.hits.map((hit) => ({
      id: hit.document.id as string,
      name: hit.document.name as string,
    }));

    this.resultCache.set(cacheKey, hits);
    return hits;
  }

  async searchByCardIds(
    ids: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const orama = await this.getOrama();
    const results = new Map<string, { id: string; name: string }>();

    for (const id of ids) {
      try {
        const searchResults = await oramaSearch(orama, {
          where: { id },
          limit: 1,
        });
        if (searchResults.hits.length > 0) {
          results.set(id, {
            id: searchResults.hits[0].document.id as string,
            name: searchResults.hits[0].document.name as string,
          });
        }
      } catch {
        // Skip cards not in index
      }
    }

    return results;
  }

  async reindexAll(cards: MinimalCard[]): Promise<void> {
    await this.clear();
    await this.indexCards(cards);
    await this.saveIndex();
  }

  /**
   * Drop the entire search result cache. Called after any index mutation
   * (insert/remove/clear/reindex) so stale results never leak out.
   */
  private invalidateCache(): void {
    this.resultCache.clear();
  }

  /**
   * Build a stable cache key from a query and its options.
   *
   * The term is normalized (trimmed + lowercased) so equivalent inputs share
   * an entry, and the options are serialized in a deterministic order so two
   * calls with the same arguments always hash identically.
   */
  private buildCacheKey(term: string, options: SearchOptions): string {
    const normalizedTerm = (term ?? "").trim().toLowerCase();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const whereKey = options.where ? JSON.stringify(options.where) : "";
    return `${normalizedTerm}|${limit}|${offset}|${whereKey}`;
  }
}

export const cardSearchIndex = new CardSearchIndex();
