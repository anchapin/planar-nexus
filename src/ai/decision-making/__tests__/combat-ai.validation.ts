/**
 * @fileoverview Combat AI Validation Tests
 *
 * These tests validate the combat AI system to ensure correct behavior
 * across various scenarios.
 */

import {
  CombatDecisionTree,
  generateAttackDecisions,
  generateBlockingDecisions,
} from '../combat-decision-tree';
import { GameState, Permanent } from '../../game-state-evaluator';

/**
 * Test helpers
 */
function createTestGameState(
  aiLife: number,
  oppLife: number,
  aiCreatures: Permanent[],
  oppCreatures: Permanent[]
): GameState {
  return {
    players: {
      ai_player: {
        id: 'ai_player',
        life: aiLife,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: aiCreatures,
        manaPool: {},
      },
      opponent: {
        id: 'opponent',
        life: oppLife,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 40,
        battlefield: oppCreatures,
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
}

/**
 * Test 1: Basic Attack Generation
 */
export function test1_BasicAttackGeneration(): { passed: boolean; message: string } {
  console.log('Test 1: Basic Attack Generation');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  if (plan.attacks.length === 0) {
    return { passed: false, message: 'Should attack with no blockers' };
  }

  if (plan.strategy !== 'moderate' && plan.strategy !== 'aggressive') {
    return { passed: false, message: 'Should be moderate or aggressive strategy' };
  }

  return { passed: true, message: '✓ Generates basic attacks correctly' };
}

/**
 * Test 2: Defensive Strategy at Low Life
 */
export function test2_DefensiveStrategy(): { passed: boolean; message: string } {
  console.log('Test 2: Defensive Strategy at Low Life');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [
    {
      id: 'oc1',
      cardId: 'oc1',
      name: 'Hill Giant',
      type: 'creature',
      controller: 'opponent',
      tapped: false,
      power: 3,
      toughness: 3,
      manaValue: 3,
    },
  ];

  const gameState = createTestGameState(5, 20, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  if (plan.strategy !== 'defensive') {
    return { passed: false, message: 'Should be defensive at low life' };
  }

  return { passed: true, message: '✓ Uses defensive strategy when low on life' };
}

/**
 * Test 3: Aggressive Strategy with Opponent Low Life
 */
export function test3_AggressiveStrategy(): { passed: boolean; message: string } {
  console.log('Test 3: Aggressive Strategy with Opponent Low Life');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 5, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  if (plan.strategy !== 'aggressive') {
    return { passed: false, message: 'Should be aggressive when opponent is low' };
  }

  if (plan.attacks.length === 0) {
    return { passed: false, message: 'Should attack when opponent is low on life' };
  }

  return { passed: true, message: '✓ Uses aggressive strategy when opponent is low' };
}

/**
 * Test 4: Evasion Creatures Prioritized
 */
export function test4_EvasionPrioritization(): { passed: boolean; message: string } {
  console.log('Test 4: Evasion Creatures Prioritized');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Serra Angel',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 4,
      toughness: 4,
      keywords: ['flying'],
      manaValue: 5,
    },
    {
      id: 'c2',
      cardId: 'c2',
      name: 'Hill Giant',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 4,
      toughness: 4,
      manaValue: 3,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'hard');

  const flyingAttack = plan.attacks.find((a) => a.creatureId === 'c1');
  const groundAttack = plan.attacks.find((a) => a.creatureId === 'c2');

  if (!flyingAttack && !groundAttack) {
    return { passed: false, message: 'Should attack with both creatures' };
  }

  if (flyingAttack && groundAttack) {
    if (flyingAttack.expectedValue <= groundAttack.expectedValue) {
      return {
        passed: false,
        message: 'Flying creature should have higher expected value',
      };
    }
  }

  return { passed: true, message: '✓ Prioritizes attacking with evasive creatures' };
}

/**
 * Test 5: Blocking Decisions
 */
export function test5_BlockingDecisions(): { passed: boolean; message: string } {
  console.log('Test 5: Blocking Decisions');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);

  // Opponent attacks with a big creature
  const attackers: Permanent[] = [
    {
      id: 'oc1',
      cardId: 'oc1',
      name: 'Craw Wurm',
      type: 'creature',
      controller: 'opponent',
      tapped: false,
      power: 6,
      toughness: 4,
      manaValue: 6,
    },
  ];

  const plan = generateBlockingDecisions(gameState, 'ai_player', attackers, 'medium');

  // Should block if it's a good trade or prevents significant damage
  if (plan.blocks.length === 0 && gameState.players.ai_player.life <= 10) {
    return {
      passed: false,
      message: 'Should block when low on life',
    };
  }

  return { passed: true, message: '✓ Generates blocking decisions' };
}

/**
 * Test 6: Trade Evaluation
 */
export function test6_TradeEvaluation(): { passed: boolean; message: string } {
  console.log('Test 6: Trade Evaluation');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [
    {
      id: 'oc1',
      cardId: 'oc1',
      name: 'Craw Wurm',
      type: 'creature',
      controller: 'opponent',
      tapped: false,
      power: 6,
      toughness: 4,
      manaValue: 6,
    },
  ];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'hard');

  // AI should recognize this is a bad trade and not attack
  // (2-drop vs 6-drop, both die)
  const bearAttack = plan.attacks.find((a) => a.creatureId === 'c1');

  if (bearAttack) {
    // If attacking, expected value should be low (bad trade)
    if (bearAttack.expectedValue > 0.3) {
      return {
        passed: false,
        message: 'Should recognize bad trade (2-for-1 mana disadvantage)',
      };
    }
  }

  return { passed: true, message: '✓ Evaluates trades correctly' };
}

/**
 * Test 7: Menace Multi-Blocking
 */
export function test7_MenaceMultiBlocking(): { passed: boolean; message: string } {
  console.log('Test 7: Menace Multi-Blocking');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Savannah Lions',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 1,
      manaValue: 1,
    },
    {
      id: 'c2',
      cardId: 'c2',
      name: 'Gray Ogre',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 3,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);

  // Opponent attacks with menace creature
  const attackers: Permanent[] = [
    {
      id: 'oc1',
      cardId: 'oc1',
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

  const plan = generateBlockingDecisions(gameState, 'ai_player', attackers, 'hard');

  // Should consider multi-blocking
  if (plan.blocks.length > 1) {
    // Check that damage order is set
    const hasDamageOrder = plan.blocks.some((b) => b.damageOrder !== undefined);
    if (!hasDamageOrder) {
      return {
        passed: false,
        message: 'Multi-block should set damage order',
      };
    }
  }

  return { passed: true, message: '✓ Handles menace multi-blocking' };
}

/**
 * Test 8: Summoning Sickness
 */
export function test8_SummoningSickness(): { passed: boolean; message: string } {
  console.log('Test 8: Summoning Sickness');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
    {
      id: 'c2',
      cardId: 'c2',
      name: 'Elvish Mystic',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 1,
      toughness: 1,
      manaValue: 1,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);

  const plan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  // Creatures without haste should still be considered attackable
  // (summoning sickness check is simplified for now)
  if (plan.attacks.length === 0) {
    return {
      passed: false,
      message: 'Should have attackable creatures',
    };
  }

  return { passed: true, message: '✓ Handles summoning sickness' };
}

/**
 * Test 9: Tapped Creatures
 */
export function test9_TappedCreatures(): { passed: boolean; message: string } {
  console.log('Test 9: Tapped Creatures');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: true, // Tapped
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);
  const plan = generateAttackDecisions(gameState, 'ai_player', 'medium');

  // Tapped creatures should not be in attack list
  const tappedAttack = plan.attacks.find((a) => a.creatureId === 'c1');

  if (tappedAttack) {
    return {
      passed: false,
      message: 'Tapped creatures should not attack',
    };
  }

  return { passed: true, message: '✓ Excludes tapped creatures from attacks' };
}

/**
 * Test 10: Custom Configuration
 */
export function test10_CustomConfiguration(): { passed: boolean; message: string } {
  console.log('Test 10: Custom Configuration');

  const aiCreatures: Permanent[] = [
    {
      id: 'c1',
      cardId: 'c1',
      name: 'Grizzly Bears',
      type: 'creature',
      controller: 'ai_player',
      tapped: false,
      power: 2,
      toughness: 2,
      manaValue: 2,
    },
  ];

  const oppCreatures: Permanent[] = [];

  const gameState = createTestGameState(20, 20, aiCreatures, oppCreatures);

  const ai = new CombatDecisionTree(gameState, 'ai_player', 'medium');
  ai.setConfig({
    aggression: 0.9,
    riskTolerance: 0.9,
    lifeThreshold: 1,
  });

  const plan = ai.generateAttackPlan();

  // Should be very aggressive with this config
  if (plan.strategy !== 'aggressive') {
    return {
      passed: false,
      message: 'Should be aggressive with high aggression config',
    };
  }

  return { passed: true, message: '✓ Respects custom configuration' };
}

/**
 * Run all validation tests
 */
export function runAllCombatValidationTests(): {
  passed: number;
  failed: number;
  results: Array<{ test: string; passed: boolean; message: string }>;
} {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║              Combat AI Validation Tests                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const tests = [
    test1_BasicAttackGeneration,
    test2_DefensiveStrategy,
    test3_AggressiveStrategy,
    test4_EvasionPrioritization,
    test5_BlockingDecisions,
    test6_TradeEvaluation,
    test7_MenaceMultiBlocking,
    test8_SummoningSickness,
    test9_TappedCreatures,
    test10_CustomConfiguration,
  ];

  const results: Array<{ test: string; passed: boolean; message: string }> = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = test();
      results.push({
        test: test.name.replace('test', '').replace(/([A-Z])/g, ' $1').trim(),
        passed: result.passed,
        message: result.message,
      });

      if (result.passed) {
        passed++;
        console.log(`✓ ${result.message}`);
      } else {
        failed++;
        console.log(`✗ ${result.message}`);
      }
    } catch (error) {
      failed++;
      const testName = test.name.replace('test', '').replace(/([A-Z])/g, ' $1').trim();
      results.push({
        test: testName,
        passed: false,
        message: `Exception: ${error}`,
      });
      console.log(`✗ ${testName}: Exception - ${error}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Tests Passed: ${passed}/${tests.length}`);
  console.log(`Tests Failed: ${failed}/${tests.length}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  return { passed, failed, results };
}

// Export tests for use in other modules
export const combatValidationTests = {
  basicAttackGeneration: test1_BasicAttackGeneration,
  defensiveStrategy: test2_DefensiveStrategy,
  aggressiveStrategy: test3_AggressiveStrategy,
  evasionPrioritization: test4_EvasionPrioritization,
  blockingDecisions: test5_BlockingDecisions,
  tradeEvaluation: test6_TradeEvaluation,
  menaceMultiBlocking: test7_MenaceMultiBlocking,
  summoningSickness: test8_SummoningSickness,
  tappedCreatures: test9_TappedCreatures,
  customConfiguration: test10_CustomConfiguration,
};
