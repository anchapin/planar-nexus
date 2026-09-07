/**
 * AI Opponent class for single-player games
 *
 * Extracted verbatim from `src/app/(app)/game/[id]/page.tsx` (issue #1715).
 * This is the page's turn-by-turn decision driver: it converts the engine
 * state via the AI game-state adapter and delegates to the
 * `GameStateEvaluator` / `CombatDecisionTree` heuristics.
 */

import type { GameState } from "@/lib/game-state";
import type { Permanent } from "@/ai/game-state-evaluator";
import { GameStateEvaluator } from "@/ai/game-state-evaluator";
import { getDifficultyConfig, type DifficultyLevel } from "@/ai/ai-difficulty";
import { CombatDecisionTree } from "@/ai/decision-making";
import { convertToAIGameState } from "@/lib/ai-game-state-adapter";
import { gameLogger } from "@/lib/logger";

/**
 * AI decision data types
 */
export interface AttackDecisionData {
  attackers: string[];
}

export interface BlockDecisionData {
  blockers: { [attackerId: string]: string[] };
}

export interface ManaDecisionData {
  cardId: string;
}

export type AIDecisionData =
  AttackDecisionData | BlockDecisionData | ManaDecisionData | undefined;

/**
 * AI Opponent class for single-player games
 */
export class AIOpponent {
  private difficulty: DifficultyLevel;
  private evaluator: GameStateEvaluator | null = null;
  private combatDecider: CombatDecisionTree | null = null;

  constructor(difficulty: DifficultyLevel = "medium") {
    this.difficulty = difficulty;
  }

  /**
   * Evaluate the current game state from AI's perspective
   */
  evaluateState(
    gameState: GameState,
    aiPlayerId: string,
  ): { score: number; recommendations: string[] } {
    try {
      const aiState = convertToAIGameState(gameState, aiPlayerId);
      this.evaluator = new GameStateEvaluator(
        aiState,
        aiPlayerId,
        this.difficulty,
      );
      const evaluation = this.evaluator.evaluate();

      return {
        score: evaluation.totalScore,
        recommendations: evaluation.recommendedActions,
      };
    } catch (error) {
      gameLogger.error("AI evaluation error:", error);
      return { score: 0, recommendations: [] };
    }
  }

  /**
   * Decide whether to attack
   */
  shouldAttack(gameState: GameState, aiPlayerId: string): boolean {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    const attackPlan = this.combatDecider.generateAttackPlan();
    return attackPlan.attacks.length > 0;
  }

  /**
   * Decide which creatures to attack with
   */
  getAttackers(gameState: GameState, aiPlayerId: string): string[] {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    const attackPlan = this.combatDecider.generateAttackPlan();
    return attackPlan.attacks.map((a) => a.creatureId);
  }

  /**
   * Decide whether to block and with what
   */
  getBlockers(
    gameState: GameState,
    aiPlayerId: string,
    _attackerIds: string[],
  ): { [attackerId: string]: string[] } {
    const aiState = convertToAIGameState(gameState, aiPlayerId);
    this.combatDecider = new CombatDecisionTree(
      aiState,
      aiPlayerId,
      this.difficulty,
    );

    // Convert real engine attackers to Permanent objects for the combat decider
    const attackers: Permanent[] = [];
    for (const a of gameState.combat.attackers) {
      const card = gameState.cards.get(a.cardId);
      if (!card) continue;
      const typeLine = card.cardData.type_line.toLowerCase();
      let permanentType: Permanent["type"] = "creature";
      if (typeLine.includes("land")) permanentType = "land";
      else if (typeLine.includes("artifact")) permanentType = "artifact";
      else if (typeLine.includes("enchantment")) permanentType = "enchantment";
      else if (typeLine.includes("planeswalker"))
        permanentType = "planeswalker";
      else if (typeLine.includes("creature")) permanentType = "creature";

      attackers.push({
        id: card.id,
        cardInstanceId: card.id,
        name: card.cardData.name,
        type: permanentType,
        controller: card.controllerId,
        tapped: card.isTapped,
        power: card.cardData.power ? parseInt(card.cardData.power) : 0,
        toughness: card.cardData.toughness
          ? parseInt(card.cardData.toughness)
          : 0,
        manaValue: card.cardData.cmc,
      } as Permanent);
    }

    const blockPlan = this.combatDecider.generateBlockingPlan(attackers);

    const assignments: { [attackerId: string]: string[] } = {};
    blockPlan.blocks.forEach((b) => {
      if (b.attackerId && b.blockerId) {
        if (!assignments[b.attackerId]) assignments[b.attackerId] = [];
        assignments[b.attackerId].push(b.blockerId);
      }
    });

    return assignments;
  }

  /**
   * Make a decision for the AI's turn
   */
  makeDecision(
    gameState: GameState,
    aiPlayerId: string,
  ): {
    action:
      "play_land" | "cast_spell" | "attack" | "block" | "pass" | "tap_mana";
    data?: AIDecisionData;
  } {
    const config = getDifficultyConfig(this.difficulty);

    // Apply randomness based on difficulty
    if (Math.random() < config.randomnessFactor) {
      // Make a random/silly move
      return { action: "pass" };
    }

    // Phase-specific decisions
    if (gameState.turn.currentPhase === "declare_attackers") {
      const attackers = this.getAttackers(gameState, aiPlayerId);
      if (attackers.length > 0) {
        return { action: "attack", data: { attackers } as AttackDecisionData };
      }
      return { action: "pass" };
    }

    if (gameState.turn.currentPhase === "declare_blockers") {
      return { action: "block" };
    }

    const evaluation = this.evaluateState(gameState, aiPlayerId);

    // Simple decision logic based on evaluation
    if (evaluation.score > 0.5) {
      // Ahead - play aggressively
      return { action: "play_land" };
    } else if (evaluation.score < -0.5) {
      // Behind - play defensively
      return { action: "pass" };
    }

    // Default: play lands and develop board
    return { action: "play_land" };
  }
}
