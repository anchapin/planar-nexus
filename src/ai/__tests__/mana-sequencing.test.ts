/**
 * @fileoverview Unit Tests for Mana Sequencing Module
 */

import { describe, it, expect } from "@jest/globals";
import {
  getHandComposition,
  computeOptimalSequence,
  scoreSequencing,
  evaluateLandDropTiming,
  getSequencingRecommendation,
  computeCurveConformance,
  DIFFICULTY_MANA_SEQUENCING_SCALING,
  getDifficultyManaSequencingScaling,
  resolveManaSequencingScaling,
} from "../mana-sequencing";
import type { DifficultyLevel, DifficultyFormat } from "../ai-difficulty";
import type { HandCard } from "../game-state-evaluator";

function makeCard(
  name: string,
  manaValue: number,
  type: string = "Creature",
): HandCard {
  return {
    cardInstanceId: `hand-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    manaValue,
    type,
    colors: [],
  };
}

function makeLand(name: string): HandCard {
  return makeCard(name, 0, "Land");
}

describe("getHandComposition", () => {
  it("should bucket spells by cmc", () => {
    const hand = [
      makeCard("Bear", 2),
      makeCard("Lightning Bolt", 1),
      makeCard("Cancel", 3),
      makeLand("Forest"),
    ];

    const comp = getHandComposition(hand);

    expect(comp.landCount).toBe(1);
    expect(comp.spellCount).toBe(3);
    expect(comp.cmcBuckets[1]).toBe(1);
    expect(comp.cmcBuckets[2]).toBe(1);
    expect(comp.cmcBuckets[3]).toBe(1);
  });

  it("should clamp cmc to 7", () => {
    const hand = [makeCard("Ultimatum", 10)];

    const comp = getHandComposition(hand);

    expect(comp.cmcBuckets[7]).toBe(1);
  });

  it("should handle empty hand", () => {
    const comp = getHandComposition([]);

    expect(comp.landCount).toBe(0);
    expect(comp.spellCount).toBe(0);
    expect(comp.cmcBuckets.every((b) => b === 0)).toBe(true);
  });
});

describe("computeOptimalSequence", () => {
  it("should produce [1, 2] for 3 mana with 1-drop and 2-drop available", () => {
    const hand = [
      makeCard("Savannah Lions", 1),
      makeCard("Grizzly Bears", 2),
      makeLand("Plains"),
    ];
    const comp = getHandComposition(hand);

    const sequence = computeOptimalSequence(comp, 3, 2);

    expect(sequence).toEqual([1, 2]);
  });

  it("should produce [3] when only a 3-drop fits in 3 mana", () => {
    const hand = [makeCard("Centaur", 3)];
    const comp = getHandComposition(hand);

    const sequence = computeOptimalSequence(comp, 3, 2);

    expect(sequence).toEqual([3]);
  });

  it("should produce empty for 0 mana", () => {
    const hand = [makeCard("Bear", 2)];
    const comp = getHandComposition(hand);

    const sequence = computeOptimalSequence(comp, 0, 0);

    expect(sequence).toEqual([]);
  });

  it("should use all mana efficiently for [1, 1, 1] in 3 mana", () => {
    const hand = [
      makeCard("Lantern", 1),
      makeCard("Ornithopter", 1),
      makeCard("Memnite", 1),
    ];
    const comp = getHandComposition(hand);

    const sequence = computeOptimalSequence(comp, 3, 3);

    expect(sequence).toEqual([1, 1, 1]);
  });

  it("should handle checklands by reducing effective mana", () => {
    const hand = [
      makeCard("Savannah Lions", 1),
      makeCard("Grizzly Bears", 2),
      makeCard("Centaur", 3),
    ];
    const comp = getHandComposition(hand);

    const normal = computeOptimalSequence(comp, 3, 3, false);
    const withCheck = computeOptimalSequence(comp, 3, 3, true);

    expect(normal.length).toBeGreaterThan(withCheck.length);
  });
});

describe("scoreSequencing", () => {
  it("should score perfect mana utilization highly", () => {
    const sequence = [1, 2];

    const score = scoreSequencing(sequence, 3, 3);

    expect(score).toBeGreaterThan(0.5);
  });

  it("should score empty sequence as 0", () => {
    const score = scoreSequencing([], 3, 2);

    expect(score).toBe(0);
  });

  it("should reward multi-drop on early turns", () => {
    const single = scoreSequencing([3], 3, 3);
    const multi = scoreSequencing([1, 2], 3, 3);

    expect(multi).toBeGreaterThan(single);
  });
});

describe("evaluateLandDropTiming", () => {
  it("should penalize having no lands in hand", () => {
    const score = evaluateLandDropTiming(0, 0, 1);

    expect(score).toBe(-0.5);
  });

  it("should reward being ahead on land drops", () => {
    const score = evaluateLandDropTiming(2, 4, 4);

    expect(score).toBeGreaterThan(0.5);
  });

  it("should penalize tapped lands early", () => {
    const untapped = evaluateLandDropTiming(1, 2, 3, false, 0);
    const tapped = evaluateLandDropTiming(1, 2, 3, false, 1);

    expect(untapped).toBeGreaterThan(tapped);
  });

  it("should handle checklands penalty", () => {
    const noCheck = evaluateLandDropTiming(1, 2, 3, false, 0);
    const withCheck = evaluateLandDropTiming(1, 2, 3, true, 0);

    expect(noCheck).toBeGreaterThan(withCheck);
  });
});

describe("getSequencingRecommendation", () => {
  it("should recommend 1-drop into 2-drop on turn 2", () => {
    const hand = [
      makeCard("Savannah Lions", 1),
      makeCard("Grizzly Bears", 2),
      makeLand("Plains"),
      makeLand("Forest"),
    ];

    const rec = getSequencingRecommendation(hand, 2, 2, 2);

    expect(rec.castOrder).toEqual([1]);
    expect(rec.score).toBeGreaterThan(0);
  });

  it("should prefer playing on curve over holding for bigger drop", () => {
    const hand = [
      makeCard("Savannah Lions", 1),
      makeCard("Grizzly Bears", 2),
      makeLand("Plains"),
      makeLand("Forest"),
    ];

    const rec = getSequencingRecommendation(hand, 2, 2, 2);

    expect(rec.castOrder.length).toBeGreaterThanOrEqual(1);
  });

  it("should add reasoning for tapped lands", () => {
    const hand = [makeCard("Bear", 2), makeLand("Dimir Guildgate")];

    const rec = getSequencingRecommendation(hand, 1, 1, 2, false, 1);

    expect(rec.reasoning.length).toBeGreaterThan(0);
    expect(rec.reasoning.some((r) => r.toLowerCase().includes("tapped"))).toBe(
      true,
    );
  });

  it("should add reasoning for no land drops", () => {
    const hand = [makeCard("Bear", 2), makeCard("Lion", 1)];

    const rec = getSequencingRecommendation(hand, 2, 2, 2);

    expect(rec.reasoning.some((r) => r.includes("No land"))).toBe(true);
  });
});

describe("computeCurveConformance", () => {
  it("should score well for an ideal curve hand", () => {
    const hand = [
      makeCard("Lantern", 1),
      makeCard("Bear", 2),
      makeCard("Bear2", 2),
      makeCard("Centaur", 3),
      makeLand("Forest"),
      makeLand("Forest2"),
    ];

    const score = computeCurveConformance(hand);

    expect(score).toBeGreaterThan(0);
  });

  it("should score poorly for top-heavy hand", () => {
    const hand = [
      makeCard("Dragon", 6),
      makeCard("Titan", 5),
      makeCard("Giant", 4),
    ];

    const score = computeCurveConformance(hand);

    expect(score).toBeLessThan(0);
  });

  it("should return 0 for empty hand", () => {
    const score = computeCurveConformance([]);

    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #990 — difficulty-scaled mana-sequencing recommendations.
//
// Mirrors the structure of combat-trick-probability.test.ts (#1067): a per-tier
// scaling table, a format-composing resolver, and difficulty-keyed degradation
// in computeOptimalSequence / scoreSequencing / evaluateLandDropTiming /
// getSequencingRecommendation. All rolls are driven by an injected `rng` so
// every assertion is deterministic (no flakiness).
// ---------------------------------------------------------------------------

const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  "easy",
  "medium",
  "hard",
  "expert",
];

/** RNG that always returns a value above every mistake threshold (no blunder). */
const NO_BLUNDER_RNG = () => 0.99;
/** RNG that always returns a value below every mistake threshold (always blunder). */
const ALWAYS_BLUNDER_RNG = () => 0.0;
/**
 * A roll that lands above expert's wasteChance (0.02) but below easy's (0.4),
 * medium's (0.15) and hard's (0.05) → distinguishes expert from the lower
 * tiers without forcing every tier to blunder.
 */
const EASY_ONLY_BLUNDER_ROLL = 0.1;

describe("DIFFICULTY_MANA_SEQUENCING_SCALING table (#990)", () => {
  it("exposes a monotonic wasteChance (decreasing in skill)", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_MANA_SEQUENCING_SCALING[d].wasteChance,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThan(vals[i - 1]);
    }
    // Easy frequently wastes; expert almost never.
    expect(DIFFICULTY_MANA_SEQUENCING_SCALING.easy.wasteChance).toBeGreaterThan(
      0.3,
    );
    expect(
      DIFFICULTY_MANA_SEQUENCING_SCALING.expert.wasteChance,
    ).toBeLessThanOrEqual(0.05);
  });

  it("exposes a monotonic efficiencyMultiplier (increasing in skill)", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_MANA_SEQUENCING_SCALING[d].efficiencyMultiplier,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
    expect(DIFFICULTY_MANA_SEQUENCING_SCALING.expert.efficiencyMultiplier).toBe(
      1,
    );
  });

  it("exposes a monotonic misorderChance (decreasing in skill)", () => {
    const vals = DIFFICULTY_LEVELS.map(
      (d) => DIFFICULTY_MANA_SEQUENCING_SCALING[d].misorderChance,
    );
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThan(vals[i - 1]);
    }
    expect(DIFFICULTY_MANA_SEQUENCING_SCALING.expert.misorderChance).toBe(0);
  });

  it("getDifficultyManaSequencingScaling returns the table entry by reference", () => {
    for (const level of DIFFICULTY_LEVELS) {
      expect(getDifficultyManaSequencingScaling(level)).toBe(
        DIFFICULTY_MANA_SEQUENCING_SCALING[level],
      );
    }
  });
});

describe("resolveManaSequencingScaling — per-format composition (#990/#1069)", () => {
  it("returns the base scaling by reference when no format is supplied", () => {
    for (const level of DIFFICULTY_LEVELS) {
      expect(resolveManaSequencingScaling(level, undefined)).toBe(
        DIFFICULTY_MANA_SEQUENCING_SCALING[level],
      );
    }
  });

  it("keeps every resolved mistake chance within [0, 1] across all formats", () => {
    for (const level of DIFFICULTY_LEVELS) {
      for (const format of [
        "commander",
        "constructed",
        "limited",
      ] as DifficultyFormat[]) {
        const s = resolveManaSequencingScaling(level, format);
        expect(s.wasteChance).toBeGreaterThanOrEqual(0);
        expect(s.wasteChance).toBeLessThanOrEqual(1);
        expect(s.misorderChance).toBeGreaterThanOrEqual(0);
        expect(s.misorderChance).toBeLessThanOrEqual(1);
      }
    }
  });

  it("folds the per-format blunderChance delta into wasteChance (bounded)", () => {
    // Every format family declares overrides for every tier in #1069, so this
    // asserts the composition path executes and stays within the base bounds.
    for (const level of DIFFICULTY_LEVELS) {
      const base = resolveManaSequencingScaling(level, undefined);
      for (const format of [
        "commander",
        "constructed",
        "limited",
      ] as DifficultyFormat[]) {
        const resolved = resolveManaSequencingScaling(level, format);
        // Resolved waste can only move proportionally with blunderChance; it
        // never exceeds the geometric ceiling of (base * ratio) clamped to 1.
        expect(resolved.wasteChance).toBeGreaterThanOrEqual(0);
        // efficiencyMultiplier is never touched by the format composition.
        expect(resolved.efficiencyMultiplier).toBe(base.efficiencyMultiplier);
      }
    }
  });
});

describe("computeOptimalSequence — difficulty waste blunder (#990)", () => {
  // A hand with an on-curve 1-drop + 2-drop so 3 mana yields [1, 2] optimally.
  const hand: HandCard[] = [
    makeCard("Savannah Lions", 1),
    makeCard("Grizzly Bears", 2),
    makeLand("Plains"),
  ];
  const comp = getHandComposition(hand);

  it("omitting difficulty preserves the legacy (optimal) sequence", () => {
    const seq = computeOptimalSequence(comp, 3, 2);
    expect(seq).toEqual([1, 2]);
  });

  it("expert produces the optimal sequence (no waste) on a no-blunder roll", () => {
    const seq = computeOptimalSequence(
      comp,
      3,
      2,
      false,
      "expert",
      NO_BLUNDER_RNG,
    );
    expect(seq).toEqual([1, 2]);
  });

  it("easy wastes the highest-cmc spell when the waste roll hits", () => {
    // roll 0.0 < easy.wasteChance(0.4) → drop the 2-drop, leaving [1].
    const seq = computeOptimalSequence(
      comp,
      3,
      2,
      false,
      "easy",
      ALWAYS_BLUNDER_RNG,
    );
    expect(seq).toEqual([1]);
    // Confirm 1 mana is now unspent (3 available, only 1 used).
    expect(seq.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("expert produces the full sequence on a roll above its waste threshold", () => {
    // EASY_ONLY_BLUNDER_ROLL (0.1) ≥ expert.wasteChance(0.02) → no waste.
    const seq = computeOptimalSequence(
      comp,
      3,
      2,
      false,
      "expert",
      () => EASY_ONLY_BLUNDER_ROLL,
    );
    expect(seq).toEqual([1, 2]);
  });

  it("is monotonic in mana utilized across tiers (aggregated over a roll ladder)", () => {
    // Across a ladder of rolls, higher tiers waste less often → use at least
    // as much mana cumulatively as the tier below. Mirrors the combat-trick
    // aggregated-hold-rate test (issue #1067).
    const rolls: number[] = [];
    for (let i = 1; i <= 20; i++) rolls.push(i / 25); // 0.04 .. 0.80
    const used = DIFFICULTY_LEVELS.map((d) => {
      let total = 0;
      for (const r of rolls) {
        total += computeOptimalSequence(comp, 3, 2, false, d, () => r).reduce(
          (a, b) => a + b,
          0,
        );
      }
      return total;
    });
    for (let i = 1; i < used.length; i++) {
      expect(used[i]).toBeGreaterThanOrEqual(used[i - 1]);
    }
    // Easy wastes strictly more often than expert over the ladder.
    expect(used[0]).toBeLessThan(used[used.length - 1]);
  });
});

describe("scoreSequencing — difficulty efficiency multiplier (#990)", () => {
  const sequence = [1, 2]; // perfect 3-mana utilization

  it("omitting difficulty preserves the legacy score", () => {
    const legacy = scoreSequencing(sequence, 3, 3);
    const explicit = scoreSequencing(sequence, 3, 3, undefined);
    expect(explicit).toBe(legacy);
  });

  it("expert scores at least as high as easy on the identical sequence", () => {
    const easy = scoreSequencing(sequence, 3, 3, "easy");
    const expert = scoreSequencing(sequence, 3, 3, "expert");
    expect(expert).toBeGreaterThanOrEqual(easy);
  });

  it("is monotonic in skill across every tier", () => {
    const scores = DIFFICULTY_LEVELS.map((d) =>
      scoreSequencing(sequence, 3, 3, d),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it("expert matches the legacy (unscaled) score", () => {
    // efficiencyMultiplier = 1 at expert → identical to the difficulty-agnostic score.
    expect(scoreSequencing(sequence, 3, 3, "expert")).toBe(
      scoreSequencing(sequence, 3, 3),
    );
  });
});

describe("evaluateLandDropTiming — difficulty misorder blunder (#990)", () => {
  it("omitting difficulty preserves the legacy score", () => {
    const legacy = evaluateLandDropTiming(2, 1, 3);
    expect(evaluateLandDropTiming(2, 1, 3, false, 0, undefined)).toBe(legacy);
  });

  it("easy penalizes land timing when the misorder roll hits", () => {
    const clean = evaluateLandDropTiming(
      2,
      1,
      3,
      false,
      0,
      "easy",
      NO_BLUNDER_RNG,
    );
    const misordered = evaluateLandDropTiming(
      2,
      1,
      3,
      false,
      0,
      "easy",
      ALWAYS_BLUNDER_RNG,
    );
    expect(misordered).toBeLessThan(clean);
  });

  it("expert never misorders (misorderChance = 0)", () => {
    const clean = evaluateLandDropTiming(
      2,
      1,
      3,
      false,
      0,
      "expert",
      NO_BLUNDER_RNG,
    );
    const rolled = evaluateLandDropTiming(
      2,
      1,
      3,
      false,
      0,
      "expert",
      ALWAYS_BLUNDER_RNG,
    );
    expect(rolled).toBe(clean);
  });

  it("is monotonic in skill on an always-blunder roll (lower tiers ≤ higher)", () => {
    const scores = DIFFICULTY_LEVELS.map((d) =>
      evaluateLandDropTiming(2, 1, 3, false, 0, d, ALWAYS_BLUNDER_RNG),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

describe("getSequencingRecommendation — difficulty scaling (#990)", () => {
  // Hand chosen so the optimal sequence achieves PERFECT 4-mana utilization:
  // 1-drop + 3-drop → [1, 3] = 4 mana used. This lets the reasoning test
  // assert "Optimal" for expert (no waste) vs "Suboptimal" for easy (waste).
  const hand: HandCard[] = [
    makeCard("One Drop", 1),
    makeCard("Three Drop", 3),
    makeLand("Plains"),
    makeLand("Plains2"),
    makeLand("Plains3"),
  ];
  const MANA = 4;
  const TURN = 4;

  it("omitting difficulty preserves the legacy recommendation cast order", () => {
    const legacy = getSequencingRecommendation(hand, MANA, MANA, TURN);
    const explicit = getSequencingRecommendation(
      hand,
      MANA,
      MANA,
      TURN,
      false,
      0,
      {},
    );
    expect(explicit.castOrder).toEqual(legacy.castOrder);
    // Sanity: the optimal sequence uses all 4 mana.
    expect(explicit.castOrder).toEqual([1, 3]);
  });

  it("expert recommendation uses at least as much mana as easy on identical rolls", () => {
    // Same seeded RNG stream for both tiers (deterministic, comparable). A
    // roll of 0.1 fires easy's waste (0.1 < 0.4) but not expert's (0.1 ≥ 0.02).
    const easy = getSequencingRecommendation(hand, MANA, MANA, TURN, false, 0, {
      difficulty: "easy",
      rng: () => EASY_ONLY_BLUNDER_ROLL,
    });
    const expert = getSequencingRecommendation(
      hand,
      MANA,
      MANA,
      TURN,
      false,
      0,
      {
        difficulty: "expert",
        rng: () => EASY_ONLY_BLUNDER_ROLL,
      },
    );
    const easyUsed = easy.castOrder.reduce((a, b) => a + b, 0);
    const expertUsed = expert.castOrder.reduce((a, b) => a + b, 0);
    expect(expertUsed).toBeGreaterThanOrEqual(easyUsed);
  });

  it("easy wastes mana on a distinguishing roll; expert does not", () => {
    // EASY_ONLY_BLUNDER_ROLL (0.1): easy wastes (drops the 3-drop → [1]),
    // expert keeps the full sequence ([1, 3]).
    const easy = getSequencingRecommendation(hand, MANA, MANA, TURN, false, 0, {
      difficulty: "easy",
      rng: () => EASY_ONLY_BLUNDER_ROLL,
    });
    const expert = getSequencingRecommendation(
      hand,
      MANA,
      MANA,
      TURN,
      false,
      0,
      {
        difficulty: "expert",
        rng: () => EASY_ONLY_BLUNDER_ROLL,
      },
    );
    const easyUsed = easy.castOrder.reduce((a, b) => a + b, 0);
    const expertUsed = expert.castOrder.reduce((a, b) => a + b, 0);
    expect(easyUsed).toBeLessThan(expertUsed);
    // Easy leaves ≥1 mana unspent (only the 1-drop is cast).
    expect(MANA - easyUsed).toBeGreaterThanOrEqual(1);
    // Expert achieves perfect utilization.
    expect(expertUsed).toBe(MANA);
  });

  it("produces a monotonic recommendation score across tiers on identical no-blunder rolls", () => {
    // No-blunder roll → identical cast order across tiers; the score delta
    // comes purely from efficiencyMultiplier (monotonic in skill).
    const scores = DIFFICULTY_LEVELS.map(
      (d) =>
        getSequencingRecommendation(hand, MANA, MANA, TURN, false, 0, {
          difficulty: d,
          rng: NO_BLUNDER_RNG,
        }).score,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
    expect(scores[0]).toBeLessThanOrEqual(scores[scores.length - 1]);
  });

  it("produces monotonic mana utilization across tiers (aggregated over a roll ladder)", () => {
    const rolls: number[] = [];
    for (let i = 1; i <= 20; i++) rolls.push(i / 25); // 0.04 .. 0.80
    const used = DIFFICULTY_LEVELS.map((d) => {
      let total = 0;
      for (const r of rolls) {
        total += getSequencingRecommendation(hand, MANA, MANA, TURN, false, 0, {
          difficulty: d,
          rng: () => r,
        }).castOrder.reduce((a, b) => a + b, 0);
      }
      return total;
    });
    for (let i = 1; i < used.length; i++) {
      expect(used[i]).toBeGreaterThanOrEqual(used[i - 1]);
    }
    expect(used[0]).toBeLessThan(used[used.length - 1]);
  });

  it("surfaces difficulty-appropriate expectations in the reasoning", () => {
    // Easy on a distinguishing roll wastes mana → "Suboptimal sequencing".
    const easy = getSequencingRecommendation(hand, MANA, MANA, TURN, false, 0, {
      difficulty: "easy",
      rng: () => EASY_ONLY_BLUNDER_ROLL,
    });
    expect(
      easy.reasoning.some((r) => r.toLowerCase().includes("suboptimal")),
    ).toBe(true);
    expect(easy.reasoning.some((r) => r.includes("easy"))).toBe(true);

    // Expert on a no-blunder roll achieves perfect utilization → "Optimal".
    const expert = getSequencingRecommendation(
      hand,
      MANA,
      MANA,
      TURN,
      false,
      0,
      {
        difficulty: "expert",
        rng: NO_BLUNDER_RNG,
      },
    );
    expect(
      expert.reasoning.some((r) => r.toLowerCase().includes("optimal")),
    ).toBe(true);
    expect(expert.reasoning.some((r) => r.includes("expert"))).toBe(true);
  });

  it.each(DIFFICULTY_LEVELS)(
    "composes with every per-format config without error (%s)",
    (level) => {
      for (const format of [
        "commander",
        "constructed",
        "limited",
      ] as DifficultyFormat[]) {
        const rec = getSequencingRecommendation(
          hand,
          MANA,
          MANA,
          TURN,
          false,
          0,
          {
            difficulty: level,
            format,
            rng: NO_BLUNDER_RNG,
          },
        );
        expect(rec.score).toBeGreaterThanOrEqual(-1);
        expect(rec.score).toBeLessThanOrEqual(1);
        expect(Array.isArray(rec.castOrder)).toBe(true);
        expect(rec.reasoning.some((r) => r.includes(level))).toBe(true);
      }
    },
  );
});
