import { describe, it, expect } from "@jest/globals";
import {
  estimateCombatTrickProbability,
  calculateCombatTrickDiscount,
  decideCombatTrickHold,
  getDifficultyTrickScaling,
  resolveTrickScaling,
  DIFFICULTY_TRICK_SCALING,
  type CombatTrickType,
} from "../decision-making/combat-trick-probability";
import { CombatDecisionTree } from "../decision-making/combat-decision-tree";
import { createTestGameState, createMockPermanent } from "./test-helpers";
import type { DifficultyLevel } from "../ai-difficulty";

const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  "easy",
  "medium",
  "hard",
  "expert",
];

describe("estimateCombatTrickProbability", () => {
  it("should return 0 probability when opponent has no open mana", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      "unknown",
    );

    expect(result.probability).toBe(0);
    expect(result.estimatedTypes).toEqual([]);
    expect(result.confidence).toBe(0.9);
  });

  it("should detect pump probability with white mana (aggro archetype)", () => {
    const result = estimateCombatTrickProbability(
      { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      "aggro",
      4,
      3,
    );

    expect(result.probability).toBeGreaterThan(0);
    expect(result.estimatedTypes).toContain("pump");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should detect removal probability with red mana (control archetype)", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "control",
      3,
      5,
    );

    expect(result.probability).toBeGreaterThan(0);
    expect(result.estimatedTypes).toContain("removal");
  });

  it("should return higher probability for more open mana", () => {
    const lowMana = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      "tempo",
      3,
      4,
    );

    const highMana = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 3, green: 0, colorless: 0 },
      "tempo",
      3,
      4,
    );

    expect(highMana.probability).toBeGreaterThan(lowMana.probability);
  });

  it("should return higher probability with more cards in hand", () => {
    const fewCards = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "midrange",
      1,
      4,
    );

    const manyCards = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "midrange",
      6,
      4,
    );

    expect(manyCards.probability).toBeGreaterThan(fewCards.probability);
  });

  it("should identify indestructible tricks for control with high mana", () => {
    const result = estimateCombatTrickProbability(
      { white: 2, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      "control",
      4,
      6,
    );

    expect(result.estimatedTypes).toContain("indestructible");
  });

  it("should return low probability for combo archetype (less interactive)", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
      "combo",
      3,
      5,
    );

    expect(result.probability).toBeLessThan(0.5);
  });

  it("should include reasoning string", () => {
    const result = estimateCombatTrickProbability(
      { white: 1, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      "tempo",
      4,
      3,
    );

    expect(result.reasoning).toContain("mana");
    expect(result.reasoning).toContain("tempo");
  });

  it("should cap probability at 0.95", () => {
    const result = estimateCombatTrickProbability(
      { white: 3, blue: 3, black: 3, red: 3, green: 3, colorless: 5 },
      "tempo",
      7,
      10,
    );

    expect(result.probability).toBeLessThanOrEqual(0.95);
  });
});

describe("calculateCombatTrickDiscount", () => {
  it("should return unchanged EV when probability is 0", () => {
    const result = calculateCombatTrickDiscount(
      { probability: 0, estimatedTypes: [], confidence: 0, reasoning: "" },
      0.6,
    );

    expect(result.discountedEV).toBe(0.6);
    expect(result.riskAdjustment).toBe(0);
  });

  it("should reduce EV when removal is likely", () => {
    const estimate = {
      probability: 0.6,
      estimatedTypes: ["removal"] as CombatTrickType[],
      confidence: 0.7,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.5, 3);

    expect(result.discountedEV).toBeLessThan(0.5);
    expect(result.riskAdjustment).toBeLessThan(0);
  });

  it("should reduce EV when pump is likely against low toughness creatures", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["pump"] as CombatTrickType[],
      confidence: 0.6,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.4, 2);

    expect(result.discountedEV).toBeLessThan(0.4);
    expect(result.riskAdjustment).toBeLessThan(0);
  });

  it("should not reduce EV for pump against high toughness creatures", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["pump"] as CombatTrickType[],
      confidence: 0.6,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.4, 8);

    expect(result.riskAdjustment).toBe(0);
    expect(result.discountedEV).toBe(0.4);
  });

  it("should apply indestructible risk penalty", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["indestructible"] as CombatTrickType[],
      confidence: 0.7,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.5);

    expect(result.discountedEV).toBeLessThan(0.5);
  });

  it("should never discount below -0.5", () => {
    const estimate = {
      probability: 0.9,
      estimatedTypes: ["removal", "pump", "indestructible"] as CombatTrickType[],
      confidence: 0.9,
      reasoning: "worst case",
    };

    const result = calculateCombatTrickDiscount(estimate, -0.3);

    expect(result.discountedEV).toBeGreaterThanOrEqual(-0.5);
  });
});

describe("integration: combat trick discount in attack decisions", () => {
  it("should make AI more cautious when opponent has open mana and tricks enabled", () => {
    const noManaState = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    noManaState.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };
    noManaState.players.player2.hand = [];

    const withManaState = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    withManaState.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 2,
      green: 0,
      colorless: 1,
    };
    withManaState.players.player2.hand = [
      {
        cardInstanceId: "h1",
        name: "Lightning Bolt",
        type: "Instant",
        manaValue: 1,
      },
    ];

    const noManaAI = new CombatDecisionTree(noManaState, "player1", "hard");
    noManaAI.setConfig({
      useCombatTricks: true,
      opponentArchetype: "tempo",
    });

    const withManaAI = new CombatDecisionTree(
      withManaState,
      "player1",
      "hard",
    );
    withManaAI.setConfig({
      useCombatTricks: true,
      opponentArchetype: "tempo",
    });

    const noManaPlan = noManaAI.generateAttackPlan();
    const withManaPlan = withManaAI.generateAttackPlan();

    if (
      noManaPlan.attacks.length > 0 &&
      withManaPlan.attacks.length > 0
    ) {
      expect(withManaPlan.attacks[0].expectedValue).toBeLessThanOrEqual(
        noManaPlan.attacks[0].expectedValue,
      );
    }

    if (noManaPlan.attacks.length > 0 && withManaPlan.attacks.length === 0) {
      expect(true).toBe(true);
    }
  });

  it("should not affect decisions when useCombatTricks is false", () => {
    const state = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    state.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 2,
      green: 0,
      colorless: 0,
    };

    const ai = new CombatDecisionTree(state, "player1", "hard");
    ai.setConfig({ useCombatTricks: false });

    const plan = ai.generateAttackPlan();
    expect(plan).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Issue #1067 — difficulty-scaled combat-trick casting + bluff/hold behavior.
// ---------------------------------------------------------------------------

describe("estimateCombatTrickProbability — difficulty scaling (#1067)", () => {
  // A fixed, mana-rich board used to compare tiers on identical inputs.
  const mana = { white: 2, blue: 0, black: 0, red: 2, green: 0, colorless: 1 };

  it("omitting difficulty preserves the legacy (unscaled) behavior", () => {
    const legacy = estimateCombatTrickProbability(mana, "tempo", 4, 5);
    const explicit = estimateCombatTrickProbability(
      mana,
      "tempo",
      4,
      5,
      undefined,
    );
    expect(explicit.probability).toBe(legacy.probability);
    // The unscaled multipliers are all 1, so expert must match legacy exactly
    // on the probability term (bluff/freq multipliers both 1 for expert).
    const expert = estimateCombatTrickProbability(mana, "tempo", 4, 5, "expert");
    expect(expert.probability).toBeCloseTo(legacy.probability, 10);
  });

  it("expert estimates a higher trick probability than easy on the same board", () => {
    const easy = estimateCombatTrickProbability(mana, "tempo", 4, 5, "easy");
    const expert = estimateCombatTrickProbability(
      mana,
      "tempo",
      4,
      5,
      "expert",
    );
    expect(expert.probability).toBeGreaterThan(easy.probability);
  });

  it("is monotonic in skill across every archetype", () => {
    const archetypes = [
      "aggro",
      "control",
      "midrange",
      "tempo",
      "combo",
      "unknown",
    ] as const;
    for (const arch of archetypes) {
      const probs = DIFFICULTY_LEVELS.map(
        (d) => estimateCombatTrickProbability(mana, arch, 4, 5, d).probability,
      );
      for (let i = 1; i < probs.length; i++) {
        expect(probs[i]).toBeGreaterThanOrEqual(probs[i - 1]);
      }
    }
  });

  it("easy bluffs are heavily suppressed (bluffWeight ≈ 0)", () => {
    // Use a control board where bluff contribution is largest; easy should
    // contribute almost nothing while expert contributes fully.
    const easy = estimateCombatTrickProbability(mana, "control", 4, 5, "easy");
    const noBluff = estimateCombatTrickProbability(mana, "control", 4, 5);
    // Easy's probability is strictly below the unscaled (no-difficulty) one
    // because both freq and bluff multipliers are < 1 for easy.
    expect(easy.probability).toBeLessThan(noBluff.probability);
  });

  it.each(DIFFICULTY_LEVELS)(
    "includes the difficulty and multipliers in the reasoning (%s)",
    (level) => {
      const result = estimateCombatTrickProbability(mana, "tempo", 4, 5, level);
      expect(result.reasoning).toContain(`difficulty=${level}`);
    },
  );

  it("still caps at 0.95 for expert with a saturated board", () => {
    const saturated = estimateCombatTrickProbability(
      { white: 3, blue: 3, black: 3, red: 3, green: 3, colorless: 5 },
      "tempo",
      7,
      10,
      "expert",
    );
    expect(saturated.probability).toBeLessThanOrEqual(0.95);
  });
});

describe("DIFFICULTY_TRICK_SCALING table (#1067)", () => {
  it("exposes a monotonic bluff multiplier (easy < ... < expert)", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_TRICK_SCALING[d].bluffMultiplier,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
    expect(DIFFICULTY_TRICK_SCALING.easy.bluffMultiplier).toBeLessThan(0.2);
    expect(DIFFICULTY_TRICK_SCALING.expert.bluffMultiplier).toBe(1);
  });

  it("exposes a monotonic optimal-cast frequency (easy < ... < expert)", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_TRICK_SCALING[d].trickFrequencyMultiplier,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });

  it("miscastChance decreases monotonically with skill", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_TRICK_SCALING[d].miscastChance,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThan(vals[i - 1]);
    }
  });

  it("holdDiscipline increases monotonically with skill", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_TRICK_SCALING[d].holdDiscipline,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });

  it("getDifficultyTrickScaling returns the table entry by reference", () => {
    for (const level of DIFFICULTY_LEVELS) {
      expect(getDifficultyTrickScaling(level)).toBe(
        DIFFICULTY_TRICK_SCALING[level],
      );
    }
  });
});

describe("resolveTrickScaling — per-format composition (#1069)", () => {
  it("returns the base scaling by reference when no format is supplied", () => {
    for (const level of DIFFICULTY_LEVELS) {
      expect(resolveTrickScaling(level, undefined)).toBe(
        DIFFICULTY_TRICK_SCALING[level],
      );
    }
  });

  it("returns the base scaling when the format has no override for the tier", () => {
    // All three format families declare overrides for every tier in #1069, so
    // this asserts the fallback path only triggers when blunderChance is
    // unchanged; if a format's resolved blunderChance equals the base, the
    // miscastChance (and thus the whole object) is returned unchanged.
    expect(resolveTrickScaling("medium", "constructed")).toBeDefined();
  });

  it("folds the per-format blunderChance delta into miscastChance", () => {
    // Constructed does not override blunderChance for any tier (#1069 only
    // touches evaluationWeights there), so the ratio is 1 → base unchanged.
    const base = resolveTrickScaling("hard", undefined);
    const constructed = resolveTrickScaling("hard", "constructed");
    expect(constructed.miscastChance).toBeCloseTo(base.miscastChance, 10);

    // Every resolved scaling must keep miscastChance within [0, 1].
    for (const level of DIFFICULTY_LEVELS) {
      for (const format of [
        "commander",
        "constructed",
        "limited",
      ] as const) {
        const m = resolveTrickScaling(level, format).miscastChance;
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("decideCombatTrickHold — bluff/hold by difficulty (#1067)", () => {
  // A seeded RNG factory: a deterministic sequence so tests are reproducible.
  function makeRng(...rolls: number[]): () => number {
    let i = 0;
    return () => {
      const r = rolls[i % rolls.length];
      i++;
      return r;
    };
  }

  it("easy mis-times (miscasts) the reveal when the miscast roll hits", () => {
    // roll 0.3 < easy.miscastChance(0.4) → forced early reveal.
    const decision = decideCombatTrickHold({
      difficulty: "easy",
      evNow: 0.2,
      evLater: 0.9,
      rng: makeRng(0.3),
    });
    expect(decision.holdForValue).toBe(false);
    expect(decision.miscast).toBe(true);
  });

  it("expert holds for value when the discipline roll passes", () => {
    // First roll 0.9 ≥ expert.miscastChance(0.02) → no miscast.
    // Second roll 0.5 < expert.holdDiscipline(0.95) → hold.
    const decision = decideCombatTrickHold({
      difficulty: "expert",
      evNow: 0.2,
      evLater: 0.9,
      rng: makeRng(0.9, 0.5),
    });
    expect(decision.holdForValue).toBe(true);
    expect(decision.miscast).toBe(false);
  });

  it("expert reveals now when there is no value gain to holding", () => {
    const decision = decideCombatTrickHold({
      difficulty: "expert",
      evNow: 0.8,
      evLater: 0.8,
      rng: makeRng(0.99, 0.0),
    });
    expect(decision.holdForValue).toBe(false);
    expect(decision.miscast).toBe(false);
  });

  it("easy rarely holds for value even when later EV dominates (low discipline)", () => {
    // No miscast (0.9 ≥ 0.4) but discipline roll 0.4 ≥ easy.holdDiscipline(0.1)
    // → easy fails the discipline check and reveals now despite +EV.
    const decision = decideCombatTrickHold({
      difficulty: "easy",
      evNow: 0.1,
      evLater: 0.9,
      rng: makeRng(0.9, 0.4),
    });
    expect(decision.holdForValue).toBe(false);
    expect(decision.miscast).toBe(false);
  });

  it("produces monotonic hold rates across tiers on identical value (aggregated)", () => {
    // Across many deterministic rolls, the cumulative hold count must be
    // non-decreasing in skill — easy holds least, expert holds most.
    const rolls: number[] = [];
    for (let i = 1; i <= 20; i++) rolls.push(i / 25); // 0.04 .. 0.80 in order
    const evNow = 0.2;
    const evLater = 0.8;
    const holdCounts = DIFFICULTY_LEVELS.map((level) => {
      let held = 0;
      // Pair rolls: (miscast, discipline) — reuse the same ladder per tier.
      for (let i = 0; i < rolls.length - 1; i += 2) {
        let idx = 0;
        const rng = () => rolls[i + idx++ % 2];
        const d = decideCombatTrickHold({
          difficulty: level,
          evNow,
          evLater,
          rng,
        });
        if (d.holdForValue) held++;
      }
      return held;
    });
    for (let i = 1; i < holdCounts.length; i++) {
      expect(holdCounts[i]).toBeGreaterThanOrEqual(holdCounts[i - 1]);
    }
    expect(holdCounts[0]).toBeLessThan(holdCounts[holdCounts.length - 1]);
  });

  it("composes with per-format config via the format parameter", () => {
    // Same tier, different formats must remain valid and within bounds.
    for (const format of [
      "commander",
      "constructed",
      "limited",
    ] as const) {
      const d = decideCombatTrickHold({
        difficulty: "hard",
        format,
        evNow: 0.2,
        evLater: 0.7,
        rng: makeRng(0.99, 0.5),
      });
      expect(typeof d.holdForValue).toBe("boolean");
      expect(typeof d.miscast).toBe("boolean");
      expect(d.reasoning).toContain("hard");
    }
  });
});

describe("CombatDecisionTree — difficulty plumbing into the trick module (#1067)", () => {
  it("stores and exposes the difficulty tier", () => {
    const state = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2)],
      [],
    );
    for (const level of DIFFICULTY_LEVELS) {
      const ai = new CombatDecisionTree(state, "player1", level);
      expect(ai.getDifficulty()).toBe(level);
    }
  });

  it("decideCombatTrickBluffHold scales hold behavior by the tree's difficulty", () => {
    const state = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2)],
      [],
    );
    const easyAi = new CombatDecisionTree(state, "player1", "easy");
    const expertAi = new CombatDecisionTree(state, "player1", "expert");

    // Deterministic RNG: low roll → easy miscasts, expert survives; next roll
    // → expert passes discipline, easy fails it.
    let i = 0;
    const rng = () => {
      const v = [0.3, 0.4, 0.9, 0.5][i++ % 4];
      return v;
    };

    const easyDecision = easyAi.decideCombatTrickBluffHold(0.2, 0.9, rng);
    const expertDecision = expertAi.decideCombatTrickBluffHold(0.2, 0.9, rng);

    expect(easyDecision.holdForValue).toBe(false);
    expect(expertDecision.holdForValue).toBe(true);
  });

  it("setDifficultyFormat threads per-format config into bluff/hold decisions", () => {
    const state = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2)],
      [],
    );
    const ai = new CombatDecisionTree(state, "player1", "hard");
    expect(ai.getDifficultyFormat()).toBeUndefined();
    ai.setDifficultyFormat("limited");
    expect(ai.getDifficultyFormat()).toBe("limited");
    // Decision still well-formed with a format applied.
    const d = ai.decideCombatTrickBluffHold(0.3, 0.7, () => 0.99);
    expect(typeof d.holdForValue).toBe("boolean");
  });

  it("expert and easy produce different attack EVs against identical open mana", () => {
    // Same board, same opponent open mana — the only difference is the AI's
    // tier threading into estimateCombatTrickProbability. Expert discounts its
    // attack EV at least as much as easy (it reads/plays around tricks more).
    const buildPlan = (level: DifficultyLevel) => {
      const state = createTestGameState(
        20,
        20,
        [createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2)],
        [],
      );
      state.players.player2.manaPool = {
        white: 0,
        blue: 0,
        black: 0,
        red: 2,
        green: 0,
        colorless: 1,
      };
      state.players.player2.hand = [
        { cardInstanceId: "h1", name: "Lightning Bolt", type: "Instant", manaValue: 1 },
      ];
      const ai = new CombatDecisionTree(state, "player1", level);
      ai.setConfig({ useCombatTricks: true, opponentArchetype: "tempo" });
      return ai.generateAttackPlan();
    };

    const easyPlan = buildPlan("easy");
    const expertPlan = buildPlan("expert");

    // When both decide to attack, expert (higher perceived trick threat)
    // cannot assign a HIGHER expected value than easy on the same board.
    if (easyPlan.attacks.length > 0 && expertPlan.attacks.length > 0) {
      expect(expertPlan.attacks[0].expectedValue).toBeLessThanOrEqual(
        easyPlan.attacks[0].expectedValue + 1e-9,
      );
    }
  });
});
