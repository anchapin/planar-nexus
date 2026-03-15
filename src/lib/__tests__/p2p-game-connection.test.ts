/**
 * Tests for P2P Game Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  P2PGameConnection,
  createP2PGameConnection,
  type P2PGameConnectionEvents,
  type P2PGameConnectionOptions,
  type P2PConnectionState,
  type GameMessage,
  type GameMessageType,
  type ChatMessage,
} from '../p2p-game-connection';

describe('P2P Game Connection Types', () => {
  describe('GameMessageType', () => {
    it('should accept all valid message types', () => {
      const types: GameMessageType[] = [
        'game-state-sync',
        'game-action',
        'chat',
        'player-joined',
        'player-left',
        'ping',
        'pong',
      ];

      types.forEach((type) => {
        const message: GameMessage = {
          type,
          senderId: 'player-1',
          timestamp: Date.now(),
          data: {},
        };
        expect(message.type).toBe(type);
      });
    });
  });

  describe('ChatMessage', () => {
    it('should create valid chat message', () => {
      const chatMessage: ChatMessage = {
        senderId: 'player-1',
        senderName: 'Player One',
        text: 'Hello everyone!',
        timestamp: Date.now(),
      };

      expect(chatMessage.senderId).toBe('player-1');
      expect(chatMessage.senderName).toBe('Player One');
      expect(chatMessage.text).toBe('Hello everyone!');
      expect(chatMessage.timestamp).toBeDefined();
    });
  });

  describe('P2PConnectionState', () => {
    it('should have all valid connection states', () => {
      const states: P2PConnectionState[] = [
        'disconnected',
        'signaling',
        'connecting',
        'connected',
        'reconnecting',
        'failed',
      ];

      states.forEach((state) => {
        expect(state).toBeDefined();
      });
    });
  });
});

describe('P2PGameConnection Events', () => {
  it('should have all required event handlers', () => {
    const events: P2PGameConnectionEvents = {
      onConnectionStateChange: () => {},
      onSignalingStateChange: () => {},
      onMessage: () => {},
      onGameStateSync: () => {},
      onChat: () => {},
      onError: () => {},
      onPlayerJoined: () => {},
      onPlayerLeft: () => {},
    };

    expect(events.onConnectionStateChange).toBeDefined();
    expect(events.onSignalingStateChange).toBeDefined();
    expect(events.onMessage).toBeDefined();
    expect(events.onGameStateSync).toBeDefined();
    expect(events.onChat).toBeDefined();
    expect(events.onError).toBeDefined();
    expect(events.onPlayerJoined).toBeDefined();
    expect(events.onPlayerLeft).toBeDefined();
  });

  it('should allow partial event handlers', () => {
    const events: Partial<P2PGameConnectionEvents> = {
      onError: () => {},
    };

    expect(events.onError).toBeDefined();
  });
});

describe('P2PGameConnectionOptions', () => {
  it('should require playerId and playerName', () => {
    const options: P2PGameConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
    };

    expect(options.playerId).toBe('player-1');
    expect(options.playerName).toBe('Test Player');
    expect(options.role).toBe('host');
  });

  it('should accept optional gameCode', () => {
    const options: P2PGameConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'joiner',
      gameCode: 'ABC123',
    };

    expect(options.gameCode).toBe('ABC123');
  });

  it('should accept optional events', () => {
    const options: P2PGameConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
      events: {
        onConnectionStateChange: () => {},
        onError: () => {},
      },
    };

    expect(options.events).toBeDefined();
  });
});

describe('createP2PGameConnection factory', () => {
  it('should create a P2PGameConnection instance', () => {
    const connection = createP2PGameConnection({
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });

  it('should create connection with joiner role', () => {
    const connection = createP2PGameConnection({
      playerId: 'player-2',
      playerName: 'Joiner Player',
      role: 'joiner',
      gameCode: 'ABC123',
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });

  it('should initialize with disconnected state', () => {
    const connection = createP2PGameConnection({
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
    });

    expect(connection.getConnectionState()).toBe('disconnected');
  });

  it('should create connection with custom ICE config', () => {
    const connection = createP2PGameConnection({
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
      iceConfig: {
        customStunServers: [
          { urls: ['stun:custom.stun.server:19302'] },
        ],
        candidatePoolSize: 10,
      },
    });

    expect(connection).toBeInstanceOf(P2PGameConnection);
  });
});

describe('P2PGameConnection instance methods', () => {
  let connection: P2PGameConnection;

  beforeEach(() => {
    connection = createP2PGameConnection({
      playerId: 'player-1',
      playerName: 'Test Player',
      role: 'host',
    });
  });

  describe('getConnectionState', () => {
    it('should return disconnected initially', () => {
      expect(connection.getConnectionState()).toBe('disconnected');
    });
  });

  describe('isConnected', () => {
    it('should return false when disconnected', () => {
      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('getSignalingState', () => {
    it('should return signaling state', () => {
      const state = connection.getSignalingState();
      expect(state).toBeDefined();
      expect(state.phase).toBeDefined();
    });
  });

  describe('getSignalingClient', () => {
    it('should return signaling client', () => {
      const client = connection.getSignalingClient();
      expect(client).toBeDefined();
    });
  });

  describe('close', () => {
    it('should close without error', () => {
      expect(() => connection.close()).not.toThrow();
      expect(connection.getConnectionState()).toBe('disconnected');
    });
  });

  describe('getStats', () => {
    it('should return null when not connected', async () => {
      const stats = await connection.getStats();
      expect(stats).toBeNull();
    });
  });
});

describe('Message creation helpers', () => {
  it('should create game state sync message', () => {
    const message: GameMessage = {
      type: 'game-state-sync',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: { gameState: {}, isFullSync: true },
    };

    expect(message.type).toBe('game-state-sync');
    expect(message.senderId).toBe('player-1');
  });

  it('should create game action message', () => {
    const message: GameMessage = {
      type: 'game-action',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: { action: 'play-card', cardId: 'card-1' },
    };

    expect(message.type).toBe('game-action');
  });

  it('should create chat message', () => {
    const message: GameMessage = {
      type: 'chat',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: { senderName: 'Player One', text: 'Hello!' },
    };

    expect(message.type).toBe('chat');
  });

  it('should create player-joined message', () => {
    const message: GameMessage = {
      type: 'player-joined',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: { playerId: 'player-2', playerName: 'Player Two' },
    };

    expect(message.type).toBe('player-joined');
  });

  it('should create player-left message', () => {
    const message: GameMessage = {
      type: 'player-left',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: { playerId: 'player-2' },
    };

    expect(message.type).toBe('player-left');
  });

  it('should create ping message', () => {
    const message: GameMessage = {
      type: 'ping',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: {},
    };

    expect(message.type).toBe('ping');
  });

  it('should create pong message', () => {
    const message: GameMessage = {
      type: 'pong',
      senderId: 'player-1',
      timestamp: Date.now(),
      data: {},
    };

    expect(message.type).toBe('pong');
  });
});
