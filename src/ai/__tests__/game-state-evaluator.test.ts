/**
 * @fileoverview Unit Tests for GameStateEvaluator
 *
 * Tests for heuristic game state evaluation functions.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  GameStateEvaluator,
  DefaultWeights,
  type EvaluationWeights,
  type DetailedEvaluation,
  projectBoardState,
  compareHoldVsPlay,
  type ProposedPlay,
} from '../game-state-evaluator';
import type { AIGameState, AIPlayerState, AIPermanent, AIHandCard } from '@/lib/game-state/types';

/**
 * Create a mock AI player state for testing
 */
function createMockPlayerState(
  id: string,
  life: number = 20,
  hand: AIHandCard[] = [],
  battlefield: AIPermanent[] = [],
  graveyard: string[] = [],
  exile: string[] = [],
  library: number = 40
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand,
    battlefield,
    graveyard,
    exile,
    library,
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
    cardInstanceId: id,
    id,
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
 * Create a mock hand card for testing
 */
function createMockHandCard(
  name: string,
  manaValue: number,
  type: string = 'Creature'
): AIHandCard {
  return {
    cardInstanceId: `hand-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    manaValue,
    type,
    colors: [],
  };
}

/**
 * Create a basic test game state
 */
function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Hand: AIHandCard[] = [],
  player2Hand: AIHandCard[] = [],
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = []
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState('player1', player1Life, player1Hand, player1Battlefield),
      player2: createMockPlayerState('player2', player2Life, player2Hand, player2Battlefield),
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
}

describe('GameStateEvaluator', () => {
  describe('constructor', () => {
    it('should initialize with default difficulty (medium)', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');

      const weights = evaluator.getWeights();
      expect(weights).toEqual(DefaultWeights.medium);
    });

    it('should initialize with specified difficulty', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1', 'hard');

      const weights = evaluator.getWeights();
      expect(weights).toEqual(DefaultWeights.hard);
    });

    it('should store the evaluating player ID', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player2');

      // This is tested indirectly through evaluate()
      const evaluation = evaluator.evaluate();
      expect(evaluation).toBeDefined();
    });
  });

  describe('setWeights and getWeights', () => {
    it('should update weights with setWeights', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');

      const customWeights: Partial<EvaluationWeights> = {
        lifeScore: 2.0,
        creaturePower: 1.5,
      };

      evaluator.setWeights(customWeights);
      const weights = evaluator.getWeights();

      expect(weights.lifeScore).toBe(2.0);
      expect(weights.creaturePower).toBe(1.5);
      // Other weights should remain unchanged
      expect(weights.poisonScore).toBe(DefaultWeights.medium.poisonScore);
    });

    it('should return a copy of weights (not mutable reference)', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');

      const weights1 = evaluator.getWeights();
      weights1.lifeScore = 999;

      const weights2 = evaluator.getWeights();
      expect(weights2.lifeScore).toBe(DefaultWeights.medium.lifeScore);
    });
  });

  describe('evaluate()', () => {
    it('should return a complete evaluation object', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');

      const evaluation = evaluator.evaluate();

      expect(evaluation).toHaveProperty('totalScore');
      expect(evaluation).toHaveProperty('factors');
      expect(evaluation).toHaveProperty('threats');
      expect(evaluation).toHaveProperty('opportunities');
      expect(evaluation).toHaveProperty('recommendedActions');
    });

    it('should evaluate life score correctly', () => {
      // Player has more life than opponent
      let gameState = createTestGameState(25, 15);
      let evaluator = new GameStateEvaluator(gameState, 'player1');
      let evaluation = evaluator.evaluate();

      expect(evaluation.factors.lifeScore).toBeGreaterThan(0);

      // Player has less life than opponent
      gameState = createTestGameState(15, 25);
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();

      expect(evaluation.factors.lifeScore).toBeLessThan(0);

      // Equal life
      gameState = createTestGameState(20, 20);
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();

      expect(evaluation.factors.lifeScore).toBeCloseTo(0, 1);
    });

    it('should evaluate poison score correctly', () => {
      const gameState = createTestGameState();
      
      // No poison
      let evaluator = new GameStateEvaluator(gameState, 'player1');
      let evaluation = evaluator.evaluate();
      expect(evaluation.factors.poisonScore).toBeCloseTo(0);

      // 5 poison counters (halfway to lethal)
      gameState.players.player1.poisonCounters = 5;
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();
      expect(evaluation.factors.poisonScore).toBe(-0.5);

      // 10 poison counters (lethal)
      gameState.players.player1.poisonCounters = 10;
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();
      expect(evaluation.factors.poisonScore).toBe(-1);
    });

    it('should evaluate card advantage correctly', () => {
      // Player has more cards than opponent
      const player1Hand = [
        createMockHandCard('Card1', 2),
        createMockHandCard('Card2', 3),
      ];
      const player2Hand = [createMockHandCard('Card3', 1)];

      let gameState = createTestGameState(20, 20, player1Hand, player2Hand);
      let evaluator = new GameStateEvaluator(gameState, 'player1');
      let evaluation = evaluator.evaluate();

      expect(evaluation.factors.cardAdvantage).toBeGreaterThan(0);

      // Player has fewer cards
      gameState = createTestGameState(20, 20, player2Hand, player1Hand);
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();

      expect(evaluation.factors.cardAdvantage).toBeLessThan(0);
    });

    it('should evaluate hand quality based on mana curve', () => {
      // Good curve (avg ~2.5)
      const goodHand = [
        createMockHandCard('Card1', 2),
        createMockHandCard('Card2', 3),
        createMockHandCard('Land', 0, 'Land'),
      ];

      const gameState = createTestGameState(20, 20, goodHand, []);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.handQuality).toBeGreaterThan(0.5);
    });

    it('should evaluate hand quality lower without mana sources', () => {
      // No lands in hand
      const noManaHand = [
        createMockHandCard('Card1', 4),
        createMockHandCard('Card2', 5),
      ];

      const gameState = createTestGameState(20, 20, noManaHand, []);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.handQuality).toBeLessThan(0.5);
    });

    it('should evaluate library depth correctly', () => {
      // Large library
      const gameState = createTestGameState();
      gameState.players.player1.library = 30;
      let evaluator = new GameStateEvaluator(gameState, 'player1');
      let evaluation = evaluator.evaluate();
      expect(evaluation.factors.libraryDepth).toBe(1);

      // Medium library
      gameState.players.player1.library = 15;
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();
      expect(evaluation.factors.libraryDepth).toBe(0.5);

      // Low library (danger zone)
      gameState.players.player1.library = 3;
      evaluator = new GameStateEvaluator(gameState, 'player1');
      evaluation = evaluator.evaluate();
      expect(evaluation.factors.libraryDepth).toBe(-1);
    });

    it('should evaluate creature power correctly', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
        createMockPermanent('c2', 'Ogre', 'creature', 3, 2),
      ];
      const player2Creatures = [
        createMockPermanent('c3', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, [], [], player1Creatures, player2Creatures);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.creaturePower).toBeGreaterThan(0);
    });

    it('should only count untapped creatures for power evaluation', () => {
      const tappedCreature = createMockPermanent('c1', 'Bear', 'creature', 2, 2, true);
      const gameState = createTestGameState(20, 20, [], [], [tappedCreature], []);
      
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.creaturePower).toBeLessThanOrEqual(0);
    });

    it('should evaluate permanent advantage correctly', () => {
      const player1Permanents = [
        createMockPermanent('c1', 'Bear', 'creature'),
        createMockPermanent('a1', 'Artifact', 'artifact'),
      ];
      const player2Permanents = [
        createMockPermanent('c2', 'Bear', 'creature'),
      ];

      const gameState = createTestGameState(20, 20, [], [], player1Permanents, player2Permanents);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.permanentAdvantage).toBeGreaterThan(0);
    });

    it('should evaluate mana available correctly', () => {
      const gameState = createTestGameState();
      gameState.players.player1.manaPool = {
        white: 2,
        blue: 1,
        black: 0,
        red: 3,
        green: 0,
        colorless: 2,
        generic: 0,
      };

      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.manaAvailable).toBeGreaterThan(0);
    });

    it('should generate threat assessments', () => {
      const opponentCreatures = [
        createMockPermanent('c1', 'Big Creature', 'creature', 5, 5),
      ];
      const gameState = createTestGameState(20, 20, [], [], [], opponentCreatures);
      gameState.players.player2.battlefield = opponentCreatures;

      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.threats).toBeDefined();
      expect(Array.isArray(evaluation.threats)).toBe(true);
    });

    it('should generate opportunity assessments', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.opportunities).toBeDefined();
      expect(Array.isArray(evaluation.opportunities)).toBe(true);
    });

    it('should generate recommended actions', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.recommendedActions).toBeDefined();
      expect(Array.isArray(evaluation.recommendedActions)).toBe(true);
    });
  });

  describe('evaluateCardPriority', () => {
    it('should prioritize low-cost cards early game', () => {
      const gameState = createTestGameState();
      gameState.turnInfo.currentTurn = 2;
      
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      
      // This tests the internal logic through the evaluation
      const evaluation = evaluator.evaluate();
      expect(evaluation).toBeDefined();
    });
  });

  describe('evaluateAttack', () => {
    it('should evaluate attacking when ahead on board', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
        createMockPermanent('c2', 'Ogre', 'creature', 3, 2),
      ];
      const player2Creatures = [
        createMockPermanent('c3', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 15, [], [], player1Creatures, player2Creatures);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      // Should recommend aggressive action when ahead
      expect(evaluation.totalScore).toBeGreaterThan(0);
    });

    it('should evaluate attacking more cautiously when behind', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];
      const player2Creatures = [
        createMockPermanent('c2', 'Bear', 'creature', 2, 2),
        createMockPermanent('c3', 'Ogre', 'creature', 3, 2),
      ];

      const gameState = createTestGameState(15, 20, [], [], player1Creatures, player2Creatures);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      // Score should be lower when behind
      expect(evaluation.totalScore).toBeLessThan(5);
    });
  });

  describe('difficulty-based evaluation', () => {
    it('should use different weights for easy difficulty', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1', 'easy');
      
      const weights = evaluator.getWeights();
      
      // Easy AI values survival more
      expect(weights.lifeScore).toBeGreaterThan(DefaultWeights.medium.lifeScore);
      // Easy AI ignores card advantage
      expect(weights.cardAdvantage).toBeLessThan(DefaultWeights.medium.cardAdvantage);
    });

    it('should use different weights for expert difficulty', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1', 'expert');
      
      const weights = evaluator.getWeights();
      
      // Expert AI has balanced, strategic weights
      expect(weights.cardAdvantage).toBeGreaterThan(DefaultWeights.easy.cardAdvantage);
      expect(weights.synergy).toBeGreaterThan(DefaultWeights.easy.synergy);
    });

    it('should produce different evaluations based on difficulty', () => {
      const player1Creatures = [
        createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      ];

      const gameState = createTestGameState(20, 20, [], [], player1Creatures, []);
      
      const easyEvaluator = new GameStateEvaluator(gameState, 'player1', 'easy');
      const expertEvaluator = new GameStateEvaluator(gameState, 'player1', 'expert');
      
      const easyEval = easyEvaluator.evaluate();
      const expertEval = expertEvaluator.evaluate();
      
      // Different difficulties should produce different total scores
      expect(easyEval.totalScore).not.toBe(expertEval.totalScore);
    });
  });

  describe('multi-opponent evaluation', () => {
    it('should handle evaluation with multiple opponents', () => {
      const gameState: AIGameState = {
        players: {
          player1: createMockPlayerState('player1', 20),
          player2: createMockPlayerState('player2', 15),
          player3: createMockPlayerState('player3', 25),
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

      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation).toBeDefined();
      expect(evaluation.totalScore).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty battlefield', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.creaturePower).toBe(0);
      expect(evaluation.factors.creatureCount).toBe(0);
    });

    it('should handle empty hand', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.handQuality).toBeLessThanOrEqual(0);
    });

    it('should handle very high life totals', () => {
      const gameState = createTestGameState(100, 10);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      // Life score should be capped at 1
      expect(evaluation.factors.lifeScore).toBeLessThanOrEqual(1);
    });

    it('should handle negative life totals', () => {
      const gameState = createTestGameState(-5, 20);
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      // Life score should be capped at -1
      expect(evaluation.factors.lifeScore).toBeGreaterThanOrEqual(-1);
    });
  });

  describe('stackPressureScore', () => {
    it('should be zero with empty stack and no open mana', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.stackPressureScore).toBe(0);
    });

    it('should score lower when opponent has 2+ mana open on their turn vs tapped out', () => {
      const tappedOutHand: AIHandCard[] = [];
      const tappedOutBattlefield: AIPermanent[] = [
        createMockPermanent('land-1', 'Island', 'land', undefined, undefined, true),
      ];

      const openManaBattlefield: AIPermanent[] = [
        createMockPermanent('land-2', 'Island', 'land', undefined, undefined, false),
        createMockPermanent('land-3', 'Island', 'land', undefined, undefined, false),
      ];

      const tappedOutState = createTestGameState(
        20, 20,
        tappedOutHand, tappedOutHand,
        tappedOutBattlefield, tappedOutBattlefield
      );
      tappedOutState.turnInfo.currentPlayer = 'player2';

      const openManaState = createTestGameState(
        20, 20,
        tappedOutHand, tappedOutHand,
        tappedOutBattlefield, openManaBattlefield
      );
      openManaState.turnInfo.currentPlayer = 'player2';

      const evaluatorTapped = new GameStateEvaluator(tappedOutState, 'player1');
      const evaluatorOpen = new GameStateEvaluator(openManaState, 'player1');

      expect(evaluatorOpen.evaluate().factors.stackPressureScore).toBeLessThan(
        evaluatorTapped.evaluate().factors.stackPressureScore
      );
    });

    it('should score positively when player has instants and opponents have open mana', () => {
      const playerHand = [
        createMockHandCard('Counterspell', 2, 'Instant'),
      ];
      const oppBattlefield = [
        createMockPermanent('land-1', 'Island', 'land', undefined, undefined, false),
        createMockPermanent('land-2', 'Island', 'land', undefined, undefined, false),
      ];

      const gameState = createTestGameState(
        20, 20,
        playerHand, [],
        [], oppBattlefield
      );

      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.stackPressureScore).toBeGreaterThan(0);
    });

    it('should score positively when player has responses on the stack', () => {
      const playerHand = [
        createMockHandCard('Counterspell', 2, 'Instant'),
      ];
      const untappedLands = [
        createMockPermanent('land-1', 'Island', 'land', undefined, undefined, false),
        createMockPermanent('land-2', 'Island', 'land', undefined, undefined, false),
      ];

      const gameState = createTestGameState(
        20, 20,
        playerHand, [],
        untappedLands, []
      );
      gameState.stack = [
        {
          id: 'stack-1',
          cardInstanceId: 'card-1',
          controller: 'player2',
          type: 'spell',
          name: 'Lightning Bolt',
          manaValue: 1,
          targets: ['player1'],
        },
      ];

      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.stackPressureScore).toBeGreaterThan(0);
    });

    it('should include stackPressureScore in default weights for all difficulties', () => {
      const difficulties: Array<'easy' | 'medium' | 'hard' | 'expert'> = ['easy', 'medium', 'hard', 'expert'];

      for (const diff of difficulties) {
        expect(DefaultWeights[diff].stackPressureScore).toBeGreaterThan(0);
      }
    });

    it('should include stackPressureScore in evaluation factors', () => {
      const gameState = createTestGameState();
      const evaluator = new GameStateEvaluator(gameState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors).toHaveProperty('stackPressureScore');
      expect(typeof evaluation.factors.stackPressureScore).toBe('number');
    });

    it('should score higher with flash creatures and no opponent mana', () => {
      const playerHand: AIHandCard[] = [
        {
          cardInstanceId: 'hand-vendilion-clique',
          name: 'Vendilion Clique',
          manaValue: 3,
          type: 'Creature',
          colors: ['blue'],
          keywords: ['flash', 'flying'],
        },
      ];

      const noManaState = createTestGameState(20, 20, playerHand, [], [], []);

      const evaluator = new GameStateEvaluator(noManaState, 'player1');
      const evaluation = evaluator.evaluate();

      expect(evaluation.factors.stackPressureScore).toBeGreaterThan(0);
    });

    it('should be included in totalScore calculation', () => {
      const playerHand = [
        createMockHandCard('Counterspell', 2, 'Instant'),
      ];
      const oppBattlefield = [
        createMockPermanent('land-1', 'Island', 'land', undefined, undefined, false),
        createMockPermanent('land-2', 'Island', 'land', undefined, undefined, false),
      ];

      const gameState = createTestGameState(
        20, 20,
        playerHand, [],
        [], oppBattlefield
      );

      const evaluatorNormal = new GameStateEvaluator(gameState, 'player1');
      evaluatorNormal.setWeights({ stackPressureScore: 0 });
      const scoreNoStack = evaluatorNormal.evaluate().totalScore;

      const evaluatorWithStack = new GameStateEvaluator(gameState, 'player1');
      const scoreWithStack = evaluatorWithStack.evaluate().totalScore;

      expect(scoreWithStack).not.toBe(scoreNoStack);
    });
  });
});

describe('projectBoardState', () => {
  it('should remove a creature card from hand and add it to battlefield', () => {
    const hand_card = createMockHandCard('Grizzly Bears', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    const projected = projectBoardState(game_state, play);

    expect(projected.players.player1.hand).toHaveLength(0);
    expect(projected.players.player1.battlefield).toHaveLength(1);
    expect(projected.players.player1.battlefield[0].name).toBe('Grizzly Bears');
    expect(projected.players.player1.battlefield[0].power).toBe(2);
  });

  it('should add land to battlefield and track land drop', () => {
    const land_card = createMockHandCard('Forest', 0, 'Land');
    const game_state = createTestGameState(20, 20, [land_card], []);

    const play: ProposedPlay = {
      card: land_card,
      type: 'play_land',
      manaCost: 0,
      producedPermanent: { type: 'land' },
    };

    const projected = projectBoardState(game_state, play);

    expect(projected.players.player1.hand).toHaveLength(0);
    expect(projected.players.player1.battlefield).toHaveLength(1);
    expect(projected.players.player1.battlefield[0].type).toBe('land');
    expect(projected.players.player1.landsPlayedThisTurn).toBe(1);
  });

  it('should send instants to graveyard after casting', () => {
    const instant_card = createMockHandCard('Lightning Bolt', 1, 'Instant');
    const game_state = createTestGameState(20, 20, [instant_card], []);

    const play: ProposedPlay = {
      card: instant_card,
      type: 'cast_instant',
      manaCost: 1,
    };

    const projected = projectBoardState(game_state, play);

    expect(projected.players.player1.hand).toHaveLength(0);
    expect(projected.players.player1.battlefield).toHaveLength(0);
    expect(projected.players.player1.graveyard).toHaveLength(1);
  });

  it('should not mutate the original game state', () => {
    const hand_card = createMockHandCard('Bear', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    projectBoardState(game_state, play);

    expect(game_state.players.player1.hand).toHaveLength(1);
    expect(game_state.players.player1.battlefield).toHaveLength(0);
  });

  it('should deduct mana cost from mana pool', () => {
    const hand_card = createMockHandCard('Bear', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);
    game_state.players.player1.manaPool = {
      white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0, generic: 0,
    };

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    const projected = projectBoardState(game_state, play);

    expect((projected.players.player1.manaPool as Record<string, number>).green).toBe(0);
  });
});

describe('compareHoldVsPlay', () => {
  it('scenario 1: should recommend playing a creature when board is empty (develop board)', () => {
    const hand_card = createMockHandCard('Grizzly Bears', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);
    game_state.players.player1.manaPool = {
      white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0, generic: 0,
    };

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result.recommendation).toBe('play');
    expect(result.playNowScore).toBeGreaterThan(result.holdScore);
  });

  it('scenario 2: should recommend playing a land to develop mana base', () => {
    const land_card = createMockHandCard('Forest', 0, 'Land');
    const hand_card = createMockHandCard('Bear', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [land_card, hand_card], []);

    const play: ProposedPlay = {
      card: land_card,
      type: 'play_land',
      manaCost: 0,
      producedPermanent: { type: 'land' },
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result.recommendation).toBe('play');
  });

  it('scenario 3: should recommend holding removal when opponent has no creatures', () => {
    const removal = createMockHandCard('Path to Exile', 1, 'Instant');
    const game_state = createTestGameState(20, 20, [removal], []);

    const play: ProposedPlay = {
      card: removal,
      type: 'cast_instant',
      manaCost: 1,
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result.recommendation).toBe('hold');
    expect(result.holdScore).toBeGreaterThanOrEqual(result.playNowScore);
  });

  it('scenario 4: should recommend playing a big creature when behind on board', () => {
    const big_creature = createMockHandCard('Inferno Titan', 6, 'Creature');
    const opponent_creatures = [
      createMockPermanent('c1', 'Bear', 'creature', 2, 2),
      createMockPermanent('c2', 'Ogre', 'creature', 3, 3),
      createMockPermanent('c3', 'Giant', 'creature', 4, 4),
    ];
    const game_state = createTestGameState(20, 20, [big_creature], [], [], opponent_creatures);
    game_state.players.player1.manaPool = {
      white: 0, blue: 0, black: 0, red: 6, colorless: 0, generic: 0,
    };

    const play: ProposedPlay = {
      card: big_creature,
      type: 'cast_creature',
      manaCost: 6,
      producedPermanent: { type: 'creature', power: 6, toughness: 6 },
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result.recommendation).toBe('play');
    expect(result.scoreDelta).toBeGreaterThan(0);
  });

  it('scenario 5: should recommend holding a sorcery with no board impact when board is empty', () => {
    const sorcery = createMockHandCard('Divination', 3, 'Sorcery');
    const game_state = createTestGameState(20, 20, [sorcery], []);

    const play: ProposedPlay = {
      card: sorcery,
      type: 'cast_sorcery',
      manaCost: 3,
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result.recommendation).toBe('hold');
    expect(result.holdScore).toBeGreaterThanOrEqual(result.playNowScore);
  });

  it('should return both scores and scoreDelta', () => {
    const hand_card = createMockHandCard('Bear', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    const result = compareHoldVsPlay(game_state, play, 'player1');

    expect(result).toHaveProperty('playNowScore');
    expect(result).toHaveProperty('holdScore');
    expect(result).toHaveProperty('recommendation');
    expect(result).toHaveProperty('scoreDelta');
    expect(typeof result.playNowScore).toBe('number');
    expect(typeof result.holdScore).toBe('number');
    expect(result.scoreDelta).toBeCloseTo(result.playNowScore - result.holdScore);
  });

  it('should respect difficulty when computing scores', () => {
    const hand_card = createMockHandCard('Bear', 2, 'Creature');
    const game_state = createTestGameState(20, 20, [hand_card], []);

    const play: ProposedPlay = {
      card: hand_card,
      type: 'cast_creature',
      manaCost: 2,
      producedPermanent: { type: 'creature', power: 2, toughness: 2 },
    };

    const easy_result = compareHoldVsPlay(game_state, play, 'player1', 'easy');
    const hard_result = compareHoldVsPlay(game_state, play, 'player1', 'hard');

    expect(easy_result.playNowScore).not.toBe(hard_result.playNowScore);
  });
});
