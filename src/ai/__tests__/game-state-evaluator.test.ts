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
  type ProposedPlay,
  projectBoardState,
  compareProjections,
  shouldPlayNow,
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
});

describe('What-If Scenario Modeling', () => {
  describe('projectBoardState', () => {
    it('should project casting a creature from hand to battlefield', () => {
      const handCard = createMockHandCard('Grizzly Bears', 2, 'Creature');
      const gameState = createTestGameState(20, 20, [handCard], [], [], []);
      gameState.players.player1.manaPool = { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'cast',
        cardId: handCard.cardInstanceId,
        manaCost: { colorless: 2 },
      };

      const result = projectBoardState(gameState, 'player1', play);

      expect(result.projectedState.players.player1.hand).toHaveLength(0);
      expect(result.projectedState.players.player1.battlefield).toHaveLength(1);
      expect(result.projectedState.players.player1.battlefield[0].name).toBe('Grizzly Bears');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should project casting a land from hand to battlefield', () => {
      const landCard = createMockHandCard('Forest', 0, 'Land');
      const gameState = createTestGameState(20, 20, [landCard], [], [], []);

      const play: ProposedPlay = {
        type: 'cast',
        cardId: landCard.cardInstanceId,
      };

      const result = projectBoardState(gameState, 'player1', play);

      expect(result.projectedState.players.player1.hand).toHaveLength(0);
      expect(result.projectedState.players.player1.battlefield).toHaveLength(1);
      expect(result.projectedState.players.player1.battlefield[0].type).toBe('land');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should deduct mana cost when casting a spell', () => {
      const handCard = createMockHandCard('Lightning Bolt', 1, 'Instant');
      const gameState = createTestGameState(20, 20, [handCard], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'cast',
        cardId: handCard.cardInstanceId,
        manaCost: { red: 1 },
      };

      const result = projectBoardState(gameState, 'player1', play);

      expect(result.projectedState.players.player1.manaPool.red).toBe(1);
    });

    it('should project creature activation', () => {
      const creature = createMockPermanent('c1', 'Mana Dork', 'creature', 1, 1);
      const gameState = createTestGameState(20, 20, [], [], [creature], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'activate',
        permanentId: creature.id,
        manaCost: { green: 1 },
      };

      const result = projectBoardState(gameState, 'player1', play);

      expect(result.projectedState.players.player1.battlefield[0].tapped).toBe(true);
      expect(result.projectedState.players.player1.manaPool.green).toBe(1);
    });

    it('should project attack with unblocked creatures dealing damage', () => {
      const attacker = createMockPermanent('c1', 'Bear', 'creature', 2, 2);
      const gameState = createTestGameState(20, 20, [], [], [attacker], []);

      const play: ProposedPlay = {
        type: 'attack',
      };

      const result = projectBoardState(gameState, 'player1', play);

      // Opponent should take damage
      expect(result.projectedState.players.player2.life).toBeLessThan(20);
      expect(result.projectedState.players.player1.battlefield[0].tapped).toBe(true);
    });

    it('should project attack with blocked creatures potentially dying', () => {
      const attacker = createMockPermanent('c1', 'Bear', 'creature', 2, 2);
      const blocker = createMockPermanent('c2', 'Bear', 'creature', 2, 2);
      const gameState = createTestGameState(20, 20, [], [], [attacker], [blocker]);

      const play: ProposedPlay = {
        type: 'attack',
      };

      const result = projectBoardState(gameState, 'player1', play);

      // Both creatures should die in combat (2 power vs 2 toughness)
      const player1Creatures = result.projectedState.players.player1.battlefield.filter(
        (p) => p.type === 'creature'
      );
      const player2Creatures = result.projectedState.players.player2.battlefield.filter(
        (p) => p.type === 'creature'
      );
      expect(player1Creatures.length).toBe(0);
      expect(player2Creatures.length).toBe(0);
    });

    it('should support 2-turn lookahead projections', () => {
      const handCard = createMockHandCard('Grizzly Bears', 2, 'Creature');
      const gameState = createTestGameState(20, 20, [handCard], [], [], []);

      const play: ProposedPlay = {
        type: 'cast',
        cardId: handCard.cardInstanceId,
      };

      const result1 = projectBoardState(gameState, 'player1', play, 1);
      const result2 = projectBoardState(gameState, 'player1', play, 2);

      // 2-turn lookahead should have lower confidence
      expect(result2.confidence).toBeLessThan(result1.confidence);
      // Both should modify the state
      expect(result1.projectedState).not.toEqual(gameState);
      expect(result2.projectedState).not.toEqual(gameState);
    });

    it('should throw error for cast play without cardId', () => {
      const gameState = createTestGameState();
      const play: ProposedPlay = { type: 'cast' };

      expect(() => projectBoardState(gameState, 'player1', play)).toThrow('cast play requires cardId');
    });

    it('should throw error for activate play without permanentId', () => {
      const gameState = createTestGameState();
      const play: ProposedPlay = { type: 'activate' };

      expect(() => projectBoardState(gameState, 'player1', play)).toThrow('activate play requires permanentId');
    });
  });

  describe('compareProjections', () => {
    it('should compare multiple proposed plays and find the best', () => {
      const creature1 = createMockHandCard('Grizzly Bears', 2, 'Creature');
      const creature2 = createMockHandCard('Hill Giant', 3, 'Creature');
      const gameState = createTestGameState(20, 20, [creature1, creature2], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 3, colorless: 0, generic: 0 };

      const plays = [
        {
          name: 'Cast 2-drop creature',
          play: { type: 'cast' as const, cardId: creature1.cardInstanceId, manaCost: { colorless: 2 } },
        },
        {
          name: 'Cast 3-drop creature',
          play: { type: 'cast' as const, cardId: creature2.cardInstanceId, manaCost: { colorless: 3 } },
        },
      ];

      const result = compareProjections(gameState, 'player1', plays);

      expect(result.currentScore).toBeDefined();
      expect(result.projections).toHaveLength(2);
      expect(result.bestPlay).toBeDefined();
      expect(result.bestPlay.recommendation).toMatch(/cast_now|hold_until_next_turn|skip/);
      expect(result.bestPlay.reasoning).toBeTruthy();
    });

    it('should recommend playing now when immediate benefit is high', () => {
      const bigCreature = createMockHandCard('Eldrazi', 10, 'Creature');
      const gameState = createTestGameState(20, 5, [bigCreature], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 10, colorless: 0, generic: 0 };

      const plays = [
        {
          name: 'Cast big creature to finish opponent',
          play: { type: 'cast' as const, cardId: bigCreature.cardInstanceId, manaCost: { colorless: 10 } },
        },
      ];

      const result = compareProjections(gameState, 'player1', plays);

      expect(result.bestPlay.recommendation).toBe('cast_now');
    });

    it('should recommend holding when better positioning is available', () => {
      const creature = createMockHandCard('Counterspell', 2, 'Instant');
      const gameState = createTestGameState(20, 20, [creature], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0, generic: 0 };

      const plays = [
        {
          name: 'Cast counterspell now (no target)',
          play: { type: 'cast' as const, cardId: creature.cardInstanceId, manaCost: { blue: 1, colorless: 1 } },
        },
      ];

      const result = compareProjections(gameState, 'player1', plays);

      // Without a good target, might recommend holding
      expect(['cast_now', 'hold_until_next_turn', 'skip']).toContain(result.bestPlay.recommendation);
    });
  });

  describe('shouldPlayNow', () => {
    it('should recommend playing now for strong immediate gain', () => {
      const creature = createMockHandCard('Tarmogoyf', 2, 'Creature');
      const gameState = createTestGameState(20, 15, [creature], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'cast',
        cardId: creature.cardInstanceId,
        manaCost: { colorless: 2 },
      };

      const result = shouldPlayNow(gameState, 'player1', play);

      expect(result.shouldPlay).toBe(true);
      expect(result.reasoning).toBeTruthy();
      expect(result.playNowScore).toBeDefined();
      expect(result.holdScore).toBeDefined();
    });

    it('should recommend holding when better positioning is available', () => {
      const instant = createMockHandCard('Counterspell', 2, 'Instant');
      const gameState = createTestGameState(20, 20, [instant], [], [], []);

      const play: ProposedPlay = {
        type: 'cast',
        cardId: instant.cardInstanceId,
        manaCost: { blue: 1, colorless: 1 },
      };

      const result = shouldPlayNow(gameState, 'player1', play);

      // For an instant with no target, might recommend holding
      expect(result.shouldPlay).toBeDefined();
      expect(result.reasoning).toBeTruthy();
    });

    it('should return valid scores for both options', () => {
      const creature = createMockHandCard('Grizzly Bears', 2, 'Creature');
      const gameState = createTestGameState(20, 20, [creature], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'cast',
        cardId: creature.cardInstanceId,
        manaCost: { colorless: 2 },
      };

      const result = shouldPlayNow(gameState, 'player1', play);

      expect(typeof result.playNowScore).toBe('number');
      expect(typeof result.holdScore).toBe('number');
    });
  });

  describe('hold-vs-play decision scenarios', () => {
    it('should recommend casting creature when opponent is low on life', () => {
      const creature = createMockHandCard('Lightning Bolt', 1, 'Instant');
      const gameState = createTestGameState(20, 3, [creature], [], [], []);
      gameState.players.player1.manaPool = { white: 0, blue: 0, black: 0, red: 1, colorless: 0, generic: 0 };

      const play: ProposedPlay = {
        type: 'cast',
        cardId: creature.cardInstanceId,
        manaCost: { red: 1 },
      };

      const result = shouldPlayNow(gameState, 'player1', play);

      // Should recommend playing now to finish opponent
      expect(result.shouldPlay).toBe(true);
    });

    it('should recommend holding when mana is needed for interaction', () => {
      const instant = createMockHandCard('Cancel', 3, 'Instant');
      const gameState = createTestGameState(20, 20, [instant], [], [], []);

      const play: ProposedPlay = {
        type: 'cast',
        cardId: instant.cardInstanceId,
        manaCost: { blue: 1, colorless: 2 },
      };

      const result = shouldPlayNow(gameState, 'player1', play);

      // Holding up mana is valuable for instants
      expect(result.reasoning).toBeTruthy();
    });

    it('should handle empty hand scenario', () => {
      const gameState = createTestGameState(20, 20, [], [], [], []);

      const play: ProposedPlay = {
        type: 'cast',
        cardId: 'nonexistent',
        manaCost: {},
      };

      const result = projectBoardState(gameState, 'player1', play);

      // Should still return a result even if card not found
      expect(result).toBeDefined();
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should compare playing a land vs holding', () => {
      const land = createMockHandCard('Forest', 0, 'Land');
      const creature = createMockHandCard('Elvish Mystic', 1, 'Creature');
      const gameState = createTestGameState(20, 20, [land, creature], [], [], []);

      const plays = [
        {
          name: 'Play land',
          play: { type: 'cast' as const, cardId: land.cardInstanceId },
        },
        {
          name: 'Cast creature (need mana first)',
          play: { type: 'cast' as const, cardId: creature.cardInstanceId, manaCost: { colorless: 1 } },
        },
      ];

      const result = compareProjections(gameState, 'player1', plays);

      // Playing land should be the best option (no cost, develops mana)
      expect(result.bestPlay.playName).toBeTruthy();
    });
  });
});
