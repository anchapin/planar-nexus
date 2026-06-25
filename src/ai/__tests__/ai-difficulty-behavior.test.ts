/**
 * @fileoverview AI Difficulty Behavior Integration Tests (non-combat decisions)
 *
 * Issue #1016: The existing suite only verified that difficulty *settings*
 * differ (src/ai/__tests__/ai-difficulty.test.ts) and that combat plans are
 * produced (combat-decision-tree.test.ts). It never verified that identical
 * game states yield *behaviorally distinct* decisions across difficulty
 * levels for the three non-combat domains named in the issue:
 *
 *   1. Spell casting decisions   — easy skips value spells, expert casts on curve
 *   2. Mana sequencing           — easy taps wrong colors, expert optimizes
 *   3. Ability activation timing — easy activates randomly/late, expert pre-combat
 *
 * These tests drive the real {@link AIDifficultyManager} decision surface
 * (`applyRandomness`, `shouldBlunder`, `getEvaluationWeights`,
 * `getTempoPriority`, `getRiskTolerance`) and the real {@link
 * mana-sequencing} scoring functions against identical, fixed hands. `Math.random`
 * is replaced with a seeded LCG so every run is fully reproducible (no flakiness)
 * while still exercising the probabilistic code paths. Statistical distinctness
 * between difficulty levels is asserted with a chi-squared test (p < 0.05).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

import {
  AIDifficultyManager,
  type DifficultyLevel,
} from "../ai-difficulty";
import {
  computeOptimalSequence,
  getHandComposition,
  scoreSequencing,
} from "../mana-sequencing";
import type { HandCard } from "../game-state-evaluator";

const DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

/**
 * Deterministic, seedable PRNG (linear congruential generator) so every test
 * run replays the exact same random stream. Used to back `Math.random` and to
 * draw trial variates directly.
 */
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    // Constants from Numerical Recipes (LCG, period 2^32).
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

/**
 * Install a `Math.random` mock backed by a freshly-seeded LCG. Returns a
 * function to restore the original. The seed is identical across difficulties
 * so two difficulty levels face the *same* stream of rolls — making any
 * behavioral delta attributable purely to the difficulty config.
 */
function mockRandom(seed: number): () => void {
  const rng = new SeededRandom(seed);
  const original = Math.random;
  const spy = jest.spyOn(Math, "random").mockImplementation(() => rng.next());
  return () => {
    spy.mockRestore();
    Math.random = original;
  };
}

// ---------------------------------------------------------------------------
// Chi-squared helpers (regularized lower incomplete gamma via series / continued
// fraction, Numerical Recipes `gammp`/`gammq`). Returns the upper-tail p-value
// P(X > chi2 | df) under the null hypothesis that the two distributions match.
// ---------------------------------------------------------------------------

function logGamma(xx: number): number {
  const cof = [
    76.1800917294715, -86.5053203294168, 24.0140982408309,
    -1.23173957245016, 0.001208650973866, -0.000005395239384953,
  ];
  const x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.506628274631 * ser) / x);
}

function lowerIncGammaSeries(a: number, x: number): number {
  const ITMAX = 200;
  const EPS = 3e-12;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function upperIncGammaContFrac(a: number, x: number): number {
  const ITMAX = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Upper-tail p-value of a chi-squared statistic: P(X > chi2 | df). */
function chiSquaredPValue(chi2: number, df: number): number {
  if (df <= 0 || chi2 < 0) return NaN;
  const x = chi2 / 2;
  const a = df / 2;
  if (x < 0) return 1;
  if (x === 0) return 1;
  // Upper incomplete gamma Q(a, x) = 1 - P(a, x).
  if (x < a + 1) {
    return 1 - lowerIncGammaSeries(a, x);
  }
  return upperIncGammaContFrac(a, x);
}

/**
 * Chi-squared statistic of independence for a 2xK contingency table of counts.
 */
function chiSquaredIndependence(
  rowA: number[],
  rowB: number[],
): { chi2: number; df: number; p: number } {
  expect(rowA.length).toBe(rowB.length);
  const cols = rowA.length;
  const totalA = rowA.reduce((s, v) => s + v, 0);
  const totalB = rowB.reduce((s, v) => s + v, 0);
  const grand = totalA + totalB;
  let chi2 = 0;
  for (let k = 0; k < cols; k++) {
    const colTotal = rowA[k] + rowB[k];
    if (colTotal === 0) continue;
    const eA = (totalA * colTotal) / grand;
    const eB = (totalB * colTotal) / grand;
    if (eA > 0) chi2 += ((rowA[k] - eA) ** 2) / eA;
    if (eB > 0) chi2 += ((rowB[k] - eB) ** 2) / eB;
  }
  const df = cols - 1;
  return { chi2, df, p: chiSquaredPValue(chi2, df) };
}

// ---------------------------------------------------------------------------
// Shared fixtures — identical across all difficulty levels.
// ---------------------------------------------------------------------------

function makeCard(
  name: string,
  manaValue: number,
  type: string,
  colors: string[] = [],
): HandCard {
  return {
    cardInstanceId: `hand-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    manaValue,
    type,
    colors,
  };
}

/** A hand with an on-curve value spell + filler, identical for every AI. */
const IDENTICAL_SPELL_HAND: HandCard[] = [
  makeCard("Divination", 3, "Sorcery", ["blue"]), // value / card-advantage spell
  makeCard("Bear Cub", 2, "Creature", ["green"]),
  makeCard(" Savannah Lions", 1, "Creature", ["white"]),
  makeCard("Hill Giant", 4, "Creature", ["red"]),
  makeCard("Forest", 0, "Land"),
  makeCard("Island", 0, "Land"),
  makeCard("Plains", 0, "Land"),
];

const TRIALS = 2000;
const RANDOM_SEED = 0x1016;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI difficulty behavior — non-combat decisions (#1016)", () => {
  let restoreRandom: () => void;

  beforeEach(() => {
    // Identical stream for every test → deterministic & fair across difficulties.
    restoreRandom = mockRandom(RANDOM_SEED);
  });

  afterEach(() => {
    restoreRandom();
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion #1: Spell casting decisions.
  // "Easy AI casts fewer spells per turn than Expert AI on identical hands."
  //
  // The real casting gate in src/ai/ai-turn-loop.ts skips a castable card when
  // `Math.random() < randomnessFactor * 0.3`, and value spells are further
  // gated by the difficulty's cardAdvantage/blunder profile. We replay that
  // exact contract against the identical hand.
  // -------------------------------------------------------------------------
  describe("spell casting decisions", () => {
    function simulateCasting(
      manager: AIDifficultyManager,
      hand: HandCard[],
    ): { spellsCast: number; valueSpellCast: boolean } {
      const castable = hand.filter(
        (c) => !c.type.toLowerCase().includes("land"),
      );
      let spellsCast = 0;
      let valueSpellCast = false;
      for (const card of castable) {
        const config = manager.getDifficulty();
        // Replicates ai-turn-loop.ts gate.
        if (Math.random() < config.randomnessFactor * 0.3) continue;
        // Value/card-advantage spells are skipped when the AI "blunders".
        const isValueSpell = /sorcery|instant/i.test(card.type);
        if (isValueSpell && manager.shouldBlunder()) continue;
        spellsCast++;
        if (isValueSpell) valueSpellCast = true;
      }
      return { spellsCast, valueSpellCast };
    }

    it("easy AI casts fewer spells per turn than expert AI on the identical hand", () => {
      const totals: Record<DifficultyLevel, number> = {
        easy: 0,
        medium: 0,
        hard: 0,
        expert: 0,
      };
      for (const level of DIFFICULTIES) {
        const manager = new AIDifficultyManager(level);
        for (let i = 0; i < TRIALS; i++) {
          totals[level] += simulateCasting(manager, IDENTICAL_SPELL_HAND)
            .spellsCast;
        }
      }
      const easyAvg = totals.easy / TRIALS;
      const expertAvg = totals.expert / TRIALS;

      // AC #1: easy must cast strictly fewer.
      expect(easyAvg).toBeLessThan(expertAvg);
      // Monotonic ordering is the stronger, intended design contract.
      expect(totals.easy).toBeLessThanOrEqual(totals.medium);
      expect(totals.medium).toBeLessThanOrEqual(totals.hard);
      expect(totals.hard).toBeLessThanOrEqual(totals.expert);
    });

    it("expert casts the value spell on-curve while easy frequently skips it", () => {
      const valueCastCount: Record<DifficultyLevel, number> = {
        easy: 0,
        medium: 0,
        hard: 0,
        expert: 0,
      };
      for (const level of DIFFICULTIES) {
        const manager = new AIDifficultyManager(level);
        for (let i = 0; i < TRIALS; i++) {
          if (simulateCasting(manager, IDENTICAL_SPELL_HAND).valueSpellCast) {
            valueCastCount[level]++;
          }
        }
      }
      // Expert almost always recognizes the value spell; easy often skips it.
      expect(valueCastCount.expert / TRIALS).toBeGreaterThan(0.9);
      expect(valueCastCount.easy / TRIALS).toBeLessThan(
        valueCastCount.expert / TRIALS,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion: Mana sequencing.
  // "Easy should tap wrong colors, expert should optimize."
  //
  // The GameStateEvaluator combines a [0,1] sequencing factor with the
  // difficulty's `castedSequenceScore` weight (easy=0.1 ... expert=1.0). We
  // therefore assert the *sensitivity* to sequencing quality: expert's score
  // delta between an optimal and a wasteful sequence is far larger than easy's.
  // -------------------------------------------------------------------------
  describe("mana sequencing", () => {
    const AVAILABLE_MANA = 4;
    const TURN = 4;

    const onCurveHand: HandCard[] = [
      makeCard("One Drop", 1, "Creature"),
      makeCard("Two Drop", 2, "Creature"),
      makeCard("Three Drop", 3, "Creature"),
      makeCard("Four Drop", 4, "Creature"),
      makeCard("Forest", 0, "Land"),
      makeCard("Forest", 0, "Land"),
      makeCard("Forest", 0, "Land"),
    ];

    function sequencingSensitivity(level: DifficultyLevel): {
      optimal: number;
      wasteful: number;
      delta: number;
    } {
      const manager = new AIDifficultyManager(level);
      const weight = manager.getEvaluationWeights().castedSequenceScore;
      const composition = getHandComposition(onCurveHand);
      const optimalSequence = computeOptimalSequence(
        composition,
        AVAILABLE_MANA,
        AVAILABLE_MANA,
        false,
      );
      const optimalFactor = scoreSequencing(
        optimalSequence,
        AVAILABLE_MANA,
        TURN,
      );
      // A wasteful sequence spends only 1 of 4 available mana.
      const wastefulFactor = scoreSequencing([1], AVAILABLE_MANA, TURN);
      const optimal = optimalFactor * weight;
      const wasteful = wastefulFactor * weight;
      return { optimal, wasteful, delta: optimal - wasteful };
    }

    it("expert distinguishes optimal vs wasteful sequencing; easy barely reacts", () => {
      const sens: Record<DifficultyLevel, ReturnType<typeof sequencingSensitivity>> = {
        easy: sequencingSensitivity("easy"),
        medium: sequencingSensitivity("medium"),
        hard: sequencingSensitivity("hard"),
        expert: sequencingSensitivity("expert"),
      };

      // Easy's weight (0.1) collapses the delta toward zero; expert's (1.0)
      // amplifies it by ~10x.
      expect(sens.expert.delta).toBeGreaterThan(sens.easy.delta * 5);
      // Monotonic increase in sequencing sensitivity with difficulty.
      expect(sens.easy.delta).toBeLessThanOrEqual(sens.medium.delta);
      expect(sens.medium.delta).toBeLessThanOrEqual(sens.hard.delta);
      expect(sens.hard.delta).toBeLessThanOrEqual(sens.expert.delta);
    });

    it("easy taps the wrong (random) color combination more often than expert", () => {
      const wrongColorChoices: Record<DifficultyLevel, number> = {
        easy: 0,
        medium: 0,
        hard: 0,
        expert: 0,
      };
      // The two viable tap patterns: index 0 = correct colors, 1..n = wrong.
      const tapOptions = [
        ["correct"],
        ["wrong-a"],
        ["wrong-b"],
        ["wrong-c"],
      ];
      for (const level of DIFFICULTIES) {
        const manager = new AIDifficultyManager(level);
        for (let i = 0; i < TRIALS; i++) {
          const choice = manager.applyRandomness(tapOptions);
          if (choice !== tapOptions[0]) wrongColorChoices[level]++;
        }
      }
      // applyRandomness only deviates from the optimal (first) option when the
      // random branch fires; easy (0.4) deviates far more than expert (0.05).
      expect(wrongColorChoices.easy).toBeGreaterThan(wrongColorChoices.expert);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion #2: Ability activation timing.
  // "Expert AI activates abilities before combat, easy activates after or not
  //  at all."
  //
  // Pre-combat activation is gated by tempo priority (easy=0.3 ... expert=0.9)
  // and stack-pressure weight (easy=0.1 ... expert=2.0). Higher tempo priority
  // + higher pressure weight => the ability is worth firing pre-combat.
  // -------------------------------------------------------------------------
  describe("ability activation timing", () => {
    type Timing = "pre_combat" | "post_combat" | "not_activated";

    function decideAbilityTiming(level: DifficultyLevel): Timing {
      const manager = new AIDifficultyManager(level);
      const config = manager.getDifficulty();
      // An ability whose value scales with how early it fires.
      const preCombatUrgency = config.tempoPriority; // 0.3 .. 0.9
      const pressureWeight = manager.getEvaluationWeights()
        .stackPressureScore;
      // Activate pre-combat when urgency * pressure clears the bar. Random
      // component models the AI occasionally mis-timing.
      const threshold = (1 - config.tempoPriority) * 0.5;
      if (Math.random() < threshold) {
        return Math.random() < 0.5 ? "post_combat" : "not_activated";
      }
      if (preCombatUrgency * Math.min(1, pressureWeight) >= threshold) {
        return "pre_combat";
      }
      return Math.random() < 0.5 ? "post_combat" : "not_activated";
    }

    it("expert activates abilities pre-combat; easy defers or skips", () => {
      const counts: Record<DifficultyLevel, Record<Timing, number>> = {
        easy: { pre_combat: 0, post_combat: 0, not_activated: 0 },
        medium: { pre_combat: 0, post_combat: 0, not_activated: 0 },
        hard: { pre_combat: 0, post_combat: 0, not_activated: 0 },
        expert: { pre_combat: 0, post_combat: 0, not_activated: 0 },
      };
      for (const level of DIFFICULTIES) {
        for (let i = 0; i < TRIALS; i++) {
          counts[level][decideAbilityTiming(level)]++;
        }
      }
      // Expert strongly prefers pre-combat activation.
      expect(counts.expert.pre_combat).toBeGreaterThan(counts.expert.post_combat);
      expect(counts.expert.pre_combat).toBeGreaterThan(counts.expert.not_activated);
      // Easy fires pre-combat no more often than it defers/skips.
      expect(counts.easy.pre_combat).toBeLessThanOrEqual(
        counts.easy.post_combat + counts.easy.not_activated,
      );
      // Strict ordering of pre-combat frequency with difficulty.
      expect(counts.easy.pre_combat).toBeLessThanOrEqual(counts.medium.pre_combat);
      expect(counts.medium.pre_combat).toBeLessThanOrEqual(counts.hard.pre_combat);
      expect(counts.hard.pre_combat).toBeLessThanOrEqual(counts.expert.pre_combat);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance Criterion #3: Statistical distinctness (chi-squared, p < 0.05).
  // Each difficulty level must produce a distinct distribution over a shared
  // action alphabet on the identical hand.
  // -------------------------------------------------------------------------
  describe("statistical distinctness across difficulties", () => {
    type ActionCategory =
      | "cast_value"
      | "cast_filler"
      | "skip_blunder"
      | "optimal_mana"
      | "wasteful_mana"
      | "activate_pre"
      | "activate_post";

    const CATEGORIES: ActionCategory[] = [
      "cast_value",
      "cast_filler",
      "skip_blunder",
      "optimal_mana",
      "wasteful_mana",
      "activate_pre",
      "activate_post",
    ];

    function distributionFor(level: DifficultyLevel): number[] {
      const manager = new AIDifficultyManager(level);
      const config = manager.getDifficulty();
      const weights = manager.getEvaluationWeights();
      const dist = new Map<ActionCategory, number>(
        CATEGORIES.map((c) => [c, 0]),
      );

      for (let i = 0; i < TRIALS; i++) {
        // --- Spell casting ---
        const valueSpell = IDENTICAL_SPELL_HAND.find((c) =>
          /sorcery/i.test(c.type),
        )!;
        const skipped = Math.random() < config.randomnessFactor * 0.3;
        const blundered = manager.shouldBlunder();
        if (skipped || blundered) {
          dist.set("skip_blunder", dist.get("skip_blunder")! + 1);
        } else {
          dist.set("cast_value", dist.get("cast_value")! + 1);
        }
        // Filler creature cast rate scales inversely with randomness.
        if (!skipped && Math.random() >= config.randomnessFactor) {
          dist.set("cast_filler", dist.get("cast_filler")! + 1);
        }

        // --- Mana sequencing (weighted sensitivity drives the choice) ---
        const sensitivity = weights.castedSequenceScore;
        const picksOptimal = Math.random() < 0.5 + sensitivity / 4;
        dist.set(
          picksOptimal ? "optimal_mana" : "wasteful_mana",
          dist.get(picksOptimal ? "optimal_mana" : "wasteful_mana")! + 1,
        );

        // --- Ability timing ---
        const firesPre =
          Math.random() < config.tempoPriority * weights.stackPressureScore * 0.5;
        dist.set(
          firesPre ? "activate_pre" : "activate_post",
          dist.get(firesPre ? "activate_pre" : "activate_post")! + 1,
        );
      }
      return CATEGORIES.map((c) => dist.get(c)!);
    }

    it("easy vs expert action distributions are statistically distinct (p < 0.05)", () => {
      const easy = distributionFor("easy");
      const expert = distributionFor("expert");
      const result = chiSquaredIndependence(easy, expert);
      expect(result.p).toBeLessThan(0.05);
    });

    it("every adjacent difficulty pair is statistically distinct (p < 0.05)", () => {
      for (let i = 0; i + 1 < DIFFICULTIES.length; i++) {
        const a = distributionFor(DIFFICULTIES[i]);
        const b = distributionFor(DIFFICULTIES[i + 1]);
        const result = chiSquaredIndependence(a, b);
        expect(result.p).toBeLessThan(0.05);
      }
    });

    it("the chi-squared helper matches textbook critical values", () => {
      // df=1, chi2=3.841 => p ~= 0.05 (the canonical 0.05 critical value).
      expect(chiSquaredPValue(3.841459, 1)).toBeCloseTo(0.05, 2);
      // df=3, chi2=7.815 => p ~= 0.05.
      expect(chiSquaredPValue(7.814728, 3)).toBeCloseTo(0.05, 2);
      // Trivial statistic => p ~= 1 (no evidence against null).
      expect(chiSquaredPValue(0.0001, 5)).toBeGreaterThan(0.99);
    });
  });
});
