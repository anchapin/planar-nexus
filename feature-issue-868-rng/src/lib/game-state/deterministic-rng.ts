/**
 * Deterministic Pseudo-Random Number Generator (PRNG)
 * 
 * Provides seeded deterministic random number generation for P2P multiplayer sync.
 * All random values in the game must come from this seeded PRNG to ensure
 * all peers produce identical random sequences.
 */

import type { GameState } from "./types";

/**
 * Seeded PRNG using Mulberry32 algorithm
 * Fast, seedable, and produces deterministic sequences
 */
export class SeededRandom {
  private state: number;
  private seed: number;

  /**
   * Create a new seeded random number generator
   * @param seed - Numeric seed (must be non-zero)
   */
  constructor(seed: number) {
    this.seed = seed;
    this.state = seed;
  }

  /**
   * Get the current seed value
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Generate a random float in [0, 1)
   * Uses Mulberry32 algorithm
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate a random integer in [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Pick a random element from an array
   */
  pick<T>(array: T[]): T {
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates
   * Returns a new array, does not mutate the original
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Reset the generator to its initial seed
   */
  reset(): void {
    this.state = this.seed;
  }
}

/**
 * Derive a numeric seed from game state
 * Uses the game ID hash code or a combination of game identifiers
 */
export function deriveSeedFromGameState(state: GameState): number {
  // Use gameId if available, otherwise use turn number and active player
  if (state.gameId) {
    return hashString(state.gameId);
  }
  
  // Fallback: derive from turn state
  const turnNumber = state.turn?.turnNumber ?? 0;
  const activePlayerId = state.turn?.activePlayerId ?? "default";
  const phase = state.turn?.currentPhase ?? "untap";
  
  const combined = `${turnNumber}-${activePlayerId}-${phase}-${state.stack.length}`;
  return hashString(combined);
}

/**
 * Create a hash from a string (for seed derivation)
 * Uses djb2 algorithm - fast and good distribution
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Create a deterministic random generator from a game state
 */
export function createSeededRandom(state: GameState): SeededRandom {
  const seed = deriveSeedFromGameState(state);
  return new SeededRandom(seed);
}

/**
 * Generate a deterministic unique ID using the seeded PRNG
 * Replaces Math.random() based ID generation
 */
export function generateDeterministicId(
  prefix: string,
  state: GameState,
  rng: SeededRandom
): string {
  // Use timestamp from state along with random values for uniqueness
  const timestamp = state.lastModifiedAt ?? Date.now();
  const randomPart = rng.next().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${randomPart}`;
}