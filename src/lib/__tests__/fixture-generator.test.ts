/**
 * Tests for Fixture Generator
 * Tests the complete fixture generation pipeline (GH#684)
 */

import {
  generateJestTestFile,
  generateTestCase,
  generateTestTags,
  generateSetupCode,
  generateAssertionCode,
  type FixtureConfig,
  type GeneratedTest,
} from '../generate-test-fixture';
import { serializeGameState } from '../game-state-serialization';
import type { GameState } from '../types';

describe('Fixture Generator', () => {
  describe('Test Tag Generation', () => {
    test('should tag simple states as simple', () => {
      const state = createMinimalGameState();
      const serialized = serializeGameState(state);

      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('simple');
      expect(tags).not.toContain('complex');
    });

    test('should tag states with stack as stack-interaction', () => {
      const state = createMinimalGameState();
      state.stack = [
        {
          id: 'stack-1',
          type: 'spell',
          sourceCardId: 'card-1',
          controllerId: 'player-1',
          name: 'Test Spell',
          text: '',
          manaCost: '{2}',
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
        },
      ];

      const serialized = serializeGameState(state);
      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('stack-interaction');
    });

    test('should tag combat states as combat', () => {
      const state = createMinimalGameState();
      state.combat.inCombatPhase = true;
      state.combat.attackers = [
        {
          cardId: 'card-1',
          defenderId: 'player-2',
          isAttackingPlaneswalker: false,
          damageToDeal: 2,
          hasFirstStrike: false,
          hasDoubleStrike: false,
        },
      ];

      const serialized = serializeGameState(state);
      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('combat');
    });

    test('should tag states with counters as counters', () => {
      const state = createMinimalGameState();
      const card = Array.from(state.cards.values())[0];
      if (card) {
        card.counters = [{ type: '+1/+1', count: 1 }];
      }

      const serialized = serializeGameState(state);
      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('counters');
    });

    test('should tag states with waiting choice as player-choice', () => {
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
      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('player-choice');
    });

    test('should apply multiple tags appropriately', () => {
      const state = createMinimalGameState();
      state.stack = [
        {
          id: 'stack-1',
          type: 'spell',
          sourceCardId: 'card-1',
          controllerId: 'player-1',
          name: 'Test Spell',
          text: '',
          manaCost: '{2}',
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
        },
      ];

      const serialized = serializeGameState(state);
      const tags = generateTestTags(state, serialized);

      expect(tags).toContain('simple'); // Base complexity
      expect(tags).toContain('stack-interaction');
    });
  });

  describe('Test Case Generation', () => {
    test('should generate test case from game state', () => {
      const state = createMinimalGameState();
      const serialized = serializeGameState(state);

      const config: FixtureConfig = {
        gameStates: [state],
        outputDir: '/tmp',
        testNamePrefix: 'test',
        testDescription: 'Test suite',
      };

      const test = generateTestCase(state, serialized, config);

      expect(test).toBeDefined();
      expect(test.testName).toMatch(/test-.*/);
      expect(test.gameState).toBeDefined();
      expect(test.tags).toContain('simple');
    });

    test('should include setup code when configured', () => {
      const state = createMinimalGameState();
      const serialized = serializeGameState(state);

      const config: FixtureConfig = {
        gameStates: [state],
        outputDir: '/tmp',
        testNamePrefix: 'test',
        testDescription: 'Test suite',
        includeSetup: true,
      };

      const test = generateTestCase(state, serialized, config);

      expect(test.setupCode).toBeDefined();
      expect(test.setupCode).toContain('createPlayer');
    });

    test('should include assertion code when configured', () => {
      const state = createMinimalGameState();
      state.stack = [
        {
          id: 'stack-1',
          type: 'spell',
          sourceCardId: 'card-1',
          controllerId: 'player-1',
          name: 'Test Spell',
          text: '',
          manaCost: '{2}',
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
        },
      ];

      const serialized = serializeGameState(state);

      const config: FixtureConfig = {
        gameStates: [state],
        outputDir: '/tmp',
        testNamePrefix: 'test',
        testDescription: 'Test suite',
        includeSetup: true,
      };

      const test = generateTestCase(state, serialized, config);

      expect(test.assertionCode).toBeDefined();
      expect(test.assertionCode).toContain('stack');
    });
  });

  describe('Jest File Generation', () => {
    test('should generate complete Jest test file', () => {
      const states = [createMinimalGameState()];

      const config: FixtureConfig = {
        gameStates: states,
        outputDir: '/tmp',
        testNamePrefix: 'auto-generated',
        testDescription: 'Test fixtures',
      };

      const testFile = generateJestTestFile(config);

      expect(testFile).toContain('describe(\'Test fixtures\'');
      expect(testFile).toContain('test(');
      expect(testFile).toContain('expect(');
      expect(testFile).toContain('import {');
    });

    test('should include file header with metadata', () => {
      const states = [createMinimalGameState()];

      const config: FixtureConfig = {
        gameStates: states,
        outputDir: '/tmp',
        testNamePrefix: 'auto-generated',
        testDescription: 'Test fixtures',
      };

      const testFile = generateJestTestFile(config);

      expect(testFile).toContain('/**');
      expect(testFile).toContain('Auto-generated test fixtures');
      expect(testFile).toContain('GH#684');
      expect(testFile).toContain('Total tests: 1');
    });

    test('should include test summary with tag counts', () => {
      const states = [
        createMinimalGameState(),
        createMinimalGameState(),
        createMinimalGameState(),
      ];

      const config: FixtureConfig = {
        gameStates: states,
        outputDir: '/tmp',
        testNamePrefix: 'auto-generated',
        testDescription: 'Test fixtures',
      };

      const testFile = generateJestTestFile(config);

      expect(testFile).toContain('Test Summary');
      expect(testFile).toContain('Total tests: 3');
      expect(testFile).toContain('simple: 3');
    });

    test('should generate multiple test cases', () => {
      const states = [
        createMinimalGameState(),
        createMinimalGameState(),
        createMinimalGameState(),
      ];

      const config: FixtureConfig = {
        gameStates: states,
        outputDir: '/tmp',
        testNamePrefix: 'auto-generated',
        testDescription: 'Test fixtures',
      };

      const testFile = generateJestTestFile(config);

      const testCount = (testFile.match(/test\(/g) || []).length;
      expect(testCount).toBe(3);
    });

    test('should skip invalid game states', () => {
      const states = [
        createMinimalGameState(),
        { gameId: 'invalid', format: 'standard' } as any, // Invalid
        createMinimalGameState(),
      ];

      const config: FixtureConfig = {
        gameStates: states,
        outputDir: '/tmp',
        testNamePrefix: 'auto-generated',
        testDescription: 'Test fixtures',
      };

      const testFile = generateJestTestFile(config);

      const testCount = (testFile.match(/test\(/g) || []).length;
      expect(testCount).toBe(2);
    });
  });

  describe('Setup Code Generation', () => {
    test('should generate player setup code', () => {
      const state = createMinimalGameState();

      const setupCode = generateSetupCode(state);

      expect(setupCode).toContain('createPlayer');
      expect(setupCode).toContain('Player 1');
      expect(setupCode).toContain('Player 2');
    });

    test('should include mana pool in setup', () => {
      const state = createMinimalGameState();

      const setupCode = generateSetupCode(state);

      expect(setupCode).toContain('manaPool');
    });
  });

  describe('Assertion Code Generation', () => {
    test('should generate basic assertions', () => {
      const state = createMinimalGameState();

      const assertions = generateAssertionCode(state);

      expect(assertions).toContain('expect(gameState).toBeDefined()');
      expect(assertions).toContain('expect(gameState.players).toHaveLength(2)');
    });

    test('should generate stack assertions when stack present', () => {
      const state = createMinimalGameState();
      state.stack = [
        {
          id: 'stack-1',
          type: 'spell',
          sourceCardId: 'card-1',
          controllerId: 'player-1',
          name: 'Test Spell',
          text: '',
          manaCost: '{2}',
          targets: [],
          chosenModes: [],
          variableValues: new Map(),
          isCountered: false,
          timestamp: Date.now(),
        },
      ];

      const assertions = generateAssertionCode(state);

      expect(assertions).toContain('stack');
    });

    test('should generate combat assertions when combat present', () => {
      const state = createMinimalGameState();
      state.combat.inCombatPhase = true;

      const assertions = generateAssertionCode(state);

      expect(assertions).toContain('combat');
    });

    test('should generate choice assertions when choice present', () => {
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

      const assertions = generateAssertionCode(state);

      expect(assertions).toContain('waitingChoice');
    });
  });
});

/**
 * Helper function to create minimal game state
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
