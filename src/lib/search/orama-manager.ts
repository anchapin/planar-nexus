import { create, type AnyOrama, insertMultiple, search as oramaSearch } from '@orama/orama';
import { MinimalCard } from '../card-database';

export interface CardDocument {
  id: string;
  name: string;
  text: string;
  type: string;
  color: string;
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
}

export const oramaManager = new OramaManager();
