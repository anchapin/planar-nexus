/**
 * @fileoverview Validation tests for the GameStateEvaluator
 *
 * This file contains simple validation tests that can be run standalone
 * without requiring a test framework like Jest.
 */

import {
  GameState,
  GameStateEvaluator,
  evaluateGameState,
  compareGameStates,
  quickScore,
} from '../game-state-evaluator';

// Helper function to create a minimal game state for testing
function createMinimalGameState(player1Life: number, player2Life: number): GameState {
  return {
    players: {
      player1: {
        id: 'player1',
        life: player1Life,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 50,
        battlefield: [],
        manaPool: {},
      },
      player2: {
        id: 'player2',
        life: player2Life,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 50,
        battlefield: [],
        manaPool: {},
      },
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer: 'player1',
      phase: 'precombat_main',
      priority: 'player1',
    },
    stack: [],
  };
}

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function runTest(name: string, testFn: () => void | Promise<void>) {
  try {
    testFn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: errorMessage });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${errorMessage}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// Validation tests
async function runValidation() {
  console.log('\n=== AI Game State Evaluator Validation ===\n');

  // Test 1: Basic Evaluation
  runTest('Basic evaluation works', () => {
    const gameState = createMinimalGameState(20, 20);
    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation !== undefined, 'Evaluation should be defined');
    assert(typeof evaluation.totalScore === 'number', 'Total score should be a number');
    assert(evaluation.factors !== undefined, 'Factors should be defined');
    assert(evaluation.threats !== undefined, 'Threats should be defined');
    assert(evaluation.opportunities !== undefined, 'Opportunities should be defined');
    assert(evaluation.recommendedActions !== undefined, 'Recommendations should be defined');
  });

  // Test 2: Life advantage
  runTest('Higher life should give better score', () => {
    const winningState = createMinimalGameState(20, 10);
    const losingState = createMinimalGameState(10, 20);

    const winningScore = quickScore(winningState, 'player1', 'medium');
    const losingScore = quickScore(losingState, 'player1', 'medium');

    assert(winningScore > losingScore, `Winning score (${winningScore}) should be greater than losing score (${losingScore})`);
  });

  // Test 3: Poison counters
  runTest('Poison counters should reduce score', () => {
    const healthyState = createMinimalGameState(20, 20);
    healthyState.players.player1.poisonCounters = 0;

    const poisonedState = createMinimalGameState(20, 20);
    poisonedState.players.player1.poisonCounters = 5;

    const healthyScore = quickScore(healthyState, 'player1', 'medium');
    const poisonedScore = quickScore(poisonedState, 'player1', 'medium');

    assert(healthyScore > poisonedScore, `Healthy score (${healthyScore}) should be greater than poisoned score (${poisonedScore})`);
  });

  // Test 4: Card advantage
  runTest('Card advantage should improve score', () => {
    const cardAdvantageState = createMinimalGameState(20, 20);
    cardAdvantageState.players.player1.hand = [
      { cardInstanceId: '1', name: 'Card', type: 'Creature', manaValue: 2 },
      { cardInstanceId: '2', name: 'Card', type: 'Creature', manaValue: 2 },
      { cardInstanceId: '3', name: 'Card', type: 'Creature', manaValue: 2 },
    ];

    const cardDisadvantageState = createMinimalGameState(20, 20);
    cardDisadvantageState.players.player2.hand = [
      { cardInstanceId: '1', name: 'Card', type: 'Creature', manaValue: 2 },
      { cardInstanceId: '2', name: 'Card', type: 'Creature', manaValue: 2 },
      { cardInstanceId: '3', name: 'Card', type: 'Creature', manaValue: 2 },
    ];

    const advantageScore = quickScore(cardAdvantageState, 'player1', 'medium');
    const disadvantageScore = quickScore(cardDisadvantageState, 'player1', 'medium');

    assert(advantageScore > disadvantageScore, `Advantage score (${advantageScore}) should be greater than disadvantage score (${disadvantageScore})`);
  });

  // Test 5: Creature advantage
  runTest('Creature advantage should improve score', () => {
    const creatureAdvantageState = createMinimalGameState(20, 20);
    creatureAdvantageState.players.player1.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Creature',
        type: 'creature',
        controller: 'player1',
        power: 2,
        toughness: 2,
        tapped: false,
      },
      {
        id: 'c2',
        cardInstanceId: 'c2',
        name: 'Creature',
        type: 'creature',
        controller: 'player1',
        power: 2,
        toughness: 2,
        tapped: false,
      },
    ];

    const creatureDisadvantageState = createMinimalGameState(20, 20);
    creatureDisadvantageState.players.player2.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Creature',
        type: 'creature',
        controller: 'player2',
        power: 2,
        toughness: 2,
        tapped: false,
      },
      {
        id: 'c2',
        cardInstanceId: 'c2',
        name: 'Creature',
        type: 'creature',
        controller: 'player2',
        power: 2,
        toughness: 2,
        tapped: false,
      },
    ];

    const advantageScore = quickScore(creatureAdvantageState, 'player1', 'medium');
    const disadvantageScore = quickScore(creatureDisadvantageState, 'player1', 'medium');

    assert(advantageScore > disadvantageScore, `Creature advantage score (${advantageScore}) should be greater than disadvantage score (${disadvantageScore})`);
  });

  // Test 6: Strong creatures vs weak creatures
  runTest('Stronger creatures should give better score', () => {
    const strongCreatureState = createMinimalGameState(20, 20);
    strongCreatureState.players.player1.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Strong Creature',
        type: 'creature',
        controller: 'player1',
        power: 5,
        toughness: 5,
        tapped: false,
      },
    ];
    strongCreatureState.players.player2.battlefield = [
      {
        id: 'c2',
        cardInstanceId: 'c2',
        name: 'Weak Creature',
        type: 'creature',
        controller: 'player2',
        power: 1,
        toughness: 1,
        tapped: false,
      },
    ];

    const weakCreatureState = createMinimalGameState(20, 20);
    weakCreatureState.players.player1.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Weak Creature',
        type: 'creature',
        controller: 'player1',
        power: 1,
        toughness: 1,
        tapped: false,
      },
    ];
    weakCreatureState.players.player2.battlefield = [
      {
        id: 'c2',
        cardInstanceId: 'c2',
        name: 'Strong Creature',
        type: 'creature',
        controller: 'player2',
        power: 5,
        toughness: 5,
        tapped: false,
      },
    ];

    const strongScore = quickScore(strongCreatureState, 'player1', 'medium');
    const weakScore = quickScore(weakCreatureState, 'player1', 'medium');

    assert(strongScore > weakScore, `Strong creature score (${strongScore}) should be greater than weak creature score (${weakScore})`);
  });

  // Test 7: Threat assessment
  runTest('Should identify untapped creatures as threats', () => {
    const gameState = createMinimalGameState(20, 20);
    gameState.players.player2.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Attacker',
        type: 'creature',
        controller: 'player2',
        power: 4,
        toughness: 4,
        tapped: false,
      },
    ];

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.threats.length > 0, 'Should identify threats');
    assert(evaluation.threats[0].urgency !== 'low', 'Untapped creature should not be low urgency');
  });

  // Test 8: Planeswalker threats
  runTest('Should identify planeswalkers as major threats', () => {
    const gameState = createMinimalGameState(20, 20);
    gameState.players.player2.battlefield = [
      {
        id: 'p1',
        cardInstanceId: 'p1',
        name: 'Test Planeswalker',
        type: 'planeswalker',
        controller: 'player2',
        loyalty: 5,
        tapped: false,
      },
    ];

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.threats.length > 0, 'Should identify planeswalker as threat');
    const planeswalkerThreat = evaluation.threats.find(
      (t) => t.reason.includes('Planeswalker')
    );
    assert(planeswalkerThreat !== undefined, 'Should have a planeswalker threat');
  });

  // Test 9: Difficulty levels
  runTest('Should produce different scores for different difficulties', () => {
    const gameState = createMinimalGameState(20, 20);
    gameState.players.player1.battlefield = [
      {
        id: 'c1',
        cardInstanceId: 'c1',
        name: 'Creature',
        type: 'creature',
        controller: 'player1',
        power: 3,
        toughness: 3,
        tapped: false,
      },
    ];

    const easyScore = quickScore(gameState, 'player1', 'easy');
    const mediumScore = quickScore(gameState, 'player1', 'medium');
    const hardScore = quickScore(gameState, 'player1', 'hard');

    // At least one of the scores should differ
    assert(
      easyScore !== mediumScore || mediumScore !== hardScore,
      'Scores should differ between difficulty levels'
    );
  });

  // Test 10: Custom weights
  runTest('Should allow custom weight configuration', () => {
    const gameState = createMinimalGameState(20, 20);
    const evaluator = new GameStateEvaluator(gameState, 'player1', 'medium');

    const originalWeights = evaluator.getWeights();

    evaluator.setWeights({
      lifeScore: 10.0,
    });

    const newWeights = evaluator.getWeights();

    assert(newWeights.lifeScore === 10.0, 'Life score weight should be updated');
    assert(
      newWeights.creaturePower === originalWeights.creaturePower,
      'Other weights should remain unchanged'
    );
  });

  // Test 11: State comparison
  runTest('Should correctly identify better state', () => {
    const betterState = createMinimalGameState(20, 10);
    const worseState = createMinimalGameState(10, 20);

    const comparison = compareGameStates(worseState, betterState, 'player1', 'medium');

    assert(comparison > 0, `Comparison (${comparison}) should be positive when second state is better`);
  });

  // Test 12: Commander damage
  runTest('Should evaluate commander damage', () => {
    const gameState = createMinimalGameState(40, 40);
    gameState.players.player1.commanderDamage = {
      player2: 10,
    };

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.factors.commanderDamage > 0, 'Commander damage should increase score');
  });

  // Test 13: Commander presence
  runTest('Should check commander presence', () => {
    const gameState = createMinimalGameState(40, 40);
    gameState.commandZone = {
      player1: {
        commander: {
          id: 'cmd1',
          cardInstanceId: 'cmd1',
          name: 'Test Commander',
          type: 'creature',
          controller: 'player1',
          power: 3,
          toughness: 3,
          tapped: false,
        },
      },
    };
    gameState.players.player1.battlefield = [
      {
        id: 'cmd1',
        cardInstanceId: 'cmd1',
        name: 'Test Commander',
        type: 'creature',
        controller: 'player1',
        power: 3,
        toughness: 3,
        tapped: false,
      },
    ];

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.factors.commanderPresence === 1, 'Commander should be present on battlefield');
  });

  // Test 14: Win condition progress
  runTest('Should detect low opponent life as win progress', () => {
    const gameState = createMinimalGameState(20, 5);

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.factors.winConditionProgress > 0.5, `Win progress should be high when opponent is at 5 life, got ${evaluation.factors.winConditionProgress}`);
  });

  // Test 15: Poison win condition
  runTest('Should detect poison counters as win progress', () => {
    const gameState = createMinimalGameState(20, 20);
    gameState.players.player2.poisonCounters = 8;

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.factors.winConditionProgress > 0, 'Poison counters should contribute to win progress');
  });

  // Test 16: Recommendations
  runTest('Should provide recommendations when losing', () => {
    const gameState = createMinimalGameState(5, 20);

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    assert(evaluation.recommendedActions.length > 0, 'Should provide recommendations when losing on life');
  });

  // Test 17: Win condition recommendation
  runTest('Should recommend closing out game when winning', () => {
    const gameState = createMinimalGameState(20, 3);

    const evaluation = evaluateGameState(gameState, 'player1', 'medium');

    const closeOutRec = evaluation.recommendedActions.find(
      (rec) => rec.toLowerCase().includes('win') || rec.toLowerCase().includes('close')
    );

    assert(closeOutRec !== undefined, 'Should recommend closing out game when opponent is at 3 life');
  });

  // Print summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}`);
      if (r.error) {
        console.log(`    ${r.error}`);
      }
    });
  }

  console.log('\n=== Validation Complete ===\n');

  return { passed, failed, total: results.length };
}

// Export for use in other modules
export { runValidation, createMinimalGameState };

// Run validation if this file is executed directly
if (typeof window === 'undefined') {
  runValidation().catch((error) => {
    console.error('Validation failed with error:', error);
    process.exit(1);
  });
}
