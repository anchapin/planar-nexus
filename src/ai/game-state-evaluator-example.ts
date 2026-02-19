/**
 * @fileoverview Example usage and test cases for the GameStateEvaluator
 *
 * This file demonstrates how to use the AI game state evaluation system
 * with realistic MTG game scenarios.
 */

import {
  GameState,
  GameStateEvaluator,
  PlayerState,
  TurnInfo,
  evaluateGameState,
  compareGameStates,
  quickScore,
  type DetailedEvaluation,
} from './game-state-evaluator';

/**
 * Create a sample game state for testing
 */
function createSampleGameState(): GameState {
  // Player 1 (evaluating player) - Red aggro deck
  const player1: PlayerState = {
    id: 'player1',
    life: 18,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      {
        cardId: 'card1',
        name: 'Lightning Bolt',
        type: 'Instant',
        manaValue: 1,
        colors: ['R'],
      },
      {
        cardId: 'card2',
        name: 'Goblin Guide',
        type: 'Creature — Goblin Scout',
        manaValue: 1,
        colors: ['R'],
      },
      {
        cardId: 'card3',
        name: 'Mountain',
        type: 'Land',
        manaValue: 0,
        colors: [],
      },
    ],
    graveyard: ['card4', 'card5'],
    exile: [],
    library: 45,
    battlefield: [
      {
        id: 'perm1',
        cardId: 'card6',
        name: 'Monastery Swiftspear',
        type: 'creature',
        controller: 'player1',
        tapped: false,
        power: 1,
        toughness: 2,
        keywords: ['haste', 'prowess'],
        manaValue: 1,
      },
      {
        id: 'perm2',
        cardId: 'card7',
        name: 'Eidolon of the Great Revel',
        type: 'creature',
        controller: 'player1',
        tapped: false,
        power: 2,
        toughness: 2,
        keywords: ['prowess'],
        manaValue: 2,
      },
      {
        id: 'perm3',
        cardId: 'card8',
        name: 'Mountain',
        type: 'land',
        controller: 'player1',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm4',
        cardId: 'card9',
        name: 'Mountain',
        type: 'land',
        controller: 'player1',
        tapped: true,
        manaValue: 0,
      },
    ],
    manaPool: { R: 2 },
  };

  // Player 2 (opponent) - Blue control deck
  const player2: PlayerState = {
    id: 'player2',
    life: 12,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      {
        cardId: 'card10',
        name: 'Counterspell',
        type: 'Instant',
        manaValue: 2,
        colors: ['U'],
      },
      {
        cardId: 'card11',
        name: 'Snapcaster Mage',
        type: 'Creature — Human Wizard',
        manaValue: 2,
        colors: ['U'],
      },
      {
        cardId: 'card12',
        name: 'Brainstorm',
        type: 'Instant',
        manaValue: 1,
        colors: ['U'],
      },
    ],
    graveyard: ['card13'],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: 'perm5',
        cardId: 'card14',
        name: 'Sphinx of Jwar Isle',
        type: 'creature',
        controller: 'player2',
        tapped: true,
        power: 5,
        toughness: 5,
        keywords: ['flying', 'shroud'],
        manaValue: 5,
      },
      {
        id: 'perm6',
        cardId: 'card15',
        name: 'Island',
        type: 'land',
        controller: 'player2',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm7',
        cardId: 'card16',
        name: 'Island',
        type: 'land',
        controller: 'player2',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm8',
        cardId: 'card17',
        name: 'Island',
        type: 'land',
        controller: 'player2',
        tapped: false,
        manaValue: 0,
      },
    ],
    manaPool: { U: 0 },
  };

  const turnInfo: TurnInfo = {
    currentTurn: 5,
    currentPlayer: 'player1',
    phase: 'precombat_main',
    step: 'main',
    priority: 'player1',
  };

  return {
    players: {
      player1,
      player2,
    },
    turnInfo,
    stack: [],
  };
}

/**
 * Create a Commander format game state
 */
function createCommanderGameState(): GameState {
  // Player 1 - Commander deck
  const player1: PlayerState = {
    id: 'player1',
    life: 38,
    poisonCounters: 0,
    commanderDamage: { player2: 8 }, // Dealt 8 commander damage
    hand: [
      {
        cardId: 'card1',
        name: 'Sol Ring',
        type: 'Artifact',
        manaValue: 1,
        colors: [],
      },
      {
        cardId: 'card2',
        name: 'Sakura-Tribe Elder',
        type: 'Creature — Snake Shaman',
        manaValue: 2,
        colors: ['G'],
      },
    ],
    graveyard: [],
    exile: [],
    library: 85,
    battlefield: [
      {
        id: 'perm1',
        cardId: 'commander1',
        name: 'Krenko, Mob Boss',
        type: 'creature',
        controller: 'player1',
        tapped: false,
        power: 3,
        toughness: 3,
        keywords: ['haste'],
        manaValue: 4,
        counters: { '+1/+1': 1 },
      },
      {
        id: 'perm2',
        cardId: 'land1',
        name: 'Mountain',
        type: 'land',
        controller: 'player1',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm3',
        cardId: 'land2',
        name: 'Mountain',
        type: 'land',
        controller: 'player1',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm4',
        cardId: 'land3',
        name: 'Mountain',
        type: 'land',
        controller: 'player1',
        tapped: false,
        manaValue: 0,
      },
    ],
    manaPool: { R: 3 },
  };

  // Player 2 - Commander deck
  const player2: PlayerState = {
    id: 'player2',
    life: 32,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      {
        cardId: 'card10',
        name: 'Wrath of God',
        type: 'Sorcery',
        manaValue: 4,
        colors: ['W'],
      },
      {
        cardId: 'card11',
        name: 'Swords to Plowshares',
        type: 'Instant',
        manaValue: 1,
        colors: ['W'],
      },
    ],
    graveyard: ['card12', 'card13', 'card14'],
    exile: [],
    library: 78,
    battlefield: [
      {
        id: 'perm5',
        cardId: 'commander2',
        name: 'Rhalgor, the Rampant',
        type: 'creature',
        controller: 'player2',
        tapped: false,
        power: 5,
        toughness: 5,
        manaValue: 5,
      },
      {
        id: 'perm6',
        cardId: 'land4',
        name: 'Plains',
        type: 'land',
        controller: 'player2',
        tapped: false,
        manaValue: 0,
      },
      {
        id: 'perm7',
        cardId: 'land5',
        name: 'Plains',
        type: 'land',
        controller: 'player2',
        tapped: false,
        manaValue: 0,
      },
    ],
    manaPool: { W: 2 },
  };

  const turnInfo: TurnInfo = {
    currentTurn: 8,
    currentPlayer: 'player1',
    phase: 'combat',
    step: 'declare_attackers',
    priority: 'player1',
  };

  return {
    players: {
      player1,
      player2,
    },
    turnInfo,
    stack: [],
    commandZone: {
      player1: {
        commander: {
          id: 'commander1',
          cardId: 'commander1',
          name: 'Krenko, Mob Boss',
          type: 'creature',
          controller: 'player1',
          power: 3,
          toughness: 3,
          manaValue: 4,
        },
      },
      player2: {
        commander: {
          id: 'commander2',
          cardId: 'commander2',
          name: 'Rhalgor, the Rampant',
          type: 'creature',
          controller: 'player2',
          power: 5,
          toughness: 5,
          manaValue: 5,
        },
      },
    },
  };
}

/**
 * Example 1: Basic evaluation
 */
export function example1_BasicEvaluation(): DetailedEvaluation {
  console.log('=== Example 1: Basic Game State Evaluation ===\n');

  const gameState = createSampleGameState();
  const evaluation = evaluateGameState(gameState, 'player1', 'medium');

  console.log('Total Score:', evaluation.totalScore.toFixed(2));
  console.log('\nFactor Scores:');
  for (const [factor, score] of Object.entries(evaluation.factors)) {
    console.log(`  ${factor}: ${score.toFixed(2)}`);
  }

  console.log('\nTop Threats:');
  evaluation.threats.slice(0, 3).forEach((threat, index) => {
    console.log(
      `  ${index + 1}. [${threat.urgency}] ${threat.reason} (${(threat.threatLevel * 100).toFixed(0)}%)`
    );
  });

  console.log('\nOpportunities:');
  evaluation.opportunities.forEach((opp, index) => {
    console.log(
      `  ${index + 1}. ${opp.description} (value: ${opp.value.toFixed(2)}, risk: ${opp.risk.toFixed(2)})`
    );
  });

  console.log('\nRecommendations:');
  evaluation.recommendedActions.forEach((rec, index) => {
    console.log(`  ${index + 1}. ${rec}`);
  });

  console.log('\n');
  return evaluation;
}

/**
 * Example 2: Comparing different difficulty levels
 */
export function example2_DifficultyComparison(): void {
  console.log('=== Example 2: Difficulty Level Comparison ===\n');

  const gameState = createSampleGameState();

  const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];

  console.log('Score comparison across difficulty levels:');
  difficulties.forEach((difficulty) => {
    const evaluation = evaluateGameState(gameState, 'player1', difficulty);
    console.log(`  ${difficulty}: ${evaluation.totalScore.toFixed(2)}`);
  });

  console.log('\nMedium difficulty factor weights:');
  const evaluator = new GameStateEvaluator(gameState, 'player1', 'medium');
  const weights = evaluator.getWeights();
  for (const [weight, value] of Object.entries(weights)) {
    console.log(`  ${weight}: ${value}`);
  }

  console.log('\n');
}

/**
 * Example 3: Commander format evaluation
 */
export function example3_CommanderFormat(): DetailedEvaluation {
  console.log('=== Example 3: Commander Format Evaluation ===\n');

  const gameState = createCommanderGameState();
  const evaluation = evaluateGameState(gameState, 'player1', 'medium');

  console.log('Total Score:', evaluation.totalScore.toFixed(2));
  console.log('Player 1 Life:', gameState.players.player1.life);
  console.log('Player 2 Life:', gameState.players.player2.life);
  console.log(
    'Commander Damage Dealt:',
    gameState.players.player1.commanderDamage?.player2 || 0
  );

  console.log('\nKey Factors:');
  console.log(`  Life Score: ${evaluation.factors.lifeScore.toFixed(2)}`);
  console.log(
    `  Commander Damage: ${evaluation.factors.commanderDamage.toFixed(2)}`
  );
  console.log(
    `  Commander Presence: ${evaluation.factors.commanderPresence.toFixed(2)}`
  );
  console.log(
    `  Win Condition Progress: ${evaluation.factors.winConditionProgress.toFixed(2)}`
  );

  console.log('\nRecommendations:');
  evaluation.recommendedActions.forEach((rec, index) => {
    console.log(`  ${index + 1}. ${rec}`);
  });

  console.log('\n');
  return evaluation;
}

/**
 * Example 4: Comparing two game states
 */
export function example4_ComparingStates(): void {
  console.log('=== Example 4: Comparing Game States ===\n');

  const state1 = createSampleGameState();
  const state2 = createSampleGameState();

  // Modify state2 to be better for player1
  state2.players.player1.life = 25;
  state2.players.player2.life = 5;

  console.log('State 1: Player 1 has 18 life, Player 2 has 12 life');
  console.log('State 2: Player 1 has 25 life, Player 2 has 5 life');

  const score1 = quickScore(state1, 'player1', 'medium');
  const score2 = quickScore(state2, 'player1', 'medium');
  const comparison = compareGameStates(state1, state2, 'player1', 'medium');

  console.log(`\nState 1 Score: ${score1.toFixed(2)}`);
  console.log(`State 2 Score: ${score2.toFixed(2)}`);
  console.log(`Difference: ${comparison.toFixed(2)} (state2 is better)`);

  console.log('\n');
}

/**
 * Example 5: Custom evaluation weights
 */
export function example5_CustomWeights(): void {
  console.log('=== Example 5: Custom Evaluation Weights ===\n');

  const gameState = createSampleGameState();

  // Default evaluation
  const defaultEval = evaluateGameState(gameState, 'player1', 'medium');
  console.log('Default evaluation score:', defaultEval.totalScore.toFixed(2));

  // Aggressive weights (prioritize creatures and damage)
  const evaluator = new GameStateEvaluator(gameState, 'player1', 'medium');
  evaluator.setWeights({
    creaturePower: 3.0, // Triple importance of creature power
    creatureCount: 2.5,
    lifeScore: 0.2, // Care less about life total
    cardAdvantage: 0.5,
  });

  const aggressiveEval = evaluator.evaluate();
  console.log('Aggressive evaluation score:', aggressiveEval.totalScore.toFixed(2));

  // Control weights (prioritize card advantage and answers)
  evaluator.setWeights({
    cardAdvantage: 2.5,
    handQuality: 1.5,
    lifeScore: 1.0,
    creaturePower: 0.5,
    creatureCount: 0.3,
  });

  const controlEval = evaluator.evaluate();
  console.log('Control evaluation score:', controlEval.totalScore.toFixed(2));

  console.log('\n');
}

/**
 * Example 6: Threat assessment focus
 */
export function example6_ThreatAssessment(): void {
  console.log('=== Example 6: Detailed Threat Assessment ===\n');

  const gameState = createSampleGameState();
  const evaluation = evaluateGameState(gameState, 'player2', 'medium'); // Evaluate from opponent's perspective

  console.log(`Evaluating from Player 2's perspective (Blue Control)\n`);

  console.log('Identified Threats:');
  evaluation.threats.forEach((threat, index) => {
    const urgencyIndicator = {
      immediate: '🚨',
      soon: '⚠️',
      eventual: '⏳',
      low: '📋',
    }[threat.urgency];

    console.log(
      `  ${index + 1}. ${urgencyIndicator} [${threat.urgency.toUpperCase()}] ${threat.reason}`
    );
    console.log(`     Threat Level: ${(threat.threatLevel * 100).toFixed(0)}%`);
  });

  if (evaluation.threats.length === 0) {
    console.log('  No significant threats detected.');
  }

  console.log('\n');
}

/**
 * Run all examples
 */
export function runAllExamples(): void {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║   AI Game State Evaluation System - Usage Examples     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  example1_BasicEvaluation();
  example2_DifficultyComparison();
  example3_CommanderFormat();
  example4_ComparingStates();
  example5_CustomWeights();
  example6_ThreatAssessment();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('All examples completed successfully!');
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Export examples for use in tests or other modules
export const examples = {
  basicEvaluation: example1_BasicEvaluation,
  difficultyComparison: example2_DifficultyComparison,
  commanderFormat: example3_CommanderFormat,
  comparingStates: example4_ComparingStates,
  customWeights: example5_CustomWeights,
  threatAssessment: example6_ThreatAssessment,
};

// Export sample game state creators for testing
export const sampleStates = {
  createSampleGameState,
  createCommanderGameState,
};
