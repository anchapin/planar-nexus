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
  settings?: {
    timerEnabled?: boolean;
    timerMinutes?: number;
  };
}

const STORAGE_KEY = 'planar_nexus_public_lobbies';
const REFRESH_INTERVAL = 10000; // 10 seconds
const DEMO_DATA_KEY = 'planar_nexus_demo_data_added';

class PublicLobbyBrowser {
  private listeners: Set<(games: PublicGameInfo[]) => void> = new Set();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Add demo games on first load if none exist
    this.initializeDemoGames();
  }

  /**
   * Initialize demo games for testing the browser UI
   */
  private initializeDemoGames(): void {
    // Only run on client side
    if (typeof window === 'undefined') return;

    const demoAdded = localStorage.getItem(DEMO_DATA_KEY);
    const existingGames = this.getAllStoredGames();

    if (!demoAdded && existingGames.length === 0) {
      const now = Date.now();
      const demoGames: PublicGameInfo[] = [
        {
          id: `demo_${now}_1`,
          gameCode: 'ABC123',
          name: 'Casual Commander Night',
          hostName: 'CommanderMaster',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: now - 5 * 60 * 1000, // 5 minutes ago
        },
        {
          id: `demo_${now}_2`,
          gameCode: 'XYZ789',
          name: 'cEDH Practice',
          hostName: 'SpikePlayer',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 3,
          status: 'waiting',
          isPublic: true,
          hasPassword: true,
          allowSpectators: false,
          createdAt: now - 15 * 60 * 1000, // 15 minutes ago
        },
        {
          id: `demo_${now}_3`,
          gameCode: 'MOD456',
          name: 'Modern Mayhem',
          hostName: 'ModernFan',
          format: 'modern',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: now - 2 * 60 * 1000, // 2 minutes ago
        },
        {
          id: `demo_${now}_4`,
          gameCode: 'STD789',
          name: 'Standard Showdown',
          hostName: 'NewPlayer123',
          format: 'standard',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: now - 30 * 60 * 1000, // 30 minutes ago
        },
        {
          id: `demo_${now}_5`,
          gameCode: 'PIO234',
          name: 'Pioneer Party',
          hostName: 'PioneerPete',
          format: 'pioneer',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: now - 8 * 60 * 1000, // 8 minutes ago
        },
      ];

      demoGames.forEach(game => {
        existingGames.push(game);
      });

      this.saveGames(existingGames);
      localStorage.setItem(DEMO_DATA_KEY, 'true');
    }
  }

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
   * Clear all demo data (useful for testing)
   */
  clearDemoData(): void {
    localStorage.removeItem(DEMO_DATA_KEY);
    const games = this.getAllStoredGames().filter(g => !g.id.startsWith('demo_'));
    this.saveGames(games);
    this.notifyListeners();
  }

  /**
   * Reset all games (clear everything including demo data)
   */
  resetAllGames(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEMO_DATA_KEY);
    this.notifyListeners();
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
