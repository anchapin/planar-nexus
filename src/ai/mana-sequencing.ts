/**
 * @fileoverview Mana Curve Sequencing Module
 *
 * Evaluates optimal cast ordering for early turns, factoring in
 * land-drop timing (tapped vs untapped), hand composition, and
 * available mana to recommend the most efficient sequencing.
 */

import type { HandCard } from "./game-state-evaluator";
import {
  DIFFICULTY_CONFIGS,
  resolveDifficultyConfig,
  type DifficultyFormat,
  type DifficultyLevel,
} from "./ai-difficulty";

export interface SequencingSlot {
  turn: number;
  availableMana: number;
  recommendedDrops: number[];
  landType: "untapped" | "tapped" | "checkland";
}

export interface SequencingRecommendation {
  castOrder: number[];
  score: number;
  reasoning: string[];
}

export interface HandComposition {
  cmcBuckets: number[];
  landCount: number;
  spellCount: number;
}

/**
 * Optional difficulty context threaded through the sequencing
 * recommendation pipeline (issue #990). All fields are optional so every
 * existing call site keeps working unchanged — omitting the whole object
 * reproduces the pre-#990 difficulty-agnostic behavior.
 */
export interface SequencingRecommendationOptions {
  /** Skill tier of the AI producing/receiving the recommendation. */
  difficulty?: DifficultyLevel;
  /** Active format family, used to fold per-format blunder tuning (#1069). */
  format?: DifficultyFormat;
  /**
   * Deterministic randomness source for tests. Defaults to `Math.random`.
   * Each recommendation consumes up to two rolls (waste, then misorder).
   */
  rng?: () => number;
}

const FIRST_FOUR_TURNS: SequencingSlot[] = [
  { turn: 1, availableMana: 1, recommendedDrops: [1], landType: "untapped" },
  { turn: 2, availableMana: 2, recommendedDrops: [2], landType: "untapped" },
  { turn: 3, availableMana: 3, recommendedDrops: [3], landType: "untapped" },
  { turn: 4, availableMana: 4, recommendedDrops: [4], landType: "untapped" },
];

const IDEAL_CURVE = [0, 1, 2, 2, 3, 3, 4, 4, 5, 6];

/**
 * Per-difficulty scaling for mana-sequencing recommendation quality
 * (issue #990).
 *
 * Before #990 every tier produced the identical "optimal" cast ordering, so
 * Easy and Expert represented mana sequencing indistinguishably. These knobs
 * reintroduce a skill axis. Every knob is **monotonic in skill** so a higher
 * tier always sequences mana at least as well as the tier below it:
 *
 * - `wasteChance` — probability the AI leaves mana unspent by dropping a
 *   playable spell (the issue's "Easy AI should frequently leave 1-2 mana
 *   unspent in early turns"). Easy frequently wastes; Expert almost never.
 *   Decreasing in skill.
 * - `efficiencyMultiplier` — multiplier applied to the achieved mana
 *   efficiency term in {@link scoreSequencing}. Lower tiers extract less
 *   value from the same mana (suboptimal color sequencing, poor curve
 *   conformance); Expert achieves ~100%. Increasing in skill (1.0 at expert).
 * - `misorderChance` — probability the AI mis-orders its land drops (tapped
 *   lands first, wrong color sequencing) modelled as a land-timing penalty
 *   in {@link evaluateLandDropTiming}. Easy frequently misorders; Expert
 *   never. Decreasing in skill.
 *
 * Composition with the unified difficulty taxonomy (#1064/#1192) + per-format
 * config (#1069): {@link resolveManaSequencingScaling} folds the resolved
 * per-format `blunderChance` into `wasteChance` and `misorderChance`, so a
 * format delta that raises/lowers blunders proportionally scales sequencing
 * mistakes — exactly the same mechanism the combat-trick module uses for
 * `miscastChance` (issue #1067).
 */
export interface ManaSequencingDifficultyScaling {
  wasteChance: number;
  efficiencyMultiplier: number;
  misorderChance: number;
}

export const DIFFICULTY_MANA_SEQUENCING_SCALING: Record<
  DifficultyLevel,
  ManaSequencingDifficultyScaling
> = {
  easy: {
    wasteChance: 0.4,
    efficiencyMultiplier: 0.6,
    misorderChance: 0.3,
  },
  medium: {
    wasteChance: 0.15,
    efficiencyMultiplier: 0.85,
    misorderChance: 0.1,
  },
  hard: {
    wasteChance: 0.05,
    efficiencyMultiplier: 0.95,
    misorderChance: 0.03,
  },
  expert: {
    wasteChance: 0.02,
    efficiencyMultiplier: 1.0,
    misorderChance: 0.0,
  },
};

/**
 * Baseline scaling (no degradation) used when no difficulty is supplied,
 * preserving the pre-#990 behavior of every sequencing function. With
 * `efficiencyMultiplier = 1` the score is unscaled and both mistake chances
 * are zero, so the output is identical to the legacy difficulty-agnostic
 * path.
 */
const NO_DIFFICULTY_SCALING: ManaSequencingDifficultyScaling = {
  wasteChance: 0,
  efficiencyMultiplier: 1,
  misorderChance: 0,
};

/**
 * Get the base tier-keyed mana-sequencing scaling.
 */
export function getDifficultyManaSequencingScaling(
  difficulty: DifficultyLevel,
): ManaSequencingDifficultyScaling {
  return DIFFICULTY_MANA_SEQUENCING_SCALING[difficulty];
}

/**
 * Resolve the effective mana-sequencing scaling for a (tier, format) pair,
 * composing the per-tier base with the per-format difficulty config (#1069).
 *
 * The base multipliers come from {@link DIFFICULTY_MANA_SEQUENCING_SCALING}.
 * The two mistake knobs (`wasteChance`, `misorderChance`) are then re-weighted
 * by the ratio of the resolved per-format `blunderChance` to the base tier
 * `blunderChance`, so a format override that raises blunders proportionally
 * raises sequencing mistakes and vice-versa. Both are clamped to [0, 1]. When
 * no format is supplied (or the format has no override for the tier) the base
 * scaling is returned unchanged — fully backward compatible. This mirrors
 * {@link resolveTrickScaling} in the combat-trick module (issue #1067) so the
 * two mistake-driven subsystems compose identically with the format layer.
 */
export function resolveManaSequencingScaling(
  difficulty: DifficultyLevel,
  format?: DifficultyFormat,
): ManaSequencingDifficultyScaling {
  const base = DIFFICULTY_MANA_SEQUENCING_SCALING[difficulty];
  if (!format) return base;
  const resolved = resolveDifficultyConfig(difficulty, format);
  const baseConfig = DIFFICULTY_CONFIGS[difficulty];
  if (baseConfig.blunderChance <= 0) return base;
  const ratio = resolved.blunderChance / baseConfig.blunderChance;
  const wasteChance = clamp01(base.wasteChance * ratio);
  const misorderChance = clamp01(base.misorderChance * ratio);
  if (
    wasteChance === base.wasteChance &&
    misorderChance === base.misorderChance
  ) {
    return base;
  }
  return { ...base, wasteChance, misorderChance };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function getHandComposition(hand: HandCard[]): HandComposition {
  const spells = hand.filter((c) => !c.type.toLowerCase().includes("land"));
  const lands = hand.filter((c) => c.type.toLowerCase().includes("land"));

  const cmcBuckets = new Array(8).fill(0);
  for (const spell of spells) {
    const cmc = Math.min(spell.manaValue, 7);
    cmcBuckets[cmc]++;
  }

  return {
    cmcBuckets,
    landCount: lands.length,
    spellCount: spells.length,
  };
}

export function computeOptimalSequence(
  composition: HandComposition,
  availableMana: number,
  untappedLands: number,
  hasChecklands: boolean = false,
  difficulty?: DifficultyLevel,
  rng: () => number = Math.random,
): number[] {
  const sequence: number[] = [];
  let mana = availableMana;
  const remaining = [...composition.cmcBuckets];

  for (let cmc = 1; cmc <= mana && cmc < remaining.length; cmc++) {
    while (remaining[cmc] > 0 && mana >= cmc) {
      sequence.push(cmc);
      mana -= cmc;
      remaining[cmc]--;
    }
  }

  // Issue #990: the leaf uses the base tier table (tier-only). Format
  // composition (#1069) is applied at the orchestrator level in
  // {@link getSequencingRecommendation} via {@link resolveManaSequencingScaling}.
  const scaling =
    difficulty === undefined
      ? NO_DIFFICULTY_SCALING
      : DIFFICULTY_MANA_SEQUENCING_SCALING[difficulty];

  if (hasChecklands && untappedLands >= 2) {
    const effectiveMana = untappedLands - 1;
    const checklandSequence: number[] = [];
    let cm = effectiveMana;
    const checkRemaining = [...composition.cmcBuckets];

    for (let cmc = 1; cmc <= cm && cmc < checkRemaining.length; cmc++) {
      while (checkRemaining[cmc] > 0 && cm >= cmc) {
        checklandSequence.push(cmc);
        cm -= cmc;
        checkRemaining[cmc]--;
      }
    }

    if (checklandSequence.length < sequence.length) {
      return applySequencingWaste(checklandSequence, scaling, rng);
    }
  }

  return applySequencingWaste(sequence, scaling, rng);
}

/**
 * Apply the per-difficulty mana-waste blunder to a computed cast sequence
 * (issue #990).
 *
 * When a roll lands under `scaling.wasteChance`, the highest-cmc spell in the
 * sequence is dropped — modelling the low-skill AI choosing to leave mana
 * unspent ("Easy AI should frequently leave 1-2 mana unspent in early turns").
 * Dropping the highest-cmc entry wastes the most mana, matching the issue's
 * intent. The {@link NO_DIFFICULTY_SCALING} sentinel (wasteChance = 0) makes
 * this a no-op for the legacy difficulty-agnostic path. The roll is driven by
 * the supplied `rng` so tests are fully deterministic.
 */
function applySequencingWaste(
  sequence: number[],
  scaling: ManaSequencingDifficultyScaling,
  rng: () => number,
): number[] {
  if (scaling.wasteChance <= 0 || sequence.length === 0) {
    return sequence;
  }
  if (rng() >= scaling.wasteChance) {
    return sequence;
  }
  // Drop the highest-cmc spell: greedy sequences are low→high, so the last
  // entry is the most expensive. A fresh copy is returned so the caller's
  // reference is never mutated.
  return sequence.slice(0, -1);
}

/**
 * Apply the per-difficulty land-drop misordering blunder to a land-timing
 * score (issue #990).
 *
 * When a roll lands under `scaling.misorderChance`, a fixed tempo penalty is
 * subtracted — modelling the low-skill AI mis-ordering its land drops (tapped
 * lands first, wrong color sequencing). The result is clamped to [-1, 1]. The
 * {@link NO_DIFFICULTY_SCALING} sentinel (misorderChance = 0) makes this a
 * no-op for the legacy path. Driven by the supplied `rng` for determinism.
 */
function applyMisorderPenalty(
  score: number,
  scaling: ManaSequencingDifficultyScaling,
  rng: () => number,
): number {
  if (scaling.misorderChance <= 0 || rng() >= scaling.misorderChance) {
    return score;
  }
  return Math.max(-1, Math.min(1, score - 0.2));
}

export function scoreSequencing(
  optimalSequence: number[],
  availableMana: number,
  turnNumber: number,
  difficulty?: DifficultyLevel,
): number {
  if (optimalSequence.length === 0) return 0;

  // Issue #990: scale the achieved mana-efficiency term by the tier's
  // `efficiencyMultiplier`. Lower tiers extract less value from the same mana
  // (suboptimal color sequencing, poor curve conformance), so the reported
  // sequencing quality is dampened — "penalize imperfect mana usage based on
  // difficulty". When `difficulty` is omitted the multiplier is 1 (unscaled),
  // preserving the legacy score for existing callers.
  const efficiencyMultiplier =
    difficulty === undefined
      ? NO_DIFFICULTY_SCALING.efficiencyMultiplier
      : DIFFICULTY_MANA_SEQUENCING_SCALING[difficulty].efficiencyMultiplier;

  let score = 0;
  const totalManaUsed = optimalSequence.reduce((a, b) => a + b, 0);
  const manaEfficiency = totalManaUsed / availableMana;

  score += manaEfficiency * 0.4 * efficiencyMultiplier;

  const curveFit = Math.abs(totalManaUsed - availableMana);
  if (curveFit === 0) score += 0.3;
  else if (curveFit === 1) score += 0.15;

  const dropCount = optimalSequence.length;
  if (dropCount >= 2 && turnNumber <= 4) score += 0.2;
  else if (dropCount >= 1) score += 0.1;

  return Math.min(1, score);
}

export function evaluateLandDropTiming(
  landsInHand: number,
  landsOnBattlefield: number,
  currentTurn: number,
  hasChecklands: boolean = false,
  tappedLandCount: number = 0,
  difficulty?: DifficultyLevel,
  rng: () => number = Math.random,
): number {
  if (landsInHand === 0) return -0.5;
  if (landsOnBattlefield >= 4 && currentTurn <= 4) return 0.8;
  if (landsOnBattlefield >= currentTurn) return 0.5;

  let score = 0;
  const landDropNeeded = currentTurn - landsOnBattlefield;

  if (landDropNeeded > 0 && landsInHand >= 1) score += 0.3;
  else if (landDropNeeded > 0) score -= 0.3;

  if (tappedLandCount > 0 && currentTurn <= 3) {
    score -= 0.15 * tappedLandCount;
  }

  if (hasChecklands && landsOnBattlefield >= 2) {
    score -= 0.1;
  }

  // Issue #990: per-difficulty land-drop misordering blunder. The leaf uses
  // the base tier table (tier-only); format composition (#1069) is applied at
  // the orchestrator level. When `difficulty` is omitted the sentinel scaling
  // (misorderChance = 0) makes this a no-op, preserving legacy behavior.
  const scaling =
    difficulty === undefined
      ? NO_DIFFICULTY_SCALING
      : DIFFICULTY_MANA_SEQUENCING_SCALING[difficulty];
  return applyMisorderPenalty(score, scaling, rng);
}

export function getSequencingRecommendation(
  hand: HandCard[],
  availableMana: number,
  untappedLands: number,
  turnNumber: number,
  hasChecklands: boolean = false,
  tappedLandCount: number = 0,
  options?: SequencingRecommendationOptions,
): SequencingRecommendation {
  const difficulty = options?.difficulty;
  const format = options?.format;
  const rng = options?.rng ?? Math.random;

  // Resolve the format-composed scaling so the per-format blunder tuning
  // (#1069) actually affects the mistake rolls — exactly like the combat-trick
  // orchestrator {@link decideCombatTrickHold} (issue #1067). The leaf
  // functions below are called WITHOUT difficulty so they produce their raw
  // (unscaled) outputs; the resolved waste/misorder blunders are applied here.
  const scaling =
    difficulty === undefined
      ? NO_DIFFICULTY_SCALING
      : resolveManaSequencingScaling(difficulty, format);

  const composition = getHandComposition(hand);

  // Raw optimal sequence — no internal waste roll (difficulty omitted).
  const rawSequence = computeOptimalSequence(
    composition,
    availableMana,
    untappedLands,
    hasChecklands,
  );
  // Apply the format-resolved mana-waste blunder (first roll consumed).
  const optimalSequence = applySequencingWaste(rawSequence, scaling, rng);

  const sequenceScore = scoreSequencing(
    optimalSequence,
    availableMana,
    turnNumber,
    difficulty,
  );

  // Raw land timing — no internal misorder roll (difficulty omitted). Then
  // apply the format-resolved misorder blunder (second roll consumed).
  const rawLandTiming = evaluateLandDropTiming(
    composition.landCount,
    untappedLands,
    turnNumber,
    hasChecklands,
    tappedLandCount,
  );
  const landTimingScore = applyMisorderPenalty(rawLandTiming, scaling, rng);

  const reasoning: string[] = [];

  const totalManaUsed = optimalSequence.reduce((a, b) => a + b, 0);
  const wastedMana = availableMana - totalManaUsed;
  if (totalManaUsed === availableMana && optimalSequence.length > 0) {
    reasoning.push("Perfect mana utilization");
  } else if (wastedMana > 1 && optimalSequence.length > 0) {
    reasoning.push(`Unused mana detected in sequence (${wastedMana} unspent)`);
  }

  if (optimalSequence.length >= 2 && turnNumber <= 4) {
    reasoning.push("Efficient multi-spell sequencing");
  }

  if (tappedLandCount > 0 && turnNumber <= 3) {
    reasoning.push("Tapped lands reducing early-game tempo");
  }

  if (composition.landCount === 0 && turnNumber <= 3) {
    reasoning.push("No land drops available");
  }

  // Issue #990: surface difficulty-appropriate expectations in the reasoning.
  // Easy routinely wastes mana / mis-orders lands; Expert is expected to be
  // near-optimal — the comment should reflect that, not claim perfection.
  if (difficulty !== undefined) {
    const efficiencyPct = Math.round(
      (totalManaUsed / Math.max(1, availableMana)) * 100,
    );
    if (difficulty === "easy" && wastedMana >= 1) {
      reasoning.push(
        `Suboptimal sequencing — ${wastedMana} mana wasted (difficulty: easy)`,
      );
    } else if (difficulty === "expert" && wastedMana === 0) {
      reasoning.push(
        `Optimal sequencing — ${efficiencyPct}% mana efficiency (difficulty: expert)`,
      );
    } else {
      reasoning.push(
        `Sequencing quality: ${efficiencyPct}% mana efficiency (difficulty: ${difficulty})`,
      );
    }
  }

  return {
    castOrder: optimalSequence,
    score: Math.max(-1, Math.min(1, (sequenceScore + landTimingScore) / 2)),
    reasoning,
  };
}

export function computeCurveConformance(hand: HandCard[]): number {
  if (hand.length === 0) return 0;

  const composition = getHandComposition(hand);
  const spellCount = composition.spellCount;
  if (spellCount === 0) return 0;

  const idealDistribution = [0, 0.25, 0.35, 0.25, 0.15];
  let score = 0;

  for (let i = 1; i <= 4 && i < composition.cmcBuckets.length; i++) {
    const actual = composition.cmcBuckets[i] / spellCount;
    const ideal = idealDistribution[i] || 0;
    const penalty = Math.abs(actual - ideal);
    score -= penalty;
  }

  for (let i = 5; i < composition.cmcBuckets.length; i++) {
    const actual = composition.cmcBuckets[i] / spellCount;
    score -= actual * 0.3;
  }

  return Math.max(-1, Math.min(1, score + 0.5));
}
