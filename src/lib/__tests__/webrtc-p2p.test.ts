/**
 * WebRTC P2P Connection Tests
 * 
 * Tests for the WebRTC P2P module which provides peer-to-peer connections
 * for multiplayer games.
 * Issue #604: Add tests for P2P networking
 */

import {
  DEFAULT_RTC_CONFIG,
  generateGameCode,
} from '../webrtc-p2p';

describe('WebRTC P2P', () => {
  describe('generateGameCode', () => {
    it('should generate a game code with default length of 6', () => {
      const code = generateGameCode();
      
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    it('should generate a game code with custom length', () => {
      const code = generateGameCode(4);
      
      expect(code).toHaveLength(4);
    });

    it('should generate unique codes', () => {
      const codes = new Set();
      
      for (let i = 0; i < 100; i++) {
        codes.add(generateGameCode());
      }
      
      // Should have mostly unique codes (allowing for tiny collision possibility)
      expect(codes.size).toBeGreaterThan(90);
    });
  });

  describe('DEFAULT_RTC_CONFIG', () => {
    it('should have STUN servers configured', () => {
      expect(DEFAULT_RTC_CONFIG).toBeDefined();
      expect(DEFAULT_RTC_CONFIG.iceServers).toBeDefined();
      expect(Array.isArray(DEFAULT_RTC_CONFIG.iceServers)).toBe(true);
      expect(DEFAULT_RTC_CONFIG.iceServers?.length ?? 0).toBeGreaterThan(0);
    });

    it('should have valid STUN server URLs', () => {
      const servers = DEFAULT_RTC_CONFIG.iceServers ?? [];
      for (const server of servers) {
        expect(server.urls).toMatch(/^stun:/);
      }
    });
  });
});
