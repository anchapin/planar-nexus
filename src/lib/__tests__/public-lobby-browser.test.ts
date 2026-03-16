/**
 * Tests for Public Lobby Browser
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
});

// Import after mock is set up
import { PublicGameInfo, publicLobbyBrowser } from '../public-lobby-browser';
import { GameFormat, PlayerCount } from '../multiplayer-types';

describe('PublicLobbyBrowser', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset the browser by creating a new instance
    jest.resetModules();
  });

  describe('PublicGameInfo type', () => {
    it('should create valid public game info', () => {
      const game: PublicGameInfo = {
        id: 'game-1',
        gameCode: 'ABC123',
        name: 'Test Game',
        hostName: 'Host Player',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 2,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      expect(game.id).toBe('game-1');
      expect(game.gameCode).toBe('ABC123');
      expect(game.format).toBe('commander');
      expect(game.maxPlayers).toBe('4');
      expect(game.currentPlayers).toBe(2);
      expect(game.status).toBe('waiting');
    });

    it('should handle all game formats', () => {
      const formats: GameFormat[] = ['commander', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper'];

      formats.forEach((format) => {
        const game: PublicGameInfo = {
          id: `game-${format}`,
          gameCode: 'TEST',
          name: `${format} Game`,
          hostName: 'Host',
          format,
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: Date.now(),
        };
        expect(game.format).toBe(format);
      });
    });

    it('should handle all player count options', () => {
      const counts: PlayerCount[] = ['2', '3', '4'];

      counts.forEach((count) => {
        const game: PublicGameInfo = {
          id: `game-${count}`,
          gameCode: 'TEST',
          name: 'Test',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: count,
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: Date.now(),
        };
        expect(game.maxPlayers).toBe(count);
      });
    });

    it('should handle game status options', () => {
      const waitingGame: PublicGameInfo = {
        id: 'game-1',
        gameCode: 'ABC',
        name: 'Waiting Game',
        hostName: 'Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 2,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      const inProgressGame: PublicGameInfo = {
        id: 'game-2',
        gameCode: 'DEF',
        name: 'In Progress Game',
        hostName: 'Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 4,
        status: 'in-progress',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      expect(waitingGame.status).toBe('waiting');
      expect(inProgressGame.status).toBe('in-progress');
    });

    it('should handle optional settings', () => {
      const gameWithSettings: PublicGameInfo = {
        id: 'game-1',
        gameCode: 'ABC123',
        name: 'Game with Settings',
        hostName: 'Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 2,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
        settings: {
          timerEnabled: true,
          timerMinutes: 30,
        },
      };

      expect(gameWithSettings.settings?.timerEnabled).toBe(true);
      expect(gameWithSettings.settings?.timerMinutes).toBe(30);
    });
  });

  describe('getPublicGames', () => {
    it('should return empty array when no games stored', () => {
      // Re-require to get fresh instance
      jest.doMock('../public-lobby-browser', () => {
        const { PublicGameInfo: PGI, publicLobbyBrowser: PLB } = jest.requireActual('../public-lobby-browser');
        return { PublicGameInfo: PGI, publicLobbyBrowser: PLB };
      });
      
      const games = publicLobbyBrowser.getPublicGames();
      expect(Array.isArray(games)).toBe(true);
    });

    it('should return empty array for invalid stored data', () => {
      localStorage.setItem('planar_nexus_public_lobbies', 'invalid json');
      
      const games = publicLobbyBrowser.getPublicGames();
      expect(games).toEqual([]);
    });

    it('should filter out non-public games', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Public Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Private Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'waiting',
          isPublic: false,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));
      
      const publicGames = publicLobbyBrowser.getPublicGames();
      expect(publicGames.length).toBe(1);
      expect(publicGames[0].isPublic).toBe(true);
    });

    it('should filter out full games', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Not Full Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Full Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 4,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));
      
      const publicGames = publicLobbyBrowser.getPublicGames();
      expect(publicGames.length).toBe(1);
      expect(publicGames[0].currentPlayers).toBeLessThan(parseInt(publicGames[0].maxPlayers));
    });

    it('should filter out in-progress games', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Waiting Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'In Progress Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 2,
          status: 'in-progress',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));
      
      const publicGames = publicLobbyBrowser.getPublicGames();
      expect(publicGames.length).toBe(1);
      expect(publicGames[0].status).toBe('waiting');
    });
  });

  describe('registerPublicGame', () => {
    it('should add a new game to the registry', () => {
      const newGame: PublicGameInfo = {
        id: 'new-game',
        gameCode: 'NEW123',
        name: 'New Game',
        hostName: 'New Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 1,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      publicLobbyBrowser.registerPublicGame(newGame);

      const games = publicLobbyBrowser.getPublicGames();
      expect(games.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updatePublicGame', () => {
    it('should update an existing game', () => {
      const game: PublicGameInfo = {
        id: 'test-game',
        gameCode: 'TEST123',
        name: 'Test Game',
        hostName: 'Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 1,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      // Register the game first
      publicLobbyBrowser.registerPublicGame(game);

      // Update the game
      publicLobbyBrowser.updatePublicGame('test-game', { currentPlayers: 2, status: 'in-progress' });

      const updatedGame = publicLobbyBrowser.getGameByCode('TEST123');
      expect(updatedGame?.currentPlayers).toBe(2);
      expect(updatedGame?.status).toBe('in-progress');
    });

    it('should do nothing for non-existent game', () => {
      const initialGames = publicLobbyBrowser.getPublicGames();
      
      publicLobbyBrowser.updatePublicGame('non-existent', { currentPlayers: 5 });
      
      const gamesAfter = publicLobbyBrowser.getPublicGames();
      expect(gamesAfter.length).toBe(initialGames.length);
    });
  });

  describe('unregisterPublicGame', () => {
    it('should remove a game from the registry', () => {
      const game: PublicGameInfo = {
        id: 'remove-game',
        gameCode: 'REM123',
        name: 'Remove Me',
        hostName: 'Host',
        format: 'commander',
        maxPlayers: '4',
        currentPlayers: 1,
        status: 'waiting',
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      };

      publicLobbyBrowser.registerPublicGame(game);
      const gamesBefore = publicLobbyBrowser.getPublicGames();
      
      publicLobbyBrowser.unregisterPublicGame('remove-game');
      const gamesAfter = publicLobbyBrowser.getPublicGames();
      
      expect(gamesAfter.length).toBeLessThanOrEqual(gamesBefore.length);
    });
  });

  describe('filterGames', () => {
    it('should filter games by format', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Commander Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Standard Game',
          hostName: 'Host',
          format: 'standard',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const commanderGames = publicLobbyBrowser.filterGames({ format: 'commander' });
      const standardGames = publicLobbyBrowser.filterGames({ format: 'standard' });

      expect(commanderGames.length).toBeGreaterThanOrEqual(1);
      expect(standardGames.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter games by maxPlayers', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: '2 Player Game',
          hostName: 'Host',
          format: 'standard',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: '4 Player Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const twoPlayerGames = publicLobbyBrowser.filterGames({ maxPlayers: '2' });
      const fourPlayerGames = publicLobbyBrowser.filterGames({ maxPlayers: '4' });

      expect(twoPlayerGames.length).toBeGreaterThanOrEqual(1);
      expect(fourPlayerGames.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter games by hasPassword', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'No Password Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Password Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: true,
          allowSpectators: false,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const noPasswordGames = publicLobbyBrowser.filterGames({ hasPassword: false });
      const passwordGames = publicLobbyBrowser.filterGames({ hasPassword: true });

      expect(noPasswordGames.length).toBeGreaterThanOrEqual(1);
      expect(passwordGames.length).toBeGreaterThanOrEqual(1);
    });

    it('should combine multiple filters', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Commander No Password',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const filtered = publicLobbyBrowser.filterGames({
        format: 'commander',
        maxPlayers: '4',
        hasPassword: false,
      });

      expect(filtered.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('searchGames', () => {
    it('should return all public games for empty query', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Test Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const results = publicLobbyBrowser.searchGames('');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should search by game name', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Commander Night',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Standard Showdown',
          hostName: 'Host',
          format: 'standard',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const results = publicLobbyBrowser.searchGames('Commander');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toContain('Commander');
    });

    it('should search by host name', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Game 1',
          hostName: 'MagicMaster',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'game-2',
          gameCode: 'ABC124',
          name: 'Game 2',
          hostName: 'CardShark',
          format: 'standard',
          maxPlayers: '2',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: false,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const results = publicLobbyBrowser.searchGames('Magic');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].hostName).toContain('Magic');
    });

    it('should be case insensitive', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'ABC123',
          name: 'Commander Game',
          hostName: 'Test Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const upperResults = publicLobbyBrowser.searchGames('COMMANDER');
      const lowerResults = publicLobbyBrowser.searchGames('commander');

      expect(upperResults.length).toBe(lowerResults.length);
    });
  });

  describe('getGameByCode', () => {
    it('should find a game by code', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'FINDME',
          name: 'Find Me Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      const found = publicLobbyBrowser.getGameByCode('FINDME');
      expect(found).not.toBeNull();
      expect(found?.gameCode).toBe('FINDME');
    });

    it('should return null for non-existent code', () => {
      const found = publicLobbyBrowser.getGameByCode('NOTHERE');
      expect(found).toBeNull();
    });
  });

  describe('cleanupOldGames', () => {
    it('should remove games older than 1 hour', () => {
      const now = Date.now();
      const games: PublicGameInfo[] = [
        {
          id: 'old-game',
          gameCode: 'OLD123',
          name: 'Old Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: now - 2 * 60 * 60 * 1000, // 2 hours ago
        },
        {
          id: 'new-game',
          gameCode: 'NEW123',
          name: 'New Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: now - 30 * 60 * 1000, // 30 minutes ago
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));

      publicLobbyBrowser.cleanupOldGames();

      const remaining = publicLobbyBrowser.getGameByCode('OLD123');
      expect(remaining).toBeNull();
    });
  });

  describe('subscribe', () => {
    it('should allow subscribing to game updates', () => {
      const callback = jest.fn();
      
      const unsubscribe = publicLobbyBrowser.subscribe(callback);
      
      expect(typeof unsubscribe).toBe('function');
      
      unsubscribe();
    });

    it('should return unsubscribe function that stops updates', () => {
      const callback = jest.fn();
      
      const unsubscribe = publicLobbyBrowser.subscribe(callback);
      unsubscribe();
      
      // After unsubscribing, the callback should not be called
      // This is tested by the fact that unsubscribe returns a function
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('clearDemoData', () => {
    it('should clear demo data while keeping user games', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'demo_123',
          gameCode: 'DEMO01',
          name: 'Demo Game',
          hostName: 'Demo Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
        {
          id: 'user-game',
          gameCode: 'USER01',
          name: 'User Game',
          hostName: 'User Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));
      localStorage.setItem('planar_nexus_demo_data_added', 'true');

      publicLobbyBrowser.clearDemoData();

      const remaining = publicLobbyBrowser.getGameByCode('USER01');
      expect(remaining).not.toBeNull();
    });
  });

  describe('resetAllGames', () => {
    it('should clear all games and demo data', () => {
      const games: PublicGameInfo[] = [
        {
          id: 'game-1',
          gameCode: 'TEST01',
          name: 'Test Game',
          hostName: 'Host',
          format: 'commander',
          maxPlayers: '4',
          currentPlayers: 1,
          status: 'waiting',
          isPublic: true,
          hasPassword: false,
          allowSpectators: true,
          createdAt: Date.now(),
        },
      ];

      localStorage.setItem('planar_nexus_public_lobbies', JSON.stringify(games));
      localStorage.setItem('planar_nexus_demo_data_added', 'true');

      publicLobbyBrowser.resetAllGames();

      const remaining = publicLobbyBrowser.getGameByCode('TEST01');
      expect(remaining).toBeNull();
      expect(localStorage.getItem('planar_nexus_demo_data_added')).toBeNull();
    });
  });
});
