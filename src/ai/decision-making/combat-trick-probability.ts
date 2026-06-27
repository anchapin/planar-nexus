import type { OpponentArchetype } from "./block-prediction";
import {
  DIFFICULTY_CONFIGS,
  resolveDifficultyConfig,
  type DifficultyFormat,
  type DifficultyLevel,
} from "../ai-difficulty";

export interface OpponentManaState {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

export interface CombatTrickEstimate {
  probability: number;
  estimatedTypes: CombatTrickType[];
  confidence: number;
  reasoning: string;
}

export type CombatTrickType =
  | "pump"
  | "removal"
  | "toughness_boost"
  | "damage_prevention"
  | "deathtouch_grant"
  | "indestructible"
  | "lifelink";

const ARCHETYPE_TRICK_WEIGHTS: Record<
  OpponentArchetype,
  {
    trickFrequency: number;
    pumpWeight: number;
    removalWeight: number;
    bluffWeight: number;
  }
> = {
  aggro: { trickFrequency: 0.6, pumpWeight: 0.8, removalWeight: 0.3, bluffWeight: 0.2 },
  control: {
    trickFrequency: 0.7,
    pumpWeight: 0.2,
    removalWeight: 0.9,
    bluffWeight: 0.6,
  },
  midrange: {
    trickFrequency: 0.5,
    pumpWeight: 0.5,
    removalWeight: 0.5,
    bluffWeight: 0.4,
  },
  tempo: {
    trickFrequency: 0.7,
    pumpWeight: 0.6,
    removalWeight: 0.7,
    bluffWeight: 0.5,
  },
  combo: {
    trickFrequency: 0.3,
    pumpWeight: 0.2,
    removalWeight: 0.4,
    bluffWeight: 0.1,
  },
  unknown: {
    trickFrequency: 0.5,
    pumpWeight: 0.5,
    removalWeight: 0.5,
    bluffWeight: 0.3,
  },
};

const COMMON_TRICK_CMC: Record<CombatTrickType, number> = {
  pump: 1,
  removal: 2,
  toughness_boost: 1,
  damage_prevention: 2,
  deathtouch_grant: 2,
  indestructible: 3,
  lifelink: 1,
};

/**
 * Per-difficulty scaling for combat-trick casting and bluff/hold behavior
 * (issue #1067).
 *
 * The archetype profiles in {@link ARCHETYPE_TRICK_WEIGHTS} are otherwise
 * constant across skill tiers, which flattens the difficulty experience: Easy
 * and Expert would represent bluffs and hold/cast combat tricks identically.
 * These multipliers reintroduce a skill axis. Every knob is **monotonic in
 * skill** so a higher tier always casts/bluffs/holds at least as well as the
 * tier below it:
 *
 * - `bluffMultiplier` — scales the archetype `bluffWeight`. Easy ≈ 0 (rarely
 *   represents a bluff), Expert = 1 (credible bluffs).
 * - `trickFrequencyMultiplier` — scales the archetype `trickFrequency`,
 *   interpreted as the rate of *optimal* trick casting. Easy miscasts or
 *   over-commits so its effective optimal-cast rate is low; Expert casts the
 *   right trick at the right time.
 * - `miscastChance` — probability of mis-timing a held trick (forced early
 *   reveal / wrong window). Easy frequently wastes tricks, Expert almost never.
 *   Decreasing in skill.
 * - `holdDiscipline` — probability of holding a trick for a higher-EV window
 *   when one exists. Easy reveals at the first opportunity, Expert holds for
 *   maximum value. Increasing in skill.
 *
 * Composition with the per-format overrides (#1069): {@link resolveTrickScaling}
 * folds the resolved per-format `blunderChance` into `miscastChance`, so a
 * format delta that raises/lowers blunders proportionally scales mis-timing.
 */
export interface CombatTrickDifficultyScaling {
  bluffMultiplier: number;
  trickFrequencyMultiplier: number;
  miscastChance: number;
  holdDiscipline: number;
}

export const DIFFICULTY_TRICK_SCALING: Record<
  DifficultyLevel,
  CombatTrickDifficultyScaling
> = {
  easy: {
    bluffMultiplier: 0.1,
    trickFrequencyMultiplier: 0.5,
    miscastChance: 0.4,
    holdDiscipline: 0.1,
  },
  medium: {
    bluffMultiplier: 0.5,
    trickFrequencyMultiplier: 0.8,
    miscastChance: 0.15,
    holdDiscipline: 0.5,
  },
  hard: {
    bluffMultiplier: 0.85,
    trickFrequencyMultiplier: 0.95,
    miscastChance: 0.05,
    holdDiscipline: 0.8,
  },
  expert: {
    bluffMultiplier: 1.0,
    trickFrequencyMultiplier: 1.0,
    miscastChance: 0.02,
    holdDiscipline: 0.95,
  },
};

/**
 * Baseline multipliers (no scaling) used when no difficulty is supplied,
 * preserving the pre-#1067 behavior of {@link estimateCombatTrickProbability}.
 */
const NO_DIFFICULTY_SCALING: CombatTrickDifficultyScaling = {
  bluffMultiplier: 1,
  trickFrequencyMultiplier: 1,
  miscastChance: 0,
  holdDiscipline: 0,
};

/**
 * Get the base tier-keyed combat-trick scaling.
 */
export function getDifficultyTrickScaling(
  difficulty: DifficultyLevel,
): CombatTrickDifficultyScaling {
  return DIFFICULTY_TRICK_SCALING[difficulty];
}

/**
 * Resolve the effective combat-trick scaling for a (tier, format) pair,
 * composing the per-tier base with the per-format difficulty config (#1069).
 *
 * The base multipliers come from {@link DIFFICULTY_TRICK_SCALING}. The
 * `miscastChance` knob is then re-weighted by the ratio of the resolved
 * per-format `blunderChance` to the base tier `blunderChance`, so a format
 * override that raises blunders proportionally raises trick mis-timing and
 * vice-versa. The result is clamped to [0, 1]. When no format is supplied (or
 * the format has no override for the tier) the base scaling is returned
 * unchanged — fully backward compatible.
 */
export function resolveTrickScaling(
  difficulty: DifficultyLevel,
  format?: DifficultyFormat,
): CombatTrickDifficultyScaling {
  const base = DIFFICULTY_TRICK_SCALING[difficulty];
  if (!format) return base;
  const resolved = resolveDifficultyConfig(difficulty, format);
  const baseConfig = DIFFICULTY_CONFIGS[difficulty];
  if (baseConfig.blunderChance <= 0) return base;
  const ratio = resolved.blunderChance / baseConfig.blunderChance;
  const miscastChance = clamp01(base.miscastChance * ratio);
  if (miscastChance === base.miscastChance) return base;
  return { ...base, miscastChance };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function totalMana(mana: OpponentManaState): number {
  return (
    mana.white +
    mana.blue +
    mana.black +
    mana.red +
    mana.green +
    mana.colorless
  );
}

function hasColors(
  mana: OpponentManaState,
  colors: string[],
): boolean {
  for (const color of colors) {
    if (color === "white" && mana.white < 1) return false;
    if (color === "blue" && mana.blue < 1) return false;
    if (color === "black" && mana.black < 1) return false;
    if (color === "red" && mana.red < 1) return false;
    if (color === "green" && mana.green < 1) return false;
  }
  return true;
}

export function estimateCombatTrickProbability(
  opponentMana: OpponentManaState,
  opponentArchetype: OpponentArchetype,
  cardsInHand?: number,
  turnNumber?: number,
  difficulty?: DifficultyLevel,
): CombatTrickEstimate {
  const total = totalMana(opponentMana);

  if (total === 0) {
    return {
      probability: 0,
      estimatedTypes: [],
      confidence: 0.9,
      reasoning: "No open mana — opponent cannot cast instants",
    };
  }

  const weights = ARCHETYPE_TRICK_WEIGHTS[opponentArchetype];
  // Issue #1067: scale trick frequency and bluff credibility by difficulty.
  // When `difficulty` is omitted the multipliers are all 1 (no scaling),
  // preserving the original behavior for existing callers.
  const scaling =
    difficulty === undefined
      ? NO_DIFFICULTY_SCALING
      : DIFFICULTY_TRICK_SCALING[difficulty];

  const manaFactor = Math.min(1, total / 3);
  const archetypeFactor = weights.trickFrequency * scaling.trickFrequencyMultiplier;

  let handFactor = 0.5;
  if (cardsInHand !== undefined) {
    handFactor = Math.min(1, cardsInHand / 5);
  }

  let turnFactor = 0.5;
  if (turnNumber !== undefined) {
    turnFactor = Math.min(1, turnNumber / 6);
  }

  const baseProbability =
    manaFactor * archetypeFactor * handFactor * turnFactor;

  const estimatedTypes: CombatTrickType[] = [];

  if (total >= COMMON_TRICK_CMC.pump) {
    if (weights.pumpWeight > 0.4) estimatedTypes.push("pump");
  }
  if (total >= COMMON_TRICK_CMC.removal) {
    if (weights.removalWeight > 0.4) estimatedTypes.push("removal");
  }
  if (total >= COMMON_TRICK_CMC.toughness_boost) {
    if (weights.pumpWeight > 0.3) estimatedTypes.push("toughness_boost");
  }
  if (total >= COMMON_TRICK_CMC.indestructible) {
    if (opponentArchetype === "control" || opponentArchetype === "midrange") {
      estimatedTypes.push("indestructible");
    }
  }

  const bluffBonus =
    weights.bluffWeight * scaling.bluffMultiplier * (total >= 2 ? 0.1 : 0);
  const probability = Math.min(0.95, baseProbability + bluffBonus);

  const hasRedRemoval = hasColors(opponentMana, ["red"]) && total >= 2;
  if (hasRedRemoval && !estimatedTypes.includes("removal")) {
    estimatedTypes.push("removal");
  }

  const hasWhitePump = hasColors(opponentMana, ["white"]) && total >= 1;
  if (hasWhitePump && !estimatedTypes.includes("pump")) {
    estimatedTypes.push("pump");
  }

  const confidence =
    cardsInHand !== undefined
      ? 0.7 + handFactor * 0.2
      : 0.4 + turnFactor * 0.2;

  const colorReasons: string[] = [];
  if (hasRedRemoval) colorReasons.push("red mana suggests burn/removal");
  if (hasWhitePump) colorReasons.push("white mana suggests pump/protection");

  const difficultyReason =
    difficulty === undefined
      ? ""
      : `; difficulty=${difficulty} (freq×${scaling.trickFrequencyMultiplier.toFixed(2)}, bluff×${scaling.bluffMultiplier.toFixed(2)})`;

  const reasoning = [
    `${total} open mana, archetype=${opponentArchetype}`,
    `base prob=${baseProbability.toFixed(3)}`,
    `expected tricks: [${estimatedTypes.join(", ") || "none"}]`,
    ...colorReasons,
  ].join("; ") + difficultyReason;

  return {
    probability,
    estimatedTypes,
    confidence: Math.min(0.95, confidence),
    reasoning,
  };
}

export function calculateCombatTrickDiscount(
  trickEstimate: CombatTrickEstimate,
  currentEV: number,
  creatureToughness?: number,
): { discountedEV: number; riskAdjustment: number } {
  if (trickEstimate.probability <= 0) {
    return { discountedEV: currentEV, riskAdjustment: 0 };
  }

  const prob = trickEstimate.probability;
  const conf = trickEstimate.confidence;

  const effectiveProb = prob * conf;

  const hasPump = trickEstimate.estimatedTypes.includes("pump");
  const hasRemoval = trickEstimate.estimatedTypes.includes("removal");

  let riskAdjustment = 0;

  if (hasRemoval) {
    riskAdjustment -= effectiveProb * 0.3;
  }

  if (hasPump && creatureToughness !== undefined) {
    const typicalPumpBoost = 2;
    if (creatureToughness <= typicalPumpBoost + 1) {
      riskAdjustment -= effectiveProb * 0.15;
    }
  }

  if (trickEstimate.estimatedTypes.includes("indestructible")) {
    riskAdjustment -= effectiveProb * 0.2;
  }

  const discountedEV = Math.max(-0.5, currentEV + riskAdjustment);

  return { discountedEV, riskAdjustment };
}

/**
 * Input to {@link decideCombatTrickHold} — the AI's own bluff/hold decision
 * for a combat trick it is considering (issue #1067).
 */
export interface CombatTrickHoldInput {
  /** Skill tier of the AI holding/casting the trick. */
  difficulty: DifficultyLevel;
  /** Active format family, used to fold per-format blunder tuning (#1069). */
  format?: DifficultyFormat;
  /** Expected value of casting the trick at the first opportunity. */
  evNow: number;
  /** Expected value of holding for the highest-EV window this combat. */
  evLater: number;
  /**
   * Deterministic randomness source for tests. Defaults to `Math.random`.
   * Each decision consumes up to two rolls (miscast, then discipline).
   */
  rng?: () => number;
}

/**
 * Result of a combat-trick bluff/hold decision.
 */
export interface CombatTrickHoldDecision {
  /** true = hold the trick for a higher-value window; false = cast now. */
  holdForValue: boolean;
  /** true = the early reveal was a mis-timing (forced blunder), not a choice. */
  miscast: boolean;
  /** Human-readable explanation including the tier that drove the decision. */
  reasoning: string;
}

/**
 * Decide whether the AI holds a combat trick for a higher-EV window or casts
 * it now, scaled by difficulty (issue #1067).
 *
 * Behavior by tier:
 * - Easy — high `miscastChance` + low `holdDiscipline` → frequently reveals
 *   held tricks at the first opportunity (the issue's "Easy reveal held tricks
 *   by casting them at the first opportunity").
 * - Expert — low `miscastChance` + high `holdDiscipline` → holds for the
 *   highest-EV window ("Expert hold until the highest-EV window"), only
 *   revealing early when there is no value gain or the discipline roll fails.
 *
 * The decision is deterministic when a fixed `rng` is supplied, which is how
 * the unit tests assert monotonic per-tier behavior without flakiness.
 */
export function decideCombatTrickHold(
  input: CombatTrickHoldInput,
): CombatTrickHoldDecision {
  const scaling = resolveTrickScaling(input.difficulty, input.format);
  const rng = input.rng ?? Math.random;

  // 1) Mis-timing blunder: low-skill tiers reveal early by mistake.
  if (rng() < scaling.miscastChance) {
    return {
      holdForValue: false,
      miscast: true,
      reasoning: `miscast (diff=${input.difficulty}): mis-timed reveal`,
    };
  }

  // 2) Value-hold discipline: hold only when later EV beats now AND the tier's
  //    discipline passes. Higher tiers hold for value far more reliably.
  const valueGain = input.evLater - input.evNow;
  if (valueGain > 0 && rng() < scaling.holdDiscipline) {
    return {
      holdForValue: true,
      miscast: false,
      reasoning: `hold for value (diff=${input.difficulty}): Δev=+${valueGain.toFixed(3)}`,
    };
  }

  return {
    holdForValue: false,
    miscast: false,
    reasoning: `reveal now (diff=${input.difficulty})`,
  };
}

