/**
 * @fileoverview AI Game State Evaluation System for Magic: The Gathering
 *
 * This module provides heuristic evaluation functions to assess board states,
 * card advantage, threats, and strategic opportunities for AI decision-making.
 * It serves as the foundation for AI opponent decision-making in gameplay.
 *
 * Key components:
 * - GameState interface: Represents the complete game state (unified format)
 * - Evaluation weights: Tunable parameters for different strategic factors
 * - Evaluation functions: Score various aspects of the game state
 * - Multi-factor evaluation: Combines all factors into a single score
 *
 * This module now uses the unified AIGameState format from the engine.
 * Use engineToAIState() from serialization.ts to convert engine state.
 */

// Import unified types from engine
import type {
  AIGameState as GameState,
  AIPlayerState as PlayerState,
  AIPermanent as Permanent,
  AIHandCard as HandCard,
  AITurnInfo as TurnInfo,
  AIStackObject as StackObject,
} from "@/lib/game-state/types";
import {
  getSequencingRecommendation,
  computeCurveConformance,
} from "./mana-sequencing";

// Re-export for backward compatibility
export type {
  GameState,
  PlayerState,
  Permanent,
  HandCard,
  TurnInfo,
  StackObject,
};

/**
 * Represents a threat assessment for a permanent
 */
export interface ThreatAssessment {
  permanentId: string;
  threatLevel: number; // 0-1 scale
  reason: string;
  urgency: "immediate" | "soon" | "eventual" | "low";
}

/**
 * Represents an opportunity assessment for a play
 */
export interface OpportunityAssessment {
  description: string;
  value: number;
  risk: number;
  requiredResources: string[];
}

/**
 * Weights for different evaluation factors
 * These can be tuned to adjust AI behavior and difficulty
 */
export interface EvaluationWeights {
  // Life and survival
  lifeScore: number;
  poisonScore: number;

  // Card advantage
  cardAdvantage: number;
  handQuality: number;
  libraryDepth: number;

  // Board presence
  creaturePower: number;
  creatureToughness: number;
  creatureCount: number;
  permanentAdvantage: number;

  // Mana and tempo
  manaAvailable: number;
  tempoAdvantage: number;

  // Commander-specific
  commanderDamageWeight: number;
  commanderPresence: number;

  // Strategic factors
  cardSelection: number; // Quality of cards in hand/graveyard
  graveyardValue: number;
  synergy: number;

  // Win conditions
  winConditionProgress: number;
  inevitability: number;

  // Stack interaction
  stackPressureScore: number;

  // Mana sequencing
  castedSequenceScore: number;
}

/**
 * Default evaluation weights for different difficulty levels
 * These weights are used by the AI to evaluate game states
 * Higher values = more importance placed on that factor
 */
export const DefaultWeights: Record<string, EvaluationWeights> = {
  easy: {
    // Easy AI: Prioritizes survival, ignores strategic advantage
    lifeScore: 1.5,
    poisonScore: 3.0,
    cardAdvantage: 0.3,
    handQuality: 0.2,
    libraryDepth: 0.1,
    creaturePower: 0.5,
    creatureToughness: 0.3,
    creatureCount: 0.3,
    permanentAdvantage: 0.3,
    manaAvailable: 0.2,
    tempoAdvantage: 0.2,
    commanderDamageWeight: 1.0,
    commanderPresence: 0.3,
    cardSelection: 0.2,
    graveyardValue: 0.1,
    synergy: 0.1,
    winConditionProgress: 0.5,
    inevitability: 0.3,
    stackPressureScore: 0.3,
    castedSequenceScore: 0.2,
  },
  medium: {
    // Medium AI: Balanced evaluation, understands basics
    lifeScore: 1.0,
    poisonScore: 6.0,
    cardAdvantage: 0.8,
    handQuality: 0.5,
    libraryDepth: 0.2,
    creaturePower: 1.0,
    creatureToughness: 0.8,
    creatureCount: 0.8,
    permanentAdvantage: 1.0,
    manaAvailable: 0.6,
    tempoAdvantage: 0.5,
    commanderDamageWeight: 2.5,
    commanderPresence: 0.8,
    cardSelection: 0.6,
    graveyardValue: 0.4,
    synergy: 0.3,
    winConditionProgress: 1.5,
    inevitability: 0.8,
    stackPressureScore: 1.0,
    castedSequenceScore: 0.5,
  },
  hard: {
    // Hard AI: Values strategic advantage and tempo
    lifeScore: 0.8,
    poisonScore: 9.0,
    cardAdvantage: 1.5,
    handQuality: 0.9,
    libraryDepth: 0.4,
    creaturePower: 1.5,
    creatureToughness: 1.2,
    creatureCount: 1.2,
    permanentAdvantage: 1.8,
    manaAvailable: 1.0,
    tempoAdvantage: 1.0,
    commanderDamageWeight: 4.0,
    commanderPresence: 1.5,
    cardSelection: 1.0,
    graveyardValue: 0.7,
    synergy: 0.7,
    winConditionProgress: 2.5,
    inevitability: 1.5,
    stackPressureScore: 1.5,
    castedSequenceScore: 0.8,
  },
  expert: {
    // Expert AI: Near-optimal weight distribution
    lifeScore: 0.6,
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
    stackPressureScore: 2.0,
    castedSequenceScore: 1.2,
  },
};

/**
 * Detailed evaluation result showing scores for each factor
 */
export interface DetailedEvaluation {
  totalScore: number;
  factors: {
    lifeScore: number;
    poisonScore: number;
    cardAdvantage: number;
    handQuality: number;
    libraryDepth: number;
    creaturePower: number;
    creatureToughness: number;
    creatureCount: number;
    permanentAdvantage: number;
    manaAvailable: number;
    tempoAdvantage: number;
    commanderDamage: number;
    commanderPresence: number;
    cardSelection: number;
    graveyardValue: number;
    synergy: number;
    winConditionProgress: number;
    inevitability: number;
    stackPressureScore: number;
    castedSequenceScore: number;
  };
  threats: ThreatAssessment[];
  opportunities: OpportunityAssessment[];
  recommendedActions: string[];
}

/**
 * Main evaluator class for game state assessment
 */
export class GameStateEvaluator {
  private weights: EvaluationWeights;
  private evaluatingPlayerId: string;
  private gameState: GameState;

  constructor(
    gameState: GameState,
    evaluatingPlayerId: string,
    difficulty: "easy" | "medium" | "hard" | "expert" = "medium",
  ) {
    this.gameState = gameState;
    this.evaluatingPlayerId = evaluatingPlayerId;
    this.weights = DefaultWeights[difficulty];
  }

  /**
   * Set custom evaluation weights
   */
  setWeights(weights: Partial<EvaluationWeights>): void {
    this.weights = { ...this.weights, ...weights };
  }

  /**
   * Get the current evaluation weights
   */
  getWeights(): EvaluationWeights {
    return { ...this.weights };
  }

  /**
   * Evaluate the entire game state for the evaluating player
   */
  evaluate(): DetailedEvaluation {
    const player = this.gameState.players[this.evaluatingPlayerId];
    const opponents = this.getOpponents();

    const factors = {
      lifeScore: this.evaluateLifeScore(player, opponents),
      poisonScore: this.evaluatePoisonScore(player),
      cardAdvantage: this.evaluateCardAdvantage(player, opponents),
      handQuality: this.evaluateHandQuality(player),
      libraryDepth: this.evaluateLibraryDepth(player),
      creaturePower: this.evaluateCreaturePower(player, opponents),
      creatureToughness: this.evaluateCreatureToughness(player, opponents),
      creatureCount: this.evaluateCreatureCount(player, opponents),
      permanentAdvantage: this.evaluatePermanentAdvantage(player, opponents),
      manaAvailable: this.evaluateManaAvailable(player),
      tempoAdvantage: this.evaluateTempoAdvantage(player, opponents),
      commanderDamage: this.evaluateCommanderDamage(player, opponents),
      commanderPresence: this.evaluateCommanderPresence(player),
      cardSelection: this.evaluateCardSelection(player),
      graveyardValue: this.evaluateGraveyardValue(player),
      synergy: this.evaluateSynergy(player),
      winConditionProgress: this.evaluateWinConditionProgress(
        player,
        opponents,
      ),
      inevitability: this.evaluateInevitability(player, opponents),
      stackPressureScore: this.evaluateStackPressureScore(player, opponents),
      castedSequenceScore: this.evaluateCastedSequenceScore(player),
    };

    const totalScore = this.calculateTotalScore(factors);

    const threats = this.assessThreats(player, opponents);
    const opportunities = this.identifyOpportunities(player, opponents);
    const recommendedActions = this.generateRecommendations(
      factors,
      threats,
      opportunities,
    );

    return {
      totalScore,
      factors,
      threats,
      opportunities,
      recommendedActions,
    };
  }

  /**
   * Get all opponent player states
   */
  private getOpponents(): PlayerState[] {
    return Object.values(this.gameState.players).filter(
      (p) => p.id !== this.evaluatingPlayerId,
    );
  }

  /**
   * Calculate total score from all factors
   */
  private calculateTotalScore(factors: DetailedEvaluation["factors"]): number {
    return (
      factors.lifeScore * this.weights.lifeScore +
      factors.poisonScore * this.weights.poisonScore +
      factors.cardAdvantage * this.weights.cardAdvantage +
      factors.handQuality * this.weights.handQuality +
      factors.libraryDepth * this.weights.libraryDepth +
      factors.creaturePower * this.weights.creaturePower +
      factors.creatureToughness * this.weights.creatureToughness +
      factors.creatureCount * this.weights.creatureCount +
      factors.permanentAdvantage * this.weights.permanentAdvantage +
      factors.manaAvailable * this.weights.manaAvailable +
      factors.tempoAdvantage * this.weights.tempoAdvantage +
      factors.commanderDamage * this.weights.commanderDamageWeight +
      factors.commanderPresence * this.weights.commanderPresence +
      factors.cardSelection * this.weights.cardSelection +
      factors.graveyardValue * this.weights.graveyardValue +
      factors.synergy * this.weights.synergy +
      factors.winConditionProgress * this.weights.winConditionProgress +
      factors.inevitability * this.weights.inevitability +
      factors.stackPressureScore * this.weights.stackPressureScore +
      factors.castedSequenceScore * this.weights.castedSequenceScore
    );
  }

  /**
   * Evaluate life total score
   * Returns normalized score (-1 to 1, positive is good)
   */
  private evaluateLifeScore(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const avgOpponentLife =
      opponents.reduce((sum, opp) => sum + opp.life, 0) / opponents.length;
    const lifeDiff = player.life - avgOpponentLife;

    // Normalize to -1 to 1 range (20 life difference is significant)
    return Math.max(-1, Math.min(1, lifeDiff / 20));
  }

  /**
   * Evaluate poison counter score (negative is bad)
   */
  private evaluatePoisonScore(player: PlayerState): number {
    // Poison counters are always bad
    // 10 poison = lethal
    return -player.poisonCounters / 10;
  }

  /**
   * Evaluate card advantage
   * Compares hand size + battlefield cards vs opponents
   */
  private evaluateCardAdvantage(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const playerResources =
      player.hand.length + player.battlefield.length + player.graveyard.length;

    const avgOpponentResources =
      opponents.reduce(
        (sum, opp) =>
          sum + opp.hand.length + opp.battlefield.length + opp.graveyard.length,
        0,
      ) / opponents.length;

    const advantageDiff = playerResources - avgOpponentResources;

    // Normalize: 3 card advantage is significant
    return Math.max(-1, Math.min(1, advantageDiff / 3));
  }

  /**
   * Evaluate hand quality based on mana value and card types
   */
  private evaluateHandQuality(player: PlayerState): number {
    if (player.hand.length === 0) return -0.5;

    // Calculate average mana value (lower is generally better early game)
    const avgManaValue =
      player.hand.reduce((sum, card) => sum + card.manaValue, 0) /
      player.hand.length;

    // Ideal hand curve depends on turn, but 2-3 is generally good
    const curveScore = 1 - Math.abs(avgManaValue - 2.5) / 3;

    // Bonus for having lands/mana sources
    const hasManaSources = player.hand.some((card) =>
      card.type.toLowerCase().includes("land"),
    );

    return curveScore * (hasManaSources ? 1 : 0.5);
  }

  /**
   * Evaluate library depth (running out of cards is bad)
   */
  private evaluateLibraryDepth(player: PlayerState): number {
    // Having more cards is generally good, but diminishing returns
    if (player.library > 20) return 1;
    if (player.library > 10) return 0.5;
    if (player.library > 5) return 0;
    return -1; // In danger of decking
  }

  /**
   * Evaluate creature power on battlefield
   */
  private evaluateCreaturePower(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const playerCreatures = player.battlefield.filter(
      (p) => p.type === "creature" && !p.tapped,
    );
    const playerPower = playerCreatures.reduce(
      (sum, c) => sum + (c.power || 0),
      0,
    );

    const avgOpponentPower =
      opponents.reduce((sum, opp) => {
        const oppCreatures = opp.battlefield.filter(
          (p) => p.type === "creature" && !p.tapped,
        );
        return sum + oppCreatures.reduce((s, c) => s + (c.power || 0), 0);
      }, 0) / opponents.length;

    const powerDiff = playerPower - avgOpponentPower;

    // Normalize: 7 power difference is significant
    return Math.max(-1, Math.min(1, powerDiff / 7));
  }

  /**
   * Evaluate creature toughness on battlefield
   */
  private evaluateCreatureToughness(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const playerCreatures = player.battlefield.filter(
      (p) => p.type === "creature" && !p.tapped,
    );
    const playerToughness = playerCreatures.reduce(
      (sum, c) => sum + (c.toughness || 0),
      0,
    );

    const avgOpponentToughness =
      opponents.reduce((sum, opp) => {
        const oppCreatures = opp.battlefield.filter(
          (p) => p.type === "creature" && !p.tapped,
        );
        return sum + oppCreatures.reduce((s, c) => s + (c.toughness || 0), 0);
      }, 0) / opponents.length;

    const toughnessDiff = playerToughness - avgOpponentToughness;

    // Normalize: 7 toughness difference is significant
    return Math.max(-1, Math.min(1, toughnessDiff / 7));
  }

  /**
   * Evaluate creature count advantage
   */
  private evaluateCreatureCount(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const playerCreatures = player.battlefield.filter(
      (p) => p.type === "creature",
    ).length;

    const avgOpponentCreatures =
      opponents.reduce(
        (sum, opp) =>
          sum + opp.battlefield.filter((p) => p.type === "creature").length,
        0,
      ) / opponents.length;

    const countDiff = playerCreatures - avgOpponentCreatures;

    // Normalize: 2 creature difference is significant
    return Math.max(-1, Math.min(1, countDiff / 2));
  }

  /**
   * Evaluate overall permanent advantage
   */
  private evaluatePermanentAdvantage(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const playerPermanents = player.battlefield.length;

    const avgOpponentPermanents =
      opponents.reduce((sum, opp) => sum + opp.battlefield.length, 0) /
      opponents.length;

    const permanentDiff = playerPermanents - avgOpponentPermanents;

    // Normalize: 3 permanent difference is significant
    return Math.max(-1, Math.min(1, permanentDiff / 3));
  }

  /**
   * Evaluate available mana
   */
  private evaluateManaAvailable(player: PlayerState): number {
    const totalMana = Object.values(player.manaPool).reduce(
      (sum, amount) => sum + amount,
      0,
    );

    // Having unused mana is inefficient, but having mana available is good
    // Normalize: 3-5 mana is ideal
    if (totalMana === 0) return -0.5;
    if (totalMana <= 5) return totalMana / 5;
    return 1 - (totalMana - 5) / 10; // Diminishing returns after 5
  }

  /**
   * Evaluate tempo advantage based on turn and phase
   */
  private evaluateTempoAdvantage(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const isCurrentPlayer = this.gameState.turnInfo.currentPlayer === player.id;
    const hasPriority = this.gameState.turnInfo.priority === player.id;

    let score = 0;

    if (isCurrentPlayer) score += 0.5;
    if (hasPriority) score += 0.3;

    // Check if we have more untapped lands/opportunities than opponents
    const playerUntappedLands = player.battlefield.filter(
      (p) => p.type === "land" && !p.tapped,
    ).length;

    const avgOpponentUntappedLands =
      opponents.reduce(
        (sum, opp) =>
          sum +
          opp.battlefield.filter((p) => p.type === "land" && !p.tapped).length,
        0,
      ) / opponents.length;

    if (playerUntappedLands > avgOpponentUntappedLands) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Evaluate commander damage (Commander format)
   */
  private evaluateCommanderDamage(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    if (
      !player.commanderDamage ||
      Object.keys(player.commanderDamage).length === 0
    ) {
      return 0;
    }

    // Check if we're dealing commander damage
    const damageDealt = Object.values(player.commanderDamage).reduce(
      (sum, dmg) => sum + dmg,
      0,
    );

    // Check if we're taking commander damage
    const damageTaken = opponents.reduce(
      (sum, opp) => sum + (opp.commanderDamage?.[player.id] || 0),
      0,
    );

    // 21 commander damage is lethal
    return (damageDealt - damageTaken) / 21;
  }

  /**
   * Evaluate commander presence on battlefield
   */
  private evaluateCommanderPresence(player: PlayerState): number {
    if (!this.gameState.commandZone) return 0;

    const commanderZone = this.gameState.commandZone[player.id];
    if (!commanderZone) return 0;

    // Check if commander is on battlefield
    const commanderOnBattlefield = player.battlefield.some(
      (p) =>
        (commanderZone.commander && p.id === commanderZone.commander.id) ||
        (commanderZone.partner && p.id === commanderZone.partner.id),
    );

    return commanderOnBattlefield ? 1 : 0;
  }

  /**
   * Evaluate card selection quality
   */
  private evaluateCardSelection(player: PlayerState): number {
    if (player.hand.length === 0) return -0.5;

    let qualityScore = 0;

    for (const card of player.hand) {
      // Bonus for interactive cards (instants, flash)
      if (card.type.toLowerCase().includes("instant")) {
        qualityScore += 0.2;
      }

      // Bonus for cards with low mana value (efficient)
      if (card.manaValue <= 2) {
        qualityScore += 0.1;
      }

      // Penalty for very expensive cards we can't cast yet
      if (card.manaValue >= 6) {
        qualityScore -= 0.1;
      }
    }

    // Normalize by hand size
    return Math.max(-1, Math.min(1, qualityScore / player.hand.length));
  }

  /**
   * Evaluate graveyard value (for recursion, flashback, etc.)
   */
  private evaluateGraveyardValue(player: PlayerState): number {
    if (player.graveyard.length === 0) return 0;

    // More cards in graveyard is generally better for recursion strategies
    // But could indicate we're losing resources
    return Math.min(1, player.graveyard.length / 10);
  }

  /**
   * Evaluate synergy between cards on battlefield and in hand
   */
  private evaluateSynergy(player: PlayerState): number {
    let synergyScore = 0;

    // Check for creature synergy (lords, tribal, etc.)
    const creatures = player.battlefield.filter((p) => p.type === "creature");
    const handCreatures = player.hand.filter((card) =>
      card.type.toLowerCase().includes("creature"),
    );

    // Bonus for having creatures that can work together
    if (creatures.length >= 2 && handCreatures.length >= 1) {
      synergyScore += 0.3;
    }

    // Check for mana ramp synergy
    const lands = player.battlefield.filter((p) => p.type === "land");
    const manaRampInHand = player.hand.some(
      (card) =>
        card.name.toLowerCase().includes("ramp") ||
        card.name.toLowerCase().includes("mana"),
    );

    if (lands.length >= 3 && manaRampInHand) {
      synergyScore += 0.2;
    }

    return Math.min(1, synergyScore);
  }

  /**
   * Evaluate progress toward win conditions
   */
  private evaluateWinConditionProgress(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    let progress = 0;

    // Aggro strategy: low opponent life
    const minOpponentLife = Math.min(...opponents.map((opp) => opp.life));
    if (minOpponentLife <= 10) progress += 0.5;
    if (minOpponentLife <= 5) progress += 0.3;

    // Mill strategy: opponent low library
    const minOpponentLibrary = Math.min(...opponents.map((opp) => opp.library));
    if (minOpponentLibrary <= 20) progress += 0.3;
    if (minOpponentLibrary <= 10) progress += 0.4;

    // Poison strategy: high poison counters on opponent
    const maxOpponentPoison = Math.max(
      ...opponents.map((opp) => opp.poisonCounters),
    );
    if (maxOpponentPoison >= 5) progress += 0.5;
    if (maxOpponentPoison >= 8) progress += 0.3;

    // Commander damage progress
    if (player.commanderDamage) {
      const maxDamageDealt = Math.max(...Object.values(player.commanderDamage));
      if (maxDamageDealt >= 10) progress += 0.3;
      if (maxDamageDealt >= 15) progress += 0.4;
    }

    return Math.min(1, progress);
  }

  /**
   * Evaluate inevitability (likelihood of winning if game goes long)
   */
  private evaluateInevitability(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    let inevitability = 0;

    // Card advantage leads to inevitability
    const playerCardCount = player.hand.length + player.library;
    const avgOpponentCardCount =
      opponents.reduce((sum, opp) => sum + opp.hand.length + opp.library, 0) /
      opponents.length;

    if (playerCardCount > avgOpponentCardCount + 5) {
      inevitability += 0.3;
    }

    // More powerful cards (higher mana value) in deck/graveyard
    const totalPermanents = player.battlefield.length;
    if (totalPermanents > 5) {
      inevitability += 0.2;
    }

    // Planeswalkers generate inevitability
    const planeswalkers = player.battlefield.filter(
      (p) => p.type === "planeswalker",
    );
    if (planeswalkers.length > 0) {
      inevitability += 0.3 * planeswalkers.length;
    }

    return Math.min(1, inevitability);
  }

  /**
   * Evaluate stack pressure score
   * Positive when the AI has responses, negative when opponents have open mana
   * and instant-speed answers
   */
  private evaluateStackPressureScore(
    player: PlayerState,
    opponents: PlayerState[],
  ): number {
    const stack = this.gameState.stack || [];

    if (stack.length === 0) {
      const opponentOpenMana = opponents.reduce((sum, opp) => {
        const oppMana = Object.values(opp.manaPool).reduce((s, m) => s + m, 0);
        const untappedLands = opp.battlefield.filter(
          (p) => p.type === "land" && !p.tapped,
        ).length;
        return sum + Math.max(oppMana, untappedLands);
      }, 0);

      const hasInstants = player.hand.some((card) =>
        card.type.toLowerCase().includes("instant"),
      );
      const hasFlashCreatures = player.hand.some(
        (card) =>
          card.type.toLowerCase().includes("creature") &&
          card.keywords?.some((kw) => kw.toLowerCase() === "flash"),
      );

      if (hasInstants || hasFlashCreatures) {
        if (opponentOpenMana >= 2) return 0.2;
        if (opponentOpenMana === 0) return 0.5;
      }

      if (opponentOpenMana >= 2) return -0.3;
      if (opponentOpenMana >= 4) return -0.5;

      return 0;
    }

    const opponentStackItems = stack.filter((item) =>
      opponents.some((opp) => opp.id === item.controller),
    );
    const playerStackItems = stack.filter(
      (item) => item.controller === this.evaluatingPlayerId,
    );

    let score = 0;

    if (playerStackItems.length > 0) {
      score -= 0.3;
      const hasCounterspells = player.hand.some(
        (card) =>
          card.type.toLowerCase().includes("instant") &&
          card.name.toLowerCase().includes("counter"),
      );
      if (hasCounterspells) score += 0.2;
    }

    if (opponentStackItems.length > 0) {
      const playerOpenMana = Object.values(player.manaPool).reduce(
        (s, m) => s + m,
        0,
      );
      const untappedLands = player.battlefield.filter(
        (p) => p.type === "land" && !p.tapped,
      ).length;
      const availableMana = Math.max(playerOpenMana, untappedLands);
      const hasInstants = player.hand.some((card) =>
        card.type.toLowerCase().includes("instant"),
      );

      if (hasInstants && availableMana >= 2) {
        score += 0.3;
      } else if (hasInstants) {
        score += 0.1;
      }
    }

    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Assess threats from opponents' battlefield
   */
  private evaluateCastedSequenceScore(player: PlayerState): number {
    const turnNumber = this.gameState.turnInfo.currentTurn;
    if (turnNumber > 6) {
      return computeCurveConformance(player.hand) * 0.5;
    }

    const totalMana = Object.values(player.manaPool).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const untappedLands = player.battlefield.filter(
      (p) => p.type === "land" && !p.tapped,
    ).length;
    const tappedLands = player.battlefield.filter(
      (p) => p.type === "land" && p.tapped,
    ).length;
    const hasChecklands = player.battlefield.some(
      (p) =>
        p.type === "land" &&
        p.keywords?.some((kw) => kw.toLowerCase() === "enters-tapped"),
    );

    const recommendation = getSequencingRecommendation(
      player.hand,
      totalMana,
      untappedLands,
      turnNumber,
      hasChecklands,
      tappedLands,
    );

    const curveBonus = computeCurveConformance(player.hand) * 0.3;

    return Math.max(-1, Math.min(1, recommendation.score + curveBonus));
  }

  private assessThreats(
    player: PlayerState,
    opponents: PlayerState[],
  ): ThreatAssessment[] {
    const threats: ThreatAssessment[] = [];

    for (const opponent of opponents) {
      for (const permanent of opponent.battlefield) {
        let threatLevel = 0;
        let reason = "";
        let urgency: ThreatAssessment["urgency"] = "low";

        if (permanent.type === "creature") {
          // Untapped creatures are threats
          if (!permanent.tapped) {
            const power = permanent.power || 0;
            threatLevel = Math.min(1, power / 10);
            reason = `${power} power creature can attack`;
            urgency =
              power >= 5 ? "immediate" : power >= 3 ? "soon" : "eventual";
          }
        } else if (permanent.type === "planeswalker") {
          // Planeswalkers are major threats
          const loyalty = permanent.loyalty || 0;
          threatLevel = 0.7;
          reason = `Planeswalker with ${loyalty} loyalty`;
          urgency = loyalty >= 5 ? "immediate" : "soon";
        } else if (permanent.type === "enchantment") {
          // Enchantures can be problematic
          threatLevel = 0.5;
          reason = "Active enchantment";
          urgency = "eventual";
        } else if (permanent.type === "artifact") {
          // Artifacts vary in threat level
          threatLevel = 0.4;
          reason = "Active artifact";
          urgency = "eventual";
        }

        if (threatLevel > 0) {
          threats.push({
            permanentId: permanent.id,
            threatLevel,
            reason,
            urgency,
          });
        }
      }
    }

    // Sort by threat level and urgency
    threats.sort((a, b) => {
      const urgencyOrder = { immediate: 0, soon: 1, eventual: 2, low: 3 };
      const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      if (urgencyDiff !== 0) return urgencyDiff;
      return b.threatLevel - a.threatLevel;
    });

    return threats.slice(0, 10); // Return top 10 threats
  }

  /**
   * Identify opportunities for plays
   */
  private identifyOpportunities(
    player: PlayerState,
    opponents: PlayerState[],
  ): OpportunityAssessment[] {
    const opportunities: OpportunityAssessment[] = [];

    // Opportunity: Cast creatures if ahead on board
    const creaturesInHand = player.hand.filter((card) =>
      card.type.toLowerCase().includes("creature"),
    );
    const opponentCreatures = opponents.reduce(
      (sum, opp) =>
        sum +
        opp.battlefield.filter((p) => p.type === "creature" && !p.tapped)
          .length,
      0,
    );
    const ourUntappedCreatures = player.battlefield.filter(
      (p) => p.type === "creature" && !p.tapped,
    ).length;

    if (
      creaturesInHand.length > 0 &&
      ourUntappedCreatures > opponentCreatures
    ) {
      opportunities.push({
        description: "Cast creature to maintain board advantage",
        value: 0.6,
        risk: 0.2,
        requiredResources: ["mana"],
      });
    }

    // Opportunity: Attack if opponent has low life
    const minOpponentLife = Math.min(...opponents.map((opp) => opp.life));
    if (ourUntappedCreatures > 0 && minOpponentLife <= 15) {
      opportunities.push({
        description: "Attack for lethal damage",
        value: 0.9,
        risk: 0.3,
        requiredResources: ["creatures"],
      });
    }

    // Opportunity: Hold up mana for interaction
    const instantsInHand = player.hand.filter((card) =>
      card.type.toLowerCase().includes("instant"),
    );
    if (instantsInHand.length > 0) {
      opportunities.push({
        description: "Hold mana for instant-speed interaction",
        value: 0.5,
        risk: 0.1,
        requiredResources: ["mana"],
      });
    }

    // Opportunity: Develop mana base
    const landsInHand = player.hand.filter((card) =>
      card.type.toLowerCase().includes("land"),
    );
    const landsOnBattlefield = player.battlefield.filter(
      (p) => p.type === "land",
    ).length;
    if (landsInHand.length > 0 && landsOnBattlefield < 5) {
      opportunities.push({
        description: "Play land to develop mana",
        value: 0.7,
        risk: 0.0,
        requiredResources: ["land-drop"],
      });
    }

    return opportunities;
  }

  /**
   * Generate recommended actions based on evaluation
   */
  private generateRecommendations(
    factors: DetailedEvaluation["factors"],
    threats: ThreatAssessment[],
    opportunities: OpportunityAssessment[],
  ): string[] {
    const recommendations: string[] = [];

    // Address threats
    const immediateThreats = threats.filter((t) => t.urgency === "immediate");
    if (immediateThreats.length > 0) {
      recommendations.push(
        `Deal with ${immediateThreats.length} immediate threat(s): ${immediateThreats
          .slice(0, 2)
          .map((t) => t.reason)
          .join(", ")}`,
      );
    }

    // Address life loss
    if (factors.lifeScore < -0.5) {
      recommendations.push("Prioritize defense and life gain");
    }

    // Address card disadvantage
    if (factors.cardAdvantage < -0.5) {
      recommendations.push("Find card draw or selection effects");
    }

    // Address board disadvantage
    if (factors.creatureCount < -0.5 || factors.creaturePower < -0.5) {
      recommendations.push("Develop board presence with creatures");
    }

    // Capitalize on opportunities
    if (opportunities.length > 0) {
      const bestOpportunity = opportunities.reduce((prev, current) =>
        prev.value > current.value ? prev : current,
      );
      recommendations.push(`Consider: ${bestOpportunity.description}`);
    }

    // Push toward win condition
    if (factors.winConditionProgress > 0.7) {
      recommendations.push("Close out the game - win condition is near");
    }

    return recommendations;
  }
}

/**
 * Convenience function to evaluate a game state
 */
export function evaluateGameState(
  gameState: GameState,
  playerId: string,
  difficulty: "easy" | "medium" | "hard" = "medium",
): DetailedEvaluation {
  const evaluator = new GameStateEvaluator(gameState, playerId, difficulty);
  return evaluator.evaluate();
}

/**
 * Compare two game states to see which is better for a player
 * Returns positive if state2 is better than state1
 */
export function compareGameStates(
  state1: GameState,
  state2: GameState,
  playerId: string,
  difficulty: "easy" | "medium" | "hard" = "medium",
): number {
  const eval1 = evaluateGameState(state1, playerId, difficulty);
  const eval2 = evaluateGameState(state2, playerId, difficulty);
  return eval2.totalScore - eval1.totalScore;
}

/**
 * Get a quick heuristic score for a game state (lighter weight evaluation)
 */
export function quickScore(
  gameState: GameState,
  playerId: string,
  difficulty: "easy" | "medium" | "hard" = "medium",
): number {
  const evaluation = evaluateGameState(gameState, playerId, difficulty);
  return evaluation.totalScore;
}

export interface ProposedPlay {
  card: HandCard;
  type: "cast_creature" | "cast_instant" | "cast_sorcery" | "play_land";
  manaCost: number;
  producedPermanent?: {
    type: "creature" | "land" | "artifact" | "enchantment" | "planeswalker";
    power?: number;
    toughness?: number;
    loyalty?: number;
  };
}

export interface ProjectionResult {
  playNowScore: number;
  holdScore: number;
  recommendation: "play" | "hold";
  scoreDelta: number;
}

function deepCloneState(state: GameState): GameState {
  const cloned_players: { [playerId: string]: PlayerState } = {};
  for (const [id, p] of Object.entries(state.players)) {
    cloned_players[id] = {
      ...p,
      hand: [...p.hand],
      battlefield: p.battlefield.map((perm) => ({ ...perm })),
      graveyard: [...p.graveyard],
      exile: [...p.exile],
      manaPool: { ...p.manaPool },
      commanderDamage: { ...p.commanderDamage },
    };
  }
  return {
    ...state,
    players: cloned_players,
    stack: state.stack.map((s) => ({ ...s })),
    turnInfo: { ...state.turnInfo },
  };
}

export function projectBoardState(
  current_state: GameState,
  play: ProposedPlay,
): GameState {
  const projected = deepCloneState(current_state);
  const player_id = Object.keys(projected.players)[0];
  const player = projected.players[player_id];

  const card_index = player.hand.findIndex(
    (c) => c.cardInstanceId === play.card.cardInstanceId,
  );
  if (card_index !== -1) {
    player.hand.splice(card_index, 1);
  }

  if (play.type === "play_land") {
    const new_permanent: Permanent = {
      cardInstanceId: `proj-land-${play.card.cardInstanceId}`,
      id: `proj-land-${play.card.cardInstanceId}`,
      name: play.card.name,
      type: "land",
      controller: player_id,
      tapped: false,
      manaValue: play.card.manaValue,
    };
    player.battlefield.push(new_permanent);
    player.landsPlayedThisTurn = (player.landsPlayedThisTurn || 0) + 1;
  } else if (play.producedPermanent) {
    const new_permanent: Permanent = {
      cardInstanceId: `proj-${play.card.cardInstanceId}`,
      id: `proj-${play.card.cardInstanceId}`,
      name: play.card.name,
      type: play.producedPermanent.type,
      controller: player_id,
      tapped: false,
      manaValue: play.card.manaValue,
      power: play.producedPermanent.power,
      toughness: play.producedPermanent.toughness,
      loyalty: play.producedPermanent.loyalty,
      summoningSickness: play.producedPermanent.type === "creature",
    };
    player.battlefield.push(new_permanent);
  } else {
    player.graveyard.push(play.card.cardInstanceId);
  }

  const generic = Math.min(play.manaCost, player.manaPool.generic || 0);
  player.manaPool.generic -= generic;
  const remaining = play.manaCost - generic;
  const colors = ["white", "blue", "black", "red", "green"] as const;
  for (const color of colors) {
    const deduction = Math.min(remaining, player.manaPool[color] || 0);
    (player.manaPool as Record<string, number>)[color] -= deduction;
  }

  return projected;
}

function advanceOneTurn(state: GameState, player_id: string): GameState {
  const projected = deepCloneState(state);
  const opponent_ids = Object.keys(projected.players).filter(
    (id) => id !== player_id,
  );
  const next_player = opponent_ids[0] || player_id;

  projected.turnInfo.currentTurn += 1;
  projected.turnInfo.currentPlayer = next_player;
  projected.turnInfo.priority = next_player;
  projected.turnInfo.phase = "precombat_main";

  for (const id of Object.keys(projected.players)) {
    const p = projected.players[id];
    p.library = Math.max(0, p.library - 1);
    for (const perm of p.battlefield) {
      if (perm.controller === id) {
        perm.tapped = false;
        perm.summoningSickness = false;
      }
    }
    p.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    };
  }

  return projected;
}

export function compareHoldVsPlay(
  current_state: GameState,
  play: ProposedPlay,
  player_id: string,
  difficulty: "easy" | "medium" | "hard" = "medium",
): ProjectionResult {
  const played_state = projectBoardState(current_state, play);
  const played_next_turn = advanceOneTurn(played_state, player_id);
  const play_now_score = quickScore(played_next_turn, player_id, difficulty);

  const held_next_turn = advanceOneTurn(current_state, player_id);
  const hold_score = quickScore(held_next_turn, player_id, difficulty);

  const score_delta = play_now_score - hold_score;

  return {
    playNowScore: play_now_score,
    holdScore: hold_score,
    recommendation: score_delta >= 0 ? "play" : "hold",
    scoreDelta: score_delta,
  };
}
