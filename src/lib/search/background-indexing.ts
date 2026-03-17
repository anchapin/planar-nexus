import { getAllCards } from '../card-database';
import { db } from '../db/local-intelligence-db';
import { EmbeddingClient } from '../ai/embedding-client';
import { oramaManager } from './orama-manager';

export interface IndexingProgress {
  status: 'idle' | 'indexing' | 'completed' | 'error';
  total: number;
  processed: number;
  error?: Error;
}

export type ProgressListener = (progress: IndexingProgress) => void;

export class BackgroundIndexingManager {
  private static instance: BackgroundIndexingManager | null = null;
  private isIndexing = false;
  private batchSize = 50;
  private listeners: Set<ProgressListener> = new Set();
  private progress: IndexingProgress = {
    status: 'idle',
    total: 0,
    processed: 0,
  };

  static getInstance(): BackgroundIndexingManager {
    if (!this.instance) {
      this.instance = new BackgroundIndexingManager();
    }
    return this.instance;
  }

  subscribe(listener: ProgressListener) {
    this.listeners.add(listener);
    listener(this.progress);
    return () => this.listeners.delete(listener);
  }

  private notify(update: Partial<IndexingProgress>) {
    this.progress = { ...this.progress, ...update };
    this.listeners.forEach(l => l(this.progress));
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
    this.notify({ status: 'indexing', processed: 0, total: 0 });

    try {
      const cards = await getAllCards();
      if (cards.length === 0) {
        console.log('No cards found in source database.');
        this.notify({ status: 'idle' });
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
        this.notify({ status: 'completed', processed: 0, total: 0 });
        return;
      }

      console.log(`Indexing ${cardsToEmbed.length} cards...`);
      this.notify({ total: cardsToEmbed.length });

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
        
        const processed = Math.min(i + this.batchSize, cardsToEmbed.length);
        console.log(`Progress: ${processed} / ${cardsToEmbed.length}`);
        this.notify({ processed });
      }

      console.log('Indexing complete.');
      this.notify({ status: 'completed' });
    } catch (error) {
      console.error('Background indexing failed:', error);
      this.notify({ status: 'error', error: error as Error });
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

  getProgress(): IndexingProgress {
    return this.progress;
  }
}

export const backgroundIndexingManager = BackgroundIndexingManager.getInstance();
