/**
 * Tests for P2P Direct Connection
 * Issue #604: Add tests for P2P networking and multiplayer systems
 */

import {
  parseConnectionData,
  parseICECandidateData,
  generateConnectionString,
  generateICECandidateString,
  validateConnectionData,
  getConnectionState,
  type ConnectionData,
  type ICECandidateData,
} from '../p2p-direct-connection';

describe('P2P Direct Connection Utilities', () => {
  describe('parseConnectionData', () => {
    it('should parse valid JSON connection data', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      const result = parseConnectionData(JSON.stringify(connectionData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe('offer');
      expect(result?.sessionId).toBe('session-123');
      expect(result?.gameCode).toBe('ABC123');
      expect(result?.hostName).toBe('Test Host');
    });

    it('should parse answer type connection data', () => {
      const connectionData: ConnectionData = {
        type: 'answer',
        sessionId: 'session-456',
        timestamp: Date.now(),
        sdp: { type: 'answer', sdp: 'mock-answer-sdp' },
        gameCode: 'XYZ789',
        hostName: 'Host Player',
        format: 'commander',
      };

      const result = parseConnectionData(JSON.stringify(connectionData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe('answer');
    });

    it('should return null for invalid JSON', () => {
      const result = parseConnectionData('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for missing required fields', () => {
      const invalidData = {
        type: 'offer',
        // missing sessionId, sdp, gameCode
      };

      const result = parseConnectionData(JSON.stringify(invalidData));
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseConnectionData('');
      expect(result).toBeNull();
    });

    it('should reject malformed JSON', () => {
      const result = parseConnectionData('{ "type": "offer", invalid }');
      expect(result).toBeNull();
    });
  });

  describe('parseICECandidateData', () => {
    it('should parse valid ICE candidate data', () => {
      const iceData: ICECandidateData = {
        type: 'ice-candidate',
        sessionId: 'session-123',
        candidate: {
          candidate: 'candidate:123456789',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      };

      const result = parseICECandidateData(JSON.stringify(iceData));

      expect(result).not.toBeNull();
      expect(result?.type).toBe('ice-candidate');
      expect(result?.sessionId).toBe('session-123');
      expect(result?.candidate).toBeDefined();
    });

    it('should return null for invalid JSON', () => {
      const result = parseICECandidateData('invalid');
      expect(result).toBeNull();
    });

    it('should return null for missing required fields', () => {
      const invalidData = {
        type: 'ice-candidate',
        // missing sessionId, candidate
      };

      const result = parseICECandidateData(JSON.stringify(invalidData));
      expect(result).toBeNull();
    });
  });

  describe('generateConnectionString', () => {
    it('should generate valid JSON string', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      const result = generateConnectionString(connectionData);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('offer');
      expect(parsed.sessionId).toBe('session-123');
    });

    it('should generate string for answer type', () => {
      const connectionData: ConnectionData = {
        type: 'answer',
        sessionId: 'session-456',
        timestamp: Date.now(),
        sdp: { type: 'answer', sdp: 'mock-answer' },
        gameCode: 'XYZ789',
        hostName: 'Host',
        format: 'commander',
      };

      const result = generateConnectionString(connectionData);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('answer');
    });
  });

  describe('generateICECandidateString', () => {
    it('should generate valid ICE candidate string', () => {
      const candidate: RTCIceCandidateInit = {
        candidate: 'candidate:123456789',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      const result = generateICECandidateString('session-123', candidate);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('ice-candidate');
      expect(parsed.sessionId).toBe('session-123');
      expect(parsed.candidate).toBeDefined();
    });
  });

  describe('validateConnectionData', () => {
    it('should validate correct connection data', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      expect(validateConnectionData(connectionData)).toBe(true);
    });

    it('should reject missing type', () => {
      const connectionData = {
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it('should reject invalid type', () => {
      const connectionData: ConnectionData = {
        type: 'invalid' as any,
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it('should reject old timestamp (more than 1 hour)', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it('should accept recent timestamp', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now() - 30 * 60 * 1000, // 30 minutes ago
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
        hostName: 'Test Host',
        format: 'commander',
      };

      expect(validateConnectionData(connectionData)).toBe(true);
    });

    it('should reject missing sessionId', () => {
      const connectionData = {
        type: 'offer',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        gameCode: 'ABC123',
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });

    it('should reject missing gameCode', () => {
      const connectionData: ConnectionData = {
        type: 'offer',
        sessionId: 'session-123',
        timestamp: Date.now(),
        sdp: { type: 'offer', sdp: 'mock-sdp' },
        // missing gameCode
        hostName: 'Test Host',
        format: 'commander',
      } as any;

      expect(validateConnectionData(connectionData)).toBe(false);
    });
  });

  describe('getConnectionState', () => {
    it('should return null for non-existent session', () => {
      const result = getConnectionState('non-existent-session');
      expect(result).toBeNull();
    });
  });
});

describe('ConnectionData Type', () => {
  it('should have correct type for offer', () => {
    const data: ConnectionData = {
      type: 'offer',
      sessionId: 'test',
      timestamp: Date.now(),
      sdp: { type: 'offer', sdp: 'test' },
      gameCode: 'TEST',
      hostName: 'Host',
      format: 'commander',
    };
    expect(data.type).toBe('offer');
  });

  it('should have correct type for answer', () => {
    const data: ConnectionData = {
      type: 'answer',
      sessionId: 'test',
      timestamp: Date.now(),
      sdp: { type: 'answer', sdp: 'test' },
      gameCode: 'TEST',
      hostName: 'Host',
      format: 'commander',
    };
    expect(data.type).toBe('answer');
  });
});
