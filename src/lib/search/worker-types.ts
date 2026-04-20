/**
 * @fileOverview Types for the Search Web Worker and Orama schema.
 */

import { MinimalCard } from '@/lib/card-database';

/**
 * The schema for card documents in Orama.
 * This defines which fields are indexed and their types.
 */
export const CARD_SCHEMA = {
  id: 'string',
  name: 'string',
  oracle_text: 'string',
  type_line: 'string',
  set: 'string',
  rarity: 'string',
  cmc: 'number',
  colors: 'string[]',
  color_identity: 'string[]',
} as const;

/**
 * The document structure that will be stored in Orama.
 */
export interface CardSearchDocument {
  id: string;
  name: string;
  oracle_text: string;
  type_line: string;
  set: string;
  rarity: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  // We store the full card data to return it in search results
  original: MinimalCard;
}

/**
 * A single search hit.
 */
export interface SearchHit {
  id: string;
  score: number;
  document: CardSearchDocument;
}

/**
 * Search results returned from the worker.
 */
export interface SearchResults {
  count: number;
  hits: SearchHit[];
  elapsed: {
    formatted: string;
    raw: number;
  };
}

/**
 * Messages sent from the main thread to the search worker.
 */
export type SearchWorkerMessage =
  | { type: 'INIT' }
  | { type: 'INDEX'; cards: MinimalCard[] }
  | {
      type: 'SEARCH';
      query: string;
      params?: {
        limit?: number;
        offset?: number;
        where?: Record<string, unknown>;
      }
    }
  | { type: 'CLEAR' };

/**
 * Responses sent from the search worker to the main thread.
 */
export type SearchWorkerResponse =
  | { type: 'READY' }
  | { type: 'INDEX_COMPLETE'; count: number }
  | {
      type: 'SEARCH_RESULTS';
      results: SearchResults;
      query: string;
      total: number;
    }
  | { type: 'ERROR'; message: string };
