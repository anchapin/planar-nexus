/**
 * Seedable PRNG unit tests (issue #1559)
 *
 * Covers the acceptance criteria for `src/lib/limited/rng.ts`:
 *  - same seed → identical 1000-value sequence
 *  - `next()` stays in [0, 1)
 *  - different seeds → different sequences
 *  - unseeded `createRng()` delegates to `Math.random()` at call time
 *    (spy-compatible, pre-#1559 behavior preserved)
 *  - helpers (`pick`, `int`, `shuffle`) behave and are deterministic
 *  - `resolveRng` precedence: rng > seed > unseeded delegate
 */

import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { createRng, resolveRng } from "../rng";

describe("rng: determinism (issue #1559)", () => {
  it("returns the identical 1000-value sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);

    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());

    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(42);
    const b = createRng(43);

    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());

    expect(seqA).not.toEqual(seqB);
  });

  it("coerces non-uint32 seeds deterministically (negative / float)", () => {
    // Same numeric seed always reproduces, whatever its sign/shape.
    const a = createRng(-1);
    const b = createRng(-1);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(
      Array.from({ length: 50 }, () => b.next()),
    );

    // 42.9 truncates to the same uint32 state as 42.
    const truncated = createRng(42.9);
    const exact = createRng(42);
    expect(truncated.next()).toBe(exact.next());
  });

  it("emits every value in [0, 1)", () => {
    const rng = createRng(2026);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("passes a loose uniformity sanity check over 10k fixed-seed draws", () => {
    // Fixed seed → deterministic draw set → this can never flake.
    const rng = createRng(1559);
    const buckets = new Array(10).fill(0);
    const draws = 10_000;
    for (let i = 0; i < draws; i++) {
      buckets[Math.floor(rng.next() * 10)]++;
    }
    const expected = draws / 10;
    for (const count of buckets) {
      // ±20% of uniform — generous, but catches gross bias.
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });
});

describe("rng: unseeded default delegates to Math.random", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws from Math.random at call time (spy-visible)", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.42);
    const rng = createRng();
    expect(rng.next()).toBe(0.42);
    expect(rng.next()).toBe(0.42);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps the exact Math.random value (no rounding drift)", () => {
    const tiny = 0.0000001;
    jest.spyOn(Math, "random").mockReturnValue(tiny);
    expect(createRng().next()).toBe(tiny);
  });
});

describe("rng: helpers", () => {
  it("pick returns a member of the array, deterministically per seed", () => {
    const items = ["a", "b", "c", "d", "e"];
    const a = createRng(7);
    const b = createRng(7);

    const picksA = Array.from({ length: 20 }, () => a.pick(items));
    const picksB = Array.from({ length: 20 }, () => b.pick(items));

    expect(picksA).toEqual(picksB);
    for (const p of picksA) expect(items).toContain(p);
  });

  it("pick throws on an empty array", () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow(/empty/i);
  });

  it("int stays within [0, maxExclusive)", () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });

  it("shuffle returns a permutation without mutating the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const snapshot = [...input];
    const rng = createRng(1234);

    const shuffled = rng.shuffle(input);

    expect(input).toEqual(snapshot); // no mutation
    expect([...shuffled].sort((a, b) => a - b)).toEqual(snapshot); // permutation
    expect(shuffled).not.toEqual(snapshot); // 8 elements → fixed-seed shuffle really moves things
  });

  it("shuffle is reproducible for a fixed seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(createRng(5).shuffle(items)).toEqual(createRng(5).shuffle(items));
  });
});

describe("resolveRng precedence (issue #1559)", () => {
  it("prefers an explicit rng over a seed", () => {
    // Compare via a fresh instance of the same seed — calling next() on
    // `resolved` and `explicit` would advance the *same* stream.
    const resolved = resolveRng({ seed: 999, rng: createRng(1) });
    expect(resolved.next()).toBe(createRng(1).next());
  });

  it("builds a seeded stream from seed alone", () => {
    const resolved = resolveRng({ seed: 42 });
    expect(resolved.next()).toBe(createRng(42).next());
  });

  it("falls back to the unseeded Math.random delegate", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(resolveRng().next()).toBe(0.5);
      expect(resolveRng({}).next()).toBe(0.5);
      expect(resolveRng({ seed: undefined }).next()).toBe(0.5);
    } finally {
      spy.mockRestore();
    }
  });
});
