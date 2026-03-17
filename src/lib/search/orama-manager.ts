import { create, type AnyOrama, insertMultiple, search as oramaSearch, insert } from '@orama/orama';
import { persist, restore } from '@orama/plugin-data-persistence';
import { db } from '../db/local-intelligence-db';
import { MinimalCard } from '../card-database';
import type { GameRecord } from '../game-history';

export interface CardDocument {
  id: string;
  name: string;
  text: string;
  type: string;
  color: string;
  vector: number[];
}

/**
 * Document for game history search
 */
export interface GameHistoryDocument {
  id: string;
  summary: string;
  result: string;
  deck: string;
  opponentDeck?: string;
  mode: string;
  turns: number;
  vector: number[];
}

export interface SearchParams {
  term?: string;
  vector?: number[];
  similarity?: number;
  where?: Record<string, any>;
  limit?: number;
  offset?: number;
}

export class OramaManager {
  protected orama: AnyOrama | null = null;

  async init() {
    if (this.orama) return;

    // Try to load from database first
    const loaded = await this.loadIndex();
    if (loaded) return;

    // If no snapshot exists, create a new one
    this.orama = await create({
      schema: {
        id: 'string',
        name: 'string',
        text: 'string',
        type: 'string',
        color: 'string',
        vector: 'vector[384]',
      } as const,
    });
  }

  /**
   * Loads the index from the database snapshot.
   */
  async loadIndex(): Promise<boolean> {
    try {
      const snapshot = await db.orama_snapshots.get('main');
      if (snapshot) {
        this.orama = await restore('json', snapshot.data);
        return true;
      }
    } catch (error) {
      console.error('Failed to load Orama index:', error);
    }
    return false;
  }

  /**
   * Saves the current index to the database as a snapshot.
   */
  async saveIndex() {
    if (!this.orama) return;

    try {
      const data = await persist(this.orama, 'json');
      await db.orama_snapshots.put({
        id: 'main',
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to save Orama index:', error);
    }
  }

  /**
   * Returns the underlying Orama instance.
   * Initializes it if it hasn't been already.
   */
  async getOrama(): Promise<AnyOrama> {
    if (!this.orama) {
      await this.init();
    }
    return this.orama!;
  }

  /**
   * Clears the current index by re-initializing it.
   */
  async clear() {
    this.orama = null;
    await this.init();
  }

  /**
   * Formats cards and their embeddings into Orama documents and inserts them.
   * Note: This is an append operation. For true upsert, the index should be cleared first
   * or IDs should be managed.
   */
  async upsertCards(cards: MinimalCard[], embeddings: Record<string, number[]>) {
    const orama = await this.getOrama();

    const documents: CardDocument[] = cards.map((card) => ({
      id: card.id,
      name: card.name,
      text: card.oracle_text || '',
      type: card.type_line,
      color: (card.colors || []).join(','),
      vector: embeddings[card.id] || new Array(384).fill(0),
    }));

    if (documents.length > 0) {
      await insertMultiple(orama, documents);
    }
  }

  /**
   * Performs hybrid search using Orama.
   */
  async search(params: SearchParams) {
    const orama = await this.getOrama();

    const searchOptions: any = {
      term: params.term,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0,
      where: params.where,
    };

    if (params.vector) {
      searchOptions.vector = {
        value: params.vector,
        property: 'vector',
        similarity: params.similarity ?? 0.8,
      };
      
      if (params.term) {
        searchOptions.mode = 'hybrid';
      } else {
        searchOptions.mode = 'vector';
      }
    }

    return await oramaSearch(orama, searchOptions);
  }

  /**
   * Performs vector-only search using Orama.
   */
  async searchByVector(vector: number[], limit: number = 20) {
    return this.search({
      vector,
      limit,
      similarity: 0.5,
    });
  }
}

export const oramaManager = new OramaManager();

/**
 * Manager for the game history Orama index.
 * Handles semantic search over past game situations.
 */
export class GameHistoryOramaManager {
  protected orama: AnyOrama | null = null;

  /**
   * Initialize the game history index.
   */
  async init() {
    if (this.orama) return;

    const loaded = await this.loadIndex();
    if (loaded) return;

    this.orama = await create({
      schema: {
        id: 'string',
        summary: 'string',
        result: 'string',
        deck: 'string',
        opponentDeck: 'string',
        mode: 'string',
        turns: 'number',
        vector: 'vector[384]',
      } as const,
    });
  }

  /**
   * Loads the game history index from the database.
   */
  async loadIndex(): Promise<boolean> {
    try {
      const snapshot = await db.orama_snapshots.get('game_history');
      if (snapshot) {
        this.orama = await restore('json', snapshot.data);
        return true;
      }
    } catch (error) {
      console.error('Failed to load game history Orama index:', error);
    }
    return false;
  }

  /**
   * Saves the game history index to the database.
   */
  async saveIndex() {
    if (!this.orama) return;

    try {
      const data = await persist(this.orama, 'json');
      await db.orama_snapshots.put({
        id: 'game_history',
        data,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to save game history Orama index:', error);
    }
  }

  /**
   * Get the Orama instance.
   */
  async getOrama(): Promise<AnyOrama> {
    if (!this.orama) {
      await this.init();
    }
    return this.orama!;
  }

  /**
   * Upsert a game record into the history index.
   */
  async upsertGameHistory(game: GameRecord, vector: number[]) {
    const orama = await this.getOrama();

    const document: GameHistoryDocument = {
      id: game.id,
      summary: game.summary || `${game.result} with ${game.playerDeck} vs ${game.opponentDeck || 'unknown'}`,
      result: game.result,
      deck: game.playerDeck,
      opponentDeck: game.opponentDeck,
      mode: game.mode,
      turns: game.turns,
      vector: vector || new Array(384).fill(0),
    };

    await insert(orama, document);
    await this.saveIndex();
  }

  /**
   * Search game history using hybrid search.
   */
  async searchHistory(params: {
    term?: string;
    vector?: number[];
    similarity?: number;
    limit?: number;
    where?: Record<string, any>;
  }) {
    const orama = await this.getOrama();

    const searchOptions: any = {
      term: params.term,
      limit: params.limit ?? 10,
      where: params.where,
    };

    if (params.vector) {
      searchOptions.vector = {
        value: params.vector,
        property: 'vector',
        similarity: params.similarity ?? 0.7,
      };

      if (params.term) {
        searchOptions.mode = 'hybrid';
      } else {
        searchOptions.mode = 'vector';
      }
    }

    return await oramaSearch(orama, searchOptions);
  }
}

export const gameHistoryOramaManager = new GameHistoryOramaManager();
