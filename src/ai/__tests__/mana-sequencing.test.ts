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
} from "../mana-sequencing";
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
