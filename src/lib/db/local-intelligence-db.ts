import Dexie, { type EntityTable } from 'dexie';

export interface Embedding {
  id?: number;
  cardId: string;
  model: string;
  vector: number[] | Float32Array;
}

export interface OramaSnapshot {
  id: string;
  data: any;
  timestamp: number;
}

export interface GameHistory {
  id?: number;
  timestamp: number;
  type: string;
  data: any;
}

export interface PlayerDecision {
  id?: number;
  gameId: string;
  timestamp: number;
  decision: any;
  context: any;
}

export interface GameEmbedding {
  id?: number;
  gameId: string;
  model: string;
  vector: number[] | Float32Array;
  createdAt: number;
}

/**
 * Local database for storing embeddings, search index snapshots,
 * game history, and player decisions.
 */
export class LocalIntelligenceDB extends Dexie {
  // Define tables with EntityTable for better type safety in Dexie 4+
  embeddings!: EntityTable<Embedding, 'id'>;
  orama_snapshots!: EntityTable<OramaSnapshot, 'id'>;
  game_history!: EntityTable<GameHistory, 'id'>;
  player_decisions!: EntityTable<PlayerDecision, 'id'>;
  game_embeddings!: EntityTable<GameEmbedding, 'id'>;

  constructor() {
    super('LocalIntelligenceDB');
    
    // Define the schema using the plan's exact definitions
    this.version(1).stores({
      embeddings: '++id, cardId, [cardId+model], vector',
      orama_snapshots: 'id, data, timestamp',
      game_history: '++id, timestamp, type, data',
      player_decisions: '++id, gameId, timestamp, decision, context'
    });
    
    // Version 2: Add game_embeddings table for semantic game search
    this.version(2).stores({
      game_embeddings: '++id, gameId, [gameId+model], createdAt'
    });
  }
}

// Export a singleton instance
export const db = new LocalIntelligenceDB();
