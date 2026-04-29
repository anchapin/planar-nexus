/**
 * @fileOverview Heuristic-powered real-time gameplay assistance
 *
 * Issue #446: Remove AI provider dependencies
 * Issue #565: Enforce strict typing in AI flows and state transitions
 * Replaced Genkit-based AI flows with heuristic algorithms.
 *
 * Provides:
 * - analyzeCurrentGameState - Analyze current game state and suggest plays
 * - getPlayRecommendation - Get specific card play recommendations
 * - getManaUsageAdvice - Suggest optimal mana usage
 * - evaluateBoardState - Provide overall board evaluation
 */

import { evaluateGameState, quickScore, GameState } from '@/ai/game-state-evaluator';
import { enforceRateLimit, aiRequestQueue, RateLimitError } from '@/lib/rate-limiter';
import { analyzeMulligan } from '@/ai/mulligan-advisor';
import type { Card, GameEvaluation, ManaBreakdown } from '@/ai/types';
import type { PlayerState as EvaluatorPlayerState, Permanent } from '@/ai/game-state-evaluator';

/**
 * Type guard to check if a card is a Land
 */
function isLandCard(card: unknown): card is Card & { type: string } {
  return (
    typeof card === 'object' &&
    card !== null &&
    'type' in card &&
    typeof (card as Record<string, unknown>).type === 'string' &&
    String((card as Record<string, unknown>).type).includes('Land')
  );
}

/**
 * Type guard to check if a card is a Creature
 */
function isCreatureCard(card: unknown): card is Card & { type: string } {
  return (
    typeof card === 'object' &&
    card !== null &&
    'type' in card &&
    typeof (card as Record<string, unknown>).type === 'string' &&
    String((card as Record<string, unknown>).type).includes('Creature')
  );
}

/**
 * Type guard to check if a card is an Instant or Sorcery
 */
function isInstantOrSorceryCard(card: unknown): card is Card & { type: string } {
  return (
    typeof card === 'object' &&
    card !== null &&
    'type' in card &&
    typeof (card as Record<string, unknown>).type === 'string' &&
    (String((card as Record<string, unknown>).type).includes('Instant') ||
      String((card as Record<string, unknown>).type).includes('Sorcery'))
  );
}

/**
 * Type guard to check if a permanent is a creature
 */
function isCreaturePermanent(permanent: unknown): permanent is Permanent & { type: 'creature' } {
  return (
    typeof permanent === 'object' &&
    permanent !== null &&
    'type' in permanent &&
    (permanent as Record<string, unknown>).type === 'creature'
  );
}

/**
 * Type guard to check if a permanent is a land
 */
function isLandPermanent(permanent: unknown): permanent is Permanent & { type: 'land' } {
  return (
    typeof permanent === 'object' &&
    permanent !== null &&
    'type' in permanent &&
    (permanent as Record<string, unknown>).type === 'land'
  );
}

/**
 * Helper type for card with mana value
 */
interface CardWithManaValue extends Card {
  manaValue?: number;
  mana_cost?: string;
}

/**
 * Helper function to filter lands from hand using type guards
 */
function filterLandsFromHand(hand: Card[] | undefined): Card[] {
  if (!hand || !Array.isArray(hand)) return [];
  return hand.filter(isLandCard);
}

/**
 * Helper function to filter creatures from hand using type guards
 */
function filterCreaturesFromHand(hand: Card[] | undefined): Card[] {
  if (!hand || !Array.isArray(hand)) return [];
  return hand.filter(isCreatureCard);
}

/**
 * Helper function to filter instants/sorceries from hand using type guards
 */
function filterInstantOrSorceryFromHand(hand: Card[] | undefined): Card[] {
  if (!hand || !Array.isArray(hand)) return [];
  return hand.filter(isInstantOrSorceryCard);
}

/**
 * Helper function to check if player has creature threats on battlefield
 */
function hasCreatureThreats(battlefield: Permanent[] | undefined): boolean {
  if (!battlefield || !Array.isArray(battlefield)) return false;
  return battlefield.some(isCreaturePermanent);
}

/**
 * Helper function to count lands on battlefield
 */
function countLandsOnBattlefield(battlefield: Permanent[] | undefined): number {
  if (!battlefield || !Array.isArray(battlefield)) return 0;
  return battlefield.filter(isLandPermanent).length;
}

/**
 * Helper function to filter playable cards by mana value (using cmc)
 */
function filterPlayableCardsByMana(hand: Card[] | undefined, maxMana: number): CardWithManaValue[] {
  if (!hand || !Array.isArray(hand)) return [];
  return hand.filter(
    (card): card is CardWithManaValue => {
      const cardUnknown = card as unknown as Record<string, unknown>;
      const manaValue = cardUnknown.manaValue as number | undefined;
      const cmc = card.cmc;
      const value = manaValue ?? cmc ?? 0;
      return typeof value === 'number' && value <= maxMana;
    }
  );
}

/**
 * Helper function to check if hand has instant cards
 */
function hasInstantInHand(hand: Card[] | undefined): boolean {
  if (!hand || !Array.isArray(hand)) return false;
  return hand.some(isInstantOrSorceryCard);
}

/**
 * Helper function to find a card by name in hand
 */
function findCardInHandByName(hand: Card[] | undefined, cardName: string): CardWithManaValue | undefined {
  if (!hand || !Array.isArray(hand)) return undefined;
  const found = hand.find((card) => typeof card === 'object' && card !== null && 'name' in card && card.name === cardName);
  return found as CardWithManaValue | undefined;
}

// Input schema for game state analysis
interface GameStateAnalysisInput {
  gameState: GameState;
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
  gameState: GameState;
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
  gameState: GameState;
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
  gameState: GameState;
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
  
  // Enforce rate limiting
  try {
    enforceRateLimit(playerName);
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new Error(
        `Rate limit exceeded. Please wait ${Math.ceil(error.retryAfter / 1000)} seconds before making another request.`
      );
    }
    throw error;
  }

  // Queue the request for processing
  return aiRequestQueue.add(async () => {
    // Evaluate game state using heuristic evaluator
    const evaluation = evaluateGameState(gameState, playerName);
    const quickScoreVal = quickScore(gameState, playerName);

    // Generate suggested plays based on game state
    const suggestedPlays = generateSuggestedPlays(gameState, playerName);

    // Generate warnings based on game state
    const warnings = generateWarnings(gameState, playerName);

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
  }, 'high');
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

  const evaluation = evaluateGameState(gameState, playerName);
  const quickScoreVal = quickScore(gameState, playerName);

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

function generateOverallAssessment(evaluation: GameEvaluation, score: number): string {
  const totalScore = evaluation.totalScore ?? score;
  if (totalScore > 5) {
    return "You have a strong board position with significant advantages.";
  } else if (totalScore > 2) {
    return "You have a slight advantage. Continue building your board.";
  } else if (totalScore > -2) {
    return "The game is evenly matched. Look for opportunities to gain advantage.";
  } else if (totalScore > -5) {
    return "You're slightly behind. Focus on stabilizing and finding answers.";
  } else {
    return "You're in a difficult position. Prioritize survival and look for comeback opportunities.";
  }
}

function generateSuggestedPlays(gameState: GameState, playerName: string): GameStateAnalysisOutput['suggestedPlays'] {
  const plays: GameStateAnalysisOutput['suggestedPlays'] = [];
  const player = gameState.players[playerName];
  const opponentId = Object.keys(gameState.players).find(id => id !== playerName);
  const opponent = opponentId ? gameState.players[opponentId] : null;

  if (!player) return plays;

  // Suggest playing land if available
  if (player.hand && player.hand.length > 0) {
    const lands = filterLandsFromHand(player.hand);
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
  if (player.hand && player.hand.length > 0) {
    const creatures = filterCreaturesFromHand(player.hand);
    creatures.slice(0, 2).forEach((creature) => {
      const creatureUnknown = creature as unknown as Record<string, unknown>;
      const manaValue = creatureUnknown.manaValue as number | undefined;
      plays.push({
        cardName: creature.name,
        priority: 'medium',
        reasoning: `Cast ${creature.name} to develop your board presence.`,
        manaCost: manaValue ?? creature.cmc ?? 0,
        expectedImpact: "Adds a threat to the battlefield",
      });
    });
  }

  // Suggest removal if opponent has threats
  if (opponent && opponent.battlefield && hasCreatureThreats(opponent.battlefield)) {
    const removal = filterInstantOrSorceryFromHand(player.hand).slice(0, 1);
    if (removal && removal.length > 0) {
      const removalCard = removal[0];
      const removalUnknown = removalCard as unknown as Record<string, unknown>;
      const manaValue = removalUnknown.manaValue as number | undefined;
      plays.push({
        cardName: removalCard.name,
        priority: 'high',
        reasoning: "Remove opponent's threat to maintain board control.",
        manaCost: manaValue ?? removalCard.cmc ?? 0,
        expectedImpact: "Neutralizes opponent's board presence",
      });
    }
  }

  return plays;
}

function generateWarnings(gameState: GameState, playerName: string): GameStateAnalysisOutput['warnings'] {
  const warnings: GameStateAnalysisOutput['warnings'] = [];
  const player = gameState.players[playerName];
  if (!player) return warnings;

  // Low life warning
  if (player.life < 10) {
    warnings.push({
      type: 'danger',
      message: "Your life total is critically low. Prioritize defense and life gain.",
    });
  }

  // Hand empty warning
  if (!player.hand || player.hand.length === 0) {
    warnings.push({
      type: 'caution',
      message: "You have no cards in hand. Consider card draw options.",
    });
  }

  // Few lands warning
  if (countLandsOnBattlefield(player.battlefield) < 3) {
    warnings.push({
      type: 'info',
      message: "Consider developing your land base for consistent mana.",
    });
  }

  return warnings;
}

function analyzeManaUsage(gameState: GameState, playerName: string): ManaAdviceOutput {
  const player = gameState.players[playerName];
  const manaPool = player?.manaPool || {};
  const totalMana = Object.values(manaPool).reduce((a, b) => a + b, 0);
  const availableMana = {
    total: totalMana,
    colored: manaPool,
    colorless: manaPool['colorless'] || 0
  };
  const unusedMana = totalMana; // Simplified

  const suggestions: ManaAdviceOutput['suggestions'] = [];

  // Suggest using available mana
  if (unusedMana > 0 && player?.hand && player.hand.length > 0) {
    const playableCards = filterPlayableCardsByMana(player.hand, unusedMana);
    playableCards.slice(0, 2).forEach((card) => {
      const manaValue = card.manaValue ?? 0;
      suggestions.push({
        cardName: card.name,
        action: `Cast ${card.name}`,
        manaCost: manaValue,
        priority: isCreatureCard(card) ? 'high' : 'medium',
        reasoning: `Use available mana to play ${card.name}`,
      });
    });
  }

  // Suggest holding mana for instants
  if (unusedMana >= 2 && hasInstantInHand(player?.hand)) {
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

function identifyThreats(gameState: GameState, playerName: string): GameStateAnalysisOutput['boardThreats'] {
  const threats: GameStateAnalysisOutput['boardThreats'] = [];
  const opponentId = Object.keys(gameState.players).find(id => id !== playerName);
  const opponent = opponentId ? gameState.players[opponentId] : null;

  if (opponent && opponent.battlefield) {
    opponent.battlefield.forEach((p) => {
      if (isCreaturePermanent(p)) {
        let priority: GameStateAnalysisOutput['boardThreats'][0]['priority'];
        if ((p.power ?? 0) >= 4) {
          priority = 'immediate';
        } else if ((p.power ?? 0) >= 2) {
          priority = 'high';
        } else {
          priority = 'medium';
        }

        threats.push({
          card: p.name,
          threat: `${p.name} (${p.power ?? 0}/${p.toughness ?? 0})`,
          priority,
        });
      }
    });
  }

  return threats;
}

function generateStrategicAdvice(evaluation: GameEvaluation, score: number): string[] {
  const advice: string[] = [];
  const totalScore = evaluation.totalScore ?? score;

  if (totalScore > 2) {
    advice.push("Continue building your advantage and close out the game.");
    advice.push("Consider aggressive plays to press your advantage.");
  } else if (totalScore < -2) {
    advice.push("Focus on stabilizing and finding answers to opponent's threats.");
    advice.push("Look for comeback opportunities and card advantage.");
  } else {
    advice.push("Look for opportunities to gain incremental advantage.");
    advice.push("Consider both tempo and card advantage in your decisions.");
  }

  if (evaluation.factors?.handQuality && evaluation.factors.handQuality < 3) {
    advice.push("Your hand is running low - consider card draw options.");
  }

  return advice;
}

function evaluatePlayHeuristic(
  gameState: GameState,
  playerName: string,
  cardName: string,
  target?: string
): PlayAnalysisOutput {
  // Simplified heuristic evaluation
  const player = gameState.players[playerName];
  const card = findCardInHandByName(player?.hand, cardName);
  const totalMana = Object.values(player?.manaPool || {}).reduce((a, b) => a + b, 0);

  if (!card) {
    return {
      isRecommended: false,
      rating: 'okay',
      reasoning: 'Card not found in hand.',
      alternativePlays: [],
      potentialUpgrades: [],
    };
  }

  // Get card mana value safely
  const cardUnknown = card as unknown as Record<string, unknown>;
  const manaValue = cardUnknown.manaValue as number | undefined;
  const cardManaValue = manaValue ?? card.cmc ?? 0;

  // Evaluate based on card type and cost
  let rating: PlayAnalysisOutput['rating'] = 'okay';
  let reasoning = 'This is a reasonable play.';

  if (isCreatureCard(card)) {
    if (cardManaValue <= totalMana) {
      rating = 'good';
      reasoning = 'Playing a creature develops your board presence.';
    }
  } else if (isInstantOrSorceryCard(card)) {
    rating = 'excellent';
    reasoning = 'Instant-speed interaction provides flexibility.';
  } else {
    rating = 'okay';
    reasoning = 'This card can impact the board state effectively.';
  }

  return {
    isRecommended: true,
    rating,
    reasoning,
    alternativePlays: [],
    potentialUpgrades: [],
  };
}

function generateKeyFactors(evaluation: GameEvaluation): string[] {
  const factors: string[] = [];
  const f = evaluation.factors;

  if (f && f.lifeScore > 0) {
    factors.push("Healthy life total");
  }
  if (f && f.cardAdvantage > 0) {
    factors.push("Card advantage");
  }
  if (f && f.permanentAdvantage > 0) {
    factors.push("Board presence");
  }
  if (f && f.manaAvailable > 0) {
    factors.push("Mana available");
  }

  return factors;
}

/**
 * Analyze opening hand for mulligan decision.
 * Issue #677: Mulligan advisor integration.
 */
export function getMulliganAdvice(
  hand: Card[],
  options?: {
    archetype?: string;
    format?: 'limited' | 'constructed';
    gameNumber?: number;
    onThePlay?: boolean;
  }
) {
  return analyzeMulligan({
    hand,
    archetype: options?.archetype,
    format: options?.format,
    gameNumber: options?.gameNumber,
    onThePlay: options?.onThePlay,
  });
}

function generateBoardRecommendations(evaluation: GameEvaluation, score: number): string[] {
  const recommendations: string[] = [];
  const totalScore = evaluation.totalScore ?? score;

  if (totalScore > 2) {
    recommendations.push("Consider aggressive plays to finish the game.");
  } else if (totalScore < -2) {
    recommendations.push("Focus on defense and finding answers.");
  }

  if (evaluation.factors?.cardAdvantage && evaluation.factors.cardAdvantage < 0) {
    recommendations.push("Look for card draw opportunities.");
  }

  return recommendations;
}
