/**
 * @fileOverview Tests for local-game-storage module
 * 
 * Issue #605: Improve IndexedDB and storage layer test coverage
 * 
 * Tests for:
 * - Database initialization
 * - Game creation and joining
 * - Game state management
 * - Session handling
 * - Error handling
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { 
  localGameStorage,
  initializeGameStorage,
  createGame,
  joinGame,
  updateGameState,
  getGameState,
  getGameSession,
  updateGameStatus,
  leaveGame,
  endGame,
  type GameStorageCallbacks
} from '../local-game-storage';

// Mock IndexedDB using jest's mock system
const mockObjectStores = new Map<string, Map<any, any>>();
let mockDB: any = null;

jest.mock('fake-indexeddb', () => {
  return class FakeIndexedDB {
    static open(name: string, version?: number) {
      mockDB = {
        name,
        version,
        objectStoreNames: {
          contains: (n: string) => mockObjectStores.has(n),
          length: mockObjectStores.size,
          item: (i: number) => {
            const keys = Array.from(mockObjectStores.keys());
            return keys[i] || null;
          },
          [Symbol.iterator]: function*() {
            for (const key of mockObjectStores.keys()) yield key;
          }
        },
        createObjectStore: (storeName: string, options: any) => {
          mockObjectStores.set(storeName, new Map());
          return {
            name: storeName,
            keyPath: options?.keyPath,
            createIndex: jest.fn(),
            put: jest.fn(),
            get: jest.fn(),
            delete: jest.fn(),
            clear: jest.fn(),
            count: jest.fn(),
          };
        },
        transaction: jest.fn(),
        close: jest.fn(),
      };
      return Promise.resolve(mockDB);
    }
  };
}, { virtual: true });

describe('local-game-storage', () => {
  beforeEach(() => {
    // Reset state
    mockObjectStores.clear();
    mockDB = null;
    (localGameStorage as any).currentGameId = null;
    (localGameStorage as any).isHost = false;
    (localGameStorage as any).currentVersion = 0;
    (localGameStorage as any).isInitialized = false;
    (localGameStorage as any).initPromise = null;
    (localGameStorage as any).db = null;
  });

  describe('initializeGameStorage', () => {
    it('should initialize without errors', async () => {
      await expect(initializeGameStorage()).resolves.not.toThrow();
    });

    it('should be idempotent', async () => {
      await initializeGameStorage();
      await expect(initializeGameStorage()).resolves.not.toThrow();
    });
  });

  describe('createGame', () => {
    it('should create game with valid parameters', async () => {
      const session = await createGame('host-1', 'Host Player', 'TEST123');
      
      expect(session.gameId).toBeDefined();
      expect(session.gameCode).toBe('TEST123');
      expect(session.hostId).toBe('host-1');
      expect(session.status).toBe('active');
    });

    it('should create game without initial state', async () => {
      const session = await createGame('host-1', 'Host Player', 'TEST456');
      
      expect(session.gameId).toBeDefined();
      expect(session.gameStateVersion).toBe(0);
    });
  });

  describe('getGameState', () => {
    it('should return null when no active game', async () => {
      const state = await getGameState();
      expect(state).toBeNull();
    });
  });

  describe('getGameSession', () => {
    it('should return null when no active game', async () => {
      const session = await getGameSession();
      expect(session).toBeNull();
    });
  });

  describe('updateGameState', () => {
    it('should throw when no active game', async () => {
      const mockState = {
        gameId: 'g1', players: new Map(), cards: new Map(), zones: new Map(), stack: [],
        turn: { activePlayerId: 'p1' as any, currentPhase: 'precombat_main', turnNumber: 1, extraTurns: 0, isFirstTurn: true, startedAt: Date.now() },
        combat: { attacking: [], blocking: [] }, waitingChoice: null, priorityPlayerId: null,
        consecutivePasses: 0, status: 'not_started' as const, winners: [], endReason: null,
        format: 'commander', createdAt: Date.now(), lastModifiedAt: Date.now()
      };
      
      await expect(updateGameState(mockState as any)).rejects.toThrow('No active game');
    });
  });

  describe('localGameStorage methods', () => {
    it('getIsHost should return false initially', () => {
      expect(localGameStorage.getIsHost()).toBe(false);
    });

    it('getCurrentVersion should return 0 initially', () => {
      expect(localGameStorage.getCurrentVersion()).toBe(0);
    });

    it('setCallbacks should accept callbacks', () => {
      const callbacks: GameStorageCallbacks = {
        onGameStateUpdate: jest.fn(),
        onPlayerJoined: jest.fn(),
        onPlayerLeft: jest.fn(),
        onConnectionStateChange: jest.fn(),
        onError: jest.fn(),
      };
      
      expect(() => localGameStorage.setCallbacks(callbacks)).not.toThrow();
    });
  });
});
