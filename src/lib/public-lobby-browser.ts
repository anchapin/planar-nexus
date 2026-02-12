/**
 * Public lobby browser for discovering available games
 * This is a prototype implementation using localStorage to simulate a public game registry
 * In production, this would connect to a signaling server or backend API
 */

import { GameFormat, PlayerCount } from './multiplayer-types';

export interface PublicGameInfo {
  id: string;
  gameCode: string;
  name: string;
  hostName: string;
  format: GameFormat;
  maxPlayers: PlayerCount;
  currentPlayers: number;
  status: 'waiting' | 'in-progress';
  isPublic: boolean;
  hasPassword: boolean;
  allowSpectators: boolean;
  createdAt: number;
}

const STORAGE_KEY = 'planar_nexus_public_lobbies';
const REFRESH_INTERVAL = 10000; // 10 seconds

class PublicLobbyBrowser {
  private listeners: Set<(games: PublicGameInfo[]) => void> = new Set();
  private refreshTimer: NodeJS.Timeout | null = null;

  /**
   * Get all public games from the registry
   */
  getPublicGames(): PublicGameInfo[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    try {
      const games: PublicGameInfo[] = JSON.parse(stored);
      // Filter to only public games that are not full
      return games.filter(
        game =>
          game.isPublic &&
          game.currentPlayers < parseInt(game.maxPlayers) &&
          game.status === 'waiting'
      );
    } catch (e) {
      console.error('Failed to parse public games:', e);
      return [];
    }
  }

  /**
   * Register a new public game
   * This would be called by the lobby manager when a public game is created
   */
  registerPublicGame(game: PublicGameInfo): void {
    const games = this.getAllStoredGames();
    games.push(game);
    this.saveGames(games);
    this.notifyListeners();
  }

  /**
   * Update a public game's info (player count, status, etc.)
   */
  updatePublicGame(gameId: string, updates: Partial<PublicGameInfo>): void {
    const games = this.getAllStoredGames();
    const index = games.findIndex(g => g.id === gameId);

    if (index !== -1) {
      games[index] = { ...games[index], ...updates };
      this.saveGames(games);
      this.notifyListeners();
    }
  }

  /**
   * Remove a game from the public registry
   */
  unregisterPublicGame(gameId: string): void {
    const games = this.getAllStoredGames();
    const filtered = games.filter(g => g.id !== gameId);
    this.saveGames(filtered);
    this.notifyListeners();
  }

  /**
   * Filter games by criteria
   */
  filterGames(filters: {
    format?: GameFormat;
    maxPlayers?: PlayerCount;
    hasPassword?: boolean;
    allowSpectators?: boolean;
  }): PublicGameInfo[] {
    let games = this.getPublicGames();

    if (filters.format) {
      games = games.filter(g => g.format === filters.format);
    }

    if (filters.maxPlayers) {
      games = games.filter(g => g.maxPlayers === filters.maxPlayers);
    }

    if (filters.hasPassword !== undefined) {
      games = games.filter(g => g.hasPassword === filters.hasPassword);
    }

    if (filters.allowSpectators !== undefined) {
      games = games.filter(g => g.allowSpectators === filters.allowSpectators);
    }

    return games;
  }

  /**
   * Search games by name
   */
  searchGames(query: string): PublicGameInfo[] {
    if (!query.trim()) return this.getPublicGames();

    const lowerQuery = query.toLowerCase();
    return this.getPublicGames().filter(
      game =>
        game.name.toLowerCase().includes(lowerQuery) ||
        game.hostName.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Subscribe to game list updates
   */
  subscribe(callback: (games: PublicGameInfo[]) => void): () => void {
    this.listeners.add(callback);

    // Auto-refresh on first subscriber
    if (this.listeners.size === 1) {
      this.startAutoRefresh();
    }

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.stopAutoRefresh();
      }
    };
  }

  /**
   * Get a specific game by code
   */
  getGameByCode(code: string): PublicGameInfo | null {
    const games = this.getAllStoredGames();
    return games.find(g => g.gameCode === code) || null;
  }

  /**
   * Clean up old games (older than 1 hour)
   */
  cleanupOldGames(): void {
    const games = this.getAllStoredGames();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const filtered = games.filter(g => g.createdAt > oneHourAgo);

    if (filtered.length !== games.length) {
      this.saveGames(filtered);
      this.notifyListeners();
    }
  }

  /**
   * Start auto-refresh timer
   */
  private startAutoRefresh(): void {
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      this.cleanupOldGames();
      this.notifyListeners();
    }, REFRESH_INTERVAL);
  }

  /**
   * Stop auto-refresh timer
   */
  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Get all stored games (including private and full ones)
   */
  private getAllStoredGames(): PublicGameInfo[] {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse stored games:', e);
      return [];
    }
  }

  /**
   * Save games to storage
   */
  private saveGames(games: PublicGameInfo[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  }

  /**
   * Notify all listeners of updates
   */
  private notifyListeners(): void {
    const games = this.getPublicGames();
    this.listeners.forEach(callback => callback(games));
  }
}

// Singleton instance
export const publicLobbyBrowser = new PublicLobbyBrowser();
