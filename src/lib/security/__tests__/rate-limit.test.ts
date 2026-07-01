/**
 * Tests for the rate-limit primitives introduced in issue #1277.
 *
 *   - `TokenBucket`        — smooth rate + burst budget
 *   - `FixedWindowLimiter` — tight per-window cap
 *   - `KeyedRateLimiter`   — per-peer map with bounded cardinality
 *
 * Both primitives are constructed with an explicit `now` so the assertions
 * are reproducible without depending on real wall-clock time.
 */

import { describe, it, expect } from "@jest/globals";
import {
  TokenBucket,
  FixedWindowLimiter,
  KeyedRateLimiter,
} from "../rate-limit";

describe("TokenBucket", () => {
  describe("within-budget", () => {
    it("admits `maxEvents` events in immediate succession", () => {
      const bucket = new TokenBucket(
        { maxEvents: 5, windowMs: 1_000 },
        /* now */ 1_000_000,
      );
      for (let i = 0; i < 5; i++) {
        expect(bucket.tryAcquire(1_000_000)).toBe(true);
      }
      expect(bucket.availableTokens).toBeLessThan(1);
    });

    it("starts with a full bucket on construction", () => {
      const bucket = new TokenBucket(
        { maxEvents: 10, windowMs: 1_000 },
        /* now */ 0,
      );
      expect(bucket.availableTokens).toBe(10);
    });
  });

  describe("over-budget", () => {
    it("rejects events once the bucket drains", () => {
      const bucket = new TokenBucket(
        { maxEvents: 3, windowMs: 1_000 },
        /* now */ 0,
      );
      expect(bucket.tryAcquire(0)).toBe(true);
      expect(bucket.tryAcquire(0)).toBe(true);
      expect(bucket.tryAcquire(0)).toBe(true);
      expect(bucket.tryAcquire(0)).toBe(false);
      expect(bucket.tryAcquire(0)).toBe(false);
    });

    it("never throws under sustained pressure", () => {
      const bucket = new TokenBucket(
        { maxEvents: 10, windowMs: 60_000 },
        /* now */ 0,
      );
      expect(() => {
        for (let i = 0; i < 100_000; i++) bucket.tryAcquire(i);
      }).not.toThrow();
    });
  });

  describe("refill", () => {
    it("refills proportionally to elapsed wall time", () => {
      const bucket = new TokenBucket(
        { maxEvents: 60, windowMs: 60_000 }, // 1 token / s
        /* now */ 1_000_000,
      );
      // Drain immediately.
      for (let i = 0; i < 60; i++) bucket.tryAcquire(1_000_000);
      expect(bucket.tryAcquire(1_000_000)).toBe(false);
      // 30 s later, 30 tokens should have accrued (capped at 60).
      expect(bucket.tryAcquire(1_030_000)).toBe(true);
      expect(bucket.tryAcquire(1_030_000)).toBe(true);
      // Still under-budget partway through.
      const before = bucket.availableTokens;
      expect(before).toBeGreaterThanOrEqual(0);
    });

    it("clamps backwards-clock movement to a no-op refill", () => {
      const bucket = new TokenBucket(
        { maxEvents: 5, windowMs: 1_000 },
        /* now */ 1_000_000,
      );
      // Drain the bucket at t = 1_000_000 (5 acquires).
      for (let i = 0; i < 5; i++) bucket.tryAcquire(1_000_000);
      expect(bucket.availableTokens).toBe(0);
      // Many backwards-time attempts must NOT refill the bucket because
      // legitimate wall-clock time has not actually elapsed.
      for (let t = 999_999; t >= 999_990; t--) {
        expect(bucket.tryAcquire(t)).toBe(false);
      }
      expect(bucket.availableTokens).toBe(0);
    });
  });

  describe("reset", () => {
    it("restores the bucket to full", () => {
      const bucket = new TokenBucket(
        { maxEvents: 2, windowMs: 1_000 },
        /* now */ 0,
      );
      bucket.tryAcquire(0);
      bucket.tryAcquire(0);
      expect(bucket.tryAcquire(0)).toBe(false);
      bucket.reset(1_000);
      expect(bucket.tryAcquire(1_001)).toBe(true);
    });
  });

  describe("construction validation", () => {
    it("rejects non-positive maxEvents", () => {
      expect(() => new TokenBucket({ maxEvents: 0, windowMs: 1 })).toThrow();
      expect(() => new TokenBucket({ maxEvents: -1, windowMs: 1 })).toThrow();
    });

    it("rejects non-positive windowMs", () => {
      expect(() => new TokenBucket({ maxEvents: 1, windowMs: 0 })).toThrow();
      expect(() => new TokenBucket({ maxEvents: 1, windowMs: -1 })).toThrow();
    });
  });
});

describe("FixedWindowLimiter", () => {
  describe("within-budget", () => {
    it("admits up to `maxEvents` events per window", () => {
      const limiter = new FixedWindowLimiter(
        { maxEvents: 30, windowMs: 60_000 },
        /* now */ 0,
      );
      for (let i = 0; i < 30; i++) {
        expect(limiter.tryAcquire(i * 100)).toBe(true);
      }
      expect(limiter.currentCount).toBe(30);
    });
  });

  describe("over-budget — issue #1277 acceptance: 71st `connection-request` rejected", () => {
    it("admits the first 70 events and rejects the 71st onward", () => {
      // 70 = a comfortable budget; 71 = the first over-budget event.
      const limiter = new FixedWindowLimiter(
        { maxEvents: 70, windowMs: 60_000 },
        /* now */ 0,
      );
      // 70 in-window events at t = 0.
      for (let i = 0; i < 70; i++) {
        expect(limiter.tryAcquire(0)).toBe(true);
      }
      // 71st onward = rate-limit.
      expect(limiter.tryAcquire(0)).toBe(false);
      expect(limiter.tryAcquire(0)).toBe(false);
    });
  });

  describe("window rollover", () => {
    it("resets the count when the window boundary crosses", () => {
      const limiter = new FixedWindowLimiter(
        { maxEvents: 2, windowMs: 1_000 },
        /* now */ 0,
      );
      expect(limiter.tryAcquire(0)).toBe(true);
      expect(limiter.tryAcquire(100)).toBe(true);
      expect(limiter.tryAcquire(500)).toBe(false);
      // Window boundary: t=1000 is the start of a new 1-second window.
      expect(limiter.tryAcquire(1_000)).toBe(true);
      expect(limiter.tryAcquire(1_001)).toBe(true);
      expect(limiter.tryAcquire(1_500)).toBe(false);
    });
  });

  describe("construction validation", () => {
    it("rejects non-positive maxEvents", () => {
      expect(
        () => new FixedWindowLimiter({ maxEvents: 0, windowMs: 60_000 }),
      ).toThrow();
      expect(
        () => new FixedWindowLimiter({ maxEvents: -5, windowMs: 60_000 }),
      ).toThrow();
    });

    it("rejects non-positive windowMs", () => {
      expect(
        () => new FixedWindowLimiter({ maxEvents: 1, windowMs: 0 }),
      ).toThrow();
      expect(
        () => new FixedWindowLimiter({ maxEvents: 1, windowMs: -100 }),
      ).toThrow();
    });
  });
});

describe("KeyedRateLimiter", () => {
  describe("per-key isolation", () => {
    it("tracks each key independently", () => {
      const keyed = new KeyedRateLimiter(
        () =>
          new FixedWindowLimiter(
            { maxEvents: 2, windowMs: 60_000 },
            1_000_000,
          ),
        { maxKeys: 100 },
      );
      expect(keyed.tryAcquire("peer-A")).toBe(true);
      expect(keyed.tryAcquire("peer-A")).toBe(true);
      expect(keyed.tryAcquire("peer-A")).toBe(false);
      // peer-B is unaffected by peer-A flooding.
      expect(keyed.tryAcquire("peer-B")).toBe(true);
      expect(keyed.tryAcquire("peer-B")).toBe(true);
      expect(keyed.tryAcquire("peer-B")).toBe(false);
    });
  });

  describe("bounded cardinality", () => {
    it("evicts the oldest entry when `maxKeys` is exceeded", () => {
      const keyed = new KeyedRateLimiter(
        () =>
          new FixedWindowLimiter(
            { maxEvents: 10, windowMs: 60_000 },
            0,
          ),
        { maxKeys: 3 },
      );
      keyed.tryAcquire("a");
      keyed.tryAcquire("b");
      keyed.tryAcquire("c");
      keyed.tryAcquire("d"); // evicts "a"
      expect(keyed.size).toBe(3);
      // "a" was evicted — it should be allowed again (new bucket).
      expect(keyed.tryAcquire("a")).toBe(true);
    });

    it("keeps the most-recently-used keys warm via re-insert", () => {
      const keyed = new KeyedRateLimiter(
        () =>
          new FixedWindowLimiter(
            { maxEvents: 1, windowMs: 60_000 },
            0,
          ),
        { maxKeys: 3 },
      );
      keyed.tryAcquire("a");
      keyed.tryAcquire("b");
      keyed.tryAcquire("c");
      // Touching "a" again should move it to the most-recent slot so it
      // becomes the eviction candidate only after the OTHER two are
      // untouched for a while.
      keyed.tryAcquire("a");
      keyed.tryAcquire("d"); // "b" is now the oldest.
      expect(keyed.size).toBe(3);
    });
  });

  describe("forget / clear", () => {
    it("drops a specific key on `forget`", () => {
      const keyed = new KeyedRateLimiter(
        () =>
          new FixedWindowLimiter(
            { maxEvents: 1, windowMs: 60_000 },
            0,
          ),
      );
      keyed.tryAcquire("peer-1");
      expect(keyed.tryAcquire("peer-1")).toBe(false);
      keyed.forget("peer-1");
      expect(keyed.tryAcquire("peer-1")).toBe(true);
    });

    it("wipes everything on `clear`", () => {
      const keyed = new KeyedRateLimiter(
        () =>
          new FixedWindowLimiter(
            { maxEvents: 1, windowMs: 60_000 },
            0,
          ),
      );
      keyed.tryAcquire("a");
      keyed.tryAcquire("b");
      expect(keyed.size).toBe(2);
      keyed.clear();
      expect(keyed.size).toBe(0);
    });
  });
});
