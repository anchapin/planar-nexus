/**
 * Local Game State Storage Module
 * Replaces Firebase Realtime Database with IndexedDB for game state storage
 */

import { serializeGameState, deserializeGameState, type SerializedGameState } from './game-state/serialization';
import type { GameState, Phase, PlayerId } from './game-state/types';

// IndexedDB configuration
const DB_NAME = 'PlanarNexusGameDB';
const DB_VERSION = 1;
const GAMES_STORE_NAME = 'games';
const GAME_CODES_STORE_NAME = 'gameCodes';

// Database state
let db: IDBDatabase | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Game session info
 */
export interface LocalGameSession {
  /** Unique game ID */
  gameId: string;
  /** Game code for joining */
  gameCode: string;
  /** Host player ID */
  hostId: string;
  /** Host player name */
  hostName: string;
  /** Client player ID (if joined) */
  clientId?: string;
  /** Client player name (if joined) */
  clientName?: string;
  /** Current game state (serialized) */
  gameState?: SerializedGameState;
  /** Game state version */
  gameStateVersion: number;
  /** When the game was created */
  createdAt: number;
  /** When the game was last updated */
  updatedAt: number;
  /** Last action timestamp */
  lastActionAt: number;
  /** Game status */
  status: 'active' | 'paused' | 'completed' | 'abandoned';
}

/**
 * Game state update info
 */
export interface GameStateUpdate {
  type: 'full-sync' | 'delta' | 'action';
  version: number;
  timestamp: number;
  senderId: string;
  data: SerializedGameState;
}

/**
 * Game storage callbacks
 */
export interface GameStorageCallbacks {
  onGameStateUpdate: (gameState: GameState, version: number) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
  onConnectionStateChange: (connected: boolean) => void;
  onError: (error: Error) => void;
}

/**
 * Local Game Storage Manager
 * Handles game state persistence using IndexedDB
 */
class LocalGameStorageManager {
  private callbacks: GameStorageCallbacks | null = null;
  private currentGameId: string | null = null;
  private isHost: boolean = false;
  private currentVersion: number = 0;
  private pendingUpdates: GameStateUpdate[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Open IndexedDB and create schema
   */
  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;

        // Create games object store
        if (!database.objectStoreNames.contains(GAMES_STORE_NAME)) {
          const gamesStore = database.createObjectStore(GAMES_STORE_NAME, { keyPath: 'gameId' });
          gamesStore.createIndex('gameCode', 'gameCode', { unique: true });
          gamesStore.createIndex('status', 'status', { unique: false });
          gamesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Create game codes object store for quick lookups
        if (!database.objectStoreNames.contains(GAME_CODES_STORE_NAME)) {
          database.createObjectStore(GAME_CODES_STORE_NAME, { keyPath: 'gameCode' });
        }
      };
    });
  }

  /**
   * Initialize the storage manager
   */
  async initialize(): Promise<void> {
    if (isInitialized) {
      return initPromise || Promise.resolve();
    }

    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      try {
        db = await this.openDatabase();
        isInitialized = true;
      } catch (error) {
        console.error('Failed to initialize game storage:', error);
        throw error;
      }
    })();

    return initPromise;
  }

  /**
   * Set callbacks for storage events
   */
  setCallbacks(callbacks: GameStorageCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Create a new game session
   */
  async createGame(
    hostId: string,
    hostName: string,
    gameCode: string,
    initialGameState?: GameState
  ): Promise<LocalGameSession> {
    await this.initialize();

    if (!db) {
      throw new Error('Database not initialized');
    }

    const gameId = this.generateGameId();
    const now = Date.now();

    const session: LocalGameSession = {
      gameId,
      gameCode,
      hostId,
      hostName,
      gameState: initialGameState ? serializeGameState(initialGameState) : undefined,
      gameStateVersion: initialGameState ? 1 : 0,
      createdAt: now,
      updatedAt: now,
      lastActionAt: now,
      status: 'active',
    };

    // Store game code mapping
    await this.storeGameCode(gameCode, gameId);

    // Store game session
    await this.storeGameSession(session);

    this.currentGameId = gameId;
    this.isHost = true;
    this.currentVersion = session.gameStateVersion;

    // Start sync interval
    this.startSyncInterval();

    // Notify connection state
    this.callbacks?.onConnectionStateChange(true);

    return session;
  }

  /**
   * Join an existing game session
   */
  async joinGame(
    gameCode: string,
    playerId: string,
    playerName: string
  ): Promise<LocalGameSession> {
    await this.initialize();

    if (!db) {
      throw new Error('Database not initialized');
    }

    // Look up game by game code
    const gameId = await this.lookupGameCode(gameCode);
    if (!gameId) {
      throw new Error('Game not found. Check the code and try again.');
    }

    const session = await this.getGameSessionById(gameId);
    if (!session) {
      throw new Error('Game session not found');
    }

    // Register as client
    session.clientId = playerId;
    session.clientName = playerName;
    session.updatedAt = Date.now();

    await this.storeGameSession(session);

    this.currentGameId = gameId;
    this.isHost = false;
    this.currentVersion = session.gameStateVersion;

    // Start sync interval
    this.startSyncInterval();

    // Notify connection state
    this.callbacks?.onConnectionStateChange(true);
    this.callbacks?.onPlayerJoined(playerId, playerName);

    return session;
  }

  /**
   * Update game state
   */
  async updateGameState(gameState: GameState, isFullSync: boolean = false): Promise<void> {
    if (!this.currentGameId) {
      throw new Error('No active game');
    }

    if (!db) {
      throw new Error('Database not initialized');
    }

    const update: GameStateUpdate = {
      type: isFullSync ? 'full-sync' : 'delta',
      version: this.currentVersion + 1,
      timestamp: Date.now(),
      senderId: this.isHost ? 'host' : 'client',
      data: serializeGameState(gameState),
    };

    // Queue update for processing
    this.pendingUpdates.push(update);

    return;
  }

  /**
   * Process pending updates
   */
  private async processPendingUpdates(): Promise<void> {
    while (this.pendingUpdates.length > 0) {
      const update = this.pendingUpdates.shift();
      if (!update) continue;

      await this.applyUpdate(update);
    }
  }

  /**
   * Apply a game state update to storage
   */
  private async applyUpdate(update: GameStateUpdate): Promise<void> {
    if (!this.currentGameId || !db) {
      return;
    }

    const session = await this.getGameSessionById(this.currentGameId);
    if (!session) {
      return;
    }

    // Only host can update game state in storage
    if (this.isHost || update.type === 'action') {
      session.gameState = update.data;
      session.gameStateVersion = update.version;
      session.updatedAt = Date.now();
      session.lastActionAt = Date.now();

      await this.storeGameSession(session);
      this.currentVersion = update.version;

      // Notify callbacks
      const baseState = this.createBaseEngineState();
      const gameState = deserializeGameState(update.data, baseState);
      this.callbacks?.onGameStateUpdate(gameState, update.version);
    }
  }

  /**
   * Create a minimal base engine state for deserialization
   */
  private createBaseEngineState(): any {
    return {
      gameId: '',
      players: new Map(),
      cards: new Map(),
      zones: new Map(),
      stack: [],
      turn: { 
        activePlayerId: '' as PlayerId, 
        currentPhase: 'precombat_main' as Phase, 
        turnNumber: 1,
        extraTurns: 0,
        isFirstTurn: true,
        startedAt: Date.now(),
      },
      combat: { attacking: [], blocking: [] },
      waitingChoice: null,
      priorityPlayerId: null,
      consecutivePasses: 0,
      status: 'not_started',
      winners: [],
      endReason: null,
      format: 'commander',
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    };
  }

  /**
   * Get current game state
   */
  async getGameState(): Promise<GameState | null> {
    if (!this.currentGameId) {
      return null;
    }

    const session = await this.getGameSessionById(this.currentGameId);
    if (!session || !session.gameState) {
      return null;
    }

    const baseState = this.createBaseEngineState();
    return deserializeGameState(session.gameState, baseState);
  }

  /**
   * Get game session info
   */
  async getGameSession(): Promise<LocalGameSession | null> {
    if (!this.currentGameId) {
      return null;
    }

    return this.getGameSessionById(this.currentGameId);
  }

  /**
   * Update game status
   */
  async updateStatus(status: 'active' | 'paused' | 'completed' | 'abandoned'): Promise<void> {
    if (!this.currentGameId || !db) {
      return;
    }

    const session = await this.getGameSessionById(this.currentGameId);
    if (!session) {
      return;
    }

    session.status = status;
    session.updatedAt = Date.now();

    await this.storeGameSession(session);
  }

  /**
   * Get current game ID
   */
  getGameId(): string | null {
    return this.currentGameId;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Check if this is the host
   */
  getIsHost(): boolean {
    return this.isHost;
  }

  /**
   * Leave the game
   */
  async leaveGame(): Promise<void> {
    if (!this.currentGameId || !db) {
      return;
    }

    const session = await this.getGameSessionById(this.currentGameId);
    if (!session) {
      return;
    }

    if (!this.isHost && session.clientId) {
      // Client leaves
      await this.removePlayerFromSession(this.currentGameId);
      this.callbacks?.onPlayerLeft(session.clientId);
    } else {
      // Host leaves - mark game as abandoned
      await this.updateStatus('abandoned');
    }

    this.cleanup();
  }

  /**
   * End the game
   */
  async endGame(): Promise<void> {
    await this.updateStatus('completed');
    this.cleanup();
  }

  /**
   * Start sync interval for periodic updates
   */
  private startSyncInterval(): void {
    this.syncInterval = setInterval(async () => {
      if (this.pendingUpdates.length > 0) {
        await this.processPendingUpdates();
      }
    }, 100); // Process updates every 100ms
  }

  /**
   * Stop sync interval
   */
  private stopSyncInterval(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.stopSyncInterval();
    this.currentGameId = null;
    this.currentVersion = 0;
    this.pendingUpdates = [];
    this.callbacks?.onConnectionStateChange(false);
  }

  /**
   * Generate a unique game ID
   */
  private generateGameId(): string {
    return 'game_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Store game code mapping
   */
  private async storeGameCode(gameCode: string, gameId: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');

    const database = db;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([GAME_CODES_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(GAME_CODES_STORE_NAME);
      const request = store.put({ gameCode, gameId });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Look up game by game code
   */
  private async lookupGameCode(gameCode: string): Promise<string | null> {
    if (!db) throw new Error('Database not initialized');

    const database = db;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([GAME_CODES_STORE_NAME], 'readonly');
      const store = transaction.objectStore(GAME_CODES_STORE_NAME);
      const request = store.get(gameCode);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result?.gameId || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Store game session
   */
  private async storeGameSession(session: LocalGameSession): Promise<void> {
    if (!db) throw new Error('Database not initialized');

    const database = db;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([GAMES_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(GAMES_STORE_NAME);
      const request = store.put(session);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get game session by ID
   */
  private async getGameSessionById(gameId: string): Promise<LocalGameSession | null> {
    if (!db) throw new Error('Database not initialized');

    const database = db;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([GAMES_STORE_NAME], 'readonly');
      const store = transaction.objectStore(GAMES_STORE_NAME);
      const request = store.get(gameId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove player from session
   */
  private async removePlayerFromSession(gameId: string): Promise<void> {
    if (!db) throw new Error('Database not initialized');

    const database = db;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([GAMES_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(GAMES_STORE_NAME);
      const request = store.get(gameId);

      request.onsuccess = () => {
        const session = request.result;
        if (session) {
          session.clientId = undefined;
          session.clientName = undefined;
          session.updatedAt = Date.now();
          const updateRequest = store.put(session);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const localGameStorage = new LocalGameStorageManager();

/**
 * Initialize game storage
 */
export async function initializeGameStorage(): Promise<void> {
  return localGameStorage.initialize();
}

/**
 * Create a game
 */
export async function createGame(
  hostId: string,
  hostName: string,
  gameCode: string,
  initialGameState?: GameState,
  callbacks?: GameStorageCallbacks
): Promise<LocalGameSession> {
  if (callbacks) {
    localGameStorage.setCallbacks(callbacks);
  }
  return localGameStorage.createGame(hostId, hostName, gameCode, initialGameState);
}

/**
 * Join a game
 */
export async function joinGame(
  gameCode: string,
  playerId: string,
  playerName: string,
  callbacks?: GameStorageCallbacks
): Promise<LocalGameSession> {
  if (callbacks) {
    localGameStorage.setCallbacks(callbacks);
  }
  return localGameStorage.joinGame(gameCode, playerId, playerName);
}

/**
 * Update game state
 */
export async function updateGameState(gameState: GameState, isFullSync?: boolean): Promise<void> {
  return localGameStorage.updateGameState(gameState, isFullSync);
}

/**
 * Get game state
 */
export async function getGameState(): Promise<GameState | null> {
  return localGameStorage.getGameState();
}

/**
 * Get game session
 */
export async function getGameSession(): Promise<LocalGameSession | null> {
  return localGameStorage.getGameSession();
}

/**
 * Update game status
 */
export async function updateGameStatus(status: 'active' | 'paused' | 'completed' | 'abandoned'): Promise<void> {
  return localGameStorage.updateStatus(status);
}

/**
 * Leave game
 */
export async function leaveGame(): Promise<void> {
  return localGameStorage.leaveGame();
}

/**
 * End game
 */
export async function endGame(): Promise<void> {
  return localGameStorage.endGame();
}
