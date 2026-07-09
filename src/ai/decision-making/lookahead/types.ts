/**
 * @fileoverview Types for multi-turn lookahead / forward board-state planning.
 *
 * Issue #667: Provides a board-state signature schema, heuristic lookup table,
 * and lookahead evaluation types for the Combat AI system.
 */

import type { AIGameState, AIPermanent } from "@/lib/game-state/types";

/**
 * Normalized creature stats used in board state signatures.
 * Rounds power/toughness to reduce signature granularity.
 */
export interface CreatureSignature {
  power: number;
  toughness: number;
  keywords: string[];
  manaValue: number;
}

/**
 * Hashable representation of the board at a point in time.
 * Two boards with the same signature are treated as strategically equivalent.
 */
export interface BoardStateSignature {
  /** Sorted list of AI creature power/toughness pairs */
  aiCreatures: CreatureSignature[];
  /** Sorted list of opponent creature power/toughness pairs */
  opponentCreatures: CreatureSignature[];
  /** AI player life total bucket: "critical" (≤5), "low" (6-10), "mid" (11-15), "high" (>15) */
  aiLifeBucket: "critical" | "low" | "mid" | "high";
  /** Opponent life total bucket */
  opponentLifeBucket: "critical" | "low" | "mid" | "high";
  /** Estimated cards in AI hand (used as proxy for resources) */
  aiHandSize: number;
  /** Estimated cards in opponent hand */
  opponentHandEstimate: number;
}

/**
 * A preferred attack line derived from expert gameplay patterns.
 * Maps a board state signature to a recommended sequence of actions.
 */
export interface AttackLineHeuristic {
  /** Unique identifier for this heuristic */
  id: string;
  /** Human-readable description of the scenario this heuristic covers */
  description: string;
  /** The board state signature this heuristic applies to */
  signature: BoardStateSignature;
  /** Weighted score modifier to apply when this heuristic matches.
   *  Positive = favor aggressive lines; negative = favor defensive lines */
  aggressionModifier: number;
  /** Suggested priority creatures to attack with (creature IDs, resolved at match time) */
  priorityAttackers: string[];
  /** Suggested creatures to hold back for defense */
  holdBack: string[];
  /** How many turns ahead this heuristic looks */
  lookaheadTurns: number;
  /** Confidence in this heuristic (0-1) */
  confidence: number;
}

/**
 * Result of matching board state signatures against the heuristic table.
 */
export interface HeuristicMatch {
  /** Matched heuristic (or null if no match) */
  heuristic: AttackLineHeuristic | null;
  /** Match quality (0-1, 1 = perfect match) */
  matchQuality: number;
  /** Aggregate aggression modifier from all matching heuristics */
  aggressionModifier: number;
  /** IDs of creatures the heuristic recommends prioritizing for attack */
  priorityAttackers: string[];
  /** IDs of creatures the heuristic recommends holding back */
  holdBack: string[];
}

/**
 * A simulated future board state used in lookahead evaluation.
 */
export interface ProjectedBoardState {
  /** The projected game state after N turns */
  gameState: AIGameState;
  /** Turn offset from current turn (1 = next turn, 2 = two turns from now) */
  turnsAhead: number;
  /** Probability of this projection being accurate (0-1) */
  probability: number;
  /** Cumulative expected damage to opponent across projected turns */
  projectedDamageToOpponent: number;
  /** Cumulative expected damage to AI player across projected turns */
  projectedDamageToAI: number;
  /** Net board advantage change (+/- creature count delta) */
  boardAdvantageDelta: number;
  /** Whether the AI player has lethal damage in this projection */
  hasLethal: boolean;
  /** Whether the opponent has lethal damage in this projection */
  opponentHasLethal: boolean;
}

/**
 * Configuration for the lookahead engine.
 */
export interface LookaheadConfig {
  /** Maximum number of turns to look ahead (1-4) */
  maxDepth: number;
  /** Number of board projections to consider per turn */
  branchingFactor: number;
  /** Weight of heuristic table matches vs. raw evaluation (0-1) */
  heuristicWeight: number;
  /** Minimum match quality to apply a heuristic (0-1) */
  minMatchQuality: number;
  /** Whether multi-turn lookahead is enabled */
  enabled: boolean;
  /**
   * External aggression bias added to the lookahead's aggression modifier
   * (issue #1068). In `[-1, 1]`: positive shifts the engine toward more
   * aggressive lines (used when the AI is behind and needs to press), negative
   * toward conservative lines (used when ahead and protecting a lead). Defaults
   * to 0 (no adjustment) so existing behavior is unchanged.
   */
  aggressionBias?: number;
  /**
   * Difficulty tier used to scale opponent combo-assembly detection depth
   * (issue #1232). Lower tiers scan fewer opponent cards per zone and so
   * declare `imminent` threats less often; hard/expert widen the window so
   * the engine spots Thassa's Oracle / Kiki / Past in Flames two cards deep
   * in the opponent's hand.
   *
   * Optional — the engine defaults to `"medium"` when omitted so existing
   * callers keep their historical behaviour.
   */
  difficulty?: "easy" | "medium" | "hard" | "expert";
  /**
   * Cap on opponent cards scanned per zone by the combo detector (issue
   * #1232). Defaults to the per-tier value from
   * `detectionDepthForTier(difficulty)`. Override only in tests.
   */
  comboDetectionDepth?: number;
}

/**
 * Complete lookahead evaluation result, used to adjust combat decisions.
 */
export interface LookaheadResult {
  /** Whether lookahead evaluation was performed */
  evaluated: boolean;
  /** Best projected line's total score */
  bestScore: number;
  /** Worst projected line's total score (opponent's best response) */
  worstScore: number;
  /** Aggregate aggression modifier from heuristic matching */
  aggressionModifier: number;
  /** Creatures recommended to prioritize for attack */
  priorityAttackers: string[];
  /** Creatures recommended to hold back */
  holdBack: string[];
  /** Whether a lethal line was found within the lookahead window */
  lethalFound: boolean;
  /** Whether the opponent can reach lethal if we play greedily */
  opponentLethalRisk: boolean;
  /** Number of turns to the earliest lethal (Infinity if none) */
  turnsToLethal: number;
  /**
   * Detected opponent combo-assembly threat tier (issue #1232). Defaults
   * to `"none"` so existing consumers see a stable shape.
   */
  comboThreat: "imminent" | "building" | "none";
  /**
   * The combo family that triggered the highest scoring threat (e.g.
   * "storm", "infinite", "reanimator", "consultation"). `null` when no
   * signal was found.
   */
  comboArchetype: string | null;
  /**
   * Urgency scalar the engine applied to the aggression modifier because
   * of the detected threat — see `comboThreatUrgency`. Always 0 when
   * `comboThreat === "none"`.
   */
  comboThreatUrgency: number;
}
