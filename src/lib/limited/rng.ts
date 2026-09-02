/**
 * Seedable PRNG for the limited subsystem (issue #1559)
 *
 * Every randomness site in draft/sealed/Rochester/Winston generation and the
 * AI pickers routes through an injected {@link Rng} instance instead of
 * calling `Math.random()` directly. Two goals:
 *
 *  1. **Reproducibility** — simulations, Stryker mutation runs, and bug
 *     reports ("the AI picked a weird card") can be replayed exactly by
 *     re-supplying the same numeric seed.
 *  2. **Shareable draft seeds** — the v1.8 `?seed=...` feature needs a
 *     single deterministic PRNG stream per session so two players can race
 *     the same pod.
 *
 * PRNG choice: **mulberry32** — 32-bit state, one `Math.imul`-based round
 * per output, ~2^32 period, good statistical quality for gameplay
 * shuffles. It is tiny, dependency-free, and synchronously deterministic
 * across JS engines (integer ops only, no floating-point state).
 *
 * Unseeded behavior is unchanged: `createRng()` (no seed) delegates to
 * `Math.random()` **at call time**, so global spies
 * (`jest.spyOn(Math, "random")`) keep working and the UX is identical to
 * the pre-#1559 implementation.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Deterministic random source threaded through the limited generators and
 * AI pickers. Always created via {@link createRng}.
 */
export interface Rng {
  /** Next float in `[0, 1)`, matching the `Math.random()` contract. */
  next(): number;
  /** Uniform random element of `items`. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Uniform random integer in `[0, maxExclusive)`. Returns 0 when `maxExclusive <= 0`. */
  int(maxExclusive: number): number;
  /** Fisher-Yates copy-shuffle of `items` driven by this Rng's stream. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * Options accepted by the limited generators. At most one of `seed`/`rng`
 * is honored; `rng` wins when both are supplied.
 */
export interface RngOptions {
  /**
   * Numeric PRNG seed. When supplied (and no `rng`), a fresh mulberry32
   * stream is created from it, making the generated pool reproducible.
   */
  seed?: number;
  /**
   * Pre-built {@link Rng} instance. Callers that already resolved a
   * session-level PRNG (e.g. session creators) pass it here directly.
   */
  rng?: Rng;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * mulberry32 — 32-bit seeded PRNG returning floats in `[0, 1)`.
 *
 * Canonical implementation (tommyettinger / bryc's public-domain variant);
 * the same routine is already used by the sealed-generator test harness to
 * stub deterministic `Math.random` sequences, so runtime and test share one
 * proven algorithm.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create an {@link Rng}.
 *
 * - `createRng(seed)` — deterministic mulberry32 stream; identical seeds
 *   produce identical output sequences (issue #1559 replay guarantee).
 * - `createRng()` — delegates to `Math.random()` at call time. This is the
 *   default path for unseeded callers, preserving pre-#1559 behavior
 *   (including test spies on `Math.random`).
 *
 * Non-integer and negative seeds are coerced with `>>> 0`, matching the
 * usual uint32 mulberry32 convention.
 */
export function createRng(seed?: number): Rng {
  const next: () => number =
    seed === undefined ? () => Math.random() : mulberry32(seed);

  return {
    next,

    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error("Cannot pick from an empty array");
      }
      return items[Math.floor(next() * items.length)];
    },

    int(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },

    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  };
}

/**
 * Resolve the effective {@link Rng} from loose `{ seed?, rng? }` options.
 *
 * Precedence: explicit `rng` instance → seeded mulberry32 → unseeded
 * `Math.random` delegate. Centralized so every session creator resolves
 * seeds identically.
 */
export function resolveRng(options?: RngOptions): Rng {
  if (options?.rng) return options.rng;
  if (options?.seed !== undefined) return createRng(options.seed);
  return createRng();
}
