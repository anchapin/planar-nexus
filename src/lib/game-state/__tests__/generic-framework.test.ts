/**
 * Generic Card Game Framework Core Tests
 *
 * ISSUE #435: Unit 1 - Generic Card Game Framework Core
 *
 * Tests for the generic abstraction layer that supports different game systems.
 * Verifies that the framework can handle:
 * - Multiple game systems with different rules
 * - Resource system abstractions
 * - Win condition checks
 * - Terminology translations
 */

import {
  createEmptyManaPool,
} from '../mana';
import type { GameState } from '../types';
import {
  adaptManaPoolToResourcePool,
  adaptResourcePoolToManaPool,
  canPayResourceCost,
  getCardResourceCost,
  canPlayResourceSource,
  checkWinConditions,
  checkLossConditions,
  registerGameSystem,
  getGameSystem,
  LEGENDARY_COMMANDER_SYSTEM,
  DEFAULT_GAME_SYSTEM,
} from '../game-system-adapter';
import { translateToGeneric, translateResourceType, translateCardType } from '../terminology-translation';

describe('Generic Framework - Resource System Abstraction', () => {
  describe('ManaPool to ResourcePool adaptation', () => {
    test('should adapt mana pool to generic resource pool', () => {
      const manaPool = {
        colorless: 2,
        white: 3,
        blue: 1,
        black: 0,
        red: 2,
        green: 1,
        generic: 0,
      };

      const resourcePool = adaptManaPoolToResourcePool(manaPool);

      expect(resourcePool.type).toBe('mana');
      expect(resourcePool.total).toBe(9); // 2+3+1+0+2+1
      expect(resourcePool.resources.get('white')).toBe(3);
      expect(resourcePool.resources.get('red')).toBe(2);
    });

    test('should adapt resource pool back to mana pool', () => {
      const resourcePool = {
        type: 'mana',
        total: 10,
        resources: new Map([
          ['white', 3],
          ['blue', 2],
          ['red', 5],
        ]),
        maximum: Infinity,
      };

      const manaPool = adaptResourcePoolToManaPool(resourcePool);

      expect(manaPool.white).toBe(3);
      expect(manaPool.blue).toBe(2);
      expect(manaPool.red).toBe(5);
      expect(manaPool.colorless).toBe(0);
    });

    test('should handle empty resource pools', () => {
      const emptyManaPool = createEmptyManaPool();
      const resourcePool = adaptManaPoolToResourcePool(emptyManaPool);

      expect(resourcePool.total).toBe(0);
      expect(resourcePool.resources.size).toBe(7); // All colors + generic + colorless
    });
  });

  describe('Resource cost checking', () => {
    test('should determine if resource cost can be paid', () => {
      const available = {
        type: 'mana',
        total: 5,
        resources: new Map([
          ['white', 2],
          ['blue', 2],
          ['red', 1],
        ]),
        maximum: Infinity,
      };

      const affordableCost = {
        resourceType: 'mana',
        amount: 3,
        requirements: new Map([
          ['white', 1],
          ['blue', 1],
        ]),
      };

      const expensiveCost = {
        resourceType: 'mana',
        amount: 6,
        requirements: new Map([
          ['white', 3],
          ['blue', 3],
        ]),
      };

      expect(canPayResourceCost(available, affordableCost)).toBe(true);
      expect(canPayResourceCost(available, expensiveCost)).toBe(false);
    });

    test('should reject resource type mismatches', () => {
      const manaResource = {
        type: 'mana',
        total: 5,
        resources: new Map([['white', 5]]),
        maximum: Infinity,
      };

      const energyCost = {
        resourceType: 'energy',
        amount: 3,
        requirements: new Map(),
      };

      expect(canPayResourceCost(manaResource, energyCost)).toBe(false);
    });
  });

  describe('Card resource cost calculation', () => {
    test('should parse mana cost string correctly', () => {
      const card = { mana_cost: '{2}{W}{U}' };
      const cost = getCardResourceCost(card, DEFAULT_GAME_SYSTEM);

      expect(cost.resourceType).toBe('mana');
      expect(cost.amount).toBe(4);
      expect(cost.requirements.get('white')).toBe(1);
      expect(cost.requirements.get('blue')).toBe(1);
    });

    test('should handle complex mana costs', () => {
      const card = { mana_cost: '{X}{W}{W}{U}{B}' };
      const cost = getCardResourceCost(card, DEFAULT_GAME_SYSTEM);

      expect(cost.amount).toBe(4); // X doesn't count
      expect(cost.requirements.get('white')).toBe(2);
      expect(cost.requirements.get('blue')).toBe(1);
      expect(cost.requirements.get('black')).toBe(1);
    });

    test('should handle empty or missing costs', () => {
      const card = { mana_cost: '' };
      const cost = getCardResourceCost(card, DEFAULT_GAME_SYSTEM);

      expect(cost.amount).toBe(0);
      expect(cost.requirements.size).toBe(0);
    });
  });
});

describe('Generic Framework - Game System Registry', () => {
  test('should register and retrieve game systems', () => {
    const customSystem = {
      id: 'custom-system',
      name: 'Custom Game',
      description: 'A custom game system',
      resourceType: 'energy',
      maxResourcesPerTurn: 2,
      emptyResourcesAtEndOfTurn: false,
      startingLife: 30,
      leaderDamageThreshold: null,
      poisonThreshold: 5,
      loseOnEmptyDeck: true,
      minDeckSize: 40,
      maxDeckSize: 60,
      maxCopiesPerCard: 3,
      usesLeader: false,
      leaderZoneName: 'reserve',
      cardTypeMappings: {},
      resourceCardTypes: [],
    };

    registerGameSystem(customSystem);
    const retrieved = getGameSystem('custom-system');

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Custom Game');
    expect(retrieved?.resourceType).toBe('energy');
  });

  test('should provide default game systems', () => {
    const defaultSystem = getGameSystem('mtg-like');
    const commanderSystem = getGameSystem('legendary-commander');

    expect(defaultSystem).toBeDefined();
    expect(defaultSystem?.resourceType).toBe('mana');
    expect(defaultSystem?.startingLife).toBe(20);

    expect(commanderSystem).toBeDefined();
    expect(commanderSystem?.startingLife).toBe(40);
    expect(commanderSystem?.usesLeader).toBe(true);
  });
});

describe('Generic Framework - Terminology Translations', () => {
  describe('Issue #435 specific translations', () => {
    test('should translate "Commander" to "Legendary Leader"', () => {
      const input = 'Your commander deals damage';
      const output = translateToGeneric(input);

      expect(output).toContain('legendary leader');
      expect(output).not.toContain('commander');
    });

    test('should translate "mana" to "resource"', () => {
      const input = 'Add two mana to your mana pool';
      const output = translateToGeneric(input);

      expect(output).toContain('resource');
      expect(output).not.toContain('mana');
    });

    test('should translate "land" to "source"', () => {
      const input = 'Play a land from your hand';
      const output = translateToGeneric(input);

      expect(output).toContain('source');
      expect(output).not.toContain('land');
    });

    test('should translate multiple occurrences', () => {
      const input = 'Pay 3 mana to play a land. Lands provide mana.';
      const output = translateToGeneric(input);

      expect(output).toMatch(/resource/g);
      expect(output).toMatch(/source/g);
      expect(output).not.toContain('mana');
      expect(output).not.toMatch(/land/g);
    });
  });

  describe('Resource type translations', () => {
    test('should translate resource types correctly', () => {
      expect(translateResourceType('mana')).toBe('resource');
      expect(translateResourceType('colorless mana')).toBe('generic resource');
      expect(translateResourceType('white mana')).toBe('white resource');
      expect(translateResourceType('mana pool')).toBe('resource pool');
    });
  });

  describe('Card type translations', () => {
    test('should translate card types correctly', () => {
      expect(translateCardType('land')).toBe('source');
      expect(translateCardType('lands')).toBe('sources');
      expect(translateCardType('planeswalker')).toBe('champion');
      expect(translateCardType('commander')).toBe('legendary leader');
    });
  });
});

describe('Generic Framework - Win/Loss Conditions', () => {
  describe('Loss condition checks', () => {
    test('should detect life total loss', () => {
      const mockState = {
        players: new Map([
          ['player1', { id: 'player1', name: 'Player 1', life: 0, hasLost: false }],
        ]),
        zones: new Map(),
      } as unknown as GameState;

      const result = checkLossConditions(mockState, 'player1', DEFAULT_GAME_SYSTEM);

      expect(result.hasLost).toBe(true);
      expect(result.reason).toContain('Life total');
    });

    test('should detect poison counter loss', () => {
      const mockState = {
        players: new Map([
          ['player1', { id: 'player1', name: 'Player 1', life: 20, poisonCounters: 10, hasLost: false }],
        ]),
        zones: new Map(),
      } as unknown as GameState;

      const result = checkLossConditions(mockState, 'player1', DEFAULT_GAME_SYSTEM);

      expect(result.hasLost).toBe(true);
      expect(result.reason).toContain('Poison');
    });

    test('should detect deck depletion', () => {
      const mockState = {
        players: new Map([
          ['player1', { id: 'player1', name: 'Player 1', life: 20, hasLost: false }],
        ]),
        zones: new Map([
          ['player1-library', { cardIds: [] }],
        ]),
      } as unknown as GameState;

      const result = checkLossConditions(mockState, 'player1', DEFAULT_GAME_SYSTEM);

      expect(result.hasLost).toBe(true);
      expect(result.reason).toContain('Deck');
    });
  });

  describe('Win condition checks', () => {
    test('should detect victory when all opponents defeated', () => {
      const mockState = {
        players: new Map([
          ['player1', { id: 'player1', name: 'Player 1', life: 20, hasLost: false }],
          ['player2', { id: 'player2', name: 'Player 2', life: 0, hasLost: true }],
        ]),
      } as unknown as GameState;

      const result = checkWinConditions(mockState, 'player1', DEFAULT_GAME_SYSTEM);

      expect(result.hasWon).toBe(true);
      expect(result.reason).toContain('defeated');
    });

    test('should not declare victory with active opponents', () => {
      const mockState = {
        players: new Map([
          ['player1', { id: 'player1', name: 'Player 1', life: 20, hasLost: false }],
          ['player2', { id: 'player2', name: 'Player 2', life: 15, hasLost: false }],
        ]),
      } as unknown as GameState;

      const result = checkWinConditions(mockState, 'player1', DEFAULT_GAME_SYSTEM);

      expect(result.hasWon).toBe(false);
    });
  });
});

describe('Generic Framework - Resource Source Playing', () => {
  test('should determine if resource source can be played', () => {
    const mockState = {
      players: new Map([
        ['player1', {
          id: 'player1',
          name: 'Player 1',
          life: 20,
          landsPlayedThisTurn: 0,
        }],
      ]),
      cards: new Map([
        ['card1', {
          id: 'card1',
          cardData: { type_line: 'Land - Forest' },
        }],
      ]),
    } as unknown as GameState;

    const canPlay = canPlayResourceSource(mockState, 'player1', 'card1', DEFAULT_GAME_SYSTEM);

    expect(canPlay).toBe(true);
  });

  test('should enforce maximum resource sources per turn', () => {
    const mockState = {
      players: new Map([
        ['player1', {
          id: 'player1',
          name: 'Player 1',
          life: 20,
          landsPlayedThisTurn: 1, // Already played one
        }],
      ]),
      cards: new Map([
        ['card1', {
          id: 'card1',
          cardData: { type_line: 'Land - Forest' },
        }],
      ]),
    } as unknown as GameState;

    const canPlay = canPlayResourceSource(mockState, 'player1', 'card1', DEFAULT_GAME_SYSTEM);

    expect(canPlay).toBe(false); // Max 1 per turn for default system
  });

  test('should reject non-resource cards', () => {
    const mockState = {
      players: new Map([
        ['player1', {
          id: 'player1',
          name: 'Player 1',
          life: 20,
          landsPlayedThisTurn: 0,
        }],
      ]),
      cards: new Map([
        ['card1', {
          id: 'card1',
          cardData: { type_line: 'Creature - Goblin' },
        }],
      ]),
    } as unknown as GameState;

    const canPlay = canPlayResourceSource(mockState, 'player1', 'card1', DEFAULT_GAME_SYSTEM);

    expect(canPlay).toBe(false);
  });
});

describe('Generic Framework - System Differences', () => {
  test('should differentiate between game systems', () => {
    expect(DEFAULT_GAME_SYSTEM.startingLife).toBe(20);
    expect(LEGENDARY_COMMANDER_SYSTEM.startingLife).toBe(40);

    expect(DEFAULT_GAME_SYSTEM.usesLeader).toBe(false);
    expect(LEGENDARY_COMMANDER_SYSTEM.usesLeader).toBe(true);

    expect(DEFAULT_GAME_SYSTEM.minDeckSize).toBe(60);
    expect(LEGENDARY_COMMANDER_SYSTEM.minDeckSize).toBe(100);
  });

  test('should apply different win conditions per system', () => {
    expect(DEFAULT_GAME_SYSTEM.leaderDamageThreshold).toBe(21);
    expect(LEGENDARY_COMMANDER_SYSTEM.leaderDamageThreshold).toBe(21);

    expect(DEFAULT_GAME_SYSTEM.maxCopiesPerCard).toBe(4);
    expect(LEGENDARY_COMMANDER_SYSTEM.maxCopiesPerCard).toBe(1);
  });
});
