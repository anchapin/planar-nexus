/**
 * @fileoverview Stack Interaction AI for Magic: The Gathering
 *
 * This module provides AI decision-making for responding to spells and abilities
 * on the stack. It handles counterspell decisions, response timing, resource management,
 * and complex stack interaction scenarios.
 *
 * Key components:
 * - StackAction interface: Represents actions on the stack
 * - ResponseDecision interface: AI response decisions
 * - ResponseEvaluator: Evaluates whether to respond to stack actions
 * - CounterspellDecider: Determines when to use counterspells
 * - StackOrderOptimizer: Optimizes multiple response ordering
 * - ResourceManager: Manages holding vs. using mana
 */

import { GameState, evaluateGameState, ThreatAssessment, DetailedEvaluation } from './game-state-evaluator';

/**
 * Represents a spell or ability on the stack
 */
export interface StackAction {
  id: string;
  cardId: string;
  name: string;
  controller: string;
  type: 'spell' | 'ability';
  manaValue: number;
  colors?: string[];
  targets?: {
    playerId?: string;
    permanentId?: string;
    cardId?: string;
  }[];
  isInstantSpeed: boolean;
  timestamp: number;
}

/**
 * Represents a response available to the AI
 */
export interface AvailableResponse {
  cardId: string;
  name: string;
  type: 'instant' | 'flash' | 'ability';
  manaValue: number;
  manaCost: { [color: string]: number };
  canCounter: boolean;
  canTarget: string[];
  effect: ResponseEffect;
}

/**
 * Represents the effect of a response
 */
export interface ResponseEffect {
  type: 'counter' | 'destroy' | 'bounce' | 'exile' | 'damage' | 'draw' | 'other';
  value: number; // Magnitude of effect (1-10)
  targets: string[];
}

/**
 * AI decision for stack interaction
 */
export interface ResponseDecision {
  shouldRespond: boolean;
  action: 'pass' | 'respond' | 'hold_priority';
  responseCardId?: string;
  targetActionId?: string;
  reasoning: string;
  confidence: number; // 0-1
  expectedValue: number; // Expected game state improvement
  holdMana?: boolean;
  waitForBetterResponse?: boolean;
}

/**
 * Priority pass decision
 */
export interface PriorityPassDecision {
  shouldPass: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Stack ordering decision for multiple responses
 */
export interface StackOrderDecision {
  orderedActions: string[]; // Card IDs in order to cast
  reasoning: string;
  expectedValue: number;
}

/**
 * Resource management decision
 */
export interface ResourceDecision {
  useNow: boolean;
  holdFor: 'end_step' | 'opponent_turn' | 'better_threat' | 'nothing';
  manaToReserve: { [color: string]: number };
  reasoning: string;
}

/**
 * Stack interaction context
 */
export interface StackContext {
  currentAction: StackAction;
  stackSize: number;
  actionsAbove: StackAction[]; // Actions above current that will resolve first
  availableMana: { [color: string]: number };
  availableResponses: AvailableResponse[];
  opponentsRemaining: string[]; // Opponents who haven't passed priority
  isMyTurn: boolean;
  phase: string;
  step: string;
  respondingToOpponent: boolean;
}

/**
 * Counterspell decision factors
 */
export interface CounterspellFactors {
  threatLevel: number;
  cardAdvantageImpact: number;
  tempoImpact: number;
  lifeImpact: number;
  winConditionDisruption: number;
  canBeRecurred: boolean;
  hasBackup: boolean; // Do we have other answers?
  opponentHasCounterspell: boolean; // Will they counter our counter?
}

/**
 * Response evaluation weights
 */
export interface ResponseWeights {
  // Core decision factors
  threatPrevention: number;
  cardAdvantage: number;
  tempo: number;
  resourceConservation: number;

  // Timing factors
  earlyGame: number;
  midGame: number;
  lateGame: number;

  // Strategic factors
  winConditionProtection: number;
  valuePlayProtection: number;
  bluffProtection: number;

  // Risk factors
  gettingCounterplayed: number;
  wastingRemoval: number;
  fallingBehind: number;

  // Stack complexity
  stackDepthPenalty: number;
  responseEfficiency: number;
}

/**
 * Default weights for different difficulty levels
 */
export const DefaultResponseWeights: Record<string, ResponseWeights> = {
  easy: {
    threatPrevention: 1.0,
    cardAdvantage: 0.5,
    tempo: 0.3,
    resourceConservation: 0.2,
    earlyGame: 1.0,
    midGame: 1.0,
    lateGame: 1.0,
    winConditionProtection: 0.5,
    valuePlayProtection: 0.3,
    bluffProtection: 0.1,
    gettingCounterplayed: 0.2,
    wastingRemoval: 0.5,
    fallingBehind: 0.3,
    stackDepthPenalty: 0.1,
    responseEfficiency: 0.3,
  },
  medium: {
    threatPrevention: 1.5,
    cardAdvantage: 1.0,
    tempo: 0.8,
    resourceConservation: 0.6,
    earlyGame: 0.8,
    midGame: 1.0,
    lateGame: 1.2,
    winConditionProtection: 1.0,
    valuePlayProtection: 0.6,
    bluffProtection: 0.3,
    gettingCounterplayed: 0.5,
    wastingRemoval: 0.8,
    fallingBehind: 0.6,
    stackDepthPenalty: 0.2,
    responseEfficiency: 0.6,
  },
  hard: {
    threatPrevention: 2.0,
    cardAdvantage: 1.5,
    tempo: 1.2,
    resourceConservation: 1.0,
    earlyGame: 0.6,
    midGame: 1.0,
    lateGame: 1.5,
    winConditionProtection: 1.5,
    valuePlayProtection: 1.0,
    bluffProtection: 0.5,
    gettingCounterplayed: 0.8,
    wastingRemoval: 1.0,
    fallingBehind: 1.0,
    stackDepthPenalty: 0.3,
    responseEfficiency: 1.0,
  },
};

/**
 * Main stack interaction AI class
 */
export class StackInteractionAI {
  private gameState: GameState;
  private playerId: string;
  private weights: ResponseWeights;

  constructor(
    gameState: GameState,
    playerId: string,
    difficulty: 'easy' | 'medium' | 'hard' = 'medium'
  ) {
    this.gameState = gameState;
    this.playerId = playerId;
    this.weights = DefaultResponseWeights[difficulty];
    // We'll use the imported evaluateGameState function
  }

  /**
   * Main decision point: Should I respond to this stack action?
   */
  evaluateResponse(context: StackContext): ResponseDecision {
    const currentEvaluation = evaluateGameState(this.gameState, this.playerId, 'medium');

    // Evaluate the threat level of the current action
    const threatLevel = this.assessActionThreat(context, currentEvaluation);

    // If no significant threat, pass priority
    if (threatLevel < 0.3) {
      return {
        shouldRespond: false,
        action: 'pass',
        reasoning: 'Threat level is low - conserve resources',
        confidence: 0.9,
        expectedValue: 0,
      };
    }

    // Check if we have valid responses available
    const validResponses = this.getValidResponses(context);
    if (validResponses.length === 0) {
      return {
        shouldRespond: false,
        action: 'pass',
        reasoning: 'No valid responses available',
        confidence: 1.0,
        expectedValue: 0,
      };
    }

    // Evaluate each possible response
    const responseEvaluations = validResponses.map((response) => ({
      response,
      evaluation: this.evaluateResponseOption(response, context, currentEvaluation),
    }));

    // Sort by expected value
    responseEvaluations.sort((a, b) => b.evaluation.expectedValue - a.evaluation.expectedValue);

    const bestResponse = responseEvaluations[0];

    // Decide if the best response is worth it
    const shouldUseResponse = this.shouldUseResponse(
      bestResponse.evaluation.expectedValue,
      context,
      currentEvaluation
    );

    if (!shouldUseResponse) {
      // Consider holding mana for later
      const holdDecision = this.evaluateHoldingMana(context, currentEvaluation);
      return {
        shouldRespond: false,
        action: 'pass',
        reasoning: holdDecision.reasoning,
        confidence: 0.8,
        expectedValue: 0,
        holdMana: holdDecision.holdMana,
        waitForBetterResponse: holdDecision.waitForBetter,
      };
    }

    return {
      shouldRespond: true,
      action: bestResponse.evaluation.holdPriority ? 'hold_priority' : 'respond',
      responseCardId: bestResponse.response.cardId,
      targetActionId: context.currentAction.id,
      reasoning: bestResponse.evaluation.reasoning,
      confidence: bestResponse.evaluation.confidence,
      expectedValue: bestResponse.evaluation.expectedValue,
    };
  }

  /**
   * Counterspell-specific decision making
   */
  decideCounterspell(
    context: StackContext,
    counterspell: AvailableResponse
  ): ResponseDecision {
    const factors = this.evaluateCounterspellFactors(context, counterspell);
    const shouldCounter = this.shouldUseCounterspell(factors);

    if (!shouldCounter) {
      return {
        shouldRespond: false,
        action: 'pass',
        reasoning: this.explainCounterspellPass(factors),
        confidence: 0.85,
        expectedValue: 0,
      };
    }

    const expectedValue = this.calculateCounterspellValue(factors);

    return {
      shouldRespond: true,
      action: 'respond',
      responseCardId: counterspell.cardId,
      targetActionId: context.currentAction.id,
      reasoning: this.explainCounterspellUse(factors),
      confidence: this.calculateCounterspellConfidence(factors),
      expectedValue,
    };
  }

  /**
   * Evaluate multiple responses and determine optimal order
   */
  optimizeResponseOrder(
    context: StackContext,
    possibleResponses: AvailableResponse[]
  ): StackOrderDecision {
    // Filter responses we can actually afford
    const affordableResponses = possibleResponses.filter((response) =>
      this.canAffordResponse(response, context)
    );

    if (affordableResponses.length === 0) {
      return {
        orderedActions: [],
        reasoning: 'No affordable responses available',
        expectedValue: 0,
      };
    }

    if (affordableResponses.length === 1) {
      const singleEval = this.evaluateResponseOption(
        affordableResponses[0],
        context,
        evaluateGameState(this.gameState, this.playerId, 'medium')
      );
      return {
        orderedActions: [affordableResponses[0].cardId],
        reasoning: `Single response: ${singleEval.reasoning}`,
        expectedValue: singleEval.expectedValue,
      };
    }

    // For multiple responses, we need to consider ordering
    // Generate possible orderings and evaluate each
    const orderings = this.generateResponseOrderings(affordableResponses);

    let bestOrdering = orderings[0];
    let bestValue = -Infinity;

    for (const ordering of orderings) {
      const value = this.evaluateOrderingValue(ordering, context);
      if (value > bestValue) {
        bestValue = value;
        bestOrdering = ordering;
      }
    }

    return {
      orderedActions: bestOrdering.map((r) => r.cardId),
      reasoning: `Optimal ordering of ${bestOrdering.length} responses for maximum value`,
      expectedValue: bestValue,
    };
  }

  /**
   * Decide whether to pass priority
   */
  decidePriorityPass(context: StackContext): PriorityPassDecision {
    const currentEvaluation = evaluateGameState(this.gameState, this.playerId, 'medium');
    const threatLevel = this.assessActionThreat(context, currentEvaluation);

    // Evaluate risk of passing
    const riskLevel = this.evaluatePassRisk(context, currentEvaluation);

    // Consider if opponents have more actions
    const opponentsCanRespond = context.opponentsRemaining.length > 0;

    let shouldPass = true;
    let reason = 'No immediate threat, safe to pass';

    // High threat level suggests we should respond
    if (threatLevel > 0.7) {
      shouldPass = false;
      reason = 'High threat action requires response';
    } else if (threatLevel > 0.5 && riskLevel !== 'low') {
      shouldPass = false;
      reason = 'Moderate threat with significant risk';
    }

    // If opponents might respond, consider holding priority
    if (shouldPass && opponentsCanRespond && riskLevel === 'high') {
      shouldPass = false;
      reason = 'Opponents may respond to our response - hold priority';
    }

    return {
      shouldPass,
      reason,
      riskLevel,
    };
  }

  /**
   * Resource management: hold mana vs use now
   */
  manageResources(context: StackContext): ResourceDecision {
    const currentEvaluation = evaluateGameState(this.gameState, this.playerId, 'medium');

    // Calculate total mana available

    // Check what instant-speed effects we have available
    const instantSpeedResponses = context.availableResponses.filter(
      (r) => r.type === 'instant' || r.type === 'flash'
    );

    // Evaluate if we should hold mana
    const holdForEndStep = this.shouldHoldForEndStep(context, currentEvaluation);
    const holdForOpponentTurn = this.shouldHoldForOpponentTurn(context, currentEvaluation);
    const holdForBetterThreat = this.shouldHoldForBetterThreat(context, currentEvaluation);

    // Calculate mana to reserve
    let manaToReserve: { [color: string]: number } = {};

    if (holdForEndStep || holdForOpponentTurn) {
      // Reserve mana for our best instant
      const bestInstant = this.findBestInstantResponse(instantSpeedResponses, context);
      if (bestInstant) {
        manaToReserve = { ...bestInstant.manaCost };
      }
    }

    let holdFor: ResourceDecision['holdFor'] = 'nothing';
    let reasoning = 'Use mana now - no better opportunity identified';

    if (holdForBetterThreat) {
      holdFor = 'better_threat';
      reasoning = 'Hold mana for a more threatening action expected soon';
    } else if (holdForEndStep) {
      holdFor = 'end_step';
      reasoning = 'Hold mana for end step to play around opponent\'s turn';
    } else if (holdForOpponentTurn) {
      holdFor = 'opponent_turn';
      reasoning = 'Hold mana for opponent\'s turn for interaction';
    }

    return {
      useNow: holdFor === 'nothing',
      holdFor,
      manaToReserve,
      reasoning,
    };
  }

  /**
   * Assess the threat level of a stack action
   */
  private assessActionThreat(
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): number {
    const action = context.currentAction;
    let threatLevel = 0;

    // High mana value spells are typically more threatening
    threatLevel += Math.min(0.4, action.manaValue * 0.05);

    // Check targets
    if (action.targets) {
      for (const target of action.targets) {
        // Targeting our stuff is bad
        if (target.playerId === this.playerId) {
          threatLevel += 0.3;
        }
        if (target.permanentId) {
          const permanent = this.findPermanent(target.permanentId);
          if (permanent && permanent.controller === this.playerId) {
            // More threat based on permanent importance
            threatLevel += this.getPermanentImportance(permanent) * 0.3;
          }
        }
      }
    }

    // Certain card types are more threatening
    const lowerName = action.name.toLowerCase();
    if (lowerName.includes('destroy') || lowerName.includes('exile')) {
      threatLevel += 0.2;
    }
    if (lowerName.includes('counter')) {
      threatLevel += 0.3;
    }
    if (lowerName.includes('draw') && action.controller !== this.playerId) {
      threatLevel += 0.15;
    }

    // Consider game state
    if (currentEvaluation.factors.lifeScore < -0.5) {
      // We're losing on life, threats are more critical
      threatLevel += 0.2;
    }

    if (currentEvaluation.threats.length > 0) {
      // We're already under pressure
      threatLevel += 0.1;
    }

    return Math.min(1, threatLevel);
  }

  /**
   * Get valid responses available in context
   */
  private getValidResponses(context: StackContext): AvailableResponse[] {
    return context.availableResponses.filter((response) =>
      this.canAffordResponse(response, context)
    );
  }

  /**
   * Check if we can afford a response
   */
  private canAffordResponse(
    response: AvailableResponse,
    context: StackContext
  ): boolean {
    for (const [color, amount] of Object.entries(response.manaCost)) {
      if ((context.availableMana[color] || 0) < amount) {
        return false;
      }
    }
    return true;
  }

  /**
   * Evaluate a specific response option
   */
  private evaluateResponseOption(
    response: AvailableResponse,
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): {
    expectedValue: number;
    reasoning: string;
    confidence: number;
    holdPriority: boolean;
  } {
    let expectedValue = 0;
    let reasoning = '';
    const confidence = 0.7;

    // Base value from effect type
    expectedValue += response.effect.value * 0.5;

    // Bonus for efficient responses (low cost, high impact)
    const efficiency = response.effect.value / (response.manaValue + 1);
    expectedValue += efficiency * this.weights.responseEfficiency;

    // Threat prevention value
    const threatLevel = this.assessActionThreat(context, currentEvaluation);
    expectedValue += threatLevel * this.weights.threatPrevention;

    // Card advantage consideration
    if (response.effect.type === 'counter') {
      // Countering is often a 2-for-1 (or better)
      expectedValue += this.weights.cardAdvantage * 0.5;
    } else if (response.effect.type === 'destroy' || response.effect.type === 'exile') {
      // Removal is card parity if target has already been cast
      expectedValue += this.weights.cardAdvantage * 0.2;
    }

    // Tempo consideration
    expectedValue += (context.currentAction.manaValue - response.manaValue) * 0.05 * this.weights.tempo;

    // Stack depth penalty (responses deeper on stack are less valuable)
    const stackDepthPenalty = context.stackSize * this.weights.stackDepthPenalty;
    expectedValue -= stackDepthPenalty;

    // Resource conservation
    const manaRemaining = this.calculateManaRemaining(response, context);
    expectedValue += manaRemaining * 0.02 * this.weights.resourceConservation;

    // Win condition protection
    if (this.protectsWinCondition(response, context, currentEvaluation)) {
      expectedValue += this.weights.winConditionProtection;
    }

    reasoning = this.generateResponseReasoning(
      response,
      threatLevel,
      efficiency,
      expectedValue
    );

    const holdPriority = this.shouldHoldPriority(response, context, currentEvaluation);

    return {
      expectedValue,
      reasoning,
      confidence,
      holdPriority,
    };
  }

  /**
   * Decide if a response is worth using
   */
  private shouldUseResponse(
    expectedValue: number,
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): boolean {
    // Base threshold
    let threshold = 0.3;

    // Lower threshold if we're losing
    if (currentEvaluation.totalScore < 0) {
      threshold -= 0.2;
    }

    // Lower threshold for critical threats
    const threatLevel = this.assessActionThreat(context, currentEvaluation);
    if (threatLevel > 0.7) {
      threshold -= 0.3;
    }

    return expectedValue > threshold;
  }

  /**
   * Evaluate counterspell-specific factors
   */
  private evaluateCounterspellFactors(
    context: StackContext,
    counterspell: AvailableResponse
  ): CounterspellFactors {
    const currentEvaluation = evaluateGameState(this.gameState, this.playerId, 'medium');

    return {
      threatLevel: this.assessActionThreat(context, currentEvaluation),
      cardAdvantageImpact: this.calculateCounterspellCardAdvantage(context),
      tempoImpact: this.calculateCounterspellTempo(context, counterspell),
      lifeImpact: this.calculateCounterspellLifeImpact(context),
      winConditionDisruption: this.calculateWinConditionDisruption(context, currentEvaluation),
      canBeRecurred: this.canCounterspellBeRecurred(counterspell),
      hasBackup: this.hasBackupCounterspells(context),
      opponentHasCounterspell: this.likelyOpponentCounterspell(context),
    };
  }

  /**
   * Decide if we should use a counterspell
   */
  private shouldUseCounterspell(factors: CounterspellFactors): boolean {
    let score = 0;

    // Threat level is most important
    score += factors.threatLevel * 3.0;

    // Card advantage impact
    score += factors.cardAdvantageImpact * 1.5;

    // Tempo
    score += factors.tempoImpact * 1.0;

    // Life impact
    score += factors.lifeImpact * 1.2;

    // Win condition disruption is critical
    score += factors.winConditionDisruption * 2.5;

    // Penalty if opponent can counter our counterspell
    if (factors.opponentHasCounterspell && !factors.hasBackup) {
      score -= 2.0;
    }

    // Bonus if we have backup
    if (factors.hasBackup) {
      score += 0.5;
    }

    // Bonus if it can be recurred
    if (factors.canBeRecurred) {
      score += 0.3;
    }

    return score > 2.0;
  }

  /**
   * Explain why we're passing on a counterspell
   */
  private explainCounterspellPass(factors: CounterspellFactors): string {
    const reasons = [];

    if (factors.threatLevel < 0.4) {
      reasons.push('threat is low');
    }
    if (factors.opponentHasCounterspell && !factors.hasBackup) {
      reasons.push('opponent likely has counterspell');
    }
    if (factors.cardAdvantageImpact < 0) {
      reasons.push('card disadvantage');
    }
    if (factors.canBeRecurred) {
      reasons.push('save for recasting');
    }

    return `Don't counter: ${reasons.join(', ')}`;
  }

  /**
   * Explain why we're using a counterspell
   */
  private explainCounterspellUse(factors: CounterspellFactors): string {
    const reasons = [];

    if (factors.threatLevel > 0.7) {
      reasons.push('major threat');
    }
    if (factors.winConditionDisruption > 0.5) {
      reasons.push('protects win condition');
    }
    if (factors.cardAdvantageImpact > 0.5) {
      reasons.push('card advantage');
    }
    if (factors.lifeImpact > 0.5) {
      reasons.push('prevents life loss');
    }

    return `Counter: ${reasons.join(', ')}`;
  }

  /**
   * Calculate counterspell confidence
   */
  private calculateCounterspellConfidence(factors: CounterspellFactors): number {
    let confidence = 0.5;

    if (factors.threatLevel > 0.7) confidence += 0.2;
    if (!factors.opponentHasCounterspell) confidence += 0.1;
    if (factors.hasBackup) confidence += 0.1;
    if (factors.winConditionDisruption > 0.5) confidence += 0.1;

    return Math.min(1, confidence);
  }

  /**
   * Calculate the value of using a counterspell
   */
  private calculateCounterspellValue(factors: CounterspellFactors): number {
    return (
      factors.threatLevel * 2.0 +
      factors.cardAdvantageImpact * 1.0 +
      factors.tempoImpact * 0.5 +
      factors.lifeImpact * 0.8 +
      factors.winConditionDisruption * 1.5
    );
  }

  /**
   * Evaluate holding mana decision
   */
  private evaluateHoldingMana(
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): {
    holdMana: boolean;
    waitForBetter: boolean;
    reasoning: string;
  } {
    // Check if we have instant-speed options
    const instantOptions = context.availableResponses.filter(
      (r) => r.type === 'instant' || r.type === 'flash'
    );

    if (instantOptions.length === 0) {
      return {
        holdMana: false,
        waitForBetter: false,
        reasoning: 'No instant-speed options to hold for',
      };
    }

    // We're winning, might not need to respond
    if (currentEvaluation.totalScore > 2.0) {
      return {
        holdMana: false,
        waitForBetter: false,
        reasoning: 'Winning, no need to hold interaction',
      };
    }

    // Opponent's turn and we have interaction - hold
    if (!context.isMyTurn && instantOptions.length > 0) {
      return {
        holdMana: true,
        waitForBetter: true,
        reasoning: 'Opponent\'s turn - hold mana for interaction',
      };
    }

    return {
      holdMana: false,
      waitForBetter: false,
      reasoning: 'No clear benefit to holding mana',
    };
  }

  /**
   * Evaluate risk of passing priority
   */
  private evaluatePassRisk(
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): 'low' | 'medium' | 'high' {
    let risk = 0;

    // Risk increases with threat level
    risk += this.assessActionThreat(context, currentEvaluation) * 0.4;

    // Risk if we're low on life
    if (currentEvaluation.factors.lifeScore < -0.5) {
      risk += 0.3;
    }

    // Risk if opponents have cards in hand
    const opponents = Object.values(this.gameState.players).filter(
      (p) => p.id !== this.playerId
    );
    const avgOpponentHand =
      opponents.reduce((sum, p) => sum + p.hand.length, 0) / opponents.length;
    risk += avgOpponentHand * 0.05;

    // Risk if we're low on resources
    if (currentEvaluation.factors.cardAdvantage < -0.5) {
      risk += 0.2;
    }

    if (risk > 0.6) return 'high';
    if (risk > 0.3) return 'medium';
    return 'low';
  }

  /**
   * Check if we should hold priority
   */
  private shouldHoldPriority(
    _response: AvailableResponse,
    context: StackContext,
    _currentEvaluation: DetailedEvaluation
  ): boolean {
    // Hold priority if we might want to add more to the stack
    const hasOtherResponses = context.availableResponses.length > 1;

    // Hold if opponents might counter
    const opponentLikelyHasCounter = this.likelyOpponentCounterspell(context);

    // Hold if we're responding to a response (stack is building)
    const stackIsBuilding = context.stackSize > 2;

    return hasOtherResponses || opponentLikelyHasCounter || stackIsBuilding;
  }

  /**
   * Calculate mana remaining after using a response
   */
  private calculateManaRemaining(
    response: AvailableResponse,
    context: StackContext
  ): number {
    let remaining = 0;

    for (const [color, amount] of Object.entries(context.availableMana)) {
      const cost = response.manaCost[color] || 0;
      remaining += Math.max(0, amount - cost);
    }

    return remaining;
  }

  /**
   * Check if response protects win condition
   */
  private protectsWinCondition(
    response: AvailableResponse,
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): boolean {
    // Check if the current action threatens our win condition
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();

    // If we're close to winning
    if (currentEvaluation.factors.winConditionProgress > 0.7) {
      // And the action disrupts that
      if (lowerName.includes('destroy') || lowerName.includes('exile') || lowerName.includes('counter')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find a permanent by ID
   */
  private findPermanent(permanentId: string): { id: string; controller: string; type: string; power?: number; keywords?: string[] } | null {
    for (const player of Object.values(this.gameState.players)) {
      const permanent = player.battlefield.find((p) => p.id === permanentId);
      if (permanent) return permanent;
    }
    return null;
  }

  /**
   * Get permanent importance (0-1)
   */
  private getPermanentImportance(permanent: { type: string; power?: number; keywords?: string[] }): number {
    let importance = 0.5;

    if (permanent.type === 'planeswalker') importance += 0.3;
    if (permanent.type === 'creature') {
      const power = permanent.power || 0;
      importance += Math.min(0.3, power / 10);
    }
    if (permanent.keywords && permanent.keywords.includes('hexproof')) importance += 0.1;

    return Math.min(1, importance);
  }

  /**
   * Calculate counterspell card advantage impact
   */
  private calculateCounterspellCardAdvantage(context: StackContext): number {
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();

    // Countering card draw is good
    if (lowerName.includes('draw')) return 0.5;

    // Countering threats is card advantage
    if (action.manaValue >= 4) return 0.3;

    return 0.1;
  }

  /**
   * Calculate counterspell tempo impact
   */
  private calculateCounterspellTempo(
    context: StackContext,
    counterspell: AvailableResponse
  ): number {
    // Positive if we spend less than opponent spent
    return context.currentAction.manaValue - counterspell.manaValue;
  }

  /**
   * Calculate counterspell life impact
   */
  private calculateCounterspellLifeImpact(context: StackContext): number {
    const action = context.currentAction;
    const lowerName = action.name.toLowerCase();

    // Preventing damage to ourselves
    if (action.targets?.some((t) => t.playerId === this.playerId)) {
      if (lowerName.includes('damage') || lowerName.includes('destroy')) {
        return 0.5;
      }
    }

    return 0;
  }

  /**
   * Calculate win condition disruption
   */
  private calculateWinConditionDisruption(
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): number {
    const action = context.currentAction;

    // If action targets our important permanents
    if (action.targets) {
      for (const target of action.targets) {
        if (target.permanentId) {
          const permanent = this.findPermanent(target.permanentId);
          if (permanent && permanent.controller === this.playerId) {
            const importance = this.getPermanentImportance(permanent);
            if (importance > 0.7) return 0.8;
          }
        }
      }
    }

    return 0;
  }

  /**
   * Check if counterspell can be recurred
   */
  private canCounterspellBeRecurred(counterspell: AvailableResponse): boolean {
    const lowerName = counterspell.name.toLowerCase();
    return (
      lowerName.includes('snapcaster') ||
      lowerName.includes('recursion') ||
      lowerName.includes('flashback')
    );
  }

  /**
   * Check if we have backup counterspells
   */
  private hasBackupCounterspells(context: StackContext): boolean {
    const counterCount = context.availableResponses.filter((r) =>
      r.name.toLowerCase().includes('counter')
    ).length;

    return counterCount > 1;
  }

  /**
   * Check if opponent likely has a counterspell
   */
  private likelyOpponentCounterspell(context: StackContext): boolean {
    const opponents = Object.values(this.gameState.players).filter(
      (p) => p.id !== this.playerId
    );

    for (const opponent of opponents) {
      // Check if opponent has cards in hand (uncertain what they are)
      if (opponent.hand.length > 2) {
        // In real game, we'd have more info here
        // For now, assume some chance
        return true;
      }
    }

    return false;
  }

  /**
   * Generate reasoning for response decision
   */
  private generateResponseReasoning(
    response: AvailableResponse,
    threatLevel: number,
    efficiency: number,
    expectedValue: number
  ): string {
    const parts = [];

    parts.push(`${response.name} (efficiency: ${efficiency.toFixed(2)})`);

    if (threatLevel > 0.5) {
      parts.push('addresses significant threat');
    }

    if (expectedValue > 0.5) {
      parts.push('high expected value');
    }

    return parts.join('; ');
  }

  /**
   * Generate possible orderings of responses
   */
  private generateResponseOrderings(responses: AvailableResponse[]): AvailableResponse[][] {
    // For now, just return a simple ordering
    // In a full implementation, we'd generate permutations
    return [responses];
  }

  /**
   * Evaluate the value of a specific ordering
   */
  private evaluateOrderingValue(
    ordering: AvailableResponse[],
    _context: StackContext
  ): number {
    let totalValue = 0;
    let position = 0;

    for (const response of ordering) {
      const positionMultiplier = 1 - position * 0.1; // Earlier responses are worth more
      totalValue += response.effect.value * positionMultiplier;
      position++;
    }

    return totalValue;
  }

  /**
   * Check if we should hold for end step
   */
  private shouldHoldForEndStep(
    context: StackContext,
    _currentEvaluation: DetailedEvaluation
  ): boolean {
    // Hold for end step if we have good instant-speed effects
    const goodInstants = context.availableResponses.filter(
      (r) => (r.type === 'instant' || r.type === 'flash') && r.effect.value >= 5
    );

    return goodInstants.length > 0 && context.isMyTurn;
  }

  /**
   * Check if we should hold for opponent's turn
   */
  private shouldHoldForOpponentTurn(
    context: StackContext,
    _currentEvaluation: DetailedEvaluation
  ): boolean {
    // Always hold some interaction for opponent's turn if we can
    const hasInteraction = context.availableResponses.some(
      (r) => r.type === 'instant' || r.type === 'flash'
    );

    return hasInteraction && !context.isMyTurn;
  }

  /**
   * Check if we should hold for a better threat
   */
  private shouldHoldForBetterThreat(
    context: StackContext,
    currentEvaluation: DetailedEvaluation
  ): boolean {
    // If we're not under immediate pressure, hold for better targets
    const immediateThreats = currentEvaluation.threats.filter(
      (t: ThreatAssessment) => t.urgency === 'immediate'
    );

    return immediateThreats.length === 0 && context.availableResponses.length > 1;
  }

  /**
   * Find best instant response
   */
  private findBestInstantResponse(
    instants: AvailableResponse[],
    _context: StackContext
  ): AvailableResponse | null {
    if (instants.length === 0) return null;

    // Sort by effect value
    instants.sort((a, b) => b.effect.value - a.effect.value);
    return instants[0];
  }
}

/**
 * Convenience function to evaluate a stack response decision
 */
export function evaluateStackResponse(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): ResponseDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.evaluateResponse(context);
}

/**
 * Convenience function to decide on a counterspell
 */
export function decideCounterspell(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  counterspell: AvailableResponse,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): ResponseDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.decideCounterspell(context, counterspell);
}

/**
 * Convenience function to manage resources
 */
export function manageResponseResources(
  gameState: GameState,
  playerId: string,
  context: StackContext,
  difficulty: 'easy' | 'medium' | 'hard' = 'medium'
): ResourceDecision {
  const ai = new StackInteractionAI(gameState, playerId, difficulty);
  return ai.manageResources(context);
}
