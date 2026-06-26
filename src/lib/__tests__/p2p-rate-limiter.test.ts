/**
 * Tests for the per-connection P2P rate limiter. Issue #1111.
 */

import {
  P2PRateLimiter,
  DEFAULT_P2P_RATE_LIMIT,
} from "../p2p-rate-limiter";

describe("P2PRateLimiter", () => {
  describe("within-limit behavior", () => {
    it("allows messages up to the configured maximum", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 5,
        windowMs: 1000,
      });
      for (let i = 0; i < 5; i++) {
        expect(limiter.tryAcquire(1000)).toBe(true);
      }
    });

    it("uses sensible defaults when constructed with no options", () => {
      const limiter = new P2PRateLimiter();
      for (let i = 0; i < DEFAULT_P2P_RATE_LIMIT.maxMessages; i++) {
        expect(limiter.tryAcquire(0)).toBe(true);
      }
    });
  });

  describe("rapid-spam / over-limit behavior", () => {
    it("drops messages once the window capacity is exceeded", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 3,
        windowMs: 1000,
      });
      expect(limiter.tryAcquire(5000)).toBe(true);
      expect(limiter.tryAcquire(5000)).toBe(true);
      expect(limiter.tryAcquire(5000)).toBe(true);
      // 4th message in the same window is dropped.
      expect(limiter.tryAcquire(5000)).toBe(false);
      // And a 5th, 6th ... are all dropped while the window is saturated.
      expect(limiter.tryAcquire(5000)).toBe(false);
      expect(limiter.tryAcquire(5000)).toBe(false);
    });

    it("sustains a flood without ever throwing", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 10,
        windowMs: 1000,
      });
      expect(() => {
        for (let i = 0; i < 100_000; i++) {
          limiter.tryAcquire(5000);
        }
      }).not.toThrow();
      // Only the first 10 were admitted.
      expect(limiter.currentCount).toBe(10);
    });
  });

  describe("sliding-window recovery", () => {
    it("admits messages again after the window has elapsed", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 2,
        windowMs: 1000,
      });
      // Saturate the window at t=1000.
      expect(limiter.tryAcquire(1000)).toBe(true);
      expect(limiter.tryAcquire(1000)).toBe(true);
      expect(limiter.tryAcquire(1000)).toBe(false);
      // Still saturated partway through the window.
      expect(limiter.tryAcquire(1500)).toBe(false);
      // At t=2001 the t=1000 entries have aged out (cutoff = 1001), so new
      // messages are admitted again.
      expect(limiter.tryAcquire(2001)).toBe(true);
      expect(limiter.tryAcquire(2001)).toBe(true);
      expect(limiter.tryAcquire(2001)).toBe(false);
    });

    it("evicts aged entries lazily on the next acquire", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 100,
        windowMs: 500,
      });
      // Fill the window in one period.
      for (let i = 0; i < 100; i++) limiter.tryAcquire(0);
      expect(limiter.currentCount).toBe(100);
      // After the window elapses, a single acquire both evicts old entries and
      // admits the new one.
      expect(limiter.tryAcquire(1000)).toBe(true);
      expect(limiter.currentCount).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears recorded timestamps", () => {
      const limiter = new P2PRateLimiter({
        maxMessages: 2,
        windowMs: 1000,
      });
      limiter.tryAcquire(0);
      limiter.tryAcquire(0);
      expect(limiter.tryAcquire(0)).toBe(false);
      limiter.reset();
      expect(limiter.currentCount).toBe(0);
      expect(limiter.tryAcquire(0)).toBe(true);
    });
  });

  describe("configuration validation", () => {
    it("rejects non-positive maxMessages", () => {
      expect(() => new P2PRateLimiter({ maxMessages: 0 })).toThrow();
      expect(() => new P2PRateLimiter({ maxMessages: -1 })).toThrow();
    });

    it("rejects non-positive windowMs", () => {
      expect(() => new P2PRateLimiter({ windowMs: 0 })).toThrow();
      expect(() => new P2PRateLimiter({ windowMs: -5 })).toThrow();
    });
  });
});
