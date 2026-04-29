/**
 * @fileoverview Expert-derived heuristic lookup table for multi-turn planning.
 *
 * Issue #667: Stores board-state signatures mapped to preferred attack lines
 * derived from expert gameplay patterns. These heuristics inject forward-looking
 * strategic knowledge into the aggression weight calculation.
 */

import type { AttackLineHeuristic, BoardStateSignature } from "./types";

/**
 * Built-in heuristic table populated from expert gameplay patterns.
 * Each entry represents a scenario where the locally optimal play differs
 * from the globally optimal play, and encodes the correct multi-turn strategy.
 */
const BUILT_IN_HEURISTICS: AttackLineHeuristic[] = [
  {
    id: "setup-lethal-next-turn",
    description:
      "AI has enough power to set up lethal next turn — should attack even if some creatures die",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "mid",
      opponentLifeBucket: "low",
      aiHandSize: 2,
      opponentHandEstimate: 0,
    },
    aggressionModifier: 0.3,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 2,
    confidence: 0.85,
  },
  {
    id: "bait-blocker-for-lethal",
    description:
      "Attacking with a sacrificial creature to bait a blocker, clearing the way for lethal",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "high",
      opponentLifeBucket: "critical",
      aiHandSize: 1,
      opponentHandEstimate: 0,
    },
    aggressionModifier: 0.4,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 2,
    confidence: 0.8,
  },
  {
    id: "avoid-trading-into-opponent-lethal",
    description:
      "Decline a trade that would leave the AI vulnerable to opponent lethal in two turns",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "critical",
      opponentLifeBucket: "mid",
      aiHandSize: 1,
      opponentHandEstimate: 0,
    },
    aggressionModifier: -0.4,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 2,
    confidence: 0.9,
  },
  {
    id: "wide-board-pressure",
    description:
      "With a wide board advantage, attack with everything to maximize damage before opponent stabilizes",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "high",
      opponentLifeBucket: "mid",
      aiHandSize: 3,
      opponentHandEstimate: 0,
    },
    aggressionModifier: 0.25,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 2,
    confidence: 0.7,
  },
  {
    id: "protect-key-threat",
    description:
      "Hold back a key evasive threat when opponent has flyers and no reach",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "low",
      opponentLifeBucket: "high",
      aiHandSize: 2,
      opponentHandEstimate: 0,
    },
    aggressionModifier: -0.2,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 1,
    confidence: 0.75,
  },
  {
    id: "racing-opponent-lethal",
    description:
      "Both players are in lethal range — maximize damage output each turn to race",
    signature: {
      aiCreatures: [],
      opponentCreatures: [],
      aiLifeBucket: "critical",
      opponentLifeBucket: "critical",
      aiHandSize: 1,
      opponentHandEstimate: 0,
    },
    aggressionModifier: 0.5,
    priorityAttackers: [],
    holdBack: [],
    lookaheadTurns: 2,
    confidence: 0.95,
  },
];

/**
 * Heuristic table that stores and looks up board-state signatures.
 */
export class HeuristicTable {
  private heuristics: AttackLineHeuristic[] = [...BUILT_IN_HEURISTICS];

  /**
   * Look up matching heuristics for a given board state signature.
   *
   * @param signature - The current board state signature
   * @param minMatchQuality - Minimum similarity score to consider a match (0-1)
   * @returns Array of matching heuristics sorted by confidence * matchQuality
   */
  lookup(
    signature: BoardStateSignature,
    minMatchQuality: number = 0.3,
  ): AttackLineHeuristic[] {
    return this.heuristics.filter((h) => {
      const score = this.computeRelevance(h, signature);
      return score >= minMatchQuality;
    });
  }

  /**
   * Add a new heuristic to the table.
   */
  add(heuristic: AttackLineHeuristic): void {
    this.heuristics.push(heuristic);
  }

  /**
   * Add multiple heuristics to the table.
   */
  addAll(heuristics: AttackLineHeuristic[]): void {
    this.heuristics.push(...heuristics);
  }

  /**
   * Remove a heuristic by ID.
   */
  remove(id: string): boolean {
    const index = this.heuristics.findIndex((h) => h.id === id);
    if (index === -1) return false;
    this.heuristics.splice(index, 1);
    return true;
  }

  /**
   * Get all heuristics.
   */
  getAll(): AttackLineHeuristic[] {
    return [...this.heuristics];
  }

  /**
   * Clear all heuristics.
   */
  clear(): void {
    this.heuristics = [];
  }

  /**
   * Compute relevance score between a heuristic's signature and a current board state.
   * Uses structural matching on life buckets, creature counts, and keyword overlap.
   */
  private computeRelevance(
    heuristic: AttackLineHeuristic,
    current: BoardStateSignature,
  ): number {
    const hs = heuristic.signature;
    let score = 0;
    let maxScore = 0;

    maxScore += 1;
    if (hs.aiLifeBucket === current.aiLifeBucket) score += 1;

    maxScore += 1;
    if (hs.opponentLifeBucket === current.opponentLifeBucket) score += 1;

    maxScore += 1;
    if (hs.aiCreatures.length === 0) {
      score += 0.5;
    } else {
      const countDiff = Math.abs(
        hs.aiCreatures.length - current.aiCreatures.length,
      );
      score += Math.max(0, 1 - countDiff / 2);
    }

    maxScore += 1;
    if (hs.opponentCreatures.length === 0) {
      score += 0.5;
    } else {
      const countDiff = Math.abs(
        hs.opponentCreatures.length - current.opponentCreatures.length,
      );
      score += Math.max(0, 1 - countDiff / 2);
    }

    maxScore += 0.5;
    if (hs.aiHandSize <= 1 && current.aiHandSize <= 1) {
      score += 0.5;
    } else {
      const handDiff = Math.abs(hs.aiHandSize - current.aiHandSize);
      score += Math.max(0, 0.5 - handDiff / 4);
    }

    maxScore += 0.5;
    const aiPowerSum = current.aiCreatures.reduce((s, c) => s + c.power, 0);
    const hsTotalPower = hs.aiCreatures.reduce((s, c) => s + c.power, 0);
    if (hsTotalPower > 0) {
      const ratio = Math.min(aiPowerSum, hsTotalPower) / Math.max(aiPowerSum, hsTotalPower);
      score += 0.5 * ratio;
    } else {
      score += 0.25;
    }

    maxScore += 0.5;
    const oppPowerSum = current.opponentCreatures.reduce((s, c) => s + c.power, 0);
    const hsOppTotalPower = hs.opponentCreatures.reduce((s, c) => s + c.power, 0);
    if (hsOppTotalPower > 0) {
      const ratio = Math.min(oppPowerSum, hsOppTotalPower) / Math.max(oppPowerSum, hsOppTotalPower);
      score += 0.5 * ratio;
    } else {
      score += 0.25;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }
}
