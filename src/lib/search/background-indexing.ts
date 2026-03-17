import { getAllCards } from '../card-database';
import { db } from '../db/local-intelligence-db';
import { EmbeddingClient } from '../ai/embedding-client';
import { oramaManager, gameHistoryOramaManager } from './orama-manager';
import { getAllGameRecords, type GameRecord } from '../game-history';

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

  /**
   * Vectorizes game history records for semantic search.
   * This enables the AI to find similar past game situations.
   */
  async startHistoryVectorization() {
    if (this.isIndexing) return;
    this.isIndexing = true;
    this.notify({ status: 'indexing', processed: 0, total: 0 });

    try {
      const games = getAllGameRecords();
      
      if (games.length === 0) {
        console.log('No game history found to vectorize.');
        this.notify({ status: 'completed', processed: 0, total: 0 });
        return;
      }

      const embeddingClient = EmbeddingClient.getInstance();

      // Find games that don't have embeddings yet
      const existingEmbeddings = await db.game_embeddings.where('model').equals('all-MiniLM-L6-v2').toArray();
      const indexedGameIds = new Set(existingEmbeddings.map(e => e.gameId));

      const gamesToEmbed = games.filter(game => !indexedGameIds.has(game.id));

      if (gamesToEmbed.length === 0) {
        console.log('Game history search index is up to date.');
        await gameHistoryOramaManager.init();
        this.notify({ status: 'completed', processed: 0, total: 0 });
        return;
      }

      console.log(`Vectorizing ${gamesToEmbed.length} game records...`);
      this.notify({ total: gamesToEmbed.length });

      // Generate text representations for embedding
      const gameTexts = gamesToEmbed.map(game => {
        return `${game.result} with ${game.playerDeck} vs ${game.opponentDeck || 'unknown'}. ` +
          `Mode: ${game.mode}. Turns: ${game.turns}. ` +
          (game.summary || '') + ' ' + (game.notes || '');
      });

      // Process in batches
      for (let i = 0; i < gamesToEmbed.length; i += this.batchSize) {
        const batch = gamesToEmbed.slice(i, i + this.batchSize);
        const textBatch = gameTexts.slice(i, i + this.batchSize);

        // Generate embeddings for the text representations
        // We need to create minimal card-like objects with text property for the embedding client
        const minimalBatch = textBatch.map((text, idx) => ({
          id: batch[idx].id,
          name: batch[idx].playerDeck,
          oracle_text: text
        }));

        const results = await embeddingClient.generateEmbeddings(minimalBatch as any);

        // Store embeddings in Dexie
        await db.game_embeddings.bulkPut(results.map(r => ({
          gameId: r.id,
          model: 'all-MiniLM-L6-v2',
          vector: r.embedding,
          createdAt: Date.now()
        })));

        // Add to Orama search index
        for (let j = 0; j < batch.length; j++) {
          const game = batch[j];
          const embedding = results.find(r => r.id === game.id);
          if (embedding) {
            await gameHistoryOramaManager.upsertGameHistory(game, embedding.embedding);
          }
        }

        const processed = Math.min(i + this.batchSize, gamesToEmbed.length);
        console.log(`Vectorization progress: ${processed} / ${gamesToEmbed.length}`);
        this.notify({ processed });
      }

      console.log('Game history vectorization complete.');
      this.notify({ status: 'completed' });
    } catch (error) {
      console.error('Game history vectorization failed:', error);
      this.notify({ status: 'error', error: error as Error });
    } finally {
      this.isIndexing = false;
    }
  }
}

export const backgroundIndexingManager = BackgroundIndexingManager.getInstance();
