/**
 * Client-Side Signaling Tests
 * Tests for client-side P2P signaling functionality
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  ClientSignalingService,
  createHostSignaling,
  createClientSignaling,
  encodeConnectionData,
  decodeConnectionData,
  isValidConnectionDataString,
} from '../client-signaling';

describe('Client-Side Signaling', () => {
  let signaling: ClientSignalingService;

  beforeEach(() => {
    const callbacks = {
      onConnectionStateChange: jest.fn(),
      onConnectionDataReceived: jest.fn(),
      onError: jest.fn(),
    };
    signaling = new ClientSignalingService(true, callbacks);
  });

  describe('Connection Data Encoding/Decoding', () => {
    it('should encode and decode connection data correctly', () => {
      const originalData = {
        type: 'offer' as const,
        sessionId: 'test-session-123',
        sdp: JSON.stringify({ type: 'offer', sdp: 'test-sdp-data' }),
        iceCandidates: [
          { candidate: 'candidate-1', sdpMid: '0', sdpMLineIndex: 0 },
        ],
        timestamp: Date.now(),
      };

      const encoded = encodeConnectionData(originalData);
      expect(encoded).toBeDefined();
      expect(typeof encoded).toBe('string');

      const decoded = decodeConnectionData(encoded);
      expect(decoded).toEqual(originalData);
    });

    it('should validate connection data strings correctly', () => {
      const validData = {
        type: 'offer' as const,
        sessionId: 'test-session',
        sdp: JSON.stringify({ type: 'offer', sdp: 'test' }),
        iceCandidates: [],
        timestamp: Date.now(),
      };

      const encoded = encodeConnectionData(validData);
      expect(isValidConnectionDataString(encoded)).toBe(true);

      expect(isValidConnectionDataString('invalid-data')).toBe(false);
    });
  });

  describe('Host Signaling', () => {
    it('should create offer data correctly', async () => {
      const offer = {
        type: 'offer' as const,
        sdp: 'test-sdp',
      };

      const offerData = await signaling.createOfferData(offer);

      expect(offerData).toBeDefined();
      expect(offerData.type).toBe('offer');
      expect(offerData.sessionId).toBeDefined();
      expect(offerData.sdp).toBe(JSON.stringify(offer));
      expect(offerData.iceCandidates).toEqual([]);
    });

    it('should add ICE candidates', () => {
      const candidate = {
        candidate: 'test-candidate',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      signaling.addIceCandidate(candidate);

      expect(signaling.getLocalConnectionData()?.iceCandidates).toContainEqual(candidate);
    });
  });

  describe('Client Signaling', () => {
    it('should create answer data correctly', async () => {
      signaling = new ClientSignalingService(false, {
        onConnectionStateChange: jest.fn(),
        onConnectionDataReceived: jest.fn(),
        onError: jest.fn(),
      });

      const answer = {
        type: 'answer' as const,
        sdp: 'test-sdp',
      };

      // Add some ICE candidates
      signaling.addIceCandidate({ candidate: 'candidate-1', sdpMid: '0', sdpMLineIndex: 0 });
      signaling.addIceCandidate({ candidate: 'candidate-2', sdpMid: '0', sdpMLineIndex: 0 });

      const answerData = await signaling.createAnswerData(answer);

      expect(answerData).toBeDefined();
      expect(answerData.type).toBe('answer');
      expect(answerData.sessionId).toBeDefined();
      expect(answerData.sdp).toBe(JSON.stringify(answer));
      expect(answerData.iceCandidates.length).toBe(2);
    });

    it('should process received offer data correctly', () => {
      signaling = new ClientSignalingService(false, {
        onConnectionStateChange: jest.fn(),
        onConnectionDataReceived: jest.fn(),
        onError: jest.fn(),
      });

      const offerData = {
        type: 'offer' as const,
        sessionId: 'test-session',
        sdp: JSON.stringify({ type: 'offer', sdp: 'test-sdp' }),
        iceCandidates: [],
        timestamp: Date.now(),
      };

      signaling.processConnectionData(offerData);

      // Should call the onConnectionDataReceived callback
      expect(signaling['callbacks'].onConnectionDataReceived).toHaveBeenCalledWith(offerData);
    });

    it('should reject answer data from client', () => {
      signaling = new ClientSignalingService(false, {
        onConnectionStateChange: jest.fn(),
        onConnectionDataReceived: jest.fn(),
        onError: jest.fn(),
      });

      const answerData = {
        type: 'answer' as const,
        sessionId: 'test-session',
        sdp: JSON.stringify({ type: 'answer', sdp: 'test-sdp' }),
        iceCandidates: [],
        timestamp: Date.now(),
      };

      signaling.processConnectionData(answerData);

      // Should call onError with validation error
      expect(signaling['callbacks'].onError).toHaveBeenCalledWith(
        expect.any(Error)
      );
    });
  });

  describe('Utility Functions', () => {
    it('should create host signaling service', () => {
      const callbacks = {
        onConnectionStateChange: jest.fn(),
        onConnectionDataReceived: jest.fn(),
        onError: jest.fn(),
      };

      const hostSignaling = createHostSignaling(callbacks);
      expect(hostSignaling).toBeInstanceOf(ClientSignalingService);
      expect(hostSignaling.getIsHost()).toBe(true);
    });

    it('should create client signaling service', () => {
      const callbacks = {
        onConnectionStateChange: jest.fn(),
        onConnectionDataReceived: jest.fn(),
        onError: jest.fn(),
      };

      const clientSignaling = createClientSignaling(callbacks);
      expect(clientSignaling).toBeInstanceOf(ClientSignalingService);
      expect(clientSignaling.getIsHost()).toBe(false);
    });
  });

  describe('Connection Data Management', () => {
    it('should check if connection data is ready', () => {
      expect(signaling.isConnectionDataReady()).toBe(false);

      signaling['localConnectionData'] = {
        type: 'offer',
        sessionId: 'test',
        sdp: '{}',
        iceCandidates: [],
        timestamp: Date.now(),
      };

      expect(signaling.isConnectionDataReady()).toBe(true);
    });

    it('should get session ID', () => {
      const sessionId = signaling.getSessionId();
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
    });

    it('should reset signaling service', () => {
      signaling['localConnectionData'] = {
        type: 'offer',
        sessionId: 'test',
        sdp: '{}',
        iceCandidates: [],
        timestamp: Date.now(),
      };

      signaling.reset();

      expect(signaling.isConnectionDataReady()).toBe(false);
      expect(signaling.getSessionId()).not.toBe(signaling['sessionId']);
    });

    it('should destroy signaling service', () => {
      signaling['localConnectionData'] = {
        type: 'offer',
        sessionId: 'test',
        sdp: '{}',
        iceCandidates: [],
        timestamp: Date.now(),
      };

      signaling.destroy();

      expect(signaling['localConnectionData']).toBe(null);
      expect(signaling['remoteConnectionData']).toBe(null);
      expect(signaling['iceCandidates']).toEqual([]);
    });
  });
});
