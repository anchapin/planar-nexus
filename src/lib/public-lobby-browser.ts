/**
 * Public lobby browser for discovering available games
 *
 * @deprecated This module uses server-dependent lobby browsing and is DEPRECATED.
 * Public lobby browsing requires centralized servers which creates legal liability targets.
 *
 * Use serverless P2P direct connection instead:
 * - Players exchange connection codes out-of-band (Discord, QR codes, etc.)
 * - Use `p2p-direct-connection.ts` for QR code/manual code exchange
 * - Use `p2p-signaling-client.ts` for client-side signaling
 *
 * See issue #641 for migration to legal/serverless P2P.
 *
 * This is a prototype implementation using localStorage to simulate a public game registry
 * In production, this would connect to a signaling server or backend API
 */

import { GameFormat, PlayerCount } from './multiplayer-types';
import { TIMEOUTS } from './config/timeouts';
import {
  FixedWindowLimiter,
  type RateLimitOptions,
} from './security/rate-limit';

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
const REFRESH_INTERVAL = TIMEOUTS.LOBBY_REFRESH_MS;
const DEMO_DATA_KEY = 'planar_nexus_demo_data_added';

/**
 * Issue #1277 — public lobby-list refresh budget.
 *
 * The auto-refresh interval (`REFRESH_INTERVAL`) is the polite steady-state
 * cadence, but a hostile tab or bookmark-import script can call
 * `getPublicGames` / `searchGames` / `subscribe` at arbitrary speed. Cap
 * reads at 6 / minute; cap write-side public-game mutations at 30 / minute
 * to bound the JSON.stringify / localStorage.setItem work that a flood
 * would otherwise drive.
 */
export const LOBBY_LIST_READ_LIMIT: RateLimitOptions = {
  maxEvents: 6,
  windowMs: 60_000,
};

export const LOBBY_WRITE_LIMIT: RateLimitOptions = {
  maxEvents: 30,
  windowMs: 60_000,
};

/**
 * Maximum number of rows returned per read. Even legitimate callers
 * shouldn't enumerate hundreds of public lobbies on every keystroke;
 * issue #1277 row-count cap.
 */
export const LOBBY_MAX_ROWS_PER_READ = 200;

class PublicLobbyBrowser {
  private listeners: Set<(games: PublicGameInfo[]) => void> = new Set();
  private refreshTimer: NodeJS.Timeout | null = null;
  /**
   * Issue #1277 — read & write rate limiters shared by every public-lobby
   * code path. The browser typically makes 1 read / `REFRESH_INTERVAL`, so
   * a 6 / minute fixed window is comfortable for normal browsing while
   * cutting a sustained flood above and beyond the polling cadence.
   */
  private readLimiter: FixedWindowLimiter;
  private writeLimiter: FixedWindowLimiter;
  /** Cumulative count of read-side rate-limit drops, exposed for tests. */
  public readDropped = 0;
  /** Cumulative count of write-side rate-limit drops, exposed for tests. */
  public writeDropped = 0;

  constructor(
    limits?: {
      read?: Partial<RateLimitOptions>;
      write?: Partial<RateLimitOptions>;
    },
  ) {
    this.readLimiter = new FixedWindowLimiter({
      ...LOBBY_LIST_READ_LIMIT,
      ...(limits?.read ?? {}),
    });
    this.writeLimiter = new FixedWindowLimiter({
      ...LOBBY_WRITE_LIMIT,
      ...(limits?.write ?? {}),
    });
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
   * Get all public games from the registry.
   *
   * Issue #1277 — returns `[]` if the per-browser read budget is exhausted.
   * Internally capped at {@link LOBBY_MAX_ROWS_PER_READ} rows so a single
   * read cannot return an unbounded enumeration even when the budget is
   * generous.
   */
  getPublicGames(): PublicGameInfo[] {
    if (!this.readLimiter.tryAcquire()) {
      this.readDropped += 1;
      return [];
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    try {
      const games: PublicGameInfo[] = JSON.parse(stored);
      // Filter to only public games that are not full
      const filtered = games.filter(
        game =>
          game.isPublic &&
          game.currentPlayers < parseInt(game.maxPlayers) &&
          game.status === 'waiting'
      );
      return filtered.slice(0, LOBBY_MAX_ROWS_PER_READ);
    } catch (e) {
      console.error('Failed to parse public games:', e);
      return [];
    }
  }

  /**
   * Register a new public game
   * This would be called by the lobby manager when a public game is created.
   * Subject to the {@link LOBBY_WRITE_LIMIT} write budget (issue #1277).
   */
  registerPublicGame(game: PublicGameInfo): void {
    if (!this.writeLimiter.tryAcquire()) {
      this.writeDropped += 1;
      return;
    }
    const games = this.getAllStoredGames();
    games.push(game);
    this.saveGames(games);
    this.notifyListeners();
  }

  /**
   * Update a public game's info (player count, status, etc.).
   * Subject to the {@link LOBBY_WRITE_LIMIT} write budget (issue #1277).
   */
  updatePublicGame(gameId: string, updates: Partial<PublicGameInfo>): void {
    if (!this.writeLimiter.tryAcquire()) {
      this.writeDropped += 1;
      return;
    }
    const games = this.getAllStoredGames();
    const index = games.findIndex(g => g.id === gameId);

    if (index !== -1) {
      games[index] = { ...games[index], ...updates };
      this.saveGames(games);
      this.notifyListeners();
    }
  }

  /**
   * Remove a game from the public registry.
   * Subject to the {@link LOBBY_WRITE_LIMIT} write budget (issue #1277).
   */
  unregisterPublicGame(gameId: string): void {
    if (!this.writeLimiter.tryAcquire()) {
      this.writeDropped += 1;
      return;
    }
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
   * Reset the read & write rate limiters and clear the drop counters. Used
   * by the test suite to exercise the lobby browser without bumping into
   * the fixed-window budgets shared across the whole jest run; not
   * intended for production callers.
   */
  resetLimits(): void {
    this.readLimiter.reset();
    this.writeLimiter.reset();
    this.readDropped = 0;
    this.writeDropped = 0;
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
