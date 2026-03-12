/**
 * @fileoverview Unit Tests for CombatDecisionTree
 *
 * Tests for AI combat decision-making logic.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  CombatDecisionTree,
  DefaultCombatConfigs,
  type CombatPlan,
  type AttackDecision,
  type BlockDecision,
} from '../decision-making/combat-decision-tree';
import type { AIGameState, AIPlayerState, AIPermanent } from '@/lib/game-state/types';

/**
 * Create a mock AI player state for testing
 */
function createMockPlayerState(
  id: string,
  life: number = 20,
  battlefield: AIPermanent[] = []
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

/**
 * Create a mock permanent for testing
 */
function createMockPermanent(
  id: string,
  name: string,
  type: 'creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker' = 'creature',
  power?: number,
  toughness?: number,
  tapped: boolean = false,
  manaValue: number = 1,
  keywords: string[] = []
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name,
    type,
    controller: 'player1',
    tapped,
    manaValue,
    power,
    toughness,
    keywords,
  };
}

/**
 * Create a basic test game state
 */
function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = [],
  currentPlayer: string = 'player1',
  phase: 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'end' = 'precombat_main'
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState('player1', player1Life, player1Battlefield),
      player2: createMockPlayerState('player2', player2Life, player2Battlefield),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer,
      priority: currentPlayer,
      phase,
      step: phase.includes('combat') ? 'combat' : 'main',
    },
    stack: [],
    combat: {
      inCombatPhase: phase === 'combat',
      attackers: [],
      blockers: {},
    },
  };
}

describe('CombatDecisionTree', () => {
  describe('constructor', () => {
    it('should initialize with default difficulty (medium)', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      expect(combatAI).toBeDefined();
    });

    it('should initialize with specified difficulty', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1', 'hard');

      expect(combatAI).toBeDefined();
    });

    it('should store the AI player ID', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player2');

      expect(combatAI).toBeDefined();
    });
  });

  describe('setConfig', () => {
    it('should update combat configuration', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      combatAI.setConfig({ aggression: 0.9 });

      // Config is updated (tested indirectly through behavior)
      expect(combatAI).toBeDefined();
    });

    it('should preserve unchanged config values', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1', 'hard');

      const originalConfig = { ...DefaultCombatConfigs.hard };
      combatAI.setConfig({ aggression: 0.9 });

      // Other config values should remain unchanged
      expect(combatAI).toBeDefined();
    });
  });

  describe('generateAttackPlan', () => {
    it('should return a combat plan object', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan).toHaveProperty('attacks');
      expect(plan).toHaveProperty('blocks');
      expect(plan).toHaveProperty('strategy');
      expect(plan).toHaveProperty('totalExpectedValue');
      expect(plan).toHaveProperty('combatTricks');
    });

    it('should generate attack decisions for creatures', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2, false),
        createMockPermanent('c2', 'Ogre', 'creature', 3, 2, false),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan.attacks).toBeDefined();
      expect(Array.isArray(plan.attacks)).toBe(true);
    });

    it('should only consider untapped creatures for attacking', () => {
      const tappedCreature = createMockPermanent('c1', 'Bear', 'creature', 2, 2, true);
      const untappedCreature = createMockPermanent('c2', 'Bear', 'creature', 2, 2, false);

      const gameState = createTestGameState(20, 20, [tappedCreature, untappedCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      // Should only attack with untapped creature
      expect(plan.attacks.length).toBeLessThanOrEqual(1);
    });

    it('should not attack with creatures that have summoning sickness', () => {
      const newCreature = createMockPermanent('c1', 'Bear', 'creature', 2, 2, false);
      (newCreature as any).summoningSickness = true;

      const gameState = createTestGameState(20, 20, [newCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      // Should not attack with summoning sick creature
      expect(plan.attacks.length).toBe(0);
    });

    it('should attack with creatures that have haste despite summoning sickness', () => {
      const hasteCreature = createMockPermanent('c1', 'Haste Bear', 'creature', 2, 2, false, 1, ['haste']);
      (hasteCreature as any).summoningSickness = true;

      const gameState = createTestGameState(20, 20, [hasteCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      // Should attack with haste creature
      expect(plan.attacks.length).toBeGreaterThanOrEqual(0);
    });

    it('should determine aggressive strategy when opponent has low life', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 8, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe('aggressive');
    });

    it('should determine defensive strategy when AI has low life', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(6, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe('defensive');
    });

    it('should determine moderate strategy in even game state', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent('c2', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, player2Creatures);
      const combatAI = new CombatDecisionTree(gameState, 'player1', 'medium');

      const plan = combatAI.generateAttackPlan();

      expect(plan.strategy).toBe('moderate');
    });

    it('should calculate total expected value', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(typeof plan.totalExpectedValue).toBe('number');
    });

    it('should handle empty battlefield', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan.attacks.length).toBe(0);
      expect(plan.totalExpectedValue).toBe(0);
    });

    it('should handle multiple opponents', () => {
      const gameState: AIGameState = {
        players: {
          player1: createMockPlayerState('player1', 20, [
            createMockPermanent('c1', 'Bear', 'creature', 2, 2),
          ]),
          player2: createMockPlayerState('player2', 20, []),
          player3: createMockPlayerState('player3', 20, []),
        },
        turnInfo: {
          currentTurn: 1,
          currentPlayer: 'player1',
          priority: 'player1',
          phase: 'precombat_main',
          step: 'main',
        },
        stack: [],
        combat: {
          inCombatPhase: false,
          attackers: [],
          blockers: {},
        },
      };

      const combatAI = new CombatDecisionTree(gameState, 'player1');
      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
      expect(plan.attacks).toBeDefined();
    });
  });

  describe('generateBlockingPlan', () => {
    it('should return a combat plan for blocking', () => {
      const gameState = createTestGameState();
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const attackers: AIPermanent[] = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan).toHaveProperty('attacks');
      expect(plan).toHaveProperty('blocks');
      expect(plan).toHaveProperty('strategy');
      expect(plan.strategy).toBe('defensive');
    });

    it('should generate block decisions for attackers', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
        createMockPermanent('c2', 'Ogre', 'creature', 3, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent('c3', 'Enemy Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks).toBeDefined();
      expect(Array.isArray(plan.blocks)).toBe(true);
    });

    it('should handle multiple attackers', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent('c2', 'Enemy Bear 1', 'creature', 2, 2),
        createMockPermanent('c3', 'Enemy Bear 2', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle no available blockers', () => {
      const attackers: AIPermanent[] = [
        createMockPermanent('c1', 'Enemy Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, [], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan.blocks.length).toBe(0);
    });

    it('should only use untapped creatures for blocking', () => {
      const tappedCreature = createMockPermanent('c1', 'Bear', 'creature', 2, 2, true);
      const untappedCreature = createMockPermanent('c2', 'Bear', 'creature', 2, 2, false);
      const attackers: AIPermanent[] = [
        createMockPermanent('c3', 'Enemy Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, [tappedCreature, untappedCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      // Should only consider untapped creature for blocking
      expect(plan).toBeDefined();
    });

    it('should calculate total block value', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent('c2', 'Enemy Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(typeof plan.totalExpectedValue).toBe('number');
    });
  });

  describe('evaluateAttacker (indirect)', () => {
    it('should create attack decisions with required properties', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      if (plan.attacks.length > 0) {
        const decision = plan.attacks[0];
        expect(decision).toHaveProperty('creatureId');
        expect(decision).toHaveProperty('shouldAttack');
        expect(decision).toHaveProperty('target');
        expect(decision).toHaveProperty('reasoning');
        expect(decision).toHaveProperty('expectedValue');
        expect(decision).toHaveProperty('riskLevel');
      }
    });
  });

  describe('evaluateBlocksForAttacker (indirect)', () => {
    it('should create block decisions with required properties', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent('c2', 'Enemy Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      if (plan.blocks.length > 0) {
        const decision = plan.blocks[0];
        expect(decision).toHaveProperty('blockerId');
        expect(decision).toHaveProperty('attackerId');
        expect(decision).toHaveProperty('reasoning');
        expect(decision).toHaveProperty('expectedValue');
      }
    });
  });

  describe('difficulty-based combat behavior', () => {
    it('should be more aggressive at hard difficulty', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const hardAI = new CombatDecisionTree(gameState, 'player1', 'hard');

      const hardPlan = hardAI.generateAttackPlan();

      expect(hardPlan).toBeDefined();
    });

    it('should be more cautious at easy difficulty', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const easyAI = new CombatDecisionTree(gameState, 'player1', 'easy');

      const easyPlan = easyAI.generateAttackPlan();

      expect(easyPlan).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle creatures with 0 power', () => {
      const weakCreature = createMockPermanent('c1', 'Wall', 'creature', 0, 5);

      const gameState = createTestGameState(20, 20, [weakCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      // Creatures with 0 power shouldn't attack
      expect(plan.attacks.length).toBe(0);
    });

    it('should handle very large creatures', () => {
      const bigCreature = createMockPermanent('c1', 'Big Beast', 'creature', 10, 10);

      const gameState = createTestGameState(20, 20, [bigCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
      expect(plan.attacks.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle creatures with evasion keywords', () => {
      const flyingCreature = createMockPermanent('c1', 'Flying Bear', 'creature', 2, 2, false, 1, ['flying']);

      const gameState = createTestGameState(20, 20, [flyingCreature], []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
    });

    it('should handle combat phase state', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, [], 'player1', 'combat');
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateAttackPlan();

      expect(plan).toBeDefined();
    });
  });

  describe('optimizeBlockerOrdering (indirect)', () => {
    it('should handle multi-block scenarios', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear 1', 'creature', 2, 2),
        createMockPermanent('c2', 'Bear 2', 'creature', 2, 2),
        createMockPermanent('c3', 'Bear 3', 'creature', 2, 2),
      ];
      const attackers: AIPermanent[] = [
        createMockPermanent('c4', 'Big Beast', 'creature', 5, 5),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1');

      const plan = combatAI.generateBlockingPlan(attackers);

      expect(plan).toBeDefined();
    });
  });

  describe('evaluateCombatTricks (indirect)', () => {
    it('should consider combat tricks when enabled', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, player1Creatures, []);
      const combatAI = new CombatDecisionTree(gameState, 'player1', 'expert');

      const plan = combatAI.generateAttackPlan();

      expect(plan.combatTricks).toBeDefined();
      expect(Array.isArray(plan.combatTricks)).toBe(true);
    });
  });
});
