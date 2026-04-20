/**
 * @fileoverview Combat AI Examples and Test Cases
 *
 * This file demonstrates how to use the Combat AI system with realistic
 * MTG combat scenarios, showing attacker selection, blocking decisions,
 * and strategic considerations.
 */

import {
  CombatDecisionTree,
  CombatPlan,
  generateAttackDecisions,
  generateBlockingDecisions,
  type CombatAIConfig,
} from './combat-decision-tree';
import { GameState, PlayerState, Permanent } from '@/ai/game-state-evaluator';
import { logger } from '@/lib/logger';

const combatExamplesLogger = logger.child('CombatExamples');

/**
 * Create a sample game state for combat testing
 */
function createCombatGameState(): GameState {
  // AI Player - Red aggro with evasive creatures
  const aiPlayer: PlayerState = {
    id: 'ai_player',
    life: 18,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [],
    graveyard: [],
    exile: [],
    library: 40,
    battlefield: [
      {
        id: 'creature1',
        cardInstanceId: 'c1',
        name: 'Stormwing Entity',
        type: 'creature',
        controller: 'ai_player',
        tapped: false,
        power: 3,
        toughness: 2,
        keywords: ['flying', 'prowess'],
        manaValue: 3,
      },
      {
        id: 'creature2',
        cardInstanceId: 'c2',
        name: 'Goblin Guide',
        type: 'creature',
        controller: 'ai_player',
        tapped: false,
        power: 2,
        toughness: 2,
        keywords: ['haste'],
        manaValue: 1,
      },
      {
        id: 'creature3',
        cardInstanceId: 'c3',
        name: 'Keldon Marauders',
        type: 'creature',
        controller: 'ai_player',
        tapped: false,
        power: 3,
        toughness: 2,
        keywords: ['vanishing'],
        manaValue: 2,
      },
      {
        id: 'land1',
        cardInstanceId: 'l1',
        name: 'Mountain',
        type: 'land',
        controller: 'ai_player',
        tapped: false,
        manaValue: 0,
      },
    ],
    manaPool: { R: 2 },
  };

  // Opponent - Green midrange with blockers
  const opponent: PlayerState = {
    id: 'opponent',
    life: 14,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [],
    graveyard: [],
    exile: [],
    library: 45,
    battlefield: [
      {
        id: 'opp_creature1',
        cardInstanceId: 'oc1',
        name: 'Carnage Tyrant',
        type: 'creature',
        controller: 'opponent',
        tapped: false,
        power: 7,
        toughness: 6,
        keywords: ['menace'],
        manaValue: 6,
      },
      {
        id: 'opp_creature2',
        cardInstanceId: 'oc2',
        name: 'Birds of Paradise',
        type: 'creature',
        controller: 'opponent',
        tapped: false,
        power: 0,
        toughness: 1,
        keywords: ['flying'],
        manaValue: 1,
      },
      {
        id: 'opp_creature3',
        cardInstanceId: 'oc3',
        name: 'Thrun, the Last Troll',
        type: 'creature',
        controller: 'opponent',
        tapped: true,
        power: 4,
        toughness: 4,
        keywords: ['hexproof'],
        manaValue: 4,
      },
    ],
    manaPool: {},
  };

  return {
    players: {
      ai_player: aiPlayer,
      opponent,
    },
    turnInfo: {
      currentTurn: 4,
      currentPlayer: 'ai_player',
      phase: 'combat',
      step: 'declare_attackers',
      priority: 'ai_player',
    },
    stack: [],
  };
}

/**
 * Example 1: Basic Attack Decisions
 */
export function example1_BasicAttacks(): CombatPlan {
  combatExamplesLogger.debug('=== Example 1: Basic Attack Decisions ===\n');

  const gameState = createCombatGameState();
  const combatPlan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  combatExamplesLogger.debug(`Strategy: ${combatPlan.strategy.toUpperCase()}`);
  combatExamplesLogger.debug(`Total Expected Value: ${combatPlan.totalExpectedValue.toFixed(2)}\n`);

  combatExamplesLogger.debug('Attack Decisions:');
  if (combatPlan.attacks.length === 0) {
    combatExamplesLogger.debug('  No attacks - holding back creatures for defense');
  } else {
    combatPlan.attacks.forEach((attack, index) => {
      combatExamplesLogger.debug(`  ${index + 1}. ${attack.reasoning}`);
      combatExamplesLogger.debug(`     Expected Value: ${attack.expectedValue.toFixed(2)}`);
      combatExamplesLogger.debug(`     Risk Level: ${(attack.riskLevel * 100).toFixed(0)}%`);
      combatExamplesLogger.debug('');
    });
  }

  combatExamplesLogger.debug('');
  return combatPlan;
}

/**
 * Example 2: Blocking Decisions
 */
export function example2_BlockingDecisions(): CombatPlan {
  combatExamplesLogger.debug('=== Example 2: Blocking Decisions ===\n');

  const gameState = createCombatGameState();

  // Opponent is attacking with their creatures
  const attackers: Permanent[] = [
    {
      id: 'opp_creature1',
      cardInstanceId: 'oc1',
      name: 'Carnage Tyrant',
      type: 'creature',
      controller: 'opponent',
      tapped: false,
      power: 7,
      toughness: 6,
      keywords: ['menace'],
      manaValue: 6,
    },
  ];

  const combatPlan = generateBlockingDecisions(gameState, 'ai_player', attackers, 'medium');

  combatExamplesLogger.debug('Opponent is attacking with:');
  attackers.forEach((attacker) => {
    combatExamplesLogger.debug(`  - ${attacker.name} (${attacker.power}/${attacker.toughness})`);
  });
  combatExamplesLogger.debug('');

  combatExamplesLogger.debug('Blocking Decisions:');
  if (combatPlan.blocks.length === 0) {
    combatExamplesLogger.debug('  No blocks - taking the damage');
  } else {
    combatPlan.blocks.forEach((block, index) => {
      const blocker = gameState.players.ai_player.battlefield.find(
        (c) => c.id === block.blockerId
      );
      const attacker = attackers.find((a) => a.id === block.attackerId);
      combatExamplesLogger.debug(
        `  ${index + 1}. ${blocker?.name} blocks ${attacker?.name}: ${block.reasoning}`
      );
      combatExamplesLogger.debug(`     Expected Value: ${block.expectedValue.toFixed(2)}`);
      if (block.damageOrder !== undefined) {
        combatExamplesLogger.debug(`     Damage Order: ${block.damageOrder}`);
      }
      combatExamplesLogger.debug('');
    });
  }

  combatExamplesLogger.debug('');
  return combatPlan;
}

/**
 * Example 3: Aggressive vs Defensive Strategy
 */
export function example3_StrategyComparison(): void {
  combatExamplesLogger.debug('=== Example 3: Aggressive vs Defensive Strategy ===\n');

  const gameState = createCombatGameState();

  // Low life scenario (should be defensive)
  const defensiveState = JSON.parse(JSON.stringify(gameState));
  defensiveState.players.ai_player.life = 5;

  combatExamplesLogger.debug('Scenario A: AI at 5 life (should play defensively)');
  const defensiveAI = new CombatDecisionTree(defensiveState, 'ai_player', 'medium');
  const defensivePlan = defensiveAI.generateAttackPlan();

  combatExamplesLogger.debug(`Strategy: ${defensivePlan.strategy.toUpperCase()}`);
  combatExamplesLogger.debug(`Attacks: ${defensivePlan.attacks.length}`);
  defensivePlan.attacks.forEach((attack) => {
    combatExamplesLogger.debug(`  - ${attack.reasoning}`);
  });
  combatExamplesLogger.debug('');

  // High life scenario (should be aggressive)
  const aggressiveState = JSON.parse(JSON.stringify(gameState));
  aggressiveState.players.ai_player.life = 20;
  aggressiveState.players.opponent.life = 8;

  combatExamplesLogger.debug('Scenario B: AI at 20 life, opponent at 8 (should play aggressively)');
  const aggressiveAI = new CombatDecisionTree(aggressiveState, 'ai_player', 'medium');
  const aggressivePlan = aggressiveAI.generateAttackPlan();

  combatExamplesLogger.debug(`Strategy: ${aggressivePlan.strategy.toUpperCase()}`);
  combatExamplesLogger.debug(`Attacks: ${aggressivePlan.attacks.length}`);
  aggressivePlan.attacks.forEach((attack) => {
    combatExamplesLogger.debug(`  - ${attack.reasoning}`);
  });
  combatExamplesLogger.debug('');
}

/**
 * Example 4: Evasion Creatures
 */
export function example4_EvasionCreatures(): void {
  combatExamplesLogger.debug('=== Example 4: Evasion Creatures ===\n');

  const gameState: GameState = {
    players: {
      ai_player: {
        id: 'ai_player',
        life: 20,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [
          {
            id: 'flying_creature',
            cardInstanceId: 'fc',
            name: 'Serra Angel',
            type: 'creature',
            controller: 'ai_player',
            tapped: false,
            power: 4,
            toughness: 4,
            keywords: ['flying', 'vigilance'],
            manaValue: 5,
          },
          {
            id: 'ground_creature',
            cardInstanceId: 'gc',
            name: 'Hill Giant',
            type: 'creature',
            controller: 'ai_player',
            tapped: false,
            power: 4,
            toughness: 4,
            keywords: [],
            manaValue: 4,
          },
        ],
        manaPool: {},
      },
      opponent: {
        id: 'opponent',
        life: 20,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [
          {
            id: 'ground_blocker',
            cardInstanceId: 'gb',
            name: 'Gray Ogre',
            type: 'creature',
            controller: 'opponent',
            tapped: false,
            power: 2,
            toughness: 2,
            keywords: [],
            manaValue: 3,
          },
        ],
        manaPool: {},
      },
    },
    turnInfo: {
      currentTurn: 5,
      currentPlayer: 'ai_player',
      phase: 'combat',
      step: 'declare_attackers',
      priority: 'ai_player',
    },
    stack: [],
  };

  const combatPlan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  combatExamplesLogger.debug('Board State:');
  combatExamplesLogger.debug("  AI: Serra Angel (4/4 flying), Hill Giant (4/4)");
  combatExamplesLogger.debug("  Opponent: Gray Ogre (2/2)");
  combatExamplesLogger.debug('');

  combatExamplesLogger.debug('Attack Decisions:');
  combatPlan.attacks.forEach((attack) => {
    const creature = gameState.players.ai_player.battlefield.find(
      (c) => c.id === attack.creatureId
    );
    combatExamplesLogger.debug(
      `  ✓ ${creature?.name}: ${attack.reasoning} (expected value: ${attack.expectedValue.toFixed(2)})`
    );
  });
  combatExamplesLogger.debug('');
}

/**
 * Example 5: Combat Trades
 */
export function example5_CombatTrades(): void {
  combatExamplesLogger.debug('=== Example 5: Evaluating Combat Trades ===\n');

  const gameState: GameState = {
    players: {
      ai_player: {
        id: 'ai_player',
        life: 20,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [
          {
            id: 'my_creature',
            cardInstanceId: 'mc',
            name: 'Grizzly Bears',
            type: 'creature',
            controller: 'ai_player',
            tapped: false,
            power: 2,
            toughness: 2,
            keywords: [],
            manaValue: 2,
          },
        ],
        manaPool: {},
      },
      opponent: {
        id: 'opponent',
        life: 20,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [
          {
            id: 'expensive_creature',
            cardInstanceId: 'ec',
            name: 'Craw Wurm',
            type: 'creature',
            controller: 'opponent',
            tapped: false,
            power: 6,
            toughness: 4,
            keywords: [],
            manaValue: 6,
          },
        ],
        manaPool: {},
      },
    },
    turnInfo: {
      currentTurn: 5,
      currentPlayer: 'ai_player',
      phase: 'combat',
      step: 'declare_attackers',
      priority: 'ai_player',
    },
    stack: [],
  };

  const combatPlan = generateAttackDecisions(gameState, 'ai_player', 'hard');

  combatExamplesLogger.debug('Board State:');
  combatExamplesLogger.debug("  AI: Grizzly Bears (2/2, 2 mana)");
  combatExamplesLogger.debug("  Opponent: Craw Wurm (6/4, 6 mana)");
  combatExamplesLogger.debug('');

  combatExamplesLogger.debug('Analysis:');
  combatExamplesLogger.debug('  If AI attacks:');
  combatExamplesLogger.debug('    - Opponent can block with Craw Wurm');
  combatExamplesLogger.debug('    - Both creatures die (bad trade for AI - loses 2 mana, opp loses 6 mana)');
  combatExamplesLogger.debug('');

  if (combatPlan.attacks.length > 0) {
    const attack = combatPlan.attacks[0];
    combatExamplesLogger.debug(`  Decision: ${attack.shouldAttack ? 'ATTACK' : 'HOLD BACK'}`);
    combatExamplesLogger.debug(`  Reasoning: ${attack.reasoning}`);
    combatExamplesLogger.debug(`  Expected Value: ${attack.expectedValue.toFixed(2)}`);
  } else {
    combatExamplesLogger.debug('  Decision: HOLD BACK (not worth attacking)');
  }
  combatExamplesLogger.debug('');
}

/**
 * Example 6: Multi-Blocking
 */
export function example6_MultiBlocking(): void {
  combatExamplesLogger.debug('=== Example 6: Multi-Blocking with Menace ===\n');

  const gameState: GameState = {
    players: {
      ai_player: {
        id: 'ai_player',
        life: 15,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [
          {
            id: 'blocker1',
            cardInstanceId: 'b1',
            name: 'Savannah Lions',
            type: 'creature',
            controller: 'ai_player',
            tapped: false,
            power: 2,
            toughness: 1,
            keywords: [],
            manaValue: 1,
          },
          {
            id: 'blocker2',
            cardInstanceId: 'b2',
            name: 'Gray Ogre',
            type: 'creature',
            controller: 'ai_player',
            tapped: false,
            power: 2,
            toughness: 2,
            keywords: [],
            manaValue: 3,
          },
        ],
        manaPool: {},
      },
      opponent: {
        id: 'opponent',
        life: 20,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: [],
        manaPool: {},
      },
    },
    turnInfo: {
      currentTurn: 5,
      currentPlayer: 'opponent',
      phase: 'combat',
      step: 'declare_blockers',
      priority: 'ai_player',
    },
    stack: [],
  };

  // Opponent attacks with a menace creature
  const attackers: Permanent[] = [
    {
      id: 'menace_attacker',
      cardInstanceId: 'ma',
      name: 'Bloodrage Brawler',
      type: 'creature',
      controller: 'opponent',
      tapped: false,
      power: 4,
      toughness: 3,
      keywords: ['menace'],
      manaValue: 3,
    },
  ];

  const combatPlan = generateBlockingDecisions(gameState, 'ai_player', attackers, 'hard');

  combatExamplesLogger.debug('Attacker: Bloodrage Brawler (4/3) with MENACE');
  combatExamplesLogger.debug('Available Blockers: Savannah Lions (2/1), Gray Ogre (2/2)');
  combatExamplesLogger.debug('');

  combatExamplesLogger.debug('Blocking Decisions:');
  if (combatPlan.blocks.length === 0) {
    combatExamplesLogger.debug('  No blocks - taking 4 damage');
  } else {
    combatPlan.blocks.forEach((block) => {
      const blocker = gameState.players.ai_player.battlefield.find(
        (c) => c.id === block.blockerId
      );
      combatExamplesLogger.debug(
        `  ${blocker?.name}: ${block.reasoning} (expected value: ${block.expectedValue.toFixed(2)})`
      );
      if (block.damageOrder !== undefined) {
        combatExamplesLogger.debug(`    Damage Order: ${block.damageOrder}`);
      }
    });
  }
  combatExamplesLogger.debug('');
}

/**
 * Example 7: Difficulty Level Comparison
 */
export function example7_DifficultyComparison(): void {
  combatExamplesLogger.debug('=== Example 7: Difficulty Level Comparison ===\n');

  const gameState = createCombatGameState();

  const difficulties: Array<'easy' | 'medium' | 'hard'> = ['easy', 'medium', 'hard'];

  difficulties.forEach((difficulty) => {
    combatExamplesLogger.debug(`${difficulty.toUpperCase()} Difficulty:`);
    const plan = generateAttackDecisions(gameState, 'ai_player', difficulty);

    combatExamplesLogger.debug(`  Strategy: ${plan.strategy}`);
    combatExamplesLogger.debug(`  Attacks: ${plan.attacks.length}`);
    combatExamplesLogger.debug(`  Total Expected Value: ${plan.totalExpectedValue.toFixed(2)}`);

    if (plan.attacks.length > 0) {
      combatExamplesLogger.debug('  Attackers:');
      plan.attacks.forEach((attack) => {
        const creature = gameState.players.ai_player.battlefield.find(
          (c) => c.id === attack.creatureId
        );
        combatExamplesLogger.debug(
          `    - ${creature?.name}: EV=${attack.expectedValue.toFixed(2)}, Risk=${(attack.riskLevel * 100).toFixed(0)}%`
        );
      });
    }
    combatExamplesLogger.debug('');
  });
}

/**
 * Example 8: Custom Configuration
 */
export function example8_CustomConfiguration(): void {
  combatExamplesLogger.debug('=== Example 8: Custom Combat AI Configuration ===\n');

  const gameState = createCombatGameState();

  // Very aggressive configuration
  const aggressiveConfig: Partial<CombatAIConfig> = {
    aggression: 0.9,
    riskTolerance: 0.8,
    lifeThreshold: 5, // Only become defensive at 5 life
    cardAdvantageWeight: 0.5, // Don't care much about card advantage
    useCombatTricks: true,
  };

  const aggressiveAI = new CombatDecisionTree(gameState, 'ai_player', 'medium');
  aggressiveAI.setConfig(aggressiveConfig);
  const aggressivePlan = aggressiveAI.generateAttackPlan();

  combatExamplesLogger.debug('Aggressive Configuration:');
  combatExamplesLogger.debug(`  Strategy: ${aggressivePlan.strategy}`);
  combatExamplesLogger.debug(`  Attacks: ${aggressivePlan.attacks.length}`);
  aggressivePlan.attacks.forEach((attack) => {
    const creature = gameState.players.ai_player.battlefield.find(
      (c) => c.id === attack.creatureId
    );
    combatExamplesLogger.debug(`    - ${creature?.name}`);
  });
  combatExamplesLogger.debug('');

  // Very defensive configuration
  const defensiveConfig: Partial<CombatAIConfig> = {
    aggression: 0.1,
    riskTolerance: 0.2,
    lifeThreshold: 15, // Become defensive early
    cardAdvantageWeight: 2.0, // Highly value card advantage
    useCombatTricks: false,
  };

  const defensiveAI = new CombatDecisionTree(gameState, 'ai_player', 'medium');
  defensiveAI.setConfig(defensiveConfig);
  const defensivePlan = defensiveAI.generateAttackPlan();

  combatExamplesLogger.debug('Defensive Configuration:');
  combatExamplesLogger.debug(`  Strategy: ${defensivePlan.strategy}`);
  combatExamplesLogger.debug(`  Attacks: ${defensivePlan.attacks.length}`);
  if (defensivePlan.attacks.length === 0) {
    combatExamplesLogger.debug('    - Holding back all creatures');
  } else {
    defensivePlan.attacks.forEach((attack) => {
      const creature = gameState.players.ai_player.battlefield.find(
        (c) => c.id === attack.creatureId
      );
      combatExamplesLogger.debug(`    - ${creature?.name}`);
    });
  }
  combatExamplesLogger.debug('');
}

/**
 * Run all examples
 */
export function runAllCombatExamples(): void {
  combatExamplesLogger.debug('\n╔════════════════════════════════════════════════════════════╗');
  combatExamplesLogger.debug('║        Combat AI Decision-Making - Usage Examples        ║');
  combatExamplesLogger.debug('╚════════════════════════════════════════════════════════════╝\n');

  example1_BasicAttacks();
  example2_BlockingDecisions();
  example3_StrategyComparison();
  example4_EvasionCreatures();
  example5_CombatTrades();
  example6_MultiBlocking();
  example7_DifficultyComparison();
  example8_CustomConfiguration();

  combatExamplesLogger.debug('═══════════════════════════════════════════════════════════');
  combatExamplesLogger.debug('All combat examples completed successfully!');
  combatExamplesLogger.debug('═══════════════════════════════════════════════════════════\n');
}

// Export examples for use in tests or other modules
export const combatExamples = {
  basicAttacks: example1_BasicAttacks,
  blockingDecisions: example2_BlockingDecisions,
  strategyComparison: example3_StrategyComparison,
  evasionCreatures: example4_EvasionCreatures,
  combatTrades: example5_CombatTrades,
  multiBlocking: example6_MultiBlocking,
  difficultyComparison: example7_DifficultyComparison,
  customConfiguration: example8_CustomConfiguration,
};
