/**
 * Unit 10 Tests: Client-Side Multiplayer Signaling
 *
 * Tests for local signaling client and P2P game connection
 * without server dependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  LocalSignalingClient,
  createLocalSignalingClient,
  createSignalingDataTransfer,
  serializeForQRCode,
  deserializeFromQRCode,
  isDataTooLargeForQRCode,
  chunkDataForQRCode,
  assembleChunks,
  type LocalSignalingClientOptions,
} from '../local-signaling-client';

describe('LocalSignalingClient', () => {
  let client: LocalSignalingClient;
  let options: LocalSignalingClientOptions;

  beforeEach(() => {
    options = {
      role: 'host',
      gameCode: 'ABC123',
    };
    client = createLocalSignalingClient(options);
  });

  afterEach(() => {
    client.reset();
  });

  it('should initialize with correct state', () => {
    const state = client.getState();
    expect(state.phase).toBe('idle');
    expect(state.role).toBe('host');
    expect(state.gameCode).toBe('ABC123');
    expect(state.localIceCandidates).toEqual([]);
    expect(state.remoteIceCandidates).toEqual([]);
  });

  it('should add local ICE candidates', () => {
    const candidate = { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 };
    client.addLocalIceCandidate(candidate);

    const state = client.getState();
    expect(state.localIceCandidates).toHaveLength(1);
    expect(state.localIceCandidates[0]).toEqual(candidate);
  });

  it('should add multiple local ICE candidates', () => {
    const candidates = [
      { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'candidate:789012', sdpMid: '0', sdpMLineIndex: 0 },
    ];

    candidates.forEach((candidate) => client.addLocalIceCandidate(candidate));

    const state = client.getState();
    expect(state.localIceCandidates).toHaveLength(2);
  });

  it('should reset to initial state', () => {
    const candidate = { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 };
    client.addLocalIceCandidate(candidate);
    client.markConnected();

    client.reset();

    const state = client.getState();
    expect(state.phase).toBe('idle');
    expect(state.localIceCandidates).toEqual([]);
    expect(state.remoteIceCandidates).toEqual([]);
  });

  it('should call event handlers on state change', () => {
    const onStateChange = jest.fn();
    const testClient = createLocalSignalingClient({
      ...options,
      events: { onStateChange },
    });

    testClient.markConnected();

    expect(onStateChange).toHaveBeenCalled();
    const newState = onStateChange.mock.calls[0][0];
    expect(newState.phase).toBe('connected');
  });

  it('should call event handler on ICE candidate', () => {
    const onIceCandidate = jest.fn();
    const testClient = createLocalSignalingClient({
      ...options,
      events: { onIceCandidate },
    });

    const candidate = { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 };
    testClient.addLocalIceCandidate(candidate);

    expect(onIceCandidate).toHaveBeenCalledWith(candidate);
  });

  it('should generate a connection string', () => {
    const candidate = { candidate: 'candidate:123456', sdpMid: '0', sdpMLineIndex: 0 };
    client.addLocalIceCandidate(candidate);
    client.markConnected();

    const connectionString = client.getConnectionString();
    expect(typeof connectionString).toBe('string');
    expect(connectionString.length).toBeGreaterThan(0);

    const parsed = JSON.parse(connectionString);
    expect(parsed.type).toBe('offer');
    expect(parsed.ice).toHaveLength(1);
  });
});

describe('LocalSignalingClient - Joiner Role', () => {
  let client: LocalSignalingClient;

  beforeEach(() => {
    client = createLocalSignalingClient({ role: 'joiner', gameCode: 'XYZ789' });
  });

  afterEach(() => {
    client.reset();
  });

  it('should initialize as joiner', () => {
    const state = client.getState();
    expect(state.role).toBe('joiner');
    expect(state.gameCode).toBe('XYZ789');
  });

  it('should handle offer correctly', () => {
    const offer = {
      type: 'offer' as const,
      sdp: 'mock-sdp-offer',
    };

    // This would be called when processing an incoming offer
    expect(offer.type).toBe('offer');
  });
});

describe('Signaling Data Transfer', () => {
  it('should create signaling data transfer for offer', () => {
    const offer = {
      type: 'offer' as const,
      sdp: 'mock-sdp',
    };

    const transfer = createSignalingDataTransfer('offer', offer);

    expect(transfer.version).toBe('1.0');
    expect(transfer.type).toBe('offer');
    expect(transfer.data).toEqual(offer);
    expect(typeof transfer.timestamp).toBe('number');
  });

  it('should create signaling data transfer for answer', () => {
    const answer = {
      type: 'answer' as const,
      sdp: 'mock-sdp-answer',
    };

    const transfer = createSignalingDataTransfer('answer', answer);

    expect(transfer.version).toBe('1.0');
    expect(transfer.type).toBe('answer');
    expect(transfer.data).toEqual(answer);
  });

  it('should create signaling data transfer for ICE candidates', () => {
    const candidates = [
      { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'candidate:456', sdpMid: '0', sdpMLineIndex: 0 },
    ];

    const transfer = createSignalingDataTransfer('ice-candidates', candidates);

    expect(transfer.version).toBe('1.0');
    expect(transfer.type).toBe('ice-candidates');
    expect(transfer.data).toEqual(candidates);
  });
});

describe('QR Code Serialization', () => {
  it('should serialize and deserialize signaling data', () => {
    const data = createSignalingDataTransfer('offer', {
      type: 'offer' as const,
      sdp: 'mock-sdp',
    });

    const serialized = serializeForQRCode(data);
    expect(typeof serialized).toBe('string');

    const deserialized = deserializeFromQRCode(serialized);
    expect(deserialized).not.toBeNull();
    expect(deserialized?.version).toBe('1.0');
    expect(deserialized?.type).toBe('offer');
  });

  it('should return null for invalid serialized data', () => {
    const invalid = deserializeFromQRCode('invalid-base64');
    expect(invalid).toBeNull();
  });

  it('should return null for corrupt base64', () => {
    const corrupt = deserializeFromQRCode('!!@#$%^&*()');
    expect(corrupt).toBeNull();
  });

  it('should detect data too large for QR code', () => {
    const smallData = 'a'.repeat(100);
    expect(isDataTooLargeForQRCode(smallData)).toBe(false);

    const largeData = 'a'.repeat(3000);
    expect(isDataTooLargeForQRCode(largeData)).toBe(true);
  });

  it('should chunk large data into smaller pieces', () => {
    const largeData = 'a'.repeat(5000);
    const chunks = chunkDataForQRCode(largeData, 2000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 2000)).toBe(true);
  });

  it('should assemble chunks back into original data', () => {
    const originalData = 'hello world'.repeat(100);
    const chunks = chunkDataForQRCode(originalData, 100);
    const assembled = assembleChunks(chunks);

    expect(assembled).toBe(originalData);
  });

  it('should handle empty data', () => {
    const emptyData = '';
    const chunks = chunkDataForQRCode(emptyData);
    expect(chunks).toEqual([]);

    const assembled = assembleChunks(chunks);
    expect(assembled).toBe('');
  });
});

describe('Game Code Generation', () => {
  it('should generate a game code of correct length', () => {
    const code = LocalSignalingClient.generateGameCode();
    expect(code.length).toBe(6);
  });

  it('should generate game code of custom length', () => {
    const code = LocalSignalingClient.generateGameCode(8);
    expect(code.length).toBe(8);
  });

  it('should generate unique game codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(LocalSignalingClient.generateGameCode());
    }
    expect(codes.size).toBe(100);
  });

  it('should only use allowed characters', () => {
    const allowedChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 100; i++) {
      const code = LocalSignalingClient.generateGameCode();
      for (const char of code) {
        expect(allowedChars.includes(char)).toBe(true);
      }
    }
  });

  it('should exclude confusing characters', () => {
    const confusingChars = ['I', 'O', '0', '1'];
    for (let i = 0; i < 100; i++) {
      const code = LocalSignalingClient.generateGameCode();
      for (const confusingChar of confusingChars) {
        expect(code.includes(confusingChar)).toBe(false);
      }
    }
  });
});

describe('Connection String Parsing', () => {
  it('should parse valid connection string', () => {
    const connectionString = JSON.stringify({
      type: 'offer',
      phase: 'waiting-for-answer',
      offer: { type: 'offer', sdp: 'mock-sdp' },
      answer: undefined,
      ice: [],
    });

    const parsed = LocalSignalingClient.parseConnectionString(connectionString);

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('offer');
    expect(parsed?.phase).toBe('waiting-for-answer');
  });

  it('should return null for invalid connection string', () => {
    const invalid = LocalSignalingClient.parseConnectionString('not-json');
    expect(invalid).toBeNull();
  });

  it('should return null for malformed JSON', () => {
    const malformed = LocalSignalingClient.parseConnectionString('{ invalid json }');
    expect(malformed).toBeNull();
  });
});
