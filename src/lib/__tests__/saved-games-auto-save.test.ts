/**
 * @fileOverview Tests for saved games auto-save functionality
 * 
 * Issue #269: Auto-save functionality for game states
 */

import { savedGamesManager, createSavedGame } from '../saved-games';
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

let mockLocalStorage: ReturnType<typeof createMockLocalStorage>;

// Setup before each test
beforeEach(() => {
  // First, set up the mock localStorage
  mockLocalStorage = createMockLocalStorage();
  
  // Mock window for Node.js environment
  Object.defineProperty(global, 'window', {
    value: {
      localStorage: mockLocalStorage,
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
  
  // Then clear the savedGamesManager state
  savedGamesManager.clearAll();
});

describe('saved-games auto-save', () => {
  describe('auto-save slot management', () => {
    it('should save to auto-save slot 0 when no auto-saves exist', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);

      const savedGame = await await savedGamesManager.saveToAutoSave(gameState, null, 0);

      expect(savedGame.isAutoSave).toBe(true);
      expect(savedGame.autoSaveSlot).toBe(0);
      expect(savedGame.name).toBe('Auto-Save 1');
    });

    it('should rotate through auto-save slots', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);

      // Save to slots 0, 1, 2
      await await savedGamesManager.saveToAutoSave(gameState, null, 0);
      await await savedGamesManager.saveToAutoSave(gameState, null, 1);
      await await savedGamesManager.saveToAutoSave(gameState, null, 2);

      const autoSaves = await savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      expect(autoSaves.map(s => s.autoSaveSlot)).toEqual([0, 1, 2]);
    });

    it('should overwrite oldest slot when max is reached', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);

      // Fill all slots
      await await savedGamesManager.saveToAutoSave(gameState, null, 0);
      await await savedGamesManager.saveToAutoSave(gameState, null, 1);
      await await savedGamesManager.saveToAutoSave(gameState, null, 2);

      // Save to slot 0 again (should overwrite)
      const newSavedGame = await await savedGamesManager.saveToAutoSave(gameState, null, 0);

      const autoSaves = await savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);

      // The slot 0 save should be the newest one
      const slot0Save = autoSaves.find(s => s.autoSaveSlot === 0);
      expect(slot0Save?.id).toBe(newSavedGame.id);
    });
  });

  describe('autoSave method', () => {
    it('should automatically assign slot when none specified', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);

      const savedGame = await savedGamesManager.autoSave(gameState, null);

      expect(savedGame.isAutoSave).toBe(true);
      expect(savedGame.autoSaveSlot).toBeDefined();
    });

    it('should use slot rotation by default', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create 3 auto-saves
      await savedGamesManager.autoSave(gameState, null);
      await savedGamesManager.autoSave(gameState, null);
      await savedGamesManager.autoSave(gameState, null);
      
      // Should have 3 saves with different slots
      const autoSaves = await savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      
      const slots = autoSaves.map(s => s.autoSaveSlot);
      expect(slots).toContain(0);
      expect(slots).toContain(1);
      expect(slots).toContain(2);
    });

    it('should reuse oldest slot when max auto-saves reached', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create 4 auto-saves (max is 3)
      await savedGamesManager.autoSave(gameState, null);
      await savedGamesManager.autoSave(gameState, null);
      await savedGamesManager.autoSave(gameState, null);
      const save4 = await savedGamesManager.autoSave(gameState, null);
      
      // Should still have only 3 saves
      const autoSaves = await savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      
      // Save4 should have replaced one of the earlier saves
      expect(autoSaves.some(s => s.id === save4.id)).toBe(true);
    });
  });

  describe('getAutoSaves vs getManualSaves', () => {
    it('should separate auto-saves from manual saves', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create manual save
      const manualSave = await savedGamesManager.saveGame(
        await createSavedGame('Manual Save', 'commander', gameState)
      );
      
      // Create auto-save
      const autoSave = await savedGamesManager.autoSave(gameState, null);
      
      const manualSaves = await savedGamesManager.getManualSaves();
      const autoSaves = await savedGamesManager.getAutoSaves();
      
      expect(manualSaves.map(s => s.id)).toContain(manualSave.id);
      expect(manualSaves.map(s => s.id)).not.toContain(autoSave.id);
      
      expect(autoSaves.map(s => s.id)).toContain(autoSave.id);
      expect(autoSaves.map(s => s.id)).not.toContain(manualSave.id);
    });

    it('should sort auto-saves by slot number', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      await savedGamesManager.saveToAutoSave(gameState, null, 2);
      await savedGamesManager.saveToAutoSave(gameState, null, 0);
      await savedGamesManager.saveToAutoSave(gameState, null, 1);
      
      const autoSaves = await savedGamesManager.getAutoSaves();
      const slots = autoSaves.map(s => s.autoSaveSlot);
      
      // All three slots should be present
      expect(slots).toContain(0);
      expect(slots).toContain(1);
      expect(slots).toContain(2);
      expect(slots.length).toBe(3);
    });
  });

  describe('auto-save metadata', () => {
    it('should include game state metadata', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = await savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.turnNumber).toBe(gameState.turn.turnNumber);
      expect(savedGame.currentPhase).toBe(gameState.turn.currentPhase);
      expect(savedGame.status).toBe(gameState.status);
      expect(savedGame.playerNames).toEqual(['Player 1', 'Player 2']);
    });

    it('should include timestamp', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const beforeSave = Date.now();
      
      const savedGame = await savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.savedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedGame.savedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should preserve game creation time', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = await savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.createdAt).toBe(gameState.createdAt);
    });
  });

  describe('loadGameState from auto-save', () => {
    it('should load game state from auto-save', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = await savedGamesManager.autoSave(gameState, null);
      
      const loadedState = await savedGamesManager.loadGameState(savedGame.id);
      
      expect(loadedState).not.toBeNull();
      expect(loadedState?.gameId).toBe(gameState.gameId);
    });
  });

  describe('delete auto-saves', () => {
    it('should delete specific auto-save', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = await savedGamesManager.autoSave(gameState, null);
      
      const success = await await savedGamesManager.deleteGame(savedGame.id);
      
      expect(success).toBe(true);
      expect((await savedGamesManager.getAutoSaves()).length).toBe(0);
    });

    it('should not affect manual saves when deleting auto-save', async () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const manualSave = await savedGamesManager.saveGame(
        await createSavedGame('Manual Save', 'commander', gameState)
      );
      const autoSave = await savedGamesManager.autoSave(gameState, null);

      await savedGamesManager.deleteGame(autoSave.id);

      expect((await savedGamesManager.getManualSaves()).length).toBe(1);
      expect((await savedGamesManager.getManualSaves())[0].id).toBe(manualSave.id);
    });
  });
});
