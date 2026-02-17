/**
 * AI Difficulty Tuning System
 * 
 * Provides configurable difficulty levels for AI opponents.
 * Controls randomness, lookahead depth, and evaluation accuracy.
 * 
 * Issue #252: Phase 3.1 - Implement AI difficulty tuning system
 */

import { EvaluationWeights, DefaultWeights } from './game-state-evaluator';

/**
 * Difficulty levels available in the game
 */
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'expert';

/**
 * Configuration for AI difficulty
 */
export interface AIDifficultyConfig {
  /** Difficulty level identifier */
  level: DifficultyLevel;
  /** Display name */
  displayName: string;
  /** Description of this difficulty */
  description: string;
  /** Randomness factor: 0 = perfect play, 1 = completely random */
  randomnessFactor: number;
  /** How many turns to look ahead in decision making */
  lookaheadDepth: number;
  /** Evaluation weights for game state assessment */
  evaluationWeights: EvaluationWeights;
  /** Whether to consider future states */
  useLookahead: boolean;
  /** Blunder chance: probability of making suboptimal moves */
  blunderChance: number;
  /** Tempo consideration: how much AI prioritizes immediate vs long-term advantage */
  tempoPriority: number;
  /** Risk tolerance: higher = more willing to take risks */
  riskTolerance: number;
}

/**
 * Complete difficulty configurations
 */
export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, AIDifficultyConfig> = {
  easy: {
    level: 'easy',
    displayName: 'Easy',
    description: 'AI makes more mistakes and plays randomly. Great for learning.',
    randomnessFactor: 0.4,
    lookaheadDepth: 1,
    evaluationWeights: {
      ...DefaultWeights.easy,
    },
    useLookahead: false,
    blunderChance: 0.25,
    tempoPriority: 0.3,
    riskTolerance: 0.2,
  },
  medium: {
    level: 'medium',
    displayName: 'Medium',
    description: 'Balanced AI opponent. Makes reasonable decisions with occasional mistakes.',
    randomnessFactor: 0.2,
    lookaheadDepth: 2,
    evaluationWeights: {
      ...DefaultWeights.medium,
    },
    useLookahead: true,
    blunderChance: 0.1,
    tempoPriority: 0.5,
    riskTolerance: 0.5,
  },
  hard: {
    level: 'hard',
    displayName: 'Hard',
    description: 'Skilled AI that makes few mistakes. Challenging for most players.',
    randomnessFactor: 0.1,
    lookaheadDepth: 3,
    evaluationWeights: {
      ...DefaultWeights.hard,
    },
    useLookahead: true,
    blunderChance: 0.05,
    tempoPriority: 0.7,
    riskTolerance: 0.7,
  },
  expert: {
    level: 'expert',
    displayName: 'Expert',
    description: 'Maximum AI challenge. Near-perfect play with deep lookahead.',
    randomnessFactor: 0.02,
    lookaheadDepth: 4,
    evaluationWeights: {
      lifeScore: 0.4,
      poisonScore: 12.0,
      cardAdvantage: 2.0,
      handQuality: 1.5,
      libraryDepth: 0.8,
      creaturePower: 2.0,
      creatureToughness: 1.5,
      creatureCount: 2.0,
      permanentAdvantage: 2.5,
      manaAvailable: 1.5,
      tempoAdvantage: 1.2,
      commanderDamageWeight: 5.0,
      commanderPresence: 2.0,
      cardSelection: 1.5,
      graveyardValue: 1.0,
      synergy: 1.0,
      winConditionProgress: 4.0,
      inevitability: 2.5,
    },
    useLookahead: true,
    blunderChance: 0.01,
    tempoPriority: 0.9,
    riskTolerance: 0.85,
  },
};

/**
 * Manages AI difficulty settings throughout the game
 */
export class AIDifficultyManager {
  private currentDifficulty: AIDifficultyConfig;
  private playerSelectedDifficulty: Map<string, DifficultyLevel> = new Map();

  constructor(difficulty: DifficultyLevel = 'medium') {
    this.currentDifficulty = DIFFICULTY_CONFIGS[difficulty];
  }

  /**
   * Set difficulty level for a specific AI opponent
   */
  setDifficulty(difficulty: DifficultyLevel, playerId?: string): void {
    if (playerId) {
      this.playerSelectedDifficulty.set(playerId, difficulty);
    } else {
      this.currentDifficulty = DIFFICULTY_CONFIGS[difficulty];
    }
  }

  /**
   * Get difficulty for a specific AI opponent
   */
  getDifficulty(playerId?: string): AIDifficultyConfig {
    if (playerId && this.playerSelectedDifficulty.has(playerId)) {
      return DIFFICULTY_CONFIGS[this.playerSelectedDifficulty.get(playerId)!];
    }
    return this.currentDifficulty;
  }

  /**
   * Get current difficulty level
   */
  getLevel(): DifficultyLevel {
    return this.currentDifficulty.level;
  }

  /**
   * Apply randomness to a decision (lower difficulty = more random)
   */
  applyRandomness<T>(options: T[], playerId?: string): T {
    const difficulty = this.getDifficulty(playerId);
    const randomFactor = difficulty.randomnessFactor;

    // Sometimes make a random choice based on difficulty
    if (Math.random() < randomFactor) {
      return options[Math.floor(Math.random() * options.length)];
    }

    // Otherwise return first option (will be evaluated properly)
    return options[0];
  }

  /**
   * Determine if AI should make a "blunder" (mistake)
   */
  shouldBlunder(playerId?: string): boolean {
    const difficulty = this.getDifficulty(playerId);
    return Math.random() < difficulty.blunderChance;
  }

  /**
   * Get lookahead depth for decision making
   */
  getLookaheadDepth(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.lookaheadDepth;
  }

  /**
   * Check if lookahead should be used
   */
  shouldUseLookahead(playerId?: string): boolean {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.useLookahead;
  }

  /**
   * Get evaluation weights for game state assessment
   */
  getEvaluationWeights(playerId?: string): EvaluationWeights {
    const difficulty = this.getDifficulty(playerId);
    return { ...difficulty.evaluationWeights };
  }

  /**
   * Get tempo priority for decisions
   */
  getTempoPriority(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.tempoPriority;
  }

  /**
   * Get risk tolerance for decisions
   */
  getRiskTolerance(playerId?: string): number {
    const difficulty = this.getDifficulty(playerId);
    return difficulty.riskTolerance;
  }

  /**
   * Get all available difficulty levels
   */
  getAvailableDifficulties(): AIDifficultyConfig[] {
    return Object.values(DIFFICULTY_CONFIGS);
  }

  /**
   * Create a modified difficulty config with custom parameters
   */
  createCustomDifficulty(
    baseLevel: DifficultyLevel,
    overrides: Partial<AIDifficultyConfig>
  ): AIDifficultyConfig {
    const base = DIFFICULTY_CONFIGS[baseLevel];
    return {
      ...base,
      ...overrides,
      level: 'medium' as DifficultyLevel, // Default to medium for custom
      displayName: overrides.displayName || `Custom (${base.displayName})`,
    };
  }
}

// Global instance for game-wide AI difficulty management
export const aiDifficultyManager = new AIDifficultyManager();

/**
 * Utility function to get difficulty config by level
 */
export function getDifficultyConfig(level: DifficultyLevel): AIDifficultyConfig {
  return DIFFICULTY_CONFIGS[level];
}

/**
 * Validate a difficulty level string
 */
export function isValidDifficulty(level: string): level is DifficultyLevel {
  return ['easy', 'medium', 'hard', 'expert'].includes(level);
}
