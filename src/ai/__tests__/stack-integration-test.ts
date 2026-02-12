/**
 * @fileoverview Stack Interaction AI Integration Test
 *
 * This file demonstrates and validates the Stack Interaction AI
 * by running through various scenarios.
 */

import {
  StackInteractionAI,
  StackAction,
  StackContext,
  AvailableResponse,
  ResponseEffect,
} from '../stack-interaction-ai';
import { GameState, PlayerState } from '../game-state-evaluator';

/**
 * Create a test game state
 */
function createGameState(
  playerLife: number = 20,
  opponentLife: number = 20,
  playerHandSize: number = 5
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
      manaValue: Math.floor(Math.random() * 4) + 1,
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
    hand: Array.from({ length: 4 }, (_, i) => ({
      cardId: `opp_card_${i}`,
      name: `Opponent Card ${i}`,
      type: 'Sorcery',
      manaValue: Math.floor(Math.random() * 4) + 1,
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
 * Test 1: High threat - should counter
 */
function test1_HighThreat_ShouldCounter() {
  console.log('\n✓ Test 1: High Threat - Should Counter');

  const gameState = createGameState(20, 20, 5);

  const stackAction: StackAction = {
    id: 'stack_1',
    cardId: 'threatening_creature',
    name: 'Glorybringer',
    controller: 'player2',
    type: 'spell',
    manaValue: 5,
    colors: ['red'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

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
      value: 6,
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

  console.log(`  Opponent casts: ${stackAction.name} (${stackAction.manaValue} mana)`);
  console.log(`  AI Decision: ${decision.action.toUpperCase()}`);
  console.log(`  Confidence: ${(decision.confidence * 100).toFixed(0)}%`);

  if (decision.shouldRespond) {
    console.log('  ✓ PASS: AI correctly decides to counter high threat');
    return true;
  } else {
    console.log('  ✗ FAIL: AI should counter high threat');
    return false;
  }
}

/**
 * Test 2: Low threat - should not counter
 */
function test2_LowThreat_ShouldNotCounter() {
  console.log('\n✓ Test 2: Low Threat - Should Not Counter');

  const gameState = createGameState(20, 20, 5);

  const stackAction: StackAction = {
    id: 'stack_2',
    cardId: 'small_creature',
    name: 'Gray Ogre',
    controller: 'player2',
    type: 'spell',
    manaValue: 3,
    colors: ['red'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

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
      value: 3,
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

  console.log(`  Opponent casts: ${stackAction.name} (${stackAction.manaValue} mana)`);
  console.log(`  AI Decision: ${decision.action.toUpperCase()}`);

  if (!decision.shouldRespond) {
    console.log('  ✓ PASS: AI correctly saves counterspell for low threat');
    return true;
  } else {
    console.log('  ✗ FAIL: AI should not counter low threat');
    return false;
  }
}

/**
 * Test 3: Lethal threat - must counter
 */
function test3_LethalThreat_MustCounter() {
  console.log('\n✓ Test 3: Lethal Threat - Must Counter');

  const gameState = createGameState(5, 20, 5);

  const stackAction: StackAction = {
    id: 'stack_3',
    cardId: 'lethal_spell',
    name: 'Lightning Bolt',
    controller: 'player2',
    type: 'spell',
    manaValue: 1,
    colors: ['red'],
    targets: [{ playerId: 'player1' }],
    isInstantSpeed: true,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];
  gameState.players['player1'].life = 5;

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
      value: 10,
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

  console.log(`  Our life: ${gameState.players['player1'].life}`);
  console.log(`  Opponent casts: ${stackAction.name} at us`);
  console.log(`  AI Decision: ${decision.action.toUpperCase()}`);
  console.log(`  Confidence: ${(decision.confidence * 100).toFixed(0)}%`);

  if (decision.shouldRespond && decision.confidence > 0.8) {
    console.log('  ✓ PASS: AI correctly counters lethal threat');
    return true;
  } else {
    console.log('  ✗ FAIL: AI must counter lethal threat');
    return false;
  }
}

/**
 * Test 4: Resource management - hold mana
 */
function test4_ResourceManagement_HoldMana() {
  console.log('\n✓ Test 4: Resource Management - Hold Mana');

  const gameState = createGameState(20, 20, 6);

  const stackAction: StackAction = {
    id: 'stack_4',
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

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.manageResources(context);

  console.log(`  Current phase: Post-combat main`);
  console.log(`  Available instant-speed effects: Flash Creature (3 mana)`);
  console.log(`  AI Decision: Hold for ${decision.holdFor}`);

  if (decision.holdFor === 'end_step' || decision.holdFor === 'opponent_turn') {
    console.log('  ✓ PASS: AI correctly holds mana for interaction');
    return true;
  } else {
    console.log('  ✗ FAIL: AI should hold mana for instant-speed interaction');
    return false;
  }
}

/**
 * Test 5: No responses available - should pass
 */
function test5_NoResponses_ShouldPass() {
  console.log('\n✓ Test 5: No Responses Available - Should Pass');

  const gameState = createGameState(20, 20, 5);

  const stackAction: StackAction = {
    id: 'stack_5',
    cardId: 'creature_spell',
    name: 'Hill Giant',
    controller: 'player2',
    type: 'spell',
    manaValue: 3,
    colors: ['red'],
    isInstantSpeed: false,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 3, colorless: 0 },
    availableResponses: [], // No responses available
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'precombat_main',
    step: 'main',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.evaluateResponse(context);

  console.log(`  Opponent casts: ${stackAction.name}`);
  console.log(`  AI has: No responses available`);
  console.log(`  AI Decision: ${decision.action.toUpperCase()}`);

  if (!decision.shouldRespond && decision.action === 'pass') {
    console.log('  ✓ PASS: AI correctly passes with no responses');
    return true;
  } else {
    console.log('  ✗ FAIL: AI should pass with no responses');
    return false;
  }
}

/**
 * Test 6: Priority decision - low risk
 */
function test6_PriorityDecision_LowRisk() {
  console.log('\n✓ Test 6: Priority Decision - Low Risk');

  const gameState = createGameState(20, 20, 5);

  const stackAction: StackAction = {
    id: 'stack_6',
    cardId: 'minor_buff',
    name: 'Giant Growth',
    controller: 'player2',
    type: 'spell',
    manaValue: 1,
    colors: ['green'],
    isInstantSpeed: true,
    timestamp: Date.now(),
  };

  gameState.stack = [stackAction];

  const context: StackContext = {
    currentAction: stackAction,
    stackSize: 1,
    actionsAbove: [],
    availableMana: { green: 1, colorless: 1 },
    availableResponses: [],
    opponentsRemaining: [],
    isMyTurn: false,
    phase: 'combat',
    step: 'combat_damage',
    respondingToOpponent: true,
  };

  const ai = new StackInteractionAI(gameState, 'player1', 'medium');
  const decision = ai.decidePriorityPass(context);

  console.log(`  Opponent casts: ${stackAction.name}`);
  console.log(`  AI Decision: ${decision.shouldPass ? 'PASS' : 'RESPOND'}`);
  console.log(`  Risk Level: ${decision.riskLevel.toUpperCase()}`);

  if (decision.shouldPass && decision.riskLevel === 'low') {
    console.log('  ✓ PASS: AI correctly passes on low-risk action');
    return true;
  } else {
    console.log('  ✗ FAIL: AI should pass on low-risk action');
    return false;
  }
}

/**
 * Run all integration tests
 */
export function runStackInteractionTests(): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Stack Interaction AI - Integration Tests               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const results = [
    test1_HighThreat_ShouldCounter(),
    test2_LowThreat_ShouldNotCounter(),
    test3_LethalThreat_MustCounter(),
    test4_ResourceManagement_HoldMana(),
    test5_NoResponses_ShouldPass(),
    test6_PriorityDecision_LowRisk(),
  ];

  const passed = results.filter((r) => r).length;
  const total = results.length;

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║     Test Results: ${passed}/${total} passed${' '.repeat(40 - passed.toString().length - total.toString().length)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (passed === total) {
    console.log('✓ All tests passed!\n');
  } else {
    console.log(`✗ ${total - passed} test(s) failed\n');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runStackInteractionTests();
}
