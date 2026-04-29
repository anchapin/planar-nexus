/**
 * AI Difficulty Tuning System
 *
 * Provides configurable difficulty levels for AI opponents.
 * Controls randomness, lookahead depth, and evaluation accuracy.
 *
 * Issue #252: Phase 3.1 - Implement AI difficulty tuning system
 */

import { EvaluationWeights, DefaultWeights } from "./game-state-evaluator";

/**
 * Difficulty levels available in the game
 */
export type DifficultyLevel = "easy" | "medium" | "hard" | "expert";

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
 *
 * Each difficulty level is tuned to provide a distinct challenge level:
 * - Easy: Beginner-friendly, makes obvious mistakes, prioritizes survival
 * - Medium: Balanced opponent, reasonable plays with occasional errors
 * - Hard: Challenging for experienced players, values advantage and tempo
 * - Expert: Near-optimal play, punishes mistakes, deep strategic thinking
 *
 * Target win rates (player vs AI):
 * - Easy: ~80% player win rate
 * - Medium: ~60% player win rate
 * - Hard: ~40% player win rate
 * - Expert: ~25% player win rate
 */
export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, AIDifficultyConfig> = {
  easy: {
    level: "easy",
    displayName: "Easy",
    description:
      "Makes frequent mistakes and random plays. Perfect for learning the game.",
    randomnessFactor: 0.4,
    lookaheadDepth: 1,
    evaluationWeights: {
      // Easy AI prioritizes survival over strategic advantage
      // Low weights mean it ignores long-term planning
      lifeScore: 1.5, // High: strongly values staying alive
      poisonScore: 3.0, // Low: doesn't understand poison threat well
      cardAdvantage: 0.3, // Low: ignores card advantage
      handQuality: 0.2, // Low: doesn't evaluate hand quality
      libraryDepth: 0.1, // Low: ignores mill risk
      creaturePower: 0.5, // Low: undervalues attacking power
      creatureToughness: 0.3, // Low: ignores creature survivability
      creatureCount: 0.3, // Low: doesn't value board presence
      permanentAdvantage: 0.3, // Low: ignores permanent advantage
      manaAvailable: 0.2, // Low: inefficient mana usage
      tempoAdvantage: 0.2, // Low: doesn't understand tempo
      commanderDamageWeight: 1.0, // Low: ignores commander damage
      commanderPresence: 0.3, // Low: undervalues commander
      cardSelection: 0.2, // Low: poor card evaluation
      graveyardValue: 0.1, // Low: ignores graveyard resources
      synergy: 0.1, // Low: doesn't recognize synergies
      winConditionProgress: 0.5, // Low: slow to close games
      inevitability: 0.3, // Low: doesn't plan for long game
      stackPressureScore: 0.1, // Low: ignores stack dynamics
      castedSequenceScore: 0.1, // Low: ignores mana sequencing
    },
    useLookahead: false,
    blunderChance: 0.25,
    tempoPriority: 0.3,
    riskTolerance: 0.2,
  },
  medium: {
    level: "medium",
    displayName: "Medium",
    description:
      "Balanced opponent. Makes reasonable plays but can be outsmarted.",
    randomnessFactor: 0.2,
    lookaheadDepth: 2,
    evaluationWeights: {
      // Medium AI has balanced evaluation - understands basics but not advanced strategy
      lifeScore: 1.0, // Moderate: values life but not obsessed
      poisonScore: 6.0, // Moderate: respects poison threat
      cardAdvantage: 0.8, // Moderate: understands card advantage basics
      handQuality: 0.5, // Moderate: evaluates hand somewhat
      libraryDepth: 0.2, // Low-moderate: aware of mill risk
      creaturePower: 1.0, // Moderate: values attacking power
      creatureToughness: 0.8, // Moderate: considers creature survivability
      creatureCount: 0.8, // Moderate: values board presence
      permanentAdvantage: 1.0, // Moderate: understands permanent advantage
      manaAvailable: 0.6, // Moderate: decent mana efficiency
      tempoAdvantage: 0.5, // Moderate: understands tempo basics
      commanderDamageWeight: 2.5, // Moderate: respects commander damage
      commanderPresence: 0.8, // Moderate: values commander
      cardSelection: 0.6, // Moderate: decent card evaluation
      graveyardValue: 0.4, // Low-moderate: some graveyard awareness
      synergy: 0.3, // Low: basic synergy recognition
      winConditionProgress: 1.5, // Moderate: pushes win conditions
      inevitability: 0.8, // Moderate: plans ahead somewhat
      stackPressureScore: 0.5, // Moderate: basic stack awareness
      castedSequenceScore: 0.3, // Moderate: basic sequencing
    },
    useLookahead: true,
    blunderChance: 0.1,
    tempoPriority: 0.5,
    riskTolerance: 0.5,
  },
  hard: {
    level: "hard",
    displayName: "Hard",
    description: "Skilled opponent. Makes few mistakes and punishes errors.",
    randomnessFactor: 0.1,
    lookaheadDepth: 3,
    evaluationWeights: {
      // Hard AI values strategic advantage and tempo - challenging for experienced players
      lifeScore: 0.8, // Lower: willing to trade life for advantage
      poisonScore: 9.0, // High: very respectful of poison
      cardAdvantage: 1.5, // High: strongly values card advantage
      handQuality: 0.9, // High: good hand evaluation
      libraryDepth: 0.4, // Moderate: manages library carefully
      creaturePower: 1.5, // High: values aggressive positioning
      creatureToughness: 1.2, // High: considers creature trades carefully
      creatureCount: 1.2, // High: values board control
      permanentAdvantage: 1.8, // High: fights for permanent advantage
      manaAvailable: 1.0, // High: efficient mana usage
      tempoAdvantage: 1.0, // High: understands tempo importance
      commanderDamageWeight: 4.0, // High: uses commander damage strategically
      commanderPresence: 1.5, // High: leverages commander well
      cardSelection: 1.0, // High: excellent card evaluation
      graveyardValue: 0.7, // Moderate-high: utilizes graveyard
      synergy: 0.7, // Moderate-high: recognizes synergies
      winConditionProgress: 2.5, // High: aggressively pursues wins
      inevitability: 1.5, // High: plans for long game
      stackPressureScore: 1.0, // High: exploits stack windows
      castedSequenceScore: 0.6, // High: optimizes sequencing
    },
    useLookahead: true,
    blunderChance: 0.05,
    tempoPriority: 0.7,
    riskTolerance: 0.7,
  },
  expert: {
    level: "expert",
    displayName: "Expert",
    description:
      "Near-perfect play. Deep lookahead and optimal decision-making.",
    randomnessFactor: 0.05,
    lookaheadDepth: 4,
    evaluationWeights: {
      // Expert AI has near-optimal weight distribution - minimal weaknesses
      lifeScore: 0.6, // Optimized: trades life efficiently for value
      poisonScore: 12.0, // Maximum: understands poison is lethal
      cardAdvantage: 2.0, // Maximum: card advantage is king
      handQuality: 1.5, // High: excellent hand assessment
      libraryDepth: 0.8, // High: manages deck resources optimally
      creaturePower: 2.0, // High: maximizes combat advantage
      creatureToughness: 1.5, // High: optimal creature trading
      creatureCount: 2.0, // High: dominates board states
      permanentAdvantage: 2.5, // Maximum: controls battlefield
      manaAvailable: 1.5, // High: perfect mana efficiency
      tempoAdvantage: 1.2, // High: tempo-focused play
      commanderDamageWeight: 5.0, // Maximum: lethal commander math
      commanderPresence: 2.0, // High: commander-centric strategy
      cardSelection: 1.5, // High: best card choices
      graveyardValue: 1.0, // High: full graveyard utilization
      synergy: 1.0, // High: maximizes card synergies
      winConditionProgress: 4.0, // Maximum: closes games efficiently
      inevitability: 2.5, // Maximum: unbeatable in long games
      stackPressureScore: 2.0, // Maximum: master of stack manipulation
      castedSequenceScore: 1.0, // Maximum: perfect mana sequencing
    },
    useLookahead: true,
    blunderChance: 0.02,
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

  constructor(difficulty: DifficultyLevel = "medium") {
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
    overrides: Partial<AIDifficultyConfig>,
  ): AIDifficultyConfig {
    const base = DIFFICULTY_CONFIGS[baseLevel];
    return {
      ...base,
      ...overrides,
      level: "medium" as DifficultyLevel, // Default to medium for custom
      displayName: overrides.displayName || `Custom (${base.displayName})`,
    };
  }
}

// Global instance for game-wide AI difficulty management
export const aiDifficultyManager = new AIDifficultyManager();

/**
 * Utility function to get difficulty config by level
 */
export function getDifficultyConfig(
  level: DifficultyLevel,
): AIDifficultyConfig {
  return DIFFICULTY_CONFIGS[level];
}

/**
 * Validate a difficulty level string
 */
export function isValidDifficulty(level: string): level is DifficultyLevel {
  return ["easy", "medium", "hard", "expert"].includes(level);
}
