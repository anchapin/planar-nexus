/**
 * Tests for Game State Serialization
 * Tests serialization for test fixture generation (GH#684)
 */

import {
  calculateComplexityScore,
  serializeGameState,
  deserializeGameState,
  generateFixtureDescription,
} from '../game-state-serialization';
import type { GameState } from '../types';

describe('Game State Serialization', () => {
  describe('Complexity Score Calculation', () => {
    test('should calculate low complexity for simple state', () => {
      const state = createMinimalGameState();

      const score = calculateComplexityScore(state);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(0.4);
    });

    test('should increase complexity with stack size', () => {
      const state = createMinimalGameState();
      state.stack = [
        createStackObject('stack-1'),
        createStackObject('stack-2'),
        createStackObject('stack-3'),
      ];

      const score = calculateComplexityScore(state);

      expect(score).toBeGreaterThan(0.5);
    });

    test('should increase complexity with combat', () => {
      const state = createMinimalGameState();
      state.combat.inCombatPhase = true;
      state.combat.attackers = [
        createAttacker('card-1'),
        createAttacker('card-2'),
        createAttacker('card-3'),
      ];

      const score = calculateComplexityScore(state);

      expect(score).toBeGreaterThan(0.4);
    });

    test('should increase complexity with card counters', () => {
      const state = createMinimalGameState();
      const card = Array.from(state.cards.values())[0];
      if (card) {
        card.counters = [
          { type: '+1/+1', count: 2 },
          { type: 'charge', count: 1 },
        ];
      }

      const score = calculateComplexityScore(state);

      expect(score).toBeGreaterThan(0.05);
    });

    test('should increase complexity with waiting choice', () => {
      const state = createMinimalGameState();
      state.waitingChoice = {
        type: 'choose_targets',
        playerId: 'player-1',
        stackObjectId: null,
        prompt: 'Choose targets',
        choices: [],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      };

      const score = calculateComplexityScore(state);

      expect(score).toBeGreaterThan(0.2);
    });

    test('should cap complexity score at 1.0', () => {
      const state = createMinimalGameState();

      // Add maximum complexity factors
      state.stack = Array.from({ length: 10 }, (_, i) => createStackObject(`stack-${i}`));
      state.combat.inCombatPhase = true;
      state.combat.attackers = Array.from({ length: 10 }, (_, i) => createAttacker(`card-${i}`));
      state.waitingChoice = {
        type: 'choose_targets',
        playerId: 'player-1',
        stackObjectId: null,
        prompt: 'Choose targets',
        choices: [],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      };

      const score = calculateComplexityScore(state);

      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Fixture Description Generation', () => {
    test('should describe simple game state', () => {
      const state = createMinimalGameState();

      const description = generateFixtureDescription(state);

      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
    });

    test('should include stack information', () => {
      const state = createMinimalGameState();
      state.stack = [
        createStackObject('stack-1'),
        createStackObject('stack-2'),
      ];

      const description = generateFixtureDescription(state);

      expect(description).toContain('stack');
      expect(description).toContain('2');
    });

    test('should include combat information', () => {
      const state = createMinimalGameState();
      state.combat.inCombatPhase = true;
      state.combat.attackers = [createAttacker('card-1')];

      const description = generateFixtureDescription(state);

      expect(description).toContain('attacker');
    });

    test('should include permanent count', () => {
      const state = createMinimalGameState();
      // Add cards to battlefield zone
      const battlefieldZone = state.zones.get('battlefield');
      if (battlefieldZone) {
        battlefieldZone.cardIds = Array.from({ length: 5 }, (_, i) => `card-${i}`);
      }

      const description = generateFixtureDescription(state);

      expect(description).toContain('permanent');
    });
  });

  describe('Serialization', () => {
    test('should serialize minimal game state', () => {
      const state = createMinimalGameState();

      const serialized = serializeGameState(state);

      expect(serialized).toBeDefined();
      expect(serialized.metadata.gameId).toBe(state.gameId);
      expect(serialized.metadata.format).toBe(state.format);
      expect(serialized.players).toHaveLength(2);
      expect(serialized.stack).toHaveLength(0);
    });

    test('should serialize game state with stack', () => {
      const state = createMinimalGameState();
      state.stack = [createStackObject('stack-1')];

      const serialized = serializeGameState(state);

      expect(serialized.stack).toHaveLength(1);
      expect(serialized.stack[0].name).toBe('Test Spell');
    });

    test('should serialize game state with combat', () => {
      const state = createMinimalGameState();
      state.combat.inCombatPhase = true;
      state.combat.attackers = [createAttacker('card-1')];

      const serialized = serializeGameState(state);

      expect(serialized.combat).toBeDefined();
      expect(serialized.combat?.inCombatPhase).toBe(true);
      expect(serialized.combat?.attackers).toHaveLength(1);
    });

    test('should serialize game state with waiting choice', () => {
      const state = createMinimalGameState();
      state.waitingChoice = {
        type: 'choose_targets',
        playerId: 'player-1',
        stackObjectId: null,
        prompt: 'Choose targets',
        choices: [],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      };

      const serialized = serializeGameState(state);

      expect(serialized.waitingChoice).toBeDefined();
      expect(serialized.waitingChoice?.type).toBe('choose_targets');
    });

    test('should include metadata with complexity score', () => {
      const state = createMinimalGameState();

      const serialized = serializeGameState(state);

      expect(serialized.metadata.complexityScore).toBeDefined();
      expect(typeof serialized.metadata.complexityScore).toBe('number');
      expect(serialized.metadata.complexityScore).toBeGreaterThanOrEqual(0);
      expect(serialized.metadata.complexityScore).toBeLessThanOrEqual(1.0);
    });

    test('should skip states below complexity threshold', () => {
      const state = createMinimalGameState();

      expect(() => {
        serializeGameState(state, { complexityThreshold: 2.0 });
      }).toThrow();
    });

    test('should include custom metadata when provided', () => {
      const state = createMinimalGameState();

      const serialized = serializeGameState(state, {
        source: 'Pro Tour Coverage',
        description: 'Test fixture description',
      });

      expect(serialized.metadata.source).toBe('Pro Tour Coverage');
      expect(serialized.metadata.description).toBe('Test fixture description');
    });
  });

  describe('Deserialization', () => {
    test('should deserialize basic game state', () => {
      const state = createMinimalGameState();
      const serialized = serializeGameState(state);

      const deserialized = deserializeGameState(serialized);

      expect(deserialized).toBeDefined();
      expect(deserialized.gameId).toBe(state.gameId);
      expect(deserialized.format).toBe(state.format);
    });

    test('should handle missing fields gracefully', () => {
      const minimalSerialized = {
        metadata: {
          gameId: 'test-game',
          format: 'standard',
          createdAt: new Date().toISOString(),
          complexityScore: 0.5,
          description: 'Test',
        },
        players: [],
        battlefield: [],
        hands: [],
        graveyards: [],
        stack: [],
        turn: {
          activePlayerId: 'player-1',
          currentPhase: 'beginning',
          turnNumber: 1,
          extraTurns: 0,
          isFirstTurn: true,
        },
        status: 'not_started',
      };

      const deserialized = deserializeGameState(minimalSerialized);

      expect(deserialized).toBeDefined();
      expect(deserialized.gameId).toBe('test-game');
    });
  });
});

/**
 * Helper function to create minimal game state for testing
 */
function createMinimalGameState(): GameState {
  return {
    gameId: 'test-game',
    players: new Map([
      [
        'player-1',
        {
          id: 'player-1',
          name: 'Player 1',
          life: 20,
          poisonCounters: 0,
          commanderDamage: new Map(),
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 0,
          maxLandsPerTurn: 1,
          manaPool: { colorless: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0 },
          isInCommandZone: false,
          experienceCounters: 0,
          commanderCastCount: 0,
          hasPassedPriority: false,
          hasActivatedManaAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        },
      ],
      [
        'player-2',
        {
          id: 'player-2',
          name: 'Player 2',
          life: 20,
          poisonCounters: 0,
          commanderDamage: new Map(),
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 0,
          maxLandsPerTurn: 1,
          manaPool: { colorless: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0 },
          isInCommandZone: false,
          experienceCounters: 0,
          commanderCastCount: 0,
          hasPassedPriority: false,
          hasActivatedManaAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        },
      ],
    ]),
    cards: new Map([
      [
        'card-1',
        {
          id: 'card-1',
          oracleId: 'oracle-1',
          cardData: {
            id: 'oracle-1',
            name: 'Test Creature',
            type_line: 'Creature',
            cmc: 2,
            colors: ['R'],
            oracle_text: '',
            keywords: [],
          },
          currentFaceIndex: 0,
          isFaceDown: false,
          controllerId: 'player-1',
          ownerId: 'player-1',
          isTapped: false,
          isFlipped: false,
          isTurnedFaceUp: false,
          isPhasedOut: false,
          hasSummoningSickness: false,
          counters: [],
          damage: 0,
          toughnessModifier: 0,
          powerModifier: 0,
          attachedToId: null,
          attachedCardIds: [],
          enteredBattlefieldTimestamp: 1000,
          attachedTimestamp: null,
          chosenBasicLandType: null,
          isToken: false,
          tokenData: null,
        },
      ],
    ]),
    zones: new Map([
      [
        'battlefield',
        {
          type: 'battlefield',
          playerId: null,
          cardIds: ['card-1'],
          isRevealed: true,
          visibleTo: [],
        },
      ],
    ]),
    stack: [],
    turn: {
      activePlayerId: 'player-1',
      currentPhase: 'precombat_main',
      turnNumber: 1,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: Date.now(),
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: 'player-1',
    consecutivePasses: 0,
    status: 'in_progress',
    winners: [],
    endReason: null,
    format: 'standard',
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  };
}

/**
 * Helper function to create stack object
 */
function createStackObject(id: string) {
  return {
    id: `stack-${id}`,
    type: 'spell' as const,
    sourceCardId: id,
    controllerId: 'player-1',
    name: 'Test Spell',
    text: 'Test effect',
    manaCost: '{2}',
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  };
}

/**
 * Helper function to create attacker
 */
function createAttacker(cardId: string) {
  return {
    cardId,
    defenderId: 'player-2',
    isAttackingPlaneswalker: false,
    damageToDeal: 2,
    hasFirstStrike: false,
    hasDoubleStrike: false,
  };
}
