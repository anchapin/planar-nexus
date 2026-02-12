/**
 * @fileoverview Stack Interaction AI Examples
 *
 * This file demonstrates the Stack Interaction AI in action with various
 * gameplay scenarios including counterspell decisions, response timing,
 * resource management, and complex stack interactions.
 */

import {
  StackInteractionAI,
  StackAction,
  StackContext,
  AvailableResponse,
  ResponseDecision,
  ResponseEffect,
  evaluateStackResponse,
  decideCounterspell,
  manageResponseResources,
} from './stack-interaction-ai';
import {
  GameState,
  PlayerState,
  Permanent,
  HandCard,
} from './game-state-evaluator';

/**
 * Helper function to create a basic game state for testing
 */
function createBasicGameState(
  playerLife: number = 20,
  opponentLife: number = 20,
  playerHandSize: number = 5,
  opponentHandSize: number = 5
): GameState {
  const player: PlayerState = {
    id: 'player1',
    life: playerLife,
    poisonCounters: 0,
    commanderDamage: {},
    hand: Array.from({ length: playerHandSize }, (_, i) => ({
      cardId: `card_${i}`,
      name: `Card ${i}`,
      type: i % 2 === 0 ? 'Instant' : 'Creature',
      manaValue: Math.floor(Math.random() * 5) + 1,
    })),
    graveyard: [],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: 'land1',
        cardId: 'land_1',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
      {
        id: 'land2',
        cardId: 'land_2',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
      {
        id: 'land3',
        cardId: 'land_3',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
    ],
    manaPool: { blue: 3, colorless: 0 },
  };

  const opponent: PlayerState = {
    id: 'player2',
    life: opponentLife,
    poisonCounters: 0,
    commanderDamage: {},
    hand: Array.from({ length: opponentHandSize }, (_, i) => ({
      cardId: `opp_card_${i}`,
      name: `Opponent Card ${i}`,
      type: 'Sorcery',
      manaValue: Math.floor(Math.random() * 5) + 1,
    })),
    graveyard: [],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: 'opp_land1',
        cardId: 'opp_land_1',
        name: 'Mountain',
        type: 'land',
        controller: 'player2',
        tapped: false,
      },
      {
        id: 'opp_land2',
        cardId: 'opp_land_2',
        name: 'Mountain',
        type: 'land',
        controller: 'player2',
        tapped: false,
      },
    ],
    manaPool: { red: 2, colorless: 0 },
  };

  return {
    players: {
      player1: player,
      player2: opponent,
    },
    turnInfo: {
      currentTurn: 3,
      currentPlayer: 'player2',
      phase: 'precombat_main',
      step: 'main',
      priority: 'player1',
    },
    stack: [],
  };
}

/**
 * Example 1: Basic Counterspell Decision
 *
 * Scenario: Opponent casts a 4-mana creature that would be problematic.
 * We have a 2-mana counterspell in hand.
 */
export function example1BasicCounterspell(): void {
  console.log('\n=== Example 1: Basic Counterspell Decision ===\n');

  const gameState = createBasicGameState(20, 15, 5, 4);

  // Opponent casts a threatening creature
  const stackAction: StackAction = {
    id: 'stack_1',
    cardId: 'threatening_creature',
    name: 'Glorybringer', // 4-mana 4/4 flying haste
    controller: 'player2',
    type: 'spell',
    manaValue: 4,
    colors: ['red'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

  // We have a counterspell available
  const counterspell: AvailableResponse = {
    cardId: 'counter_spell',
    name: 'Cancel',
    type: 'instant',
    manaValue: 3,
    manaCost: { blue: 2, colorless: 1 },
    canCounter: true,
    canTarget: ['spell'],
    effect: {
      type: 'counter',
      value: 6, // Countering a 4-drop is valuable
      targets: [stackAction.id],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 0 },
    availableResponses: [counterspell],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'precombat_main',
    step: 'main',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.decideCounterspell(context, counterspell);

  console.log(`Opponent casts: ${stackAction.name} (${stackAction.manaValue} mana)`);
  console.log(`We have: ${counterspell.name} (${counterspell.manaValue} mana)`);
  console.log(`\nDecision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`Expected Value: ${decision.expectedValue.toFixed(2)}`);

  // Expected: Should counter - Glorybringer is a significant threat
  console.log('\nExpected: Should counter (moderate threat, efficient trade)\n');
}

/**
 * Example 2: Don't Counter Low Threat
 *
 * Scenario: Opponent casts a small creature. We should save our counterspell.
 */
export function example2DontCounterLowThreat(): void {
  console.log('\n=== Example 2: Don\'t Counter Low Threat ===\n');

  const gameState = createBasicGameState(20, 20, 5, 4);

  // Opponent casts a small creature
  const stackAction: StackAction = {
    id: 'stack_2',
    cardId: 'small_creature',
    name: 'Gray Ogre', // 3-mana 2/2
    controller: 'player2',
    type: 'spell',
    manaValue: 3,
    colors: ['red'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

  // We have the same counterspell
  const counterspell: AvailableResponse = {
    cardId: 'counter_spell',
    name: 'Cancel',
    type: 'instant',
    manaValue: 3,
    manaCost: { blue: 2, colorless: 1 },
    canCounter: true,
    canTarget: ['spell'],
    effect: {
      type: 'counter',
      value: 3, // Countering a 3-drop is less valuable
      targets: [stackAction.id],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 0 },
    availableResponses: [counterspell],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'precombat_main',
    step: 'main',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.decideCounterspell(context, counterspell);

  console.log(`Opponent casts: ${stackAction.name} (${stackAction.manaValue} mana)`);
  console.log(`We have: ${counterspell.name} (${counterspell.manaValue} mana)`);
  console.log(`\nDecision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);

  // Expected: Should NOT counter - low threat, inefficient trade
  console.log('\nExpected: Pass priority (low threat, save counterspell)\n');
}

/**
 * Example 3: Resource Management - Hold for End Step
 *
 * Scenario: We have instant-speed effects available. Should we use now or hold?
 */
export function example3HoldForEndStep(): void {
  console.log('\n=== Example 3: Resource Management - Hold for End Step ===\n');

  const gameState = createBasicGameState(18, 20, 6, 4);

  // No immediate threat on stack
  const stackAction: StackAction = {
    id: 'stack_3',
    cardId: 'minor_spell',
    name: 'Shock',
    controller: 'player1',
    type: 'spell',
    manaValue: 1,
    colors: ['red'],
    isInstantSpeed: true,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];
  gameState.turnInfo.currentPlayer = 'player1';
  gameState.turnInfo.priority = 'player1';

  // We have instant-speed options
  const instantResponse: AvailableResponse = {
    cardId: 'flash_creature',
    name: 'Flash Creature',
    type: 'flash',
    manaValue: 3,
    manaCost: { blue: 2, colorless: 1 },
    canCounter: false,
    canTarget: [],
    effect: {
      type: 'other',
      value: 5,
      targets: [],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 2 },
    availableResponses: [instantResponse],
    opponentsRemaining: ['player2'],
    isMyTurn: true,
    phase: 'postcombat_main',
    step: 'main',
    respondingToOpponent: false,
  };

  const decision = manageResponseResources(gameState, 'player1', context, 'medium');

  console.log('Current phase: Post-combat main');
  console.log('Available instant-speed effects: Flash Creature (3 mana)');
  console.log(`\nUse Now: ${decision.useNow ? 'YES' : 'NO'}`);
  console.log(`Hold For: ${decision.holdFor}`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Mana to Reserve: ${JSON.stringify(decision.manaToReserve)}`);

  // Expected: Should hold for end step or opponent's turn
  console.log('\nExpected: Hold mana for end step/opponent turn (interaction)\n');
}

/**
 * Example 4: High Threat - Must Counter
 *
 * Scenario: Opponent casts a game-ending spell. Must counter!
 */
export function example4HighThreatMustCounter(): void {
  console.log('\n=== Example 4: High Threat - Must Counter ===\n');

  const gameState = createBasicGameState(5, 20, 5, 4); // We're at low life

  // Opponent casts a lethal spell
  const stackAction: StackAction = {
    id: 'stack_4',
    cardId: 'lethal_spell',
    name: 'Lightning Bolt', // 3 damage to player
    controller: 'player2',
    type: 'spell',
    manaValue: 1,
    colors: ['red'],
    targets: [{ playerId: 'player1' }],
    isInstantSpeed: true,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];
  gameState.players['player1'].life = 5; // At 5 life, Bolt is lethal

  // We have a counterspell
  const counterspell: AvailableResponse = {
    cardId: 'counter_spell',
    name: 'Counterspell',
    type: 'instant',
    manaValue: 2,
    manaCost: { blue: 2 },
    canCounter: true,
    canTarget: ['spell'],
    effect: {
      type: 'counter',
      value: 10, // Preventing lethal is extremely valuable
      targets: [stackAction.id],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 0 },
    availableResponses: [counterspell],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'postcombat_main',
    step: 'main',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.decideCounterspell(context, counterspell);

  console.log(`Our life: ${gameState.players['player1'].life}`);
  console.log(`Opponent casts: ${stackAction.name} at us`);
  console.log(`We have: ${counterspell.name}`);
  console.log(`\nDecision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`Expected Value: ${decision.expectedValue.toFixed(2)}`);

  // Expected: MUST counter - preventing lethal
  console.log('\nExpected: MUST COUNTER (prevent lethal damage)\n');
}

/**
 * Example 5: Complex Stack - Multiple Responses
 *
 * Scenario: Multiple items on stack. Decide optimal response ordering.
 */
export function example5ComplexStackOrdering(): void {
  console.log('\n=== Example 5: Complex Stack - Multiple Responses ===\n');

  const gameState = createBasicGameState(15, 15, 7, 5);

  // Multiple items on stack
  const stackActions: StackAction[] = [
    {
      id: 'stack_5_1',
      cardId: 'spell_1',
      name: 'Giant Growth',
      controller: 'player2',
      type: 'spell',
      manaValue: 1,
      colors: ['green'],
      isInstantSpeed: true,
      timestamp: Date.now() - 100,
    },
    {
      id: 'stack_5_2',
      cardId: 'spell_2',
      name: 'Shock',
      controller: 'player2',
      type: 'spell',
      manaValue: 1,
      colors: ['red'],
      targets: [{ playerId: 'player1' }],
      isInstantSpeed: true,
      timestamp: Date.now() - 50,
    },
  ];

  gameState.stack = stackActions;
  gameState.turnInfo.priority = 'player1';

  // We have multiple responses
  const responses: AvailableResponse[] = [
    {
      cardId: 'response_1',
      name: 'Counterspell',
      type: 'instant',
      manaValue: 2,
      manaCost: { blue: 2 },
      canCounter: true,
      canTarget: ['spell'],
      effect: {
        type: 'counter',
        value: 4,
        targets: [stackActions[1].id],
      },
    },
    {
      cardId: 'response_2',
      name: 'Save',
      type: 'instant',
      manaValue: 1,
      manaCost: { white: 1 },
      canCounter: false,
      canTarget: ['player'],
      effect: {
        type: 'other',
        value: 5,
        targets: ['player1'],
      },
    },
  ];

  const context: StackContext = {
    currentAction: stackActions[1], // Top of stack
    stackSize: 2,
    actionsAbove: [stackActions[0]],
    availableMana: { blue: 2, white: 2, colorless: 1 },
    availableResponses: responses,
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'combat',
    step: 'combat_damage',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.optimizeResponseOrder(context, responses);

  console.log(`Stack size: ${context.stackSize}`);
  console.log(`Available responses: ${responses.length}`);
  console.log(`Optimal ordering: ${decision.orderedActions.length} responses`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Expected Value: ${decision.expectedValue.toFixed(2)}`);

  console.log('\nExpected: Order responses to maximize value (counter damage, then prevent growth)\n');
}

/**
 * Example 6: Hold Priority Decision
 *
 * Scenario: Should we hold priority to add more to the stack?
 */
export function example6HoldPriority(): void {
  console.log('\n=== Example 6: Hold Priority Decision ===\n');

  const gameState = createBasicGameState(20, 20, 6, 4);

  const stackAction: StackAction = {
    id: 'stack_6',
    cardId: 'creature_spell',
    name: 'Tarmogoyf',
    controller: 'player1',
    type: 'spell',
    manaValue: 2,
    colors: ['green'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];
  gameState.turnInfo.currentPlayer = 'player1';
  gameState.turnInfo.priority = 'player1';

  // We have multiple instant options
  const instantBuff: AvailableResponse = {
    cardId: 'instant_buff',
    name: 'Giant Growth',
    type: 'instant',
    manaValue: 1,
    manaCost: { green: 1 },
    canCounter: false,
    canTarget: ['creature'],
    effect: {
      type: 'other',
      value: 3,
      targets: ['stack_6'],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { green: 2, blue: 1, colorless: 1 },
    availableResponses: [instantBuff],
    opponentsRemaining: ['player2'],
    isMyTurn: true,
    phase: 'precombat_main',
    step: 'main',
    respondingToOpponent: false,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.evaluateResponse(context);

  console.log(`We cast: ${stackAction.name}`);
  console.log(`We also have: ${instantBuff.name} (${instantBuff.manaValue} mana)`);
  console.log(`Opponent hasn't passed priority yet`);
  console.log(`\nDecision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);
  console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);

  console.log('\nExpected: May hold priority if opponent might respond (e.g., with removal)\n');
}

/**
 * Example 7: End of Turn Plays
 *
 * Scenario: Opponent's turn ends. Should we use our instant-speed effects now?
 */
export function example7EndOfTurnPlays(): void {
  console.log('\n=== Example 7: End of Turn Plays ===\n');

  const gameState = createBasicGameState(20, 18, 6, 4);

  const stackAction: StackAction = {
    id: 'stack_7',
    cardId: 'eot_trigger',
    name: 'End of Turn Trigger',
    controller: 'player2',
    type: 'ability',
    manaValue: 0,
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];
  gameState.turnInfo.currentPlayer = 'player2';
  gameState.turnInfo.phase = 'end';
  gameState.turnInfo.step = 'end';
  gameState.turnInfo.priority = 'player1';

  // We have good end-of-turn options
  const eotInstant: AvailableResponse = {
    cardId: 'eot_draw',
    name: 'Instant Draw',
    type: 'instant',
    manaValue: 2,
    manaCost: { blue: 1, colorless: 1 },
    canCounter: false,
    canTarget: [],
    effect: {
      type: 'draw',
      value: 6,
      targets: [],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 2 },
    availableResponses: [eotInstant],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'end',
    step: 'end',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.evaluateResponse(context);

  console.log(`Phase: ${context.phase} - ${context.step}`);
  console.log(`Available: ${eotInstant.name} (${eotInstant.manaValue} mana)`);
  console.log(`\nShould Respond: ${decision.shouldRespond ? 'YES' : 'NO'}`);
  console.log(`Decision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);

  console.log('\nExpected: Use instant-speed effects at end of turn (efficient timing)\n');
}

/**
 * Example 8: Card Advantage Consideration
 *
 * Scenario: Opponent casts a draw spell. Should we counter it?
 */
export function example8CardAdvantage(): void {
  console.log('\n=== Example 8: Card Advantage Consideration ===\n');

  const gameState = createBasicGameState(20, 20, 4, 6); // Opponent has more cards

  const stackAction: StackAction = {
    id: 'stack_8',
    cardId: 'draw_spell',
    name: 'Concentrate', // Draw 3 cards
    controller: 'player2',
    type: 'spell',
    manaValue: 3,
    colors: ['blue'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

  const counterspell: AvailableResponse = {
    cardId: 'counter_spell',
    name: 'Negate',
    type: 'instant',
    manaValue: 2,
    manaCost: { blue: 1, colorless: 1 },
    canCounter: true,
    canTarget: ['spell'],
    effect: {
      type: 'counter',
      value: 5, // Countering draw 3 is good for card advantage
      targets: [stackAction.id],
    },
  };

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 0 },
    availableResponses: [counterspell],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'precombat_main',
    step: 'main',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.decideCounterspell(context, counterspell);

  console.log(`Opponent's hand: ${gameState.players['player2'].hand.length} cards`);
  console.log(`Opponent casts: ${stackAction.name} (draw 3 cards)`);
  console.log(`We have: ${counterspell.name}`);
  console.log(`\nDecision: ${decision.action.toUpperCase()}`);
  console.log(`Reasoning: ${decision.reasoning}`);

  console.log('\nExpected: Counter to prevent opponent from gaining card advantage\n');
}

/**
 * Run all examples
 */
export function runAllStackInteractionExamples(): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Stack Interaction AI - Comprehensive Examples          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  example1BasicCounterspell();
  example2DontCounterLowThreat();
  example3HoldForEndStep();
  example4HighThreatMustCounter();
  example5ComplexStackOrdering();
  example6HoldPriority();
  example7EndOfTurnPlays();
  example8CardAdvantage();

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              Examples Complete                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

// Export for use in tests
export {
  createBasicGameState,
};
