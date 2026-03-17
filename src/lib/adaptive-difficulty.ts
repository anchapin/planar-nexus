/**
 * @fileoverview Adaptive Difficulty Service
 * 
 * Analyzes player performance to suggest difficulty adjustments.
 * Checks the last 5 games at the current difficulty and recommends
 * changes based on win rate thresholds.
 */

import type { GameRecord } from './game-history';

/**
 * Difficulty levels in order from easiest to hardest
 */
export const DIFFICULTY_LEVELS = ['beginner', 'easy', 'normal', 'hard', 'expert', 'master'] as const;

export type DifficultyLevel = typeof DIFFICULTY_LEVELS[number];

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
  recommendation: 'increase' | 'decrease' | 'maintain';
  
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
 * Get the next difficulty level
 */
export function getNextDifficulty(
  current: DifficultyLevel,
  direction: 'increase' | 'decrease'
): DifficultyLevel | null {
  const currentIndex = DIFFICULTY_LEVELS.indexOf(current);
  
  if (direction === 'increase') {
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
  thresholds: DifficultyThresholds = DEFAULT_THRESHOLDS
): DifficultyAnalysis {
  // Filter to last N games at current difficulty
  const relevantRecords = records
    .filter(r => r.difficulty === currentDifficulty && r.mode === 'vs_ai')
    .slice(0, thresholds.minGamesForRecommendation);
  
  const gamesAnalyzed = relevantRecords.length;
  
  // If not enough games, maintain current difficulty
  if (gamesAnalyzed < thresholds.minGamesForRecommendation) {
    return {
      currentDifficulty,
      gamesAnalyzed,
      winRate: 0,
      recommendation: 'maintain',
      reason: `Not enough games played at ${currentDifficulty} difficulty (need ${thresholds.minGamesForRecommendation})`,
    };
  }
  
  // Calculate win rate
  const wins = relevantRecords.filter(r => r.result === 'win').length;
  const winRate = Math.round((wins / gamesAnalyzed) * 100);
  
  // Determine recommendation based on thresholds
  let recommendation: 'increase' | 'decrease' | 'maintain';
  let reason: string;
  
  if (winRate > thresholds.increaseThreshold) {
    recommendation = 'increase';
    reason = `Strong performance: ${winRate}% win rate (threshold: >${thresholds.increaseThreshold}%)`;
  } else if (winRate < thresholds.decreaseThreshold) {
    recommendation = 'decrease';
    reason = `Struggling: ${winRate}% win rate (threshold: <${thresholds.decreaseThreshold}%)`;
  } else {
    recommendation = 'maintain';
    reason = `Balanced: ${winRate}% win rate (within ${thresholds.decreaseThreshold}-${thresholds.increaseThreshold}% range)`;
  }
  
  // Calculate suggested next difficulty
  let suggestedDifficulty: DifficultyLevel | undefined;
  if (recommendation !== 'maintain') {
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
  thresholds?: DifficultyThresholds
): DifficultyAnalysis {
  // If no difficulty provided, infer from most recent vs_ai game
  if (!currentDifficulty) {
    // Sort by date descending to get the most recent game
    const sortedRecords = [...records].sort((a, b) => b.date - a.date);
    const lastVsAiGame = sortedRecords.find(r => r.mode === 'vs_ai' && r.difficulty);
    if (lastVsAiGame && lastVsAiGame.difficulty) {
      currentDifficulty = lastVsAiGame.difficulty as DifficultyLevel;
    } else {
      // Default to normal if no history
      currentDifficulty = 'normal';
    }
  }
  
  return analyzeDifficulty(records, currentDifficulty, thresholds);
}

/**
 * Check if a difficulty level is valid
 */
export function isValidDifficulty(difficulty: string): difficulty is DifficultyLevel {
  return DIFFICULTY_LEVELS.includes(difficulty as DifficultyLevel);
}

/**
 * Get difficulty level info for UI display
 */
export function getDifficultyInfo(difficulty: DifficultyLevel): {
  label: string;
  description: string;
  color: string;
} {
  const info: Record<DifficultyLevel, { label: string; description: string; color: string }> = {
    beginner: {
      label: 'Beginner',
      description: 'AI makes frequent mistakes, easy to win',
      color: 'text-green-500',
    },
    easy: {
      label: 'Easy',
      description: 'AI plays below optimal, good for learning',
      color: 'text-green-400',
    },
    normal: {
      label: 'Normal',
      description: 'Balanced AI, fair challenge',
      color: 'text-yellow-500',
    },
    hard: {
      label: 'Hard',
      description: 'Strong AI, requires good strategy',
      color: 'text-orange-500',
    },
    expert: {
      label: 'Expert',
      description: 'Very skilled AI, for experienced players',
      color: 'text-red-500',
    },
    master: {
      label: 'Master',
      description: 'Maximum challenge, near-perfect play',
      color: 'text-red-600',
    },
  };
  
  return info[difficulty];
}
