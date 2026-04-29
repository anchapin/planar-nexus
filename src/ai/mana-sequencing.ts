/**
 * @fileoverview Mana Curve Sequencing Module
 *
 * Evaluates optimal cast ordering for early turns, factoring in
 * land-drop timing (tapped vs untapped), hand composition, and
 * available mana to recommend the most efficient sequencing.
 */

import type { HandCard } from "./game-state-evaluator";

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

const FIRST_FOUR_TURNS: SequencingSlot[] = [
  { turn: 1, availableMana: 1, recommendedDrops: [1], landType: "untapped" },
  { turn: 2, availableMana: 2, recommendedDrops: [2], landType: "untapped" },
  { turn: 3, availableMana: 3, recommendedDrops: [3], landType: "untapped" },
  { turn: 4, availableMana: 4, recommendedDrops: [4], landType: "untapped" },
];

const IDEAL_CURVE = [0, 1, 2, 2, 3, 3, 4, 4, 5, 6];

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
      return checklandSequence;
    }
  }

  return sequence;
}

export function scoreSequencing(
  optimalSequence: number[],
  availableMana: number,
  turnNumber: number,
): number {
  if (optimalSequence.length === 0) return 0;

  let score = 0;
  const totalManaUsed = optimalSequence.reduce((a, b) => a + b, 0);
  const manaEfficiency = totalManaUsed / availableMana;

  score += manaEfficiency * 0.4;

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

  return Math.max(-1, Math.min(1, score));
}

export function getSequencingRecommendation(
  hand: HandCard[],
  availableMana: number,
  untappedLands: number,
  turnNumber: number,
  hasChecklands: boolean = false,
  tappedLandCount: number = 0,
): SequencingRecommendation {
  const composition = getHandComposition(hand);
  const optimalSequence = computeOptimalSequence(
    composition,
    availableMana,
    untappedLands,
    hasChecklands,
  );
  const sequenceScore = scoreSequencing(
    optimalSequence,
    availableMana,
    turnNumber,
  );
  const landTimingScore = evaluateLandDropTiming(
    composition.landCount,
    untappedLands,
    turnNumber,
    hasChecklands,
    tappedLandCount,
  );

  const reasoning: string[] = [];

  const totalManaUsed = optimalSequence.reduce((a, b) => a + b, 0);
  if (totalManaUsed === availableMana && optimalSequence.length > 0) {
    reasoning.push("Perfect mana utilization");
  } else if (totalManaUsed < availableMana - 1 && optimalSequence.length > 0) {
    reasoning.push("Unused mana detected in sequence");
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
