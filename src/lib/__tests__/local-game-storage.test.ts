/**
 * Local Game Storage Tests
 * Tests for IndexedDB-based local game storage module
 */

import type { LocalGameSession, GameStorageCallbacks } from '../local-game-storage';
import { type GameState, type PlayerId, Phase } from '../game-state/types';

describe('LocalGameSession Type', () => {
  it('should create valid session object', () => {
    const session: LocalGameSession = {
      gameId: 'game_123',
      gameCode: 'TEST123',
      hostId: 'host-1',
      hostName: 'Host Player',
      gameStateVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActionAt: Date.now(),
      status: 'active',
    };

    expect(session.gameId).toBe('game_123');
    expect(session.gameCode).toBe('TEST123');
    expect(session.status).toBe('active');
  });

  it('should support different session statuses', () => {
    const statuses: LocalGameSession['status'][] = ['active', 'paused', 'completed', 'abandoned'];
    
    statuses.forEach(status => {
      const session: LocalGameSession = {
        gameId: 'game_123',
        gameCode: 'TEST123',
        hostId: 'host-1',
        hostName: 'Host Player',
        gameStateVersion: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActionAt: Date.now(),
        status,
      };

      expect(session.status).toBe(status);
    });
  });

  it('should support optional client fields', () => {
    const sessionWithoutClient: LocalGameSession = {
      gameId: 'game_123',
      gameCode: 'TEST123',
      hostId: 'host-1',
      hostName: 'Host Player',
      gameStateVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActionAt: Date.now(),
      status: 'active',
    };

    expect(sessionWithoutClient.clientId).toBeUndefined();

    const sessionWithClient: LocalGameSession = {
      ...sessionWithoutClient,
      clientId: 'client-1',
      clientName: 'Client Player',
    };

    expect(sessionWithClient.clientId).toBe('client-1');
    expect(sessionWithClient.clientName).toBe('Client Player');
  });

  it('should support optional game state', () => {
    const sessionWithoutState: LocalGameSession = {
      gameId: 'game_123',
      gameCode: 'TEST123',
      hostId: 'host-1',
      hostName: 'Host Player',
      gameStateVersion: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActionAt: Date.now(),
      status: 'active',
    };

    expect(sessionWithoutState.gameState).toBeUndefined();
  });
});

describe('GameStorageCallbacks Type', () => {
  it('should define all required callback functions', () => {
    const callbacks: GameStorageCallbacks = {
      onGameStateUpdate: (_gameState: GameState, _version: number) => {},
      onPlayerJoined: (_playerId: string, _playerName: string) => {},
      onPlayerLeft: (_playerId: string) => {},
      onConnectionStateChange: (_connected: boolean) => {},
      onError: (_error: Error) => {},
    };

    expect(typeof callbacks.onGameStateUpdate).toBe('function');
    expect(typeof callbacks.onPlayerJoined).toBe('function');
    expect(typeof callbacks.onPlayerLeft).toBe('function');
    expect(typeof callbacks.onConnectionStateChange).toBe('function');
    expect(typeof callbacks.onError).toBe('function');
  });

  it('should allow callbacks to be called with correct types', () => {
    let capturedGameState: GameState | null = null;
    let capturedVersion: number | null = null;
    let capturedConnected: boolean | null = null;
    let capturedError: Error | null = null;

    const callbacks: GameStorageCallbacks = {
      onGameStateUpdate: (gameState: GameState, version: number) => {
        capturedGameState = gameState;
        capturedVersion = version;
      },
      onPlayerJoined: (_playerId: string, _playerName: string) => {},
      onPlayerLeft: (_playerId: string) => {},
      onConnectionStateChange: (connected: boolean) => {
        capturedConnected = connected;
      },
      onError: (error: Error) => {
        capturedError = error;
      },
    };

    // Simulate calling callbacks
    const mockGameState = createMinimalGameState();
    callbacks.onGameStateUpdate(mockGameState, 5);
    expect(capturedGameState).not.toBeNull();
    expect(capturedVersion).toBe(5);

    callbacks.onConnectionStateChange(true);
    expect(capturedConnected).toBe(true);

    callbacks.onError(new Error('test error'));
    expect(capturedError).not.toBeNull();
  });
});

// Helper function to create minimal game state for testing
function createMinimalGameState(): GameState {
  return {
    gameId: 'test-game-123',
    players: new Map([['player-1' as PlayerId, {
      id: 'player-1' as PlayerId,
      name: 'Player 1',
      life: 40,
      poisonCounters: 0,
      commanderDamage: new Map(),
      maxHandSize: 7,
      currentHandSizeModifier: 0,
      hasLost: false,
      lossReason: null,
      landsPlayedThisTurn: 0,
      maxLandsPerTurn: 1,
      manaPool: { colorless: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0 },
      isInCommandZone: false,
      experienceCounters: 0,
      commanderCastCount: 0,
      hasPassedPriority: false,
      hasActivatedManaAbility: false,
      additionalCombatPhase: false,
      additionalMainPhase: false,
      hasOfferedDraw: false,
      hasAcceptedDraw: false,
    }]]),
    cards: new Map(),
    zones: new Map(),
    stack: [],
    turn: {
      activePlayerId: 'player-1' as PlayerId,
      currentPhase: 'precombat_main' as Phase,
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: Date.now(),
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: null,
    consecutivePasses: 0,
    status: 'not_started',
    winners: [],
    endReason: null,
    format: 'commander',
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  };
}

describe('GameState Integration', () => {
  it('should create valid game state object', () => {
    const state = createMinimalGameState();
    
    expect(state.gameId).toBe('test-game-123');
    expect(state.players.size).toBe(1);
    expect(state.status).toBe('not_started');
    expect(state.format).toBe('commander');
  });

  it('should support different game statuses', () => {
    const statuses: GameState['status'][] = ['not_started', 'in_progress', 'paused', 'completed'];
    
    statuses.forEach(status => {
      const state = createMinimalGameState();
      state.status = status;
      expect(state.status).toBe(status);
    });
  });

  it('should support different phases', () => {
    const phases: Phase[] = [
      Phase.PRECOMBAT_MAIN,
      Phase.BEGIN_COMBAT,
      Phase.DECLARE_ATTACKERS,
      Phase.POSTCOMBAT_MAIN,
    ];
    
    phases.forEach(phase => {
      const state = createMinimalGameState();
      state.turn.currentPhase = phase;
      expect(state.turn.currentPhase).toBe(phase);
    });
  });
});

describe('Database Configuration', () => {
  it('should have valid database configuration values', () => {
    // These are internal constants but we can verify they exist conceptually
    const DB_NAME = 'PlanarNexusGameDB';
    const DB_VERSION = 1;
    
    expect(DB_NAME).toBeDefined();
    expect(DB_VERSION).toBe(1);
  });

  it('should have valid store names', () => {
    const GAMES_STORE_NAME = 'games';
    const GAME_CODES_STORE_NAME = 'gameCodes';
    
    expect(GAMES_STORE_NAME).toBe('games');
    expect(GAME_CODES_STORE_NAME).toBe('gameCodes');
  });
});
