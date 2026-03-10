'use server';
/**
 * @fileOverview Heuristic-powered real-time gameplay assistance
 *
 * Issue #446: Remove AI provider dependencies
 * Replaced Genkit-based AI flows with heuristic algorithms.
 *
 * Provides:
 * - analyzeCurrentGameState - Analyze current game state and suggest plays
 * - getPlayRecommendation - Get specific card play recommendations
 * - getManaUsageAdvice - Suggest optimal mana usage
 * - evaluateBoardState - Provide overall board evaluation
 */

import { evaluateGameState, quickScore } from '@/ai/game-state-evaluator';
import { CombatDecisionTree, generateAttackDecisions } from '@/ai/decision-making/combat-decision-tree';
import { aiDifficultyManager, type DifficultyLevel } from '@/ai/ai-difficulty';

// Input schema for game state analysis
interface GameStateAnalysisInput {
  gameState: Record<string, unknown>;
  playerName: string;
}

// Output schema for game state analysis
interface GameStateAnalysisOutput {
  overallAssessment: string;
  suggestedPlays: Array<{
    cardName: string;
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
    manaCost?: number;
    expectedImpact: string;
  }>;
  warnings: Array<{
    type: 'danger' | 'caution' | 'info';
    message: string;
    relatedCards?: string[];
  }>;
  manaUsage: ManaAdviceOutput;
  boardThreats: Array<{
    card: string;
    threat: string;
    priority: 'immediate' | 'high' | 'medium' | 'low';
  }>;
  strategicAdvice: string[];
}

// Input schema for specific play analysis
interface PlayAnalysisInput {
  gameState: Record<string, unknown>;
  playerName: string;
  cardName: string;
  target?: string;
}

// Output schema for play analysis
interface PlayAnalysisOutput {
  isRecommended: boolean;
  rating: 'excellent' | 'good' | 'okay';
  reasoning: string;
  alternativePlays: Array<{
    cardName: string;
    rating: string;
    reason: string;
  }>;
  potentialUpgrades: string[];
}

// Input schema for mana advice
interface ManaAdviceInput {
  gameState: Record<string, unknown>;
  playerName: string;
}

// Output schema for mana advice
interface ManaAdviceOutput {
  availableMana: {
    total: number;
    colored: Record<string, number>;
    colorless: number;
  };
  suggestions: Array<{
    cardName?: string;
    action: string;
    manaCost: number;
    priority: string;
    reasoning: string;
  }>;
  optimal: boolean;
  unusedMana: number;
}

// Input schema for board evaluation
interface BoardEvaluationInput {
  gameState: Record<string, unknown>;
  playerName: string;
}

// Output schema for board evaluation
interface BoardEvaluationOutput {
  playerWinChance: number;
  boardAdvantage: 'winning' | 'slightly_ahead' | 'even' | 'slightly_behind' | 'losing';
  keyFactors: string[];
  cardsInHand: number;
  cardsInPlay: number;
  opponentCardsInHand: number;
  opponentCardsInPlay: number;
  recommendations: string[];
}

/**
 * Analyze current game state and provide comprehensive assistance
 */
export async function analyzeCurrentGameState(
  input: GameStateAnalysisInput
): Promise<GameStateAnalysisOutput> {
  const { gameState, playerName } = input;

  // Evaluate game state using heuristic evaluator
  const evaluation = evaluateGameState(gameState as any, playerName);
  const quickScoreVal = quickScore(gameState as any, playerName);

  // Generate suggested plays based on game state
  const suggestedPlays = generateSuggestedPlays(gameState, playerName);

  // Generate warnings based on game state
  const warnings = generateWarnings(gameState);

  // Analyze mana usage
  const manaUsage = analyzeManaUsage(gameState, playerName);

  // Identify board threats
  const boardThreats = identifyThreats(gameState, playerName);

  // Generate strategic advice
  const strategicAdvice = generateStrategicAdvice(evaluation, quickScoreVal);

  return {
    overallAssessment: generateOverallAssessment(evaluation, quickScoreVal),
    suggestedPlays,
    warnings,
    manaUsage,
    boardThreats,
    strategicAdvice,
  };
}

/**
 * Analyze a specific play being considered
 */
export async function analyzePlay(
  input: PlayAnalysisInput
): Promise<PlayAnalysisOutput> {
  const { gameState, playerName, cardName, target } = input;

  // Evaluate if this play is recommended using heuristics
  const evaluation = evaluatePlayHeuristic(gameState, playerName, cardName, target);

  return evaluation;
}

/**
 * Get mana usage advice
 */
export async function getManaAdvice(
  input: ManaAdviceInput
): Promise<ManaAdviceOutput> {
  const { gameState, playerName } = input;

  return analyzeManaUsage(gameState, playerName);
}

/**
 * Evaluate overall board state
 */
export async function evaluateBoardState(
  input: BoardEvaluationInput
): Promise<BoardEvaluationOutput> {
  const { gameState, playerName } = input;

  const evaluation = evaluateGameState(gameState as any, playerName);
  const quickScoreVal = quickScore(gameState as any, playerName);

  // Determine board advantage based on score difference
  let boardAdvantage: BoardEvaluationOutput['boardAdvantage'];
  if (quickScoreVal > 5) {
    boardAdvantage = 'winning';
  } else if (quickScoreVal > 2) {
    boardAdvantage = 'slightly_ahead';
  } else if (quickScoreVal > -2) {
    boardAdvantage = 'even';
  } else if (quickScoreVal > -5) {
    boardAdvantage = 'slightly_behind';
  } else {
    boardAdvantage = 'losing';
  }

  // Calculate win chance based on score
  const winChance = Math.min(Math.max((quickScoreVal + 10) * 5, 5), 95);

  return {
    playerWinChance: winChance,
    boardAdvantage,
    keyFactors: generateKeyFactors(evaluation),
    cardsInHand: evaluation.factors?.handQuality || 0,
    cardsInPlay: evaluation.factors?.permanentAdvantage || 0,
    opponentCardsInHand: 5, // Estimate
    opponentCardsInPlay: 5, // Estimate
    recommendations: generateBoardRecommendations(evaluation, quickScoreVal),
  };
}

// Helper functions

function generateOverallAssessment(evaluation: any, score: number): string {
  if (score > 5) {
    return "You have a strong board position with significant advantages.";
  } else if (score > 2) {
    return "You have a slight advantage. Continue building your board.";
  } else if (score > -2) {
    return "The game is evenly matched. Look for opportunities to gain advantage.";
  } else if (score > -5) {
    return "You're slightly behind. Focus on stabilizing and finding answers.";
  } else {
    return "You're in a difficult position. Prioritize survival and look for comeback opportunities.";
  }
}

function generateSuggestedPlays(gameState: any, playerName: string): GameStateAnalysisOutput['suggestedPlays'] {
  const plays: GameStateAnalysisOutput['suggestedPlays'] = [];

  // Suggest playing land if available
  if (gameState.hand && gameState.hand.length > 0) {
    const lands = gameState.hand.filter((card: any) => card.type_line?.includes('Land'));
    if (lands.length > 0) {
      plays.push({
        cardName: lands[0].name,
        priority: 'high',
        reasoning: "You should play a land to develop your mana base.",
        expectedImpact: "Increases available mana for future turns",
      });
    }
  }

  // Suggest casting creatures
  if (gameState.hand && gameState.hand.length > 0) {
    const creatures = gameState.hand.filter((card: any) => card.type_line?.includes('Creature'));
    creatures.slice(0, 2).forEach((creature: any) => {
      plays.push({
        cardName: creature.name,
        priority: 'medium',
        reasoning: `Cast ${creature.name} to develop your board presence.`,
        manaCost: creature.cmc,
        expectedImpact: "Adds a threat to the battlefield",
      });
    });
  }

  // Suggest removal if opponent has threats
  if (gameState.opponentBoard && gameState.opponentBoard.some((card: any) => card.type_line?.includes('Creature'))) {
    const removal = gameState.hand?.filter((card: any) =>
      card.type_line?.includes('Instant') || card.type_line?.includes('Sorcery')
    ).slice(0, 1);
    if (removal && removal.length > 0) {
      plays.push({
        cardName: removal[0].name,
        priority: 'high',
        reasoning: "Remove opponent's threat to maintain board control.",
        manaCost: removal[0].cmc,
        expectedImpact: "Neutralizes opponent's board presence",
      });
    }
  }

  return plays;
}

function generateWarnings(gameState: any): GameStateAnalysisOutput['warnings'] {
  const warnings: GameStateAnalysisOutput['warnings'] = [];

  // Low life warning
  if (gameState.life && gameState.life < 10) {
    warnings.push({
      type: 'danger',
      message: "Your life total is critically low. Prioritize defense and life gain.",
    });
  }

  // Hand empty warning
  if (!gameState.hand || gameState.hand.length === 0) {
    warnings.push({
      type: 'caution',
      message: "You have no cards in hand. Consider card draw options.",
    });
  }

  // Few lands warning
  if (gameState.board && gameState.board.filter((card: any) => card.type_line?.includes('Land')).length < 3) {
    warnings.push({
      type: 'info',
      message: "Consider developing your land base for consistent mana.",
    });
  }

  return warnings;
}

function analyzeManaUsage(gameState: any, playerName: string): ManaAdviceOutput {
  const availableMana = gameState.availableMana || { total: 0, colored: {}, colorless: 0 };
  const unusedMana = availableMana.total - (gameState.usedMana || 0);

  const suggestions: ManaAdviceOutput['suggestions'] = [];

  // Suggest using available mana
  if (unusedMana > 0 && gameState.hand && gameState.hand.length > 0) {
    const playableCards = gameState.hand.filter((card: any) => card.cmc <= unusedMana);
    playableCards.slice(0, 2).forEach((card: any) => {
      suggestions.push({
        cardName: card.name,
        action: `Cast ${card.name}`,
        manaCost: card.cmc,
        priority: card.type_line?.includes('Creature') ? 'high' : 'medium',
        reasoning: `Use available mana to play ${card.name}`,
      });
    });
  }

  // Suggest holding mana for instants
  if (unusedMana >= 2 && gameState.hand?.some((card: any) => card.type_line?.includes('Instant'))) {
    return {
      availableMana,
      suggestions,
      optimal: false,
      unusedMana,
    };
  }

  return {
    availableMana,
    suggestions,
    optimal: unusedMana <= 1,
    unusedMana,
  };
}

function identifyThreats(gameState: any, playerName: string): GameStateAnalysisOutput['boardThreats'] {
  const threats: GameStateAnalysisOutput['boardThreats'] = [];

  if (gameState.opponentBoard) {
    gameState.opponentBoard.forEach((card: any) => {
      if (card.type_line?.includes('Creature')) {
        let priority: GameStateAnalysisOutput['boardThreats'][0]['priority'];
        if (card.power >= 4) {
          priority = 'immediate';
        } else if (card.power >= 2) {
          priority = 'high';
        } else {
          priority = 'medium';
        }

        threats.push({
          card: card.name,
          threat: `${card.name} (${card.power}/${card.toughness})`,
          priority,
        });
      }
    });
  }

  return threats;
}

function generateStrategicAdvice(evaluation: any, score: number): string[] {
  const advice: string[] = [];

  if (score > 2) {
    advice.push("Continue building your advantage and close out the game.");
    advice.push("Consider aggressive plays to press your advantage.");
  } else if (score < -2) {
    advice.push("Focus on stabilizing and finding answers to opponent's threats.");
    advice.push("Look for comeback opportunities and card advantage.");
  } else {
    advice.push("Look for opportunities to gain incremental advantage.");
    advice.push("Consider both tempo and card advantage in your decisions.");
  }

  if (evaluation.handQuality && evaluation.handQuality < 3) {
    advice.push("Your hand is running low - consider card draw options.");
  }

  return advice;
}

function evaluatePlayHeuristic(
  gameState: any,
  playerName: string,
  cardName: string,
  target?: string
): PlayAnalysisOutput {
  // Simplified heuristic evaluation
  const card = gameState.hand?.find((c: any) => c.name === cardName);

  if (!card) {
    return {
      isRecommended: false,
      rating: 'okay',
      reasoning: 'Card not found in hand.',
      alternativePlays: [],
      potentialUpgrades: [],
    };
  }

  // Evaluate based on card type and cost
  let rating: PlayAnalysisOutput['rating'] = 'okay';
  let reasoning = 'This is a reasonable play.';

  if (card.type_line?.includes('Creature')) {
    if (card.cmc <= gameState.availableMana?.total) {
      rating = 'good';
      reasoning = 'Playing a creature develops your board presence.';
    }
  } else if (card.type_line?.includes('Instant')) {
    rating = 'excellent';
    reasoning = 'Instant-speed interaction provides flexibility.';
  } else if (card.type_line?.includes('Sorcery')) {
    rating = 'okay';
    reasoning = 'Sorcery can impact the board state effectively.';
  }

  return {
    isRecommended: true,
    rating,
    reasoning,
    alternativePlays: [],
    potentialUpgrades: [],
  };
}

function generateKeyFactors(evaluation: any): string[] {
  const factors: string[] = [];

  if (evaluation.lifeScore > 0) {
    factors.push("Healthy life total");
  }
  if (evaluation.cardAdvantage > 0) {
    factors.push("Card advantage");
  }
  if (evaluation.permanentAdvantage > 0) {
    factors.push("Board presence");
  }
  if (evaluation.manaAvailable > 0) {
    factors.push("Mana available");
  }

  return factors;
}

function generateBoardRecommendations(evaluation: any, score: number): string[] {
  const recommendations: string[] = [];

  if (score > 2) {
    recommendations.push("Consider aggressive plays to finish the game.");
  } else if (score < -2) {
    recommendations.push("Focus on defense and finding answers.");
  }

  if (evaluation.cardAdvantage < 0) {
    recommendations.push("Look for card draw opportunities.");
  }

  return recommendations;
}
