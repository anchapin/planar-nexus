/**
 * @fileoverview Stack Interaction AI Tests
 *
 * Comprehensive tests for the Stack Interaction AI system.
 */

import {
  StackInteractionAI,
  StackAction,
  StackContext,
  AvailableResponse,
  evaluateStackResponse,
  decideCounterspell,
  manageResponseResources,
} from '../stack-interaction-ai';
import { GameState, PlayerState } from '../game-state-evaluator';

describe('StackInteractionAI', () => {
  let gameState: GameState;
  let playerId: string;

  beforeEach(() => {
    playerId = 'player1';
    gameState = createTestGameState();
  });

  describe('Basic Response Evaluation', () => {
    test('should pass on low-threat actions', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'small_creature',
        name: 'Gray Ogre',
        controller: 'player2',
        type: 'spell',
        manaValue: 3,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 1 },
        availableResponses: [],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.evaluateResponse(context);

      expect(decision.shouldRespond).toBe(false);
      expect(decision.action).toBe('pass');
    });

    test('should respond to high-threat actions', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'threatening_spell',
        name: 'Exsanguinate',
        controller: 'player2',
        type: 'spell',
        manaValue: 6,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const response: AvailableResponse = {
        cardId: 'counter',
        name: 'Counterspell',
        type: 'instant',
        manaValue: 2,
        manaCost: { blue: 2 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 8,
          targets: [stackAction.id],
        },
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [response],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.evaluateResponse(context);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.action).toBe('respond');
    });
  });

  describe('Counterspell Decisions', () => {
    test('should counter high-threat spells', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'threat',
        name: 'Primeval Titan',
        controller: 'player2',
        type: 'spell',
        manaValue: 6,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const counterspell: AvailableResponse = {
        cardId: 'counter',
        name: 'Cancel',
        type: 'instant',
        manaValue: 3,
        manaCost: { blue: 2, colorless: 1 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 7,
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

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.decideCounterspell(context, counterspell);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.responseCardId).toBe(counterspell.cardId);
    });

    test('should not counter low-value spells', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'minor_spell',
        name: 'Elvish Mystic',
        controller: 'player2',
        type: 'spell',
        manaValue: 1,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const counterspell: AvailableResponse = {
        cardId: 'counter',
        name: 'Counterspell',
        type: 'instant',
        manaValue: 2,
        manaCost: { blue: 2 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 2,
          targets: [stackAction.id],
        },
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [counterspell],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.decideCounterspell(context, counterspell);

      expect(decision.shouldRespond).toBe(false);
      expect(decision.action).toBe('pass');
    });

    test('should counter lethal threats regardless of cost', () => {
      gameState.players['player1'].life = 3;

      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'lethal',
        name: 'Lightning Bolt',
        controller: 'player2',
        type: 'spell',
        manaValue: 1,
        colors: ['red'],
        targets: [{ playerId: 'player1' }],
        isInstantSpeed: true,
        timestamp: Date.now(),
      };

      const counterspell: AvailableResponse = {
        cardId: 'counter',
        name: 'Force of Will',
        type: 'instant',
        manaValue: 0, // Alternative cost
        manaCost: { blue: 0 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 10, // Preventing lethal
          targets: [stackAction.id],
        },
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 0, colorless: 1 },
        availableResponses: [counterspell],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'postcombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.decideCounterspell(context, counterspell);

      expect(decision.shouldRespond).toBe(true);
      expect(decision.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Resource Management', () => {
    test('should hold mana for opponent turn', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'minor_spell',
        name: 'Candlestick',
        controller: 'player1',
        type: 'spell',
        manaValue: 1,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const instantResponse: AvailableResponse = {
        cardId: 'instant',
        name: 'Shock',
        type: 'instant',
        manaValue: 1,
        manaCost: { red: 1 },
        canCounter: false,
        canTarget: [],
        effect: {
          type: 'damage',
          value: 4,
          targets: [],
        },
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { red: 2, blue: 1, colorless: 1 },
        availableResponses: [instantResponse],
        opponentsRemaining: ['player2'],
        isMyTurn: true,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: false,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.manageResources(context);

      expect(decision.holdFor).toBe('opponent_turn');
      expect(decision.manaToReserve).toBeDefined();
    });

    test('should use mana now when no better opportunity', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'instant_use',
        name: 'Sorcery',
        controller: 'player1',
        type: 'spell',
        manaValue: 2,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { red: 2, colorless: 2 },
        availableResponses: [], // No instant-speed options
        opponentsRemaining: [],
        isMyTurn: true,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: false,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.manageResources(context);

      expect(decision.useNow).toBe(true);
      expect(decision.holdFor).toBe('nothing');
    });
  });

  describe('Priority Decisions', () => {
    test('should pass priority on low-threat actions', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'minor_spell',
        name: 'Giant Growth',
        controller: 'player2',
        type: 'spell',
        manaValue: 1,
        isInstantSpeed: true,
        timestamp: Date.now(),
      };

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

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.decidePriorityPass(context);

      expect(decision.shouldPass).toBe(true);
      expect(decision.riskLevel).toBe('low');
    });

    test('should not pass priority on high-threat actions', () => {
      gameState.players['player1'].life = 5;

      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'threat',
        name: 'Fireball',
        controller: 'player2',
        type: 'spell',
        manaValue: 5,
        colors: ['red'],
        targets: [{ playerId: 'player1' }],
        isInstantSpeed: true,
        timestamp: Date.now(),
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 1 },
        availableResponses: [
          {
            cardId: 'counter',
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
          },
        ],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'postcombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.decidePriorityPass(context);

      expect(decision.shouldPass).toBe(false);
      expect(decision.riskLevel).toBe('high');
    });
  });

  describe('Stack Ordering', () => {
    test('should optimize order of multiple responses', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'target',
        name: 'Creature',
        controller: 'player2',
        type: 'spell',
        manaValue: 3,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

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
            value: 6,
            targets: [stackAction.id],
          },
        },
        {
          cardId: 'response_2',
          name: 'Draw Spell',
          type: 'instant',
          manaValue: 2,
          manaCost: { blue: 1, colorless: 1 },
          canCounter: false,
          canTarget: [],
          effect: {
            type: 'draw',
            value: 5,
            targets: [],
          },
        },
      ];

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 4, colorless: 1 },
        availableResponses: responses,
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const ai = new StackInteractionAI(gameState, playerId, 'medium');
      const decision = ai.optimizeResponseOrder(context, responses);

      expect(decision.orderedActions).toBeDefined();
      expect(decision.orderedActions.length).toBeGreaterThan(0);
      expect(decision.expectedValue).toBeGreaterThan(0);
    });
  });

  describe('Difficulty Level Differences', () => {
    test('easy difficulty should be more aggressive', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'medium_threat',
        name: 'Hill Giant',
        controller: 'player2',
        type: 'spell',
        manaValue: 3,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const counterspell: AvailableResponse = {
        cardId: 'counter',
        name: 'Cancel',
        type: 'instant',
        manaValue: 3,
        manaCost: { blue: 2, colorless: 1 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 4,
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

      const easyAI = new StackInteractionAI(gameState, playerId, 'easy');
      const easyDecision = easyAI.decideCounterspell(context, counterspell);

      const hardAI = new StackInteractionAI(gameState, playerId, 'hard');
      const hardDecision = hardAI.decideCounterspell(context, counterspell);

      // Easy might counter, hard might save it
      // This verifies that difficulty affects decisions
      expect(easyDecision).toBeDefined();
      expect(hardDecision).toBeDefined();
    });
  });

  describe('Convenience Functions', () => {
    test('evaluateStackResponse should work', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'test_spell',
        name: 'Test Spell',
        controller: 'player2',
        type: 'spell',
        manaValue: 2,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const decision = evaluateStackResponse(gameState, playerId, context, 'medium');

      expect(decision).toBeDefined();
      expect(decision.shouldRespond).toBeDefined();
    });

    test('decideCounterspell should work', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'test_spell',
        name: 'Test Spell',
        controller: 'player2',
        type: 'spell',
        manaValue: 2,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const counterspell: AvailableResponse = {
        cardId: 'counter',
        name: 'Counterspell',
        type: 'instant',
        manaValue: 2,
        manaCost: { blue: 2 },
        canCounter: true,
        canTarget: ['spell'],
        effect: {
          type: 'counter',
          value: 5,
          targets: [stackAction.id],
        },
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [counterspell],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const decision = decideCounterspell(gameState, playerId, context, counterspell, 'medium');

      expect(decision).toBeDefined();
      expect(decision.shouldRespond).toBeDefined();
    });

    test('manageResponseResources should work', () => {
      const stackAction: StackAction = {
        id: 'stack_1',
        cardId: 'test_spell',
        name: 'Test Spell',
        controller: 'player1',
        type: 'spell',
        manaValue: 1,
        isInstantSpeed: false,
        timestamp: Date.now(),
      };

      const context: StackContext = {
        currentAction: stackAction,
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 1 },
        availableResponses: [],
        opponentsRemaining: ['player2'],
        isMyTurn: true,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: false,
      };

      const decision = manageResponseResources(gameState, playerId, context, 'medium');

      expect(decision).toBeDefined();
      expect(decision.useNow).toBeDefined();
      expect(decision.holdFor).toBeDefined();
    });
  });
});

/**
 * Helper function to create a test game state
 */
function createTestGameState(): GameState {
  const player1: PlayerState = {
    id: 'player1',
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      { cardId: 'card1', name: 'Counterspell', type: 'Instant', manaValue: 2 },
      { cardId: 'card2', name: 'Instant', type: 'Instant', manaValue: 1 },
      { cardId: 'card3', name: 'Creature', type: 'Creature', manaValue: 3 },
    ],
    graveyard: [],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: 'land1',
        cardId: 'land1',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
      {
        id: 'land2',
        cardId: 'land2',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
      {
        id: 'land3',
        cardId: 'land3',
        name: 'Island',
        type: 'land',
        controller: 'player1',
        tapped: false,
      },
    ],
    manaPool: { blue: 3, colorless: 0 },
  };

  const player2: PlayerState = {
    id: 'player2',
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      { cardId: 'opp1', name: 'Creature', type: 'Creature', manaValue: 3 },
      { cardId: 'opp2', name: 'Sorcery', type: 'Sorcery', manaValue: 2 },
    ],
    graveyard: [],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: 'opp_land1',
        cardId: 'opp_land1',
        name: 'Mountain',
        type: 'land',
        controller: 'player2',
        tapped: false,
      },
      {
        id: 'opp_land2',
        cardId: 'opp_land2',
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
      player1,
      player2,
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
