/**
 * Tests for P2P Signaling Client
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import type { RTCIceCandidateInit } from '@/lib/webrtc-types';

import {
  P2PSignalingClient,
  createHostSignalingClient,
  createClientSignalingClient,
  parseConnectionInfo,
  serializeSignalingData,
  deserializeSignalingData,
  type ConnectionInfo,
  type SignalingData,
  type SignalingEvents,
  type HandshakeStep,
} from '../p2p-signaling-client';

describe('P2P Signaling Client Types', () => {
  describe('ConnectionInfo', () => {
    it('should create valid connection info', () => {
      const info: ConnectionInfo = {
        gameCode: 'ABC123',
        hostName: 'Test Host',
        timestamp: Date.now(),
      };

      expect(info.gameCode).toBe('ABC123');
      expect(info.hostName).toBe('Test Host');
      expect(info.timestamp).toBeDefined();
    });

    it('should accept optional iceServers', () => {
      const info: ConnectionInfo = {
        gameCode: 'ABC123',
        hostName: 'Test Host',
        timestamp: Date.now(),
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      };

      expect(info.iceServers).toBeDefined();
      expect(info.iceServers?.length).toBe(1);
    });
  });

  describe('SignalingData', () => {
    it('should create signaling data for offer', () => {
      const data: SignalingData = {
        type: 'offer',
        data: { type: 'offer', sdp: 'mock-sdp' },
        senderCode: 'ABC123',
      };

      expect(data.type).toBe('offer');
      expect(data.senderCode).toBe('ABC123');
    });

    it('should create signaling data for answer', () => {
      const data: SignalingData = {
        type: 'answer',
        data: { type: 'answer', sdp: 'mock-answer' },
        senderCode: 'ABC123',
      };

      expect(data.type).toBe('answer');
    });

    it('should create signaling data for ICE candidates', () => {
      const data: SignalingData = {
        type: 'ice-candidate',
        data: { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidateInit,
        senderCode: 'ABC123',
      };

      expect(data.type).toBe('ice-candidate');
    });
  });

  describe('HandshakeStep', () => {
    it('should have all valid handshake steps', () => {
      const steps: HandshakeStep[] = [
        'idle',
        'waiting-for-offer',
        'waiting-for-answer',
        'waiting-for-candidates',
        'completed',
        'failed',
      ];

      steps.forEach((step) => expect(step).toBeDefined());
    });
  });
});

describe('SignalingEvents', () => {
  it('should require all event handlers', () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    expect(events.onConnectionStateChange).toBeDefined();
    expect(events.onMessage).toBeDefined();
    expect(events.onConnected).toBeDefined();
    expect(events.onError).toBeDefined();
    expect(events.onHandshakeStepChange).toBeDefined();
  });
});

describe('createHostSignalingClient', () => {
  it('should create a P2PSignalingClient instance as host', () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createHostSignalingClient('Test Host', events);
    expect(client).toBeInstanceOf(P2PSignalingClient);
  });

  it('should set correct game code', () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createHostSignalingClient('Test Host', events);
    const gameCode = client.getGameCode();
    expect(gameCode.length).toBe(6);
  });
});

describe('createClientSignalingClient', () => {
  it('should create a P2PSignalingClient instance as client', () => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };

    const client = createClientSignalingClient('Test Client', events);
    expect(client).toBeInstanceOf(P2PSignalingClient);
  });
});

describe('parseConnectionInfo', () => {
  it('should parse valid connection info JSON', () => {
    const info: ConnectionInfo = {
      gameCode: 'ABC123',
      hostName: 'Test Host',
      timestamp: Date.now(),
    };

    const result = parseConnectionInfo(JSON.stringify(info));

    expect(result).not.toBeNull();
    expect(result?.gameCode).toBe('ABC123');
    expect(result?.hostName).toBe('Test Host');
  });

  it('should parse connection info with ICE servers', () => {
    const info: ConnectionInfo = {
      gameCode: 'ABC123',
      hostName: 'Test Host',
      timestamp: Date.now(),
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };

    const result = parseConnectionInfo(JSON.stringify(info));

    expect(result?.iceServers).toBeDefined();
    expect(result?.iceServers?.length).toBe(1);
  });

  it('should return null for invalid JSON', () => {
    const result = parseConnectionInfo('not valid json');
    expect(result).toBeNull();
  });

  it('should return null for missing gameCode', () => {
    const result = parseConnectionInfo(JSON.stringify({ hostName: 'Test' }));
    expect(result).toBeNull();
  });

  it('should return null for missing hostName', () => {
    const result = parseConnectionInfo(JSON.stringify({ gameCode: 'ABC123' }));
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = parseConnectionInfo('');
    expect(result).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    const result = parseConnectionInfo('{ "gameCode": invalid }');
    expect(result).toBeNull();
  });
});

describe('serializeSignalingData', () => {
  it('should serialize offer data', () => {
    const data: SignalingData = {
      type: 'offer',
      data: { type: 'offer', sdp: 'mock-sdp' },
      senderCode: 'ABC123',
    };

    const serialized = serializeSignalingData(data);

    expect(typeof serialized).toBe('string');
    const parsed = JSON.parse(serialized);
    expect(parsed.type).toBe('offer');
    expect(parsed.data).toEqual(data.data);
  });

  it('should serialize answer data', () => {
    const data: SignalingData = {
      type: 'answer',
      data: { type: 'answer', sdp: 'mock-answer' },
      senderCode: 'ABC123',
    };

    const serialized = serializeSignalingData(data);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe('answer');
  });

  it('should serialize ICE candidate data', () => {
    const data: SignalingData = {
      type: 'ice-candidate',
      data: { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidateInit,
      senderCode: 'ABC123',
    };

    const serialized = serializeSignalingData(data);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe('ice-candidate');
  });
});

describe('deserializeSignalingData', () => {
  it('should deserialize valid signaling data', () => {
    const data: SignalingData = {
      type: 'offer',
      data: { type: 'offer', sdp: 'mock-sdp' },
      senderCode: 'ABC123',
    };

    const serialized = serializeSignalingData(data);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect(deserialized?.type).toBe('offer');
    expect(deserialized?.senderCode).toBe('ABC123');
  });

  it('should return null for invalid JSON', () => {
    const result = deserializeSignalingData('not valid json');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = deserializeSignalingData('');
    expect(result).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    const result = deserializeSignalingData('{ "type": invalid }');
    expect(result).toBeNull();
  });
});

describe('P2PSignalingClient instance', () => {
  let client: P2PSignalingClient;

  beforeEach(() => {
    const events: SignalingEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onError: () => {},
      onHandshakeStepChange: () => {},
    };
    client = createHostSignalingClient('Test Host', events);
  });

  describe('getGameCode', () => {
    it('should return a 6-character game code', () => {
      const gameCode = client.getGameCode();
      expect(gameCode.length).toBe(6);
    });

    it('should use valid characters', () => {
      const gameCode = client.getGameCode();
      const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (const char of gameCode) {
        expect(validChars.includes(char)).toBe(true);
      }
    });
  });

  describe('getConnectionInfo', () => {
    it('should return connection info with game code', () => {
      const info = client.getConnectionInfo();
      expect(info.gameCode).toBeDefined();
      expect(info.hostName).toBe('Test Host');
      expect(info.timestamp).toBeDefined();
    });
  });

  describe('getHandshakeStep', () => {
    it('should return initial handshake step', () => {
      const step = client.getHandshakeStep();
      expect(step).toBe('idle');
    });
  });

  describe('getLocalOffer', () => {
    it('should return null initially', () => {
      const offer = client.getLocalOffer();
      expect(offer).toBeNull();
    });
  });

  describe('getLocalAnswer', () => {
    it('should return null initially', () => {
      const answer = client.getLocalAnswer();
      expect(answer).toBeNull();
    });
  });

  describe('getConnectionState', () => {
    it('should return initial connection state', () => {
      const state = client.getConnectionState();
      expect(state).toBeDefined();
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      expect(client.isConnected()).toBe(false);
    });
  });
});

describe('End-to-end serialization', () => {
  it('should round-trip signaling data for offer', () => {
    const original: SignalingData = {
      type: 'offer',
      data: { type: 'offer', sdp: 'v=0\r\no=- 12345 67890\r\n...' },
      senderCode: 'ABC123',
    };

    const serialized = serializeSignalingData(original);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect(deserialized?.type).toBe(original.type);
    expect(deserialized?.senderCode).toBe(original.senderCode);
  });

  it('should round-trip signaling data for ICE candidates', () => {
    const original: SignalingData = {
      type: 'ice-candidate',
      data: { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 } as RTCIceCandidateInit,
      senderCode: 'XYZ789',
    };

    const serialized = serializeSignalingData(original);
    const deserialized = deserializeSignalingData(serialized);

    expect(deserialized).not.toBeNull();
    expect((deserialized?.data as RTCIceCandidateInit).candidate).toBeDefined();
  });
});
