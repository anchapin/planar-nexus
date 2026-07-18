/**
 * @fileoverview Difficulty-scaled creature cast ordering (issue #1415).
 *
 * `mana-sequencing.ts` ships a fully tested, difficulty-aware
 * {@link getSequencingRecommendation} (issues #990 / #1069), but until this
 * file landed nothing in the live AI turn loop consumed it — `castCreatures`
 * in `ai-turn-loop.ts` sorted the hand by raw CMC and cast in that order, so
 * Easy and Expert sequenced creatures identically.
 *
 * This module is the thin wiring layer between the engine state the turn loop
 * already holds and the pure recommendation in `mana-sequencing.ts`. It is
 * deliberately kept in a sibling file (mirroring `opening-turn-plan.ts`) so
 * the only edit to `ai-turn-loop.ts` is the call site — sibling issues
 * #1413/#1414 also touch that file and rebase cleanly.
 *
 * Per-tier behavior (matches the issue spec):
 * - **easy**    — ignore the recommendation; keep the legacy ascending-CMC
 *   sort. Matches the Easy fallback already encoded in
 *   `mana-sequencing.ts` (`wasteChance` 0.4 / `efficiencyMultiplier` 0.6).
 * - **medium**  — call the recommendation and use its `castOrder` only when
 *   it scores strictly higher than the CMC sort on the same hand; otherwise
 *   fall back to CMC. Keeps Medium from ever doing worse than the legacy
 *   path.
 * - **hard**    — trust the recommendation, but with a 10% chance apply a
 *   Fisher-Yates shuffle to the ordered list (mimics imperfect sequencing —
 *   "allow a 10% random reorder to mimic imperfect sequencing").
 * - **expert**  — trust the recommendation exactly.
 *
 * The recommendation's `castOrder` is a list of CMC values, not card ids, so
 * {@link applyCastOrder} maps each CMC back to the next unmatched creature and
 * appends any leftovers (e.g. high-cmc spells the optimal sequence omitted) in
 * CMC order so they still get a cast attempt — feasibility is still gated by
 * the engine in `executeAIAction`.
 */

import type { CardInstanceId, AIHandCard } from "@/lib/game-state/types";
import type { DifficultyLevel, DifficultyFormat } from "./ai-difficulty";
import {
  getSequencingRecommendation,
  scoreSequencing,
} from "./mana-sequencing";

/** A creature in hand positioned for casting. */
export interface CreatureCastEntry {
  cardId: CardInstanceId;
  cmc: number;
}

/** Per-tier knobs threaded through the ordering decision. */
export interface CastSequencingContext {
  difficulty: DifficultyLevel;
  format?: DifficultyFormat;
  /**
   * Deterministic randomness source for tests. Defaults to `Math.random`.
   * Consumed by: the Hard 10% shuffle decision, the shuffle itself, and the
   * underlying recommendation's waste/misorder rolls.
   */
  rng?: () => number;
}

/** Inputs required to order a hand of creatures. */
export interface CreatureOrderInputs {
  /** Creatures currently in hand (pre-sorted any way). */
  creatures: CreatureCastEntry[];
  /** The AI's full hand, projected to the simplified {@link AIHandCard} shape
   * the recommendation expects. */
  hand: AIHandCard[];
  /** Total mana available this turn (summed across all color slots). */
  availableMana: number;
  /** Untapped land count — used by the recommendation's land-timing term. */
  untappedLands: number;
  /** Current turn number — used by the recommendation's curve-fit term. */
  turnNumber: number;
  /** Per-tier sequencing context. */
  context: CastSequencingContext;
}

/**
 * Order a list of creatures for the cast loop, scaled by difficulty.
 *
 * The function is pure: same inputs → same outputs. Inject `context.rng` for
 * deterministic tests. Always returns a fresh array; the input is not
 * mutated.
 */
export function orderCreaturesForDifficulty(
  args: CreatureOrderInputs,
): CreatureCastEntry[] {
  const { creatures, hand, availableMana, untappedLands, turnNumber, context } =
    args;
  if (creatures.length === 0) return [];

  // Easy: legacy ascending-CMC sort, no recommendation call (matches the
  // Easy fallback already encoded in mana-sequencing.ts).
  if (context.difficulty === "easy") {
    return sortByCmc(creatures);
  }

  const rng = context.rng ?? Math.random;

  const recommendation = getSequencingRecommendation(
    hand,
    availableMana,
    untappedLands,
    turnNumber,
    false,
    0,
    { difficulty: context.difficulty, format: context.format, rng },
  );

  const castOrder = recommendation.castOrder;

  if (context.difficulty === "medium") {
    // Use the sequence only when it scores strictly higher than the legacy
    // CMC sort on the same hand; otherwise fall back to CMC. Comparing via
    // the exported `scoreSequencing` keeps the signal pure and testable.
    const cmcOrder = sortByCmc(creatures).map((c) => c.cmc);
    const cmcScore = scoreSequencing(
      cmcOrder,
      availableMana,
      turnNumber,
      context.difficulty,
    );
    const seqScore = scoreSequencing(
      castOrder,
      availableMana,
      turnNumber,
      context.difficulty,
    );
    if (seqScore <= cmcScore) {
      return sortByCmc(creatures);
    }
  } else if (context.difficulty === "hard") {
    // 10% chance of a Fisher-Yates shuffle to mimic imperfect sequencing.
    if (rng() < CAST_SEQUENCE_HARD_SHUFFLE_CHANCE) {
      const ordered = applyCastOrder(creatures, castOrder);
      return shuffleInPlace(ordered, rng);
    }
  }

  return applyCastOrder(creatures, castOrder);
}

/** Chance that Hard difficulty randomly reorders the recommended sequence. */
export const CAST_SEQUENCE_HARD_SHUFFLE_CHANCE = 0.1;

/** Ascending-CMC sort (stable on cardId as a tiebreaker for determinism). */
function sortByCmc(creatures: CreatureCastEntry[]): CreatureCastEntry[] {
  return [...creatures].sort((a, b) => {
    if (a.cmc !== b.cmc) return a.cmc - b.cmc;
    // Stable tiebreak on stringified id keeps test output deterministic.
    return String(a.cardId).localeCompare(String(b.cardId));
  });
}

/**
 * Map a list of CMC values (the recommendation's `castOrder`) back onto
 * concrete creatures. Each CMC consumes the next unmatched creature at that
 * cost; any creatures the sequence omitted (e.g. high-cmc spells the optimal
 * play omitted) are appended in ascending-CMC order so they still get a cast
 * attempt — feasibility is still gated downstream by `executeAIAction`.
 */
function applyCastOrder(
  creatures: CreatureCastEntry[],
  castOrder: number[],
): CreatureCastEntry[] {
  const used = new Set<string>();
  const keyed = creatures.map((c) => ({ ...c, key: String(c.cardId) }));
  const ordered: CreatureCastEntry[] = [];

  for (const cmc of castOrder) {
    const next = keyed.find((c) => c.cmc === cmc && !used.has(c.key));
    if (next) {
      ordered.push(next);
      used.add(next.key);
    }
  }

  const leftovers = keyed
    .filter((c) => !used.has(c.key))
    .sort((a, b) => a.cmc - b.cmc || a.key.localeCompare(b.key));
  for (const c of leftovers) ordered.push(c);

  return ordered;
}

/** In-place Fisher-Yates shuffle driven by the injected rng. */
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
