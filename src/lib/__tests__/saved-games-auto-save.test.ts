/**
 * @fileOverview Tests for saved games auto-save functionality
 * 
 * Issue #269: Auto-save functionality for game states
 */

import { savedGamesManager, createSavedGame } from '../saved-games';
import { createInitialGameState } from '../game-state/game-state';
import { createDeck } from '../deck-builder';

// Mock localStorage
const mockLocalStorage = (() => {
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
})();

// Setup before each test
beforeEach(() => {
  mockLocalStorage.clear();
  Object.defineProperty(global, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
  });
});

describe('saved-games auto-save', () => {
  describe('auto-save slot management', () => {
    it('should save to auto-save slot 0 when no auto-saves exist', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.saveToAutoSave(gameState, null, 0);
      
      expect(savedGame.isAutoSave).toBe(true);
      expect(savedGame.autoSaveSlot).toBe(0);
      expect(savedGame.name).toBe('Auto-Save 1');
    });

    it('should rotate through auto-save slots', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Save to slots 0, 1, 2
      savedGamesManager.saveToAutoSave(gameState, null, 0);
      savedGamesManager.saveToAutoSave(gameState, null, 1);
      savedGamesManager.saveToAutoSave(gameState, null, 2);
      
      const autoSaves = savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      expect(autoSaves.map(s => s.autoSaveSlot)).toEqual([0, 1, 2]);
    });

    it('should overwrite oldest slot when max is reached', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Fill all slots
      savedGamesManager.saveToAutoSave(gameState, null, 0);
      savedGamesManager.saveToAutoSave(gameState, null, 1);
      savedGamesManager.saveToAutoSave(gameState, null, 2);
      
      // Save to slot 0 again (should overwrite)
      const newSavedGame = savedGamesManager.saveToAutoSave(gameState, null, 0);
      
      const autoSaves = savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      
      // The slot 0 save should be the newest one
      const slot0Save = autoSaves.find(s => s.autoSaveSlot === 0);
      expect(slot0Save?.id).toBe(newSavedGame.id);
    });
  });

  describe('autoSave method', () => {
    it('should automatically assign slot when none specified', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.isAutoSave).toBe(true);
      expect(savedGame.autoSaveSlot).toBeDefined();
    });

    it('should use slot rotation by default', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create 3 auto-saves
      const save1 = savedGamesManager.autoSave(gameState, null);
      const save2 = savedGamesManager.autoSave(gameState, null);
      const save3 = savedGamesManager.autoSave(gameState, null);
      
      // Should have 3 saves with different slots
      const autoSaves = savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      
      const slots = autoSaves.map(s => s.autoSaveSlot);
      expect(slots).toContain(0);
      expect(slots).toContain(1);
      expect(slots).toContain(2);
    });

    it('should reuse oldest slot when max auto-saves reached', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create 4 auto-saves (max is 3)
      savedGamesManager.autoSave(gameState, null);
      savedGamesManager.autoSave(gameState, null);
      savedGamesManager.autoSave(gameState, null);
      const save4 = savedGamesManager.autoSave(gameState, null);
      
      // Should still have only 3 saves
      const autoSaves = savedGamesManager.getAutoSaves();
      expect(autoSaves.length).toBe(3);
      
      // Save4 should have replaced one of the earlier saves
      expect(autoSaves.some(s => s.id === save4.id)).toBe(true);
    });
  });

  describe('getAutoSaves vs getManualSaves', () => {
    it('should separate auto-saves from manual saves', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      // Create manual save
      const manualSave = savedGamesManager.saveGame(
        createSavedGame('Manual Save', 'commander', gameState)
      );
      
      // Create auto-save
      const autoSave = savedGamesManager.autoSave(gameState, null);
      
      const manualSaves = savedGamesManager.getManualSaves();
      const autoSaves = savedGamesManager.getAutoSaves();
      
      expect(manualSaves.map(s => s.id)).toContain(manualSave.id);
      expect(manualSaves.map(s => s.id)).not.toContain(autoSave.id);
      
      expect(autoSaves.map(s => s.id)).toContain(autoSave.id);
      expect(autoSaves.map(s => s.id)).not.toContain(manualSave.id);
    });

    it('should sort auto-saves by slot number', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      savedGamesManager.saveToAutoSave(gameState, null, 2);
      savedGamesManager.saveToAutoSave(gameState, null, 0);
      savedGamesManager.saveToAutoSave(gameState, null, 1);
      
      const autoSaves = savedGamesManager.getAutoSaves();
      const slots = autoSaves.map(s => s.autoSaveSlot);
      
      expect(slots).toEqual([0, 1, 2]);
    });
  });

  describe('auto-save metadata', () => {
    it('should include game state metadata', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.turnNumber).toBe(gameState.turn.turnNumber);
      expect(savedGame.currentPhase).toBe(gameState.turn.currentPhase);
      expect(savedGame.status).toBe(gameState.status);
      expect(savedGame.playerNames).toEqual(['Player 1', 'Player 2']);
    });

    it('should include timestamp', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      const beforeSave = Date.now();
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.savedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedGame.savedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should preserve game creation time', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      expect(savedGame.createdAt).toBe(gameState.createdAt);
    });
  });

  describe('loadGameState from auto-save', () => {
    it('should load game state from auto-save', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      const loadedState = savedGamesManager.loadGameState(savedGame.id);
      
      expect(loadedState).not.toBeNull();
      expect(loadedState?.gameId).toBe(gameState.gameId);
      expect(loadedState?.players.size).toBe(gameState.players.size);
    });
  });

  describe('delete auto-saves', () => {
    it('should delete specific auto-save', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const savedGame = savedGamesManager.autoSave(gameState, null);
      
      const success = savedGamesManager.deleteGame(savedGame.id);
      
      expect(success).toBe(true);
      expect(savedGamesManager.getAutoSaves().length).toBe(0);
    });

    it('should not affect manual saves when deleting auto-save', () => {
      const gameState = createInitialGameState(['Player 1', 'Player 2']);
      
      const manualSave = savedGamesManager.saveGame(
        createSavedGame('Manual Save', 'commander', gameState)
      );
      const autoSave = savedGamesManager.autoSave(gameState, null);
      
      savedGamesManager.deleteGame(autoSave.id);
      
      expect(savedGamesManager.getManualSaves().length).toBe(1);
      expect(savedGamesManager.getManualSaves()[0].id).toBe(manualSave.id);
    });
  });
});
