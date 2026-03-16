/**
 * @fileOverview Tests for saved-games manager
 * 
 * Issue #605: Improve IndexedDB and storage layer test coverage
 * 
 * Tests for:
 * - Saved games CRUD operations
 * - Search and filter functionality
 * - Game state and replay loading
 * - Utility functions
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  savedGamesManager, 
  createSavedGame, 
  formatSavedAt, 
  getStatusDisplay,
  getSavedGamesCount,
  type SavedGame
} from '../saved-games';
import { createInitialGameState } from '../game-state/game-state';

// Mock localStorage
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get store() {
      return store;
    },
  };
};

// Mock IndexedDB
const mockIndexedDB = {
  open: jest.fn(),
};

let mockLocalStorage: ReturnType<typeof createMockLocalStorage>;

// Setup before each test
beforeEach(() => {
  // First, set up the mock localStorage
  mockLocalStorage = createMockLocalStorage();
  
  // Mock window for Node.js environment
  Object.defineProperty(global, 'window', {
    value: {
      localStorage: mockLocalStorage,
      indexedDB: mockIndexedDB,
    },
    writable: true,
    configurable: true,
  });
  
  // Also set localStorage directly on global
  Object.defineProperty(global, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });

  // Clear any existing saved games
  try {
    savedGamesManager.clearAll();
  } catch (e) {
    // Ignore if not initialized
  }
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('saved-games manager', () => {
  describe('createSavedGame', () => {
    it('should create a saved game object', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      gameState.status = 'in_progress';
      gameState.turn.turnNumber = 3;
      
      const savedGame = await createSavedGame('Test Game', 'commander', gameState);
      
      expect(savedGame.id).toBeDefined();
      expect(savedGame.name).toBe('Test Game');
      expect(savedGame.format).toBe('commander');
      expect(savedGame.playerNames).toEqual(['Player 1', 'Player 2']);
      expect(savedGame.turnNumber).toBe(3);
      expect(savedGame.status).toBe('in_progress');
      expect(savedGame.isAutoSave).toBe(false);
      expect(savedGame.gameStateJson).toBeDefined();
      expect(savedGame.createdAt).toBe(gameState.createdAt);
    });

    it('should include replay when provided', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create a proper mock replay with all required fields
      const mockReplay = {
        id: 'replay-1',
        metadata: {
          format: 'commander',
          playerNames: ['Player 1', 'Player 2'],
          startingLife: 40,
          isCommander: true,
          winners: [],
          gameStartDate: Date.now(),
        },
        actions: [],
        currentPosition: 0,
        totalActions: 0,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      };
      
      const savedGame = await createSavedGame('Test Game', 'commander', gameState, mockReplay);
      
      expect(savedGame.replayJson).toBeDefined();
      const parsed = JSON.parse(savedGame.replayJson!);
      expect(parsed.id).toBe('replay-1');
    });
  });

  describe('formatSavedAt', () => {
    it('should return "Just now" for very recent timestamps', () => {
      const now = Date.now();
      expect(formatSavedAt(now)).toBe('Just now');
    });

    it('should return minutes ago for timestamps less than an hour old', () => {
      const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
      expect(formatSavedAt(thirtyMinutesAgo)).toBe('30m ago');
    });

    it('should return hours ago for timestamps less than a day old', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(formatSavedAt(twoHoursAgo)).toBe('2h ago');
    });

    it('should return days ago for timestamps less than a week old', () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(formatSavedAt(threeDaysAgo)).toBe('3d ago');
    });

    it('should return date for timestamps older than a week', () => {
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const result = formatSavedAt(twoWeeksAgo);
      // Should be a date string (contains /)
      expect(result).toMatch(/\//);
    });
  });

  describe('getStatusDisplay', () => {
    it('should return display text for each status', () => {
      expect(getStatusDisplay('not_started')).toBe('Not Started');
      expect(getStatusDisplay('in_progress')).toBe('In Progress');
      expect(getStatusDisplay('paused')).toBe('Paused');
      expect(getStatusDisplay('completed')).toBe('Completed');
    });

    it('should return the status itself for unknown values', () => {
      expect(getStatusDisplay('unknown' as any)).toBe('unknown');
    });
  });

  describe('getSavedGamesCount', () => {
    it('should return 0 when no games saved', async () => {
      const count = await getSavedGamesCount();
      expect(count).toBe(0);
    });

    it('should return count of saved games', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Save some games
      await savedGamesManager.saveGame(await createSavedGame('Game 1', 'commander', gameState));
      await savedGamesManager.saveGame(await createSavedGame('Game 2', 'standard', gameState));
      
      const count = await getSavedGamesCount();
      expect(count).toBe(2);
    });
  });

  describe('saveGame', () => {
    it('should save a new game', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const savedGame = await createSavedGame('New Game', 'commander', gameState);
      
      const result = await savedGamesManager.saveGame(savedGame);
      
      expect(result.id).toBe(savedGame.id);
      expect(result.name).toBe('New Game');
    });

    it('should update existing game with same ID', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const game1 = await createSavedGame('Game', 'commander', gameState);
      await savedGamesManager.saveGame(game1);
      
      // Update the game
      game1.name = 'Updated Game';
      await savedGamesManager.saveGame(game1);
      
      const games = await savedGamesManager.getAllSavedGames();
      const updated = games.find(g => g.id === game1.id);
      expect(updated?.name).toBe('Updated Game');
    });
  });

  describe('getAllSavedGames', () => {
    it('should return empty array when no games saved', async () => {
      const games = await savedGamesManager.getAllSavedGames();
      expect(games).toEqual([]);
    });

    it('should return all saved games', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const game1 = await createSavedGame('Game 1', 'commander', gameState);
      game1.savedAt = Date.now() - 1000;
      
      const game2 = await createSavedGame('Game 2', 'standard', gameState);
      game2.savedAt = Date.now();
      
      await savedGamesManager.saveGame(game1);
      await savedGamesManager.saveGame(game2);
      
      const games = await savedGamesManager.getAllSavedGames();
      expect(games).toHaveLength(2);
      // Just verify both games are present
      const names = games.map(g => g.name);
      expect(names).toContain('Game 1');
      expect(names).toContain('Game 2');
    });
  });

  describe('getSavedGame', () => {
    it('should return null for non-existent game', async () => {
      const game = await savedGamesManager.getSavedGame('non-existent');
      expect(game).toBeNull();
    });

    it('should return the game by ID', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const savedGame = await createSavedGame('Test Game', 'commander', gameState);
      
      await savedGamesManager.saveGame(savedGame);
      
      const retrieved = await savedGamesManager.getSavedGame(savedGame.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(savedGame.id);
      expect(retrieved?.name).toBe('Test Game');
    });
  });

  describe('deleteGame', () => {
    it('should delete a saved game', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const savedGame = await createSavedGame('To Delete', 'commander', gameState);
      
      await savedGamesManager.saveGame(savedGame);
      
      const success = await savedGamesManager.deleteGame(savedGame.id);
      expect(success).toBe(true);
      
      const retrieved = await savedGamesManager.getSavedGame(savedGame.id);
      expect(retrieved).toBeNull();
    });

    it('should return true when deleting non-existent game (no error thrown)', async () => {
      // The delete operation returns true because it doesn't throw an error
      // even when the game doesn't exist
      const success = await savedGamesManager.deleteGame('non-existent-id');
      expect(success).toBe(true);
    });
  });

  describe('searchGames', () => {
    it('should return all games for empty query', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveGame(await createSavedGame('Game 1', 'commander', gameState));
      await savedGamesManager.saveGame(await createSavedGame('Game 2', 'standard', gameState));
      
      const games = await savedGamesManager.searchGames('');
      expect(games).toHaveLength(2);
    });

    it('should search by game name', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveGame(await createSavedGame('My Commander Game', 'commander', gameState));
      await savedGamesManager.saveGame(await createSavedGame('Standard Match', 'standard', gameState));
      
      const results = await savedGamesManager.searchGames('commander');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('My Commander Game');
    });

    it('should search by player name', async () => {
      const gameState = createInitialGameState(['Alice', 'Bob']);
      
      await savedGamesManager.saveGame(await createSavedGame('Game 1', 'commander', gameState));
      
      const results = await savedGamesManager.searchGames('Alice');
      expect(results).toHaveLength(1);
      expect(results[0].playerNames).toContain('Alice');
    });

    it('should be case insensitive', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveGame(await createSavedGame('TEST GAME', 'commander', gameState));
      
      const results = await savedGamesManager.searchGames('test');
      expect(results).toHaveLength(1);
    });
  });

  describe('filterByStatus', () => {
    it('should filter games by status', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const inProgress = await createSavedGame('In Progress', 'commander', gameState);
      inProgress.status = 'in_progress';
      
      const completed = await createSavedGame('Completed', 'commander', gameState);
      completed.status = 'completed';
      
      await savedGamesManager.saveGame(inProgress);
      await savedGamesManager.saveGame(completed);
      
      const inProgressGames = await savedGamesManager.filterByStatus('in_progress');
      expect(inProgressGames).toHaveLength(1);
      expect(inProgressGames[0].name).toBe('In Progress');
      
      const completedGames = await savedGamesManager.filterByStatus('completed');
      expect(completedGames).toHaveLength(1);
      expect(completedGames[0].name).toBe('Completed');
    });
  });

  describe('filterByFormat', () => {
    it('should filter games by format', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveGame(await createSavedGame('Commander Game', 'commander', gameState));
      await savedGamesManager.saveGame(await createSavedGame('Standard Game', 'standard', gameState));
      
      const commanderGames = await savedGamesManager.filterByFormat('commander');
      expect(commanderGames).toHaveLength(1);
      expect(commanderGames[0].name).toBe('Commander Game');
      
      const standardGames = await savedGamesManager.filterByFormat('standard');
      expect(standardGames).toHaveLength(1);
      expect(standardGames[0].name).toBe('Standard Game');
    });
  });

  describe('loadGameState', () => {
    it('should load game state from saved game', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      gameState.turn.turnNumber = 5;
      
      const savedGame = await createSavedGame('Test Game', 'commander', gameState);
      await savedGamesManager.saveGame(savedGame);
      
      const loadedState = await savedGamesManager.loadGameState(savedGame.id);
      
      expect(loadedState).not.toBeNull();
      expect(loadedState?.turn.turnNumber).toBe(5);
    });

    it('should return null for non-existent game', async () => {
      const loadedState = await savedGamesManager.loadGameState('non-existent');
      expect(loadedState).toBeNull();
    });
  });

  describe('loadReplay', () => {
    it('should load replay from saved game', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const mockReplay = {
        id: 'replay-1',
        metadata: {
          format: 'commander',
          playerNames: ['Player 1', 'Player 2'],
          startingLife: 40,
          isCommander: true,
          winners: [],
          gameStartDate: Date.now(),
        },
        actions: [],
        currentPosition: 0,
        totalActions: 0,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      };
      
      const savedGame = await createSavedGame('Test Game', 'commander', gameState, mockReplay);
      await savedGamesManager.saveGame(savedGame);
      
      const loadedReplay = await savedGamesManager.loadReplay(savedGame.id);
      
      expect(loadedReplay).not.toBeNull();
      expect(loadedReplay?.id).toBe('replay-1');
    });

    it('should return null when no replay exists', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const savedGame = await createSavedGame('Test Game', 'commander', gameState);
      await savedGamesManager.saveGame(savedGame);
      
      const loadedReplay = await savedGamesManager.loadReplay(savedGame.id);
      expect(loadedReplay).toBeNull();
    });

    it('should return null for non-existent game', async () => {
      const loadedReplay = await savedGamesManager.loadReplay('non-existent');
      expect(loadedReplay).toBeNull();
    });
  });

  describe('clearAll', () => {
    it('should clear all saved games', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveGame(await createSavedGame('Game 1', 'commander', gameState));
      await savedGamesManager.saveGame(await createSavedGame('Game 2', 'standard', gameState));
      
      await savedGamesManager.clearAll();
      
      const games = await savedGamesManager.getAllSavedGames();
      expect(games).toHaveLength(0);
    });
  });
});
