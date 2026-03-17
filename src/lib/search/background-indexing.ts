import { getAllCards } from '../card-database';
import { db } from '../db/local-intelligence-db';
import { EmbeddingClient } from '../ai/embedding-client';
import { oramaManager } from './orama-manager';

export class BackgroundIndexingManager {
  private static instance: BackgroundIndexingManager | null = null;
  private isIndexing = false;
  private batchSize = 50;

  static getInstance(): BackgroundIndexingManager {
    if (!this.instance) {
      this.instance = new BackgroundIndexingManager();
    }
    return this.instance;
  }

  /**
   * Orchestrates the background indexing process:
   * 1. Retrieves cards from the source database.
   * 2. Checks for existing embeddings in Dexie.
   * 3. Generates missing embeddings in batches.
   * 4. Stores embeddings and updates the Orama index.
   */
  async startIndexing() {
    if (this.isIndexing) return;
    this.isIndexing = true;

    try {
      const cards = await getAllCards();
      if (cards.length === 0) {
        console.log('No cards found in source database.');
        return;
      }

      const embeddingClient = EmbeddingClient.getInstance();
      
      // Delta indexing: find cards that don't have embeddings yet
      const existingEmbeddings = await db.embeddings.where('model').equals('all-MiniLM-L6-v2').toArray();
      const indexedCardIds = new Set(existingEmbeddings.map(e => e.cardId));

      const cardsToEmbed = cards.filter(card => !indexedCardIds.has(card.id));

      if (cardsToEmbed.length === 0) {
        console.log('Search index is up to date.');
        // Still ensure Orama is loaded from snapshot if it hasn't been
        await oramaManager.init();
        return;
      }

      console.log(`Indexing ${cardsToEmbed.length} cards...`);

      for (let i = 0; i < cardsToEmbed.length; i += this.batchSize) {
        const batch = cardsToEmbed.slice(i, i + this.batchSize);
        const results = await embeddingClient.generateEmbeddings(batch);

        // Store embeddings in Dexie for persistence
        await db.embeddings.bulkPut(results.map(r => ({
          cardId: r.id,
          model: 'all-MiniLM-L6-v2',
          vector: r.embedding
        })));

        // Update Orama in-memory index
        const embeddingsMap = results.reduce((acc, r) => {
          acc[r.id] = r.embedding;
          return acc;
        }, {} as Record<string, number[]>);

        await oramaManager.upsertCards(batch, embeddingsMap);
        
        // Persist the Orama index snapshot
        await oramaManager.saveIndex();
        
        console.log(`Progress: ${Math.min(i + this.batchSize, cardsToEmbed.length)} / ${cardsToEmbed.length}`);
      }

      console.log('Indexing complete.');
    } catch (error) {
      console.error('Background indexing failed:', error);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Returns whether an indexing process is currently active.
   */
  getIsIndexing(): boolean {
    return this.isIndexing;
  }
}

export const backgroundIndexingManager = BackgroundIndexingManager.getInstance();
