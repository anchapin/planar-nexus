/**
 * Firebase Game State Service
 * Issue #305: Add Firebase Realtime Database for signaling/state
 * 
 * This module provides game state storage and synchronization using
 * Firebase Realtime Database for reliability and offline support.
 */

import {
  ref,
  set,
  get,
  remove,
  onValue,
  off,
  push,
  serverTimestamp,
  DataSnapshot,
} from 'firebase/database';
import { firebaseService, isFirebaseAvailable } from './firebase-config';
import { serializeGameState, deserializeGameState, type SerializedGameState } from '../game-state/serialization';
import type { GameState } from '../game-state/types';

/**
 * Stored game session for Firebase
 */
export interface FirebaseGameSession {
  gameId: string;
  gameCode: string;
  hostId: string;
  hostName: string;
  clientId?: string;
  clientName?: string;
  gameState?: SerializedGameState;
  gameStateVersion: number;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  lastActionAt: number;
}

/**
 * Game state update message
 */
export interface GameStateUpdate {
  type: 'full-sync' | 'delta' | 'action';
  version: number;
  timestamp: number;
  senderId: string;
  data: unknown;
}

/**
 * Game state callbacks
 */
export interface FirebaseGameStateCallbacks {
  onGameStateUpdate: (gameState: GameState, version: number) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
  onConnectionStateChange: (connected: boolean) => void;
  onError: (error: Error) => void;
}

/**
 * Firebase Game State Service
 * Manages game state storage and synchronization
 */
export class FirebaseGameStateService {
  private gameId: string | null = null;
  private playerId: string = '';
  private isHost: boolean = false;
  private callbacks: FirebaseGameStateCallbacks;
  private listeners: Array<{ ref: ReturnType<typeof ref>; callback: (snap: DataSnapshot) => void }> = [];
  private currentVersion: number = 0;
  private pendingUpdates: GameStateUpdate[] = [];
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private offlineQueue: GameStateUpdate[] = [];
  private isOnline: boolean = true;

  /**
   * Create a new Firebase Game State Service
   */
  constructor(callbacks: FirebaseGameStateCallbacks) {
    this.callbacks = callbacks;

    // Set up online/offline detection
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  /**
   * Check if Firebase is available
   */
  private checkAvailability(): boolean {
    if (!isFirebaseAvailable()) {
      this.callbacks.onError(new Error('Firebase is not configured or unavailable'));
      return false;
    }
    return true;
  }

  /**
   * Create a new game session
   */
  async createGame(
    hostId: string,
    hostName: string,
    gameCode: string,
    initialGameState?: GameState
  ): Promise<FirebaseGameSession> {
    if (!this.checkAvailability()) {
      throw new Error('Firebase not available');
    }

    const db = firebaseService.getDatabaseInstance()!;
    
    // Create game
    const gamesRef = ref(db, 'games/sessions');
    const newGameRef = push(gamesRef);
    const gameId = newGameRef.key!;

    const now = Date.now();
    const session: Omit<FirebaseGameSession, 'gameId'> = {
      gameCode,
      hostId,
      hostName,
      gameState: initialGameState ? serializeGameState(initialGameState, 'Initial state') : undefined,
      gameStateVersion: initialGameState ? 1 : 0,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      lastActionAt: now,
    };

    // Store game code to game ID mapping
    await set(ref(db, `games/gameCodes/${gameCode}`), gameId);
    
    // Store game session data
    await set(newGameRef, session);

    this.gameId = gameId;
    this.playerId = hostId;
    this.isHost = true;
    this.currentVersion = session.gameStateVersion;

    // Set up listeners
    this.setupGameListeners();
    
    // Start sync interval
    this.startSyncInterval();

    return {
      gameId,
      ...session,
    };
  }

  /**
   * Join an existing game session
   */
  async joinGame(
    gameCode: string,
    playerId: string,
    playerName: string
  ): Promise<FirebaseGameSession> {
    if (!this.checkAvailability()) {
      throw new Error('Firebase not available');
    }

    const db = firebaseService.getDatabaseInstance()!;

    // Look up game by game code
    const gameCodeRef = ref(db, `games/gameCodes/${gameCode}`);
    const gameCodeSnap = await get(gameCodeRef);

    if (!gameCodeSnap.exists()) {
      throw new Error('Game not found');
    }

    const gameId = gameCodeSnap.val();
    const gameRef = ref(db, `games/sessions/${gameId}`);
    const gameSnap = await get(gameRef);

    if (!gameSnap.exists()) {
      throw new Error('Game session not found');
    }

    const gameData = gameSnap.val();

    // Register as client
    await set(ref(db, `games/sessions/${gameId}/clientId`), playerId);
    await set(ref(db, `games/sessions/${gameId}/clientName`), playerName);
    await set(ref(db, `games/sessions/${gameId}/updatedAt`), Date.now());

    this.gameId = gameId;
    this.playerId = playerId;
    this.isHost = false;
    this.currentVersion = gameData.gameStateVersion || 0;

    // Set up listeners
    this.setupGameListeners();
    
    // Start sync interval
    this.startSyncInterval();

    return {
      gameId,
      ...gameData,
      clientId: playerId,
      clientName: playerName,
    };
  }

  /**
   * Set up real-time listeners for game updates
   */
  private setupGameListeners(): void {
    if (!this.gameId) return;

    const db = firebaseService.getDatabaseInstance()!;

    // Listen for game state updates
    const gameStateRef = ref(db, `games/sessions/${this.gameId}/gameState`);
    const gameStateCallback = (snap: DataSnapshot) => {
      if (snap.exists()) {
        const serializedState = snap.val();
        const gameState = deserializeGameState(serializedState);
        this.callbacks.onGameStateUpdate(gameState, this.currentVersion);
      }
    };
    onValue(gameStateRef, gameStateCallback);
    this.listeners.push({ ref: gameStateRef, callback: gameStateCallback });

    // Listen for version updates
    const versionRef = ref(db, `games/sessions/${this.gameId}/gameStateVersion`);
    const versionCallback = (snap: DataSnapshot) => {
      if (snap.exists()) {
        this.currentVersion = snap.val();
      }
    };
    onValue(versionRef, versionCallback);
    this.listeners.push({ ref: versionRef, callback: versionCallback });

    // Listen for player joins (for host)
    if (this.isHost) {
      const clientRef = ref(db, `games/sessions/${this.gameId}/clientId`);
      const clientCallback = (snap: DataSnapshot) => {
        if (snap.exists() && snap.val() !== this.playerId) {
          // New player joined
          get(ref(db, `games/sessions/${this.gameId}/clientName`)).then((nameSnap) => {
            if (nameSnap.exists()) {
              this.callbacks.onPlayerJoined(snap.val(), nameSnap.val());
            }
          });
        }
      };
      onValue(clientRef, clientCallback);
      this.listeners.push({ ref: clientRef, callback: clientCallback });
    }

    // Connection state listener
    const connectedRef = ref(db, '.info/connected');
    const connectedCallback = (snap: DataSnapshot) => {
      this.isOnline = snap.val() === true;
      this.callbacks.onConnectionStateChange(this.isOnline);
      
      if (this.isOnline && this.offlineQueue.length > 0) {
        this.flushOfflineQueue();
      }
    };
    onValue(connectedRef, connectedCallback);
    this.listeners.push({ ref: connectedRef, callback: connectedCallback });
  }

  /**
   * Update game state
   */
  async updateGameState(gameState: GameState, isFullSync: boolean = false): Promise<void> {
    if (!this.gameId) {
      throw new Error('No active game');
    }

    const update: GameStateUpdate = {
      type: isFullSync ? 'full-sync' : 'delta',
      version: this.currentVersion + 1,
      timestamp: Date.now(),
      senderId: this.playerId,
      data: serializeGameState(gameState, isFullSync ? 'Full sync' : 'Delta update'),
    };

    if (!this.isOnline) {
      // Queue update for when we're back online
      this.offlineQueue.push(update);
      return;
    }

    await this.applyUpdate(update);
  }

  /**
   * Apply a game state update to Firebase
   */
  private async applyUpdate(update: GameStateUpdate): Promise<void> {
    if (!this.gameId) return;

    const db = firebaseService.getDatabaseInstance()!;
    
    // Only host can update game state, or use optimistic updates
    if (this.isHost || update.type === 'action') {
      await set(ref(db, `games/sessions/${this.gameId}/gameState`), update.data);
      await set(ref(db, `games/sessions/${this.gameId}/gameStateVersion`), update.version);
      await set(ref(db, `games/sessions/${this.gameId}/updatedAt`), Date.now());
      await set(ref(db, `games/sessions/${this.gameId}/lastActionAt`), Date.now());
      
      this.currentVersion = update.version;
    }
  }

  /**
   * Record a player action
   */
  async recordAction(action: string, data: unknown): Promise<void> {
    if (!this.gameId) return;

    const db = firebaseService.getDatabaseInstance()!;
    const actionRef = ref(db, `games/sessions/${this.gameId}/actions`);
    
    await push(actionRef, {
      type: action,
      data,
      playerId: this.playerId,
      timestamp: serverTimestamp(),
    });
  }

  /**
   * Get current game state
   */
  async getGameState(): Promise<GameState | null> {
    if (!this.gameId) return null;

    const db = firebaseService.getDatabaseInstance()!;
    const stateRef = ref(db, `games/sessions/${this.gameId}/gameState`);
    const snap = await get(stateRef);

    if (!snap.exists()) return null;

    return deserializeGameState(snap.val());
  }

  /**
   * Get game session info
   */
  async getGameSession(): Promise<FirebaseGameSession | null> {
    if (!this.gameId) return null;

    const db = firebaseService.getDatabaseInstance()!;
    const gameRef = ref(db, `games/sessions/${this.gameId}`);
    const snap = await get(gameRef);

    if (!snap.exists()) return null;

    return {
      gameId: this.gameId,
      ...snap.val(),
    };
  }

  /**
   * Update game status
   */
  async updateStatus(status: 'active' | 'paused' | 'completed' | 'abandoned'): Promise<void> {
    if (!this.gameId) return;

    const db = firebaseService.getDatabaseInstance()!;
    await set(ref(db, `games/sessions/${this.gameId}/status`), status);
    await set(ref(db, `games/sessions/${this.gameId}/updatedAt`), Date.now());
  }

  /**
   * Start sync interval for periodic updates
   */
  private startSyncInterval(): void {
    this.syncInterval = setInterval(() => {
      if (this.pendingUpdates.length > 0 && this.isOnline) {
        this.processPendingUpdates();
      }
    }, 100); // Process updates every 100ms
  }

  /**
   * Process pending updates
   */
  private processPendingUpdates(): void {
    while (this.pendingUpdates.length > 0) {
      const update = this.pendingUpdates.shift();
      if (update) {
        this.applyUpdate(update);
      }
    }
  }

  /**
   * Handle going online
   */
  private handleOnline(): void {
    this.isOnline = true;
    if (this.offlineQueue.length > 0) {
      this.flushOfflineQueue();
    }
  }

  /**
   * Handle going offline
   */
  private handleOffline(): void {
    this.isOnline = false;
    this.callbacks.onConnectionStateChange(false);
  }

  /**
   * Flush offline queue when back online
   */
  private async flushOfflineQueue(): Promise<void> {
    while (this.offlineQueue.length > 0) {
      const update = this.offlineQueue.shift();
      if (update) {
        await this.applyUpdate(update);
      }
    }
  }

  /**
   * Get current game ID
   */
  getGameId(): string | null {
    return this.gameId;
  }

  /**
   * Get current version
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Check if online
   */
  isOnlineStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Leave the game
   */
  async leaveGame(): Promise<void> {
    if (!this.gameId) return;

    const db = firebaseService.getDatabaseInstance()!;

    if (!this.isHost) {
      // Client leaves
      await remove(ref(db, `games/sessions/${this.gameId}/clientId`));
      await remove(ref(db, `games/sessions/${this.gameId}/clientName`));
      this.callbacks.onPlayerLeft(this.playerId);
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
    if (!this.gameId) return;

    await this.updateStatus('completed');
    this.cleanup();
  }

  /**
   * Clean up listeners and intervals
   */
  private cleanup(): void {
    // Remove all listeners
    this.listeners.forEach(({ ref, callback }) => {
      off(ref, 'value', callback);
    });
    this.listeners = [];

    // Clear intervals
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.gameId = null;
    this.currentVersion = 0;
    this.pendingUpdates = [];
    this.offlineQueue = [];
  }

  /**
   * Destroy the service
   */
  destroy(): void {
    this.cleanup();

    // Remove online/offline listeners
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }
}

/**
 * Create a Firebase game state service
 */
export function createFirebaseGameStateService(
  callbacks: FirebaseGameStateCallbacks
): FirebaseGameStateService {
  return new FirebaseGameStateService(callbacks);
}
