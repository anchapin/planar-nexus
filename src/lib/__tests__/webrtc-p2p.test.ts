/**
 * Tests for WebRTC P2P Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  P2PConnectionState,
  P2PMessageType,
  P2PMessage,
  GameStateSyncMessage,
  PlayerActionMessage,
  ChatMessage,
  EmoteMessage,
  ConnectionRequestMessage,
  ConnectionAcceptMessage,
  ErrorMessage,
  PeerInfo,
  P2PEvents,
  P2PConnectionOptions,
  DEFAULT_RTC_CONFIG,
  generateGameCode,
  createP2PConnection,
} from '../webrtc-p2p';

describe('P2P Connection State Types', () => {
  const validStates: P2PConnectionState[] = [
    'disconnected',
    'connecting',
    'connected',
    'reconnecting',
    'failed',
  ];

  it('should have all expected connection states', () => {
    expect(validStates).toContain('disconnected');
    expect(validStates).toContain('connecting');
    expect(validStates).toContain('connected');
    expect(validStates).toContain('reconnecting');
    expect(validStates).toContain('failed');
  });
});

describe('P2P Message Type Types', () => {
  const validMessageTypes: P2PMessageType[] = [
    'game-state-sync',
    'game-action',
    'player-action',
    'chat',
    'emote',
    'ping',
    'pong',
    'connection-request',
    'connection-accept',
    'error',
  ];

  it('should have all expected message types', () => {
    validMessageTypes.forEach((type) => {
      const message: P2PMessage = {
        type,
        senderId: 'test-sender',
        timestamp: Date.now(),
        payload: {},
      };
      expect(message.type).toBe(type);
    });
  });
});

describe('P2PMessage Interface', () => {
  it('should create a valid base P2P message', () => {
    const message: P2PMessage = {
      type: 'ping',
      senderId: 'player-1',
      timestamp: 1234567890,
      payload: { data: 'test' },
    };

    expect(message.type).toBe('ping');
    expect(message.senderId).toBe('player-1');
    expect(message.timestamp).toBe(1234567890);
    expect(message.payload).toEqual({ data: 'test' });
  });

  it('should allow different payload types', () => {
    const messageWithObject: P2PMessage = {
      type: 'game-action',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: { action: 'play', card: 'Lightning Bolt' },
    };

    const messageWithString: P2PMessage = {
      type: 'chat',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: 'Hello world',
    };

    const messageWithArray: P2PMessage = {
      type: 'game-state-sync',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: [1, 2, 3],
    };

    expect(messageWithObject.payload).toEqual({ action: 'play', card: 'Lightning Bolt' });
    expect(messageWithString.payload).toBe('Hello world');
    expect(messageWithArray.payload).toEqual([1, 2, 3]);
  });
});

describe('GameStateSyncMessage', () => {
  it('should create a valid game state sync message', () => {
    const mockGameState = {
      players: [],
      battlefield: [],
      hand: [],
      graveyard: [],
      stack: [],
    };

    const message: GameStateSyncMessage = {
      type: 'game-state-sync',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        gameState: mockGameState as any,
        isFullSync: true,
      },
    };

    expect(message.type).toBe('game-state-sync');
    expect(message.payload.isFullSync).toBe(true);
    expect(message.payload.gameState).toEqual(mockGameState);
  });

  it('should handle partial sync flag', () => {
    const message: GameStateSyncMessage = {
      type: 'game-state-sync',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        gameState: { players: [] } as any,
        isFullSync: false,
      },
    };

    expect(message.payload.isFullSync).toBe(false);
  });
});

describe('PlayerActionMessage', () => {
  it('should create a valid player action message', () => {
    const actionData = {
      action: 'cast',
      data: { card: 'Counterspell', target: 'Lightning Bolt' },
    };

    const message: PlayerActionMessage = {
      type: 'player-action',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: actionData,
    };

    expect(message.type).toBe('player-action');
    expect(message.payload.action).toBe('cast');
    expect(message.payload.data).toEqual({ card: 'Counterspell', target: 'Lightning Bolt' });
  });
});

describe('ChatMessage', () => {
  it('should create a valid chat message', () => {
    const message: ChatMessage = {
      type: 'chat',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        text: 'Hello everyone!',
      },
    };

    expect(message.type).toBe('chat');
    expect(message.payload.text).toBe('Hello everyone!');
  });

  it('should handle empty chat message', () => {
    const message: ChatMessage = {
      type: 'chat',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        text: '',
      },
    };

    expect(message.payload.text).toBe('');
  });
});

describe('EmoteMessage', () => {
  it('should create a valid emote message', () => {
    const message: EmoteMessage = {
      type: 'emote',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        emote: 'thumbsup',
      },
    };

    expect(message.type).toBe('emote');
    expect(message.payload.emote).toBe('thumbsup');
  });
});

describe('ConnectionRequestMessage', () => {
  it('should create a valid connection request message', () => {
    const message: ConnectionRequestMessage = {
      type: 'connection-request',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        playerName: 'Test Player',
        gameCode: 'ABC123',
        isHost: true,
      },
    };

    expect(message.type).toBe('connection-request');
    expect(message.payload.playerName).toBe('Test Player');
    expect(message.payload.gameCode).toBe('ABC123');
    expect(message.payload.isHost).toBe(true);
  });

  it('should handle non-host connection request', () => {
    const message: ConnectionRequestMessage = {
      type: 'connection-request',
      senderId: 'player-2',
      timestamp: Date.now(),
      payload: {
        playerName: 'Guest Player',
        gameCode: 'ABC123',
        isHost: false,
      },
    };

    expect(message.payload.isHost).toBe(false);
  });
});

describe('ConnectionAcceptMessage', () => {
  it('should create a valid connection accept message', () => {
    const message: ConnectionAcceptMessage = {
      type: 'connection-accept',
      senderId: 'player-1',
      timestamp: Date.now(),
      payload: {
        playerName: 'Host Player',
        playerId: 'host-123',
      },
    };

    expect(message.type).toBe('connection-accept');
    expect(message.payload.playerName).toBe('Host Player');
    expect(message.payload.playerId).toBe('host-123');
  });
});

describe('ErrorMessage', () => {
  it('should create a valid error message', () => {
    const message: ErrorMessage = {
      type: 'error',
      senderId: 'system',
      timestamp: Date.now(),
      payload: {
        code: 'CONNECTION_FAILED',
        message: 'Unable to establish connection',
      },
    };

    expect(message.type).toBe('error');
    expect(message.payload.code).toBe('CONNECTION_FAILED');
    expect(message.payload.message).toBe('Unable to establish connection');
  });
});

describe('PeerInfo', () => {
  it('should create valid peer info', () => {
    const peer: PeerInfo = {
      peerId: 'peer-123',
      playerId: 'player-1',
      playerName: 'Test Player',
      connectionState: 'connected',
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    expect(peer.peerId).toBe('peer-123');
    expect(peer.playerId).toBe('player-1');
    expect(peer.playerName).toBe('Test Player');
    expect(peer.connectionState).toBe('connected');
    expect(peer.connectedAt).toBeDefined();
  });

  it('should handle all connection states for peer', () => {
    const states: P2PConnectionState[] = ['disconnected', 'connecting', 'connected', 'reconnecting', 'failed'];

    states.forEach((state) => {
      const peer: PeerInfo = {
        peerId: 'peer-1',
        playerId: 'player-1',
        playerName: 'Test',
        connectionState: state,
      };
      expect(peer.connectionState).toBe(state);
    });
  });

  it('should allow optional timing fields', () => {
    const peerWithoutTiming: PeerInfo = {
      peerId: 'peer-1',
      playerId: 'player-1',
      playerName: 'Test',
      connectionState: 'connected',
    };

    expect(peerWithoutTiming.connectedAt).toBeUndefined();
    expect(peerWithoutTiming.lastMessageAt).toBeUndefined();
  });
});

describe('P2PEvents', () => {
  it('should define all expected event types', () => {
    const events: P2PEvents = {
      onConnectionStateChange: jest.fn(),
      onMessage: jest.fn(),
      onGameStateSync: jest.fn(),
      onPlayerAction: jest.fn(),
      onChat: jest.fn(),
      onEmote: jest.fn(),
      onError: jest.fn(),
      onPeerConnected: jest.fn(),
      onPeerDisconnected: jest.fn(),
    };

    expect(events.onConnectionStateChange).toBeDefined();
    expect(events.onMessage).toBeDefined();
    expect(events.onGameStateSync).toBeDefined();
    expect(events.onPlayerAction).toBeDefined();
    expect(events.onChat).toBeDefined();
    expect(events.onEmote).toBeDefined();
    expect(events.onError).toBeDefined();
    expect(events.onPeerConnected).toBeDefined();
    expect(events.onPeerDisconnected).toBeDefined();
  });
});

describe('P2PConnectionOptions', () => {
  it('should create valid connection options with required fields', () => {
    const options: P2PConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      isHost: true,
    };

    expect(options.playerId).toBe('player-1');
    expect(options.playerName).toBe('Test Player');
    expect(options.isHost).toBe(true);
  });

  it('should allow optional fields', () => {
    const mockEventHandler = () => {};
    
    const options: P2PConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      isHost: false,
      gameCode: 'ABC123',
      events: {
        onConnectionStateChange: mockEventHandler,
        onMessage: mockEventHandler,
        onGameStateSync: mockEventHandler,
        onPlayerAction: mockEventHandler,
        onChat: mockEventHandler,
        onEmote: mockEventHandler,
        onError: mockEventHandler,
        onPeerConnected: mockEventHandler,
        onPeerDisconnected: mockEventHandler,
      },
      rtcConfig: {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      },
      enableICEMonitoring: true,
      fallbackToRelay: false,
    };

    expect(options.gameCode).toBe('ABC123');
    expect(options.events).toBeDefined();
    expect(options.rtcConfig).toBeDefined();
  });

  it('should allow ICE configuration options', () => {
    const options: P2PConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      isHost: true,
      iceConfig: {
        mode: 'stun-only',
        enableIPv6: false,
        candidatePoolSize: 10,
      },
    };

    expect(options.iceConfig).toBeDefined();
    expect(options.iceConfig?.mode).toBe('stun-only');
  });
});

describe('DEFAULT_RTC_CONFIG', () => {
  it('should have ICE servers configured', () => {
    expect(DEFAULT_RTC_CONFIG.iceServers).toBeDefined();
    expect(Array.isArray(DEFAULT_RTC_CONFIG.iceServers)).toBe(true);
  });

  it('should have STUN servers configured', () => {
    const stunServers = DEFAULT_RTC_CONFIG.iceServers?.filter(
      (server) => {
        const urls = server.urls;
        if (typeof urls === 'string') {
          return urls.startsWith('stun:');
        }
        if (Array.isArray(urls)) {
          return urls.some(url => url.startsWith('stun:'));
        }
        return false;
      }
    );

    expect(stunServers).toBeDefined();
    expect(stunServers?.length).toBeGreaterThan(0);
  });

  it('should use Google STUN servers', () => {
    const urls = DEFAULT_RTC_CONFIG.iceServers?.map((server) => server.urls).flat();
    
    expect(urls).toContain('stun:stun.l.google.com:19302');
    expect(urls).toContain('stun:stun1.l.google.com:19302');
  });
});

describe('generateGameCode', () => {
  it('should generate a code of default length (6)', () => {
    const code = generateGameCode();
    expect(code).toHaveLength(6);
  });

  it('should generate a code of specified length', () => {
    const code4 = generateGameCode(4);
    const code8 = generateGameCode(8);
    const code10 = generateGameCode(10);

    expect(code4).toHaveLength(4);
    expect(code8).toHaveLength(8);
    expect(code10).toHaveLength(10);
  });

  it('should only use valid characters', () => {
    const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = generateGameCode(100);

    for (const char of code) {
      expect(validChars).toContain(char);
    }
  });

  it('should not include confusing characters', () => {
    const confusingChars = 'IO0O1l1';
    const code = generateGameCode(1000);

    for (const char of code) {
      expect(confusingChars).not.toContain(char);
    }
  });

  it('should generate different codes each time', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateGameCode());
    }

    // Most codes should be unique (allowing for tiny possibility of collision)
    expect(codes.size).toBeGreaterThan(90);
  });

  it('should handle edge case of length 1', () => {
    const code = generateGameCode(1);
    expect(code).toHaveLength(1);
  });

  it('should handle edge case of maximum length', () => {
    const code = generateGameCode(20);
    expect(code).toHaveLength(20);
  });
});

describe('createP2PConnection', () => {
  it('should create a WebRTCConnection instance', () => {
    const options: P2PConnectionOptions = {
      playerId: 'player-1',
      playerName: 'Test Player',
      isHost: true,
    };

    const connection = createP2PConnection(options);
    expect(connection).toBeDefined();
  });
});
