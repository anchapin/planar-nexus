/**
 * Deterministic RNG Tests
 * 
 * Tests for the seeded PRNG to ensure deterministic behavior
 * across peers in multiplayer sync.
 */

import { SeededRandom, hashString, deriveSeedFromGameState, generateDeterministicId } from "../deterministic-rng";

describe("SeededRandom", () => {
  describe("basic functionality", () => {
    it("should produce deterministic sequence with same seed", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);
      
      const seq1 = [rng1.next(), rng1.next(), rng1.next()];
      const seq2 = [rng2.next(), rng2.next(), rng2.next()];
      
      expect(seq1).toEqual(seq2);
    });

    it("should produce different sequences with different seeds", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(123);
      
      const seq1 = [rng1.next(), rng1.next(), rng1.next()];
      const seq2 = [rng2.next(), rng2.next(), rng2.next()];
      
      expect(seq1).not.toEqual(seq2);
    });

    it("should produce values in [0, 1) range", () => {
      const rng = new SeededRandom(42);
      
      for (let i = 0; i < 100; i++) {
        const val = rng.next();
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it("should produce uniform integer distribution", () => {
      const rng = new SeededRandom(42);
      const counts = new Array(10).fill(0);
      const iterations = 10000;
      
      for (let i = 0; i < iterations; i++) {
        const val = rng.nextInt(0, 9);
        counts[val]++;
      }
      
      // Check uniform distribution (allow 20% deviation from expected)
      const expected = iterations / 10;
      for (const count of counts) {
        expect(count).toBeGreaterThan(expected * 0.8);
        expect(count).toBeLessThan(expected * 1.2);
      }
    });
  });

  describe("nextInt", () => {
    it("should return values within range", () => {
      const rng = new SeededRandom(42);
      
      for (let i = 0; i < 100; i++) {
        const val = rng.nextInt(5, 10);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });

    it("should handle edge cases", () => {
      const rng = new SeededRandom(42);
      
      expect(rng.nextInt(0, 0)).toBe(0);
      expect(rng.nextInt(1, 1)).toBe(1);
      expect(rng.nextInt(100, 100)).toBe(100);
    });
  });

  describe("pick", () => {
    it("should pick elements from array", () => {
      const rng = new SeededRandom(42);
      const arr = ["a", "b", "c", "d", "e"];
      const picked: string[] = [];
      
      for (let i = 0; i < 20; i++) {
        picked.push(rng.pick(arr));
      }
      
      // All picks should be from original array
      for (const p of picked) {
        expect(arr).toContain(p);
      }
    });

    it("should return different elements over multiple picks", () => {
      const rng = new SeededRandom(42);
      const arr = ["a", "b", "c", "d", "e"];
      const picked = new Set<string>();
      
      for (let i = 0; i < 20; i++) {
        picked.add(rng.pick(arr));
      }
      
      // With 20 picks from 5 elements, should get at least 3 different
      expect(picked.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe("shuffle", () => {
    it("should return array of same length", () => {
      const rng = new SeededRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle(arr);
      
      expect(shuffled.length).toBe(arr.length);
    });

    it("should contain all original elements", () => {
      const rng = new SeededRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = rng.shuffle(arr);
      
      const sortedOriginal = [...arr].sort((a, b) => a - b);
      const sortedShuffled = [...shuffled].sort((a, b) => a - b);
      
      expect(sortedShuffled).toEqual(sortedOriginal);
    });

    it("should be deterministic with same seed", () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const shuffled1 = rng1.shuffle(arr);
      const shuffled2 = rng2.shuffle(arr);
      
      expect(shuffled1).toEqual(shuffled2);
    });

    it("should not mutate original array", () => {
      const rng = new SeededRandom(42);
      const arr = [1, 2, 3, 4, 5];
      const original = [...arr];
      
      rng.shuffle(arr);
      
      expect(arr).toEqual(original);
    });
  });

  describe("reset", () => {
    it("should restart sequence after reset", () => {
      const rng = new SeededRandom(42);
      
      rng.next();
      rng.next();
      rng.reset();
      const afterReset = rng.next();
      
      rng.reset();
      const first = rng.next();
      rng.next();
      const second = rng.next();
      
      expect(afterReset).toEqual(first);
      expect(second).toEqual(afterReset);
    });
  });

  describe("getSeed", () => {
    it("should return original seed", () => {
      const rng = new SeededRandom(12345);
      expect(rng.getSeed()).toBe(12345);
    });
  });
});

describe("hashString", () => {
  it("should produce consistent hashes", () => {
    const hash1 = hashString("test");
    const hash2 = hashString("test");
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different strings", () => {
    const hash1 = hashString("test1");
    const hash2 = hashString("test2");
    expect(hash1).not.toBe(hash2);
  });

  it("should produce positive numbers", () => {
    const hash = hashString("any string");
    expect(hash).toBeGreaterThan(0);
  });
});

describe("generateDeterministicId", () => {
  it("should generate unique IDs", () => {
    // Minimal mock game state
    const mockState = {
      gameId: "game-123",
      lastModifiedAt: 1234567890,
      stack: [],
    } as any;
    const rng = new SeededRandom(42);
    
    const id1 = generateDeterministicId("stack", mockState, rng);
    const id2 = generateDeterministicId("stack", mockState, rng);
    
    expect(id1).not.toBe(id2);
    expect(id1).toContain("stack-");
  });

  it("should include prefix in ID", () => {
    const mockState = {
      gameId: "game-123",
      lastModifiedAt: 1234567890,
      stack: [],
    } as any;
    const rng = new SeededRandom(42);
    
    const id = generateDeterministicId("card", mockState, rng);
    expect(id.startsWith("card-")).toBe(true);
  });
});

describe("multiplayer sync scenarios", () => {
  it("should produce same random sequence for two peers with same game state seed", () => {
    // Simulate two peers joining a game with same gameId
    const gameId = "game-peer-sync-test-123";
    const mockState = {
      gameId,
      lastModifiedAt: Date.now(),
      stack: [],
      turn: { turnNumber: 1, activePlayerId: "p1", currentPhase: "untap" },
    } as any;
    
    // Both peers create RNG from same game state
    const rng1 = new SeededRandom(hashString(gameId));
    const rng2 = new SeededRandom(hashString(gameId));
    
    // Both should produce identical random sequences
    const seq1 = [rng1.next(), rng1.next(), rng1.nextInt(0, 9)];
    const seq2 = [rng2.next(), rng2.next(), rng2.nextInt(0, 9)];
    
    expect(seq1).toEqual(seq2);
  });

  it("should produce different sequences for different game states", () => {
    const state1 = { gameId: "game-1", stack: [] } as any;
    const state2 = { gameId: "game-2", stack: [] } as any;
    
    const seed1 = hashString("game-1");
    const seed2 = hashString("game-2");
    
    const rng1 = new SeededRandom(seed1);
    const rng2 = new SeededRandom(seed2);
    
    const val1 = rng1.next();
    const val2 = rng2.next();
    
    expect(val1).not.toBe(val2);
  });
});