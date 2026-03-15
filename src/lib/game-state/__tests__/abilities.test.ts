/**
 * Unit tests for Abilities System
 * Issue #602: Increase test coverage for critical game logic modules
 *
 * Tests:
 * - Activated abilities
 * - Triggered abilities
 * - Loyalty abilities (planeswalkers)
 * - Ability cost payment
 */

import {
  hasActivatedAbilities,
  hasTriggeredAbilities,
  getActivatedAbilities,
  getTriggeredAbilities,
  canActivateAbility,
  activateAbility,
  getLoyaltyAbilities,
  canActivateLoyaltyAbility,
  activateLoyaltyAbility,
} from '../abilities';
import { createInitialGameState, startGame } from '../game-state';
import { createCardInstance } from '../card-instance';
import type { ScryfallCard } from '@/app/actions';
import { Phase } from '../types';

// Helper function to create a mock card
function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'mock-card-1',
    name: 'Test Card',
    type_line: 'Creature — Human',
    oracle_text: '',
    mana_cost: '{1}{W}',
    cmc: 2,
    colors: ['W'],
    color_identity: ['W'],
    legalities: { standard: 'legal', commander: 'legal' },
    layout: 'normal',
    ...overrides,
  } as ScryfallCard;
}

describe('Abilities System - hasActivatedAbilities', () => {
  it('should return false for card without activated abilities', () => {
    const card = createMockCard({ oracle_text: 'This is a static ability.' });
    expect(hasActivatedAbilities(card)).toBe(false);
  });

  it('should return true for card with activated ability (colon syntax)', () => {
    const card = createMockCard({ oracle_text: '{T}: Draw a card.' });
    expect(hasActivatedAbilities(card)).toBe(true);
  });

  it('should return false for card without oracle_text', () => {
    const card = { name: 'Test' } as any;
    expect(hasActivatedAbilities(card)).toBe(false);
  });
});

describe('Abilities System - hasTriggeredAbilities', () => {
  it('should return true for card with "when" trigger', () => {
    const card = createMockCard({ oracle_text: 'When this creature enters the battlefield, draw a card.' });
    expect(hasTriggeredAbilities(card)).toBe(true);
  });

  it('should return true for card with "whenever" trigger', () => {
    const card = createMockCard({ oracle_text: 'Whenever you draw a card, create a 1/1 token.' });
    expect(hasTriggeredAbilities(card)).toBe(true);
  });

  it('should return true for card with "at" trigger', () => {
    const card = createMockCard({ oracle_text: 'At the beginning of your upkeep, lose 1 life.' });
    expect(hasTriggeredAbilities(card)).toBe(true);
  });

  it('should return false for card without triggered abilities', () => {
    const card = createMockCard({ oracle_text: 'Flying' });
    expect(hasTriggeredAbilities(card)).toBe(false);
  });

  it('should return false for card without oracle_text', () => {
    const card = { name: 'Test' } as any;
    expect(hasTriggeredAbilities(card)).toBe(false);
  });
});

describe('Abilities System - getActivatedAbilities', () => {
  it('should return empty array for card without oracle text', () => {
    const card = createMockCard({ oracle_text: undefined });
    expect(getActivatedAbilities(card)).toEqual([]);
  });

  it('should return empty array for card without activated abilities', () => {
    const card = createMockCard({ oracle_text: 'Flying. Trample.' });
    expect(getActivatedAbilities(card)).toEqual([]);
  });

  it('should parse card with activated ability', () => {
    const card = createMockCard({ oracle_text: '{T}: Draw a card.' });
    const abilities = getActivatedAbilities(card);
    expect(abilities.length).toBeGreaterThan(0);
  });
});

describe('Abilities System - getTriggeredAbilities', () => {
  it('should return empty array for card without oracle text', () => {
    const card = createMockCard({ oracle_text: undefined });
    expect(getTriggeredAbilities(card)).toEqual([]);
  });

  it('should parse card with triggered ability', () => {
    const card = createMockCard({ oracle_text: 'When this creature enters the battlefield, draw a card.' });
    const abilities = getTriggeredAbilities(card);
    expect(abilities.length).toBeGreaterThan(0);
  });
});

describe('Abilities System - canActivateAbility', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let cardId!: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, false);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    // Create and place a creature on the battlefield
    const creatureData = createMockCard({
      id: 'test-creature',
      name: 'Test Creature',
      type_line: 'Creature — Human Warrior',
      oracle_text: '{T}: Draw a card.',
      power: '2',
      toughness: '2',
    });
    const creature = createCardInstance(creatureData, aliceId, aliceId);
    creature.hasSummoningSickness = false;
    cardId = creature.id;
    state.cards.set(cardId, creature);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, cardId],
    });
  });

  it('should allow activation when all conditions are met', () => {
    // Give Alice priority
    state = { ...state, priorityPlayerId: aliceId };
    
    const result = canActivateAbility(state, aliceId, cardId, 0);
    expect(result.canActivate).toBe(true);
  });

  it('should deny activation when card is not found', () => {
    state = { ...state, priorityPlayerId: aliceId };
    
    const result = canActivateAbility(state, aliceId, 'non-existent-card', 0);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('Card not found');
  });

  it('should deny activation when player does not control card', () => {
    state = { ...state, priorityPlayerId: bobId };
    
    const result = canActivateAbility(state, bobId, cardId, 0);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('You do not control this card');
  });

  it('should deny activation when player does not have priority', () => {
    state = { ...state, priorityPlayerId: bobId };
    
    const result = canActivateAbility(state, aliceId, cardId, 0);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('You do not have priority');
  });

  it('should deny activation when card is not on battlefield', () => {
    state = { ...state, priorityPlayerId: aliceId };
    
    // Move card to hand
    const hand = state.zones.get(`${aliceId}-hand`)!;
    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-hand`, { ...hand, cardIds: [...hand.cardIds, cardId] });
    state.zones.set(`${aliceId}-battlefield`, { ...battlefield, cardIds: [] });
    
    const result = canActivateAbility(state, aliceId, cardId, 0);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('Card is not on the battlefield');
  });
});

describe('Abilities System - activateAbility', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let cardId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, false);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    // Create and place a creature on the battlefield
    const creatureData = createMockCard({
      id: 'test-creature-tap',
      name: 'Tap Creature',
      type_line: 'Creature — Human Warrior',
      oracle_text: '{T}: Draw a card.',
      power: '2',
      toughness: '2',
    });
    const creature = createCardInstance(creatureData, aliceId, aliceId);
    creature.hasSummoningSickness = false;
    cardId = creature.id;
    state.cards.set(cardId, creature);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, cardId],
    });

    // Give Alice priority
    state = { ...state, priorityPlayerId: aliceId };
  });

  it('should successfully activate an ability', () => {
    const result = activateAbility(state, aliceId, cardId, 0);
    
    expect(result.success).toBe(true);
    expect(result.description).toContain('Tap Creature');
    // Check stack was updated
    expect(result.state.stack.length).toBe(1);
  });

  it('should fail when card is not found', () => {
    const result = activateAbility(state, aliceId, 'non-existent', 0);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Card not found');
  });

  it('should fail when ability is not found', () => {
    const result = activateAbility(state, aliceId, cardId, 99);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Ability not found');
  });

  it('should tap the card when ability has tap cost', () => {
    const result = activateAbility(state, aliceId, cardId, 0);
    
    const card = result.state.cards.get(cardId);
    expect(card?.isTapped).toBe(true);
  });

  it('should add ability to stack', () => {
    const result = activateAbility(state, aliceId, cardId, 0);
    
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].type).toBe('ability');
    expect(result.state.stack[0].sourceCardId).toBe(cardId);
  });
});

describe('Abilities System - getLoyaltyAbilities', () => {
  it('should return empty array for card without oracle text', () => {
    const card = createMockCard({ oracle_text: undefined });
    expect(getLoyaltyAbilities(card)).toEqual([]);
  });

  it('should parse positive loyalty ability', () => {
    const card = createMockCard({ 
      oracle_text: '+1: Draw a card.\n-3: Destroy target creature.' 
    });
    const abilities = getLoyaltyAbilities(card);
    
    expect(abilities.length).toBe(2);
    expect(abilities[0].cost).toBe(1);
    expect(abilities[0].effect).toBe('Draw a card.');
    expect(abilities[1].cost).toBe(-3);
    expect(abilities[1].effect).toBe('Destroy target creature.');
  });

  it('should return empty array for non-planeswalker', () => {
    const card = createMockCard({ oracle_text: 'Flying.' });
    expect(getLoyaltyAbilities(card)).toEqual([]);
  });
});

describe('Abilities System - canActivateLoyaltyAbility', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let bobId: string;
  let planeswalkerId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, false);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];
    bobId = playerIds[1];

    // Create a planeswalker
    const pwData = createMockCard({
      id: 'test-planeswalker',
      name: 'Test Planeswalker',
      type_line: 'Planeswalker — Jace',
      oracle_text: '+1: Draw a card.\n-3: Destroy target creature.',
      power: undefined,
      toughness: undefined,
    });
    const planeswalker = createCardInstance(pwData, aliceId, aliceId);
    planeswalker.counters = [{ type: 'loyalty', count: 3 }];
    planeswalkerId = planeswalker.id;
    state.cards.set(planeswalkerId, planeswalker);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, planeswalkerId],
    });
  });

  it('should allow loyalty activation during main phase with empty stack', () => {
    state = { 
      ...state, 
      priorityPlayerId: aliceId,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
    };
    
    const result = canActivateLoyaltyAbility(state, aliceId, planeswalkerId, 1);
    expect(result.canActivate).toBe(true);
  });

  it('should deny activation when card is not a planeswalker', () => {
    // Create a creature instead
    const creatureData = createMockCard({
      id: 'test-creature',
      name: 'Test Creature',
      type_line: 'Creature — Human',
      oracle_text: '{T}: Draw a card.',
    });
    const creature = createCardInstance(creatureData, aliceId, aliceId);
    const creatureId = creature.id;
    state.cards.set(creatureId, creature);

    const result = canActivateLoyaltyAbility(state, aliceId, creatureId, 1);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('Card is not a planeswalker');
  });

  it('should deny activation when player does not control planeswalker', () => {
    state = { 
      ...state, 
      priorityPlayerId: bobId,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
    };
    
    const result = canActivateLoyaltyAbility(state, bobId, planeswalkerId, 1);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toBe('You do not control this planeswalker');
  });

  it('should deny activation when not main phase', () => {
    state = { 
      ...state, 
      priorityPlayerId: aliceId,
      turn: { ...state.turn, currentPhase: Phase.BEGIN_COMBAT },
    };
    
    const result = canActivateLoyaltyAbility(state, aliceId, planeswalkerId, 1);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toContain('main phases');
  });

  it('should deny activation when stack is not empty', () => {
    state = { 
      ...state, 
      priorityPlayerId: aliceId,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
      stack: [{ id: 'test-spell', type: 'spell', sourceCardId: 'test', controllerId: bobId, name: 'Test', text: '', manaCost: null, targets: [], chosenModes: [], variableValues: new Map(), isCountered: false, timestamp: Date.now() }],
    };
    
    const result = canActivateLoyaltyAbility(state, aliceId, planeswalkerId, 1);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toContain('Stack must be empty');
  });

  it('should deny activation when not enough loyalty counters', () => {
    state = { 
      ...state, 
      priorityPlayerId: aliceId,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
    };
    
    // Try to activate -4 ability with only 3 loyalty (should definitely fail)
    const result = canActivateLoyaltyAbility(state, aliceId, planeswalkerId, -4);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toContain('Not enough loyalty');
  });
});

describe('Abilities System - activateLoyaltyAbility', () => {
  let state: ReturnType<typeof createInitialGameState>;
  let aliceId: string;
  let planeswalkerId: string;

  beforeEach(() => {
    state = createInitialGameState(['Alice', 'Bob'], 20, false);
    state = startGame(state);
    
    const playerIds = Array.from(state.players.keys());
    aliceId = playerIds[0];

    // Create a planeswalker with loyalty counters
    const pwData = createMockCard({
      id: 'test-planeswalker-loyal',
      name: 'Test Planeswalker',
      type_line: 'Planeswalker — Jace',
      oracle_text: '+1: Draw a card.\n-3: Destroy target creature.',
    });
    const planeswalker = createCardInstance(pwData, aliceId, aliceId);
    planeswalker.counters = [{ type: 'loyalty', count: 3 }];
    planeswalkerId = planeswalker.id;
    state.cards.set(planeswalkerId, planeswalker);

    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, planeswalkerId],
    });

    state = { 
      ...state, 
      priorityPlayerId: aliceId,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
    };
  });

  it('should successfully activate loyalty ability', () => {
    const result = activateLoyaltyAbility(state, aliceId, planeswalkerId, 0);
    
    expect(result.success).toBe(true);
    expect(result.description).toContain('+1');
  });

  it('should update loyalty counters', () => {
    const result = activateLoyaltyAbility(state, aliceId, planeswalkerId, 0);
    
    const card = result.state.cards.get(planeswalkerId);
    const loyaltyCounter = card?.counters?.find(c => c.type === 'loyalty');
    expect(loyaltyCounter?.count).toBe(4); // 3 + 1
  });

  it('should fail when planeswalker not found', () => {
    const result = activateLoyaltyAbility(state, aliceId, 'non-existent', 0);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Card not found');
  });

  it('should fail when loyalty ability not found', () => {
    const result = activateLoyaltyAbility(state, aliceId, planeswalkerId, 99);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Loyalty ability not found');
  });
});
