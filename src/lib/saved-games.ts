/**
 * @fileOverview Saved games management system
 * 
 * Issue #33: Phase 2.3: Add saved games browser
 * 
 * Provides:
 * - Save game to localStorage
 * - Load saved games list
 * - Delete saved games
 * - Game metadata management
 */

import type { GameState } from './game-state/types';
import type { Replay } from './game-state/replay';

export interface SavedGame {
  /** Unique identifier */
  id: string;
  /** Game name/title */
  name: string;
  /** Game format */
  format: string;
  /** Player names */
  playerNames: string[];
  /** When the game was saved */
  savedAt: number;
  /** When the game was created */
  createdAt: number;
  /** Current turn number */
  turnNumber: number;
  /** Current phase */
  currentPhase: string;
  /** Game status */
  status: 'not_started' | 'in_progress' | 'paused' | 'completed';
  /** Winner(s) if completed */
  winners?: string[];
  /** Whether this is an auto-save */
  isAutoSave: boolean;
  /** Auto-save slot number (if isAutoSave is true) */
  autoSaveSlot?: number;
  /** Game state snapshot (serialized) */
  gameStateJson: string;
  /** Replay data (optional) */
  replayJson?: string;
}

const STORAGE_KEY = 'planar_nexus_saved_games';
const AUTO_SAVE_PREFIX = 'planar_nexus_auto_save_';
const MAX_AUTO_SAVE_SLOTS = 3;

/**
 * Saved games manager
 */
class SavedGamesManager {
  /**
   * Get all saved games
   */
  getAllSavedGames(): SavedGame[] {
    if (typeof window === 'undefined') return [];
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    try {
      const games: SavedGame[] = JSON.parse(stored);
      // Sort by save date, newest first
      return games.sort((a, b) => b.savedAt - a.savedAt);
    } catch (e) {
      console.error('Failed to parse saved games:', e);
      return [];
    }
  }

  /**
   * Get saved game by ID
   */
  getSavedGame(id: string): SavedGame | null {
    const games = this.getAllSavedGames();
    return games.find(g => g.id === id) || null;
  }

  /**
   * Save a game
   */
  saveGame(game: SavedGame): SavedGame {
    const games = this.getAllSavedGames();
    
    // Check if game with same ID exists
    const existingIndex = games.findIndex(g => g.id === game.id);
    
    if (existingIndex >= 0) {
      // Update existing
      games[existingIndex] = game;
    } else {
      // Add new
      games.push(game);
    }

    this.saveGamesToStorage(games);
    return game;
  }

  /**
   * Delete a saved game
   */
  deleteGame(id: string): boolean {
    const games = this.getAllSavedGames();
    const filteredGames = games.filter(g => g.id !== id);
    
    if (filteredGames.length === games.length) {
      return false; // No game was deleted
    }

    this.saveGamesToStorage(filteredGames);
    return true;
  }

  /**
   * Get only manual saves (not auto-saves)
   */
  getManualSaves(): SavedGame[] {
    return this.getAllSavedGames().filter(g => !g.isAutoSave);
  }

  /**
   * Get only auto-saves
   */
  getAutoSaves(): SavedGame[] {
    return this.getAllSavedGames()
      .filter(g => g.isAutoSave)
      .sort((a, b) => (a.autoSaveSlot || 0) - (b.autoSaveSlot || 0));
  }

  /**
   * Save game state to auto-save slot
   */
  saveToAutoSave(
    gameState: GameState,
    replay: Replay | null,
    slot: number = 0
  ): SavedGame {
    // First, delete any existing auto-save in this slot
    const existingAutoSaves = this.getAutoSaves();
    const existingInSlot = existingAutoSaves.find(g => g.autoSaveSlot === slot);
    if (existingInSlot) {
      this.deleteGame(existingInSlot.id);
    }

    const now = Date.now();
    const autoSave: SavedGame = {
      id: `${AUTO_SAVE_PREFIX}${slot}_${now}`,
      name: `Auto-Save ${slot + 1}`,
      format: 'unknown', // Would be stored in gameState
      playerNames: Array.from(gameState.players.values()).map(p => p.name),
      savedAt: now,
      createdAt: gameState.createdAt,
      turnNumber: gameState.turn.turnNumber,
      currentPhase: gameState.turn.currentPhase,
      status: gameState.status,
      winners: gameState.winners,
      isAutoSave: true,
      autoSaveSlot: slot,
      gameStateJson: JSON.stringify(gameState),
      replayJson: replay ? JSON.stringify(replay) : undefined,
    };

    return this.saveGame(autoSave);
  }

  /**
   * Perform auto-save with slot rotation
   */
  autoSave(gameState: GameState, replay: Replay | null): SavedGame {
    const autoSaves = this.getAutoSaves();
    
    // Find oldest slot or use slot 0
    let targetSlot = 0;
    if (autoSaves.length >= MAX_AUTO_SAVE_SLOTS) {
      // Use the oldest slot
      targetSlot = autoSaves[0].autoSaveSlot || 0;
    } else {
      // Find first available slot
      const usedSlots = new Set(autoSaves.map(g => g.autoSaveSlot));
      for (let i = 0; i < MAX_AUTO_SAVE_SLOTS; i++) {
        if (!usedSlots.has(i)) {
          targetSlot = i;
          break;
        }
      }
    }

    return this.saveToAutoSave(gameState, replay, targetSlot);
  }

  /**
   * Search saved games by name or player
   */
  searchGames(query: string): SavedGame[] {
    if (!query.trim()) return this.getAllSavedGames();
    
    const lowerQuery = query.toLowerCase();
    return this.getAllSavedGames().filter(
      game =>
        game.name.toLowerCase().includes(lowerQuery) ||
        game.playerNames.some(name => name.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Filter saved games by status
   */
  filterByStatus(status: SavedGame['status']): SavedGame[] {
    return this.getAllSavedGames().filter(g => g.status === status);
  }

  /**
   * Filter saved games by format
   */
  filterByFormat(format: string): SavedGame[] {
    return this.getAllSavedGames().filter(g => g.format === format);
  }

  /**
   * Load game state from saved game
   */
  loadGameState(id: string): GameState | null {
    const game = this.getSavedGame(id);
    if (!game) return null;

    try {
      return JSON.parse(game.gameStateJson);
    } catch (e) {
      console.error('Failed to parse game state:', e);
      return null;
    }
  }

  /**
   * Load replay from saved game
   */
  loadReplay(id: string): Replay | null {
    const game = this.getSavedGame(id);
    if (!game?.replayJson) return null;

    try {
      return JSON.parse(game.replayJson);
    } catch (e) {
      console.error('Failed to parse replay:', e);
      return null;
    }
  }

  /**
   * Clear all saved games
   */
  clearAll(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * Export saved game to JSON file
   */
  exportGame(id: string): void {
    const game = this.getSavedGame(id);
    if (!game) return;

    const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved-game-${game.name.replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import saved game from JSON file
   */
  async importGame(file: File): Promise<SavedGame | null> {
    try {
      const text = await file.text();
      const game = JSON.parse(text) as SavedGame;
      
      // Generate new ID to avoid conflicts
      game.id = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      game.savedAt = Date.now();
      
      return this.saveGame(game);
    } catch (e) {
      console.error('Failed to import game:', e);
      return null;
    }
  }

  /**
   * Save games to localStorage
   */
  private saveGamesToStorage(games: SavedGame[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  }
}

// Singleton instance
export const savedGamesManager = new SavedGamesManager();

/**
 * Helper to create a SavedGame from game state
 */
export function createSavedGame(
  name: string,
  format: string,
  gameState: GameState,
  replay?: Replay | null
): SavedGame {
  return {
    id: `save-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    format,
    playerNames: Array.from(gameState.players.values()).map(p => p.name),
    savedAt: Date.now(),
    createdAt: gameState.createdAt,
    turnNumber: gameState.turn.turnNumber,
    currentPhase: gameState.turn.currentPhase,
    status: gameState.status,
    winners: gameState.winners,
    isAutoSave: false,
    gameStateJson: JSON.stringify(gameState),
    replayJson: replay ? JSON.stringify(replay) : undefined,
  };
}

/**
 * Format timestamp to readable date
 */
export function formatSavedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

/**
 * Get status display text
 */
export function getStatusDisplay(status: SavedGame['status']): string {
  switch (status) {
    case 'not_started': return 'Not Started';
    case 'in_progress': return 'In Progress';
    case 'paused': return 'Paused';
    case 'completed': return 'Completed';
    default: return status;
  }
}
