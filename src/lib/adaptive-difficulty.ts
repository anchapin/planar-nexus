/**
 * @fileoverview Adaptive Difficulty Service
 *
 * Analyzes player performance to suggest difficulty adjustments.
 * Checks the last 5 games at the current difficulty and recommends
 * changes based on win rate thresholds.
 *
 * Issue #1064: this module no longer declares its own difficulty taxonomy. It
 * imports the single canonical {@link DifficultyLevel} / {@link DIFFICULTY_LEVELS}
 * from `src/ai/ai-difficulty.ts` and re-exports them, so the advisory service
 * and the real AI configs can never disagree on the set of tiers. Legacy
 * archival names (`beginner`/`normal`/`master`) are folded onto the canonical
 * set via {@link normalizeDifficultyLevel} at the read boundary.
 */

import type { GameRecord } from "./game-history";
import {
  DIFFICULTY_LEVELS,
  isValidDifficulty,
  normalizeDifficultyLevel,
  type DifficultyLevel,
} from "@/ai/ai-difficulty";

// Re-export the canonical taxonomy so existing callers that import these
// symbols from this module keep compiling — they now resolve to the one shared
// source of truth in `src/ai/ai-difficulty.ts` (issue #1064).
export {
  DIFFICULTY_LEVELS,
  isValidDifficulty,
  normalizeDifficultyLevel,
  type DifficultyLevel,
};

/**
 * Result of adaptive difficulty analysis
 */
export interface DifficultyAnalysis {
  /** Current difficulty level */
  currentDifficulty: DifficultyLevel;

  /** Number of games analyzed */
  gamesAnalyzed: number;

  /** Win rate percentage */
  winRate: number;

  /** Recommendation */
  recommendation: "increase" | "decrease" | "maintain";

  /** Reason for recommendation */
  reason: string;

  /** Suggested next difficulty */
  suggestedDifficulty?: DifficultyLevel;
}

/**
 * Default difficulty thresholds
 */
export interface DifficultyThresholds {
  /** Win rate above this triggers increase recommendation */
  increaseThreshold: number;
  /** Win rate below this triggers decrease recommendation */
  decreaseThreshold: number;
  /** Minimum games needed to make a recommendation */
  minGamesForRecommendation: number;
}

/**
 * Default thresholds
 * - Increase difficulty if win rate > 80%
 * - Decrease difficulty if win rate < 20%
 * - Need at least 5 games to make a decision
 */
export const DEFAULT_THRESHOLDS: DifficultyThresholds = {
  increaseThreshold: 80,
  decreaseThreshold: 20,
  minGamesForRecommendation: 5,
};

/**
 * Get the next difficulty level along the canonical ladder
 * (`easy → medium → hard → expert`, issue #1064). Returns `null` at either end.
 */
export function getNextDifficulty(
  current: DifficultyLevel,
  direction: "increase" | "decrease",
): DifficultyLevel | null {
  const currentIndex = DIFFICULTY_LEVELS.indexOf(current);

  if (direction === "increase") {
    if (currentIndex >= DIFFICULTY_LEVELS.length - 1) {
      return null; // Already at max
    }
    return DIFFICULTY_LEVELS[currentIndex + 1];
  } else {
    if (currentIndex <= 0) {
      return null; // Already at min
    }
    return DIFFICULTY_LEVELS[currentIndex - 1];
  }
}

/**
 * Analyze difficulty based on recent games
 *
 * @param records - Game records to analyze
 * @param currentDifficulty - Current difficulty level
 * @param thresholds - Custom thresholds (optional)
 */
export function analyzeDifficulty(
  records: GameRecord[],
  currentDifficulty: DifficultyLevel,
  thresholds: DifficultyThresholds = DEFAULT_THRESHOLDS,
): DifficultyAnalysis {
  // Filter to last N games at current difficulty. `GameRecord.difficulty` is a
  // free-form string, so normalize legacy archival names (e.g. "normal") onto
  // the canonical tier before comparing — otherwise old saved games would stop
  // counting toward the recommendation (issue #1064).
  const relevantRecords = records
    .filter(
      (r) =>
        r.mode === "vs_ai" &&
        normalizeDifficultyLevel(r.difficulty) === currentDifficulty,
    )
    .slice(0, thresholds.minGamesForRecommendation);

  const gamesAnalyzed = relevantRecords.length;

  // If not enough games, maintain current difficulty
  if (gamesAnalyzed < thresholds.minGamesForRecommendation) {
    return {
      currentDifficulty,
      gamesAnalyzed,
      winRate: 0,
      recommendation: "maintain",
      reason: `Not enough games played at ${currentDifficulty} difficulty (need ${thresholds.minGamesForRecommendation})`,
    };
  }

  // Calculate win rate
  const wins = relevantRecords.filter((r) => r.result === "win").length;
  const winRate = Math.round((wins / gamesAnalyzed) * 100);

  // Determine recommendation based on thresholds
  let recommendation: "increase" | "decrease" | "maintain";
  let reason: string;

  if (winRate > thresholds.increaseThreshold) {
    recommendation = "increase";
    reason = `Strong performance: ${winRate}% win rate (threshold: >${thresholds.increaseThreshold}%)`;
  } else if (winRate < thresholds.decreaseThreshold) {
    recommendation = "decrease";
    reason = `Struggling: ${winRate}% win rate (threshold: <${thresholds.decreaseThreshold}%)`;
  } else {
    recommendation = "maintain";
    reason = `Balanced: ${winRate}% win rate (within ${thresholds.decreaseThreshold}-${thresholds.increaseThreshold}% range)`;
  }

  // Calculate suggested next difficulty
  let suggestedDifficulty: DifficultyLevel | undefined;
  if (recommendation !== "maintain") {
    const next = getNextDifficulty(currentDifficulty, recommendation);
    if (next) {
      suggestedDifficulty = next;
    }
  }

  return {
    currentDifficulty,
    gamesAnalyzed,
    winRate,
    recommendation,
    reason,
    suggestedDifficulty,
  };
}

/**
 * Get adaptive difficulty recommendation for the next game
 *
 * @param records - All game records
 * @param currentDifficulty - Current difficulty (optional, inferred from last game if not provided)
 * @param thresholds - Custom thresholds (optional)
 */
export function getAdaptiveDifficulty(
  records: GameRecord[],
  currentDifficulty?: DifficultyLevel,
  thresholds?: DifficultyThresholds,
): DifficultyAnalysis {
  // If no difficulty provided, infer from most recent vs_ai game
  if (!currentDifficulty) {
    // Sort by date descending to get the most recent game
    const sortedRecords = [...records].sort((a, b) => b.date - a.date);
    const lastVsAiGame = sortedRecords.find(
      (r) => r.mode === "vs_ai" && r.difficulty,
    );
    if (lastVsAiGame && lastVsAiGame.difficulty) {
      // Normalize the archival string onto the canonical tier (issue #1064).
      currentDifficulty = normalizeDifficultyLevel(lastVsAiGame.difficulty);
    } else {
      // Default to medium (the canonical mid-tier) if no history
      currentDifficulty = "medium";
    }
  }

  return analyzeDifficulty(records, currentDifficulty, thresholds);
}

// `isValidDifficulty` is re-exported from `src/ai/ai-difficulty.ts` (see the
// top of this file). It now accepts only the four canonical tiers — the local
// declaration that previously recognized the divergent `beginner`/`normal`/
// `master` rungs has been removed so there is a single validity rule (#1064).

/**
 * Get difficulty level info for UI display.
 *
 * Accepts a free-form string (UI may iterate dynamic keys such as
 * `winRateByDifficulty`) and normalizes legacy archival names onto the
 * canonical tier before lookup, so old persisted data still renders instead of
 * crashing (issue #1064). The info table is keyed by the canonical
 * {@link DifficultyLevel} set, which also acts as a compile-time
 * exhaustiveness guard.
 */
export function getDifficultyInfo(difficulty: DifficultyLevel | string): {
  label: string;
  description: string;
  color: string;
} {
  const tier = normalizeDifficultyLevel(difficulty);
  const info: Record<
    DifficultyLevel,
    { label: string; description: string; color: string }
  > = {
    easy: {
      label: "Easy",
      description: "AI makes frequent mistakes, good for learning",
      color: "text-green-400",
    },
    medium: {
      label: "Medium",
      description: "Balanced AI, fair challenge",
      color: "text-yellow-500",
    },
    hard: {
      label: "Hard",
      description: "Strong AI, requires good strategy",
      color: "text-orange-500",
    },
    expert: {
      label: "Expert",
      description: "Maximum challenge, near-perfect play",
      color: "text-red-500",
    },
  };

  return info[tier];
}

// ===========================================================================
// End-of-game learning loop (issue #1066)
// ===========================================================================
//
// `analyzeDifficulty` above *recommends a different tier*; it never retunes the
// AI's own weights, so the opponent never improved from game to game. The
// helpers below close that loop: after each single-player match, the post-game
// analysis is fed into the WeightLearner, which nudges the AI's evaluation
// weights (bounded + EMA-smoothed, persisted per tier). This module stays the
// orchestrator; the learner itself lives in `src/ai/weight-learning.ts` so it
// can sit next to the weights it retunes.
//
// The two systems cooperate but stay distinct:
//   - adaptive-difficulty  → picks WHICH tier the AI plays at (advisory)
//   - weight-learning      → retunes the weights WITHIN that tier (learning)

import {
  WeightLearner,
  defaultWeightLearner,
  toDifficultyTier,
  type AIGameOutcome,
  type IngestResult,
} from "@/ai/weight-learning";
import type { GameAnalysisOutput } from "@/ai/flows/ai-post-game-analysis";
import type {
  EvaluationWeights,
  DifficultyTier,
} from "@/ai/game-state-evaluator";

/**
 * Input to {@link ingestGameOutcomeIntoWeights}: the minimal bundle the post-game
 * flow hands the learning loop once a match ends.
 */
export interface LearningLoopInput {
  /** The UI difficulty the AI played at this game (any rung on the ladder). */
  difficulty: DifficultyLevel | string;
  /** The AI's result for the game (from the AI's perspective). */
  outcome: AIGameOutcome;
  /** The structured analysis produced by `analyzeGame` for this game. */
  analysis: GameAnalysisOutput;
}

/**
 * Close one iteration of the learning loop after a single-player game.
 *
 * This is the function the post-game flow (see
 * `src/app/(app)/game-analysis/page.tsx`, which already runs `analyzeGame`)
 * should call once the analysis is ready — it folds the outcome + analysis into
 * the AI's per-tier evaluation weights and persists them locally for next game.
 *
 * @param input    outcome + analysis bundle
 * @param learner  optional explicit learner (tests); defaults to the
 *                 process-wide singleton used by the live game
 *
 * @returns an {@link IngestResult} describing what changed (and whether
 *          persistence hit a quota limit). Never throws.
 */
export function ingestGameOutcomeIntoWeights(
  input: LearningLoopInput,
  learner: WeightLearner = defaultWeightLearner,
): IngestResult {
  const tier = toDifficultyTier(input.difficulty);
  return learner.ingestGameOutcome(tier, input.outcome, input.analysis);
}

/**
 * Fetch the evaluation weights the AI should actually play with for a given UI
 * difficulty — i.e. the static defaults for that tier, overlaid with the
 * locally-learned, bounded, EMA-smoothed adjustments. Feed the result to
 * `GameStateEvaluator#setWeights` at game start to close the read side of the
 * loop.
 *
 * Returns the static defaults unchanged when no learning has happened yet.
 */
export function getEvaluationWeightsForDifficulty(
  difficulty: DifficultyLevel | string,
  learner: WeightLearner = defaultWeightLearner,
): EvaluationWeights {
  const tier = toDifficultyTier(difficulty);
  return learner.getLearnedEvaluationWeights(tier);
}

/**
 * Reset the learned-weight adjustments. Pass a difficulty to clear a single
 * tier, or omit to wipe all tiers back to static defaults. Quota-safe.
 */
export function resetLearnedWeightsForDifficulty(
  difficulty?: DifficultyLevel | string,
  learner: WeightLearner = defaultWeightLearner,
): { ok: boolean; warning?: string } {
  if (difficulty === undefined) return learner.reset();
  const tier = toDifficultyTier(difficulty);
  return learner.reset(tier);
}

/** Re-export the evaluator tier so callers don't need a second import path. */
export type { DifficultyTier };
