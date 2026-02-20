/**
 * Comprehensive unit tests for Spell Casting System
 * Issue #323: Add comprehensive unit tests for game engine modules
 *
 * Tests spell casting including:
 * - Timing restrictions (sorcery vs instant speed)
 * - Mana cost payment
 * - Stack management
 * - Target validation
 * - Spell resolution
 */

import {
  canCastSpell,
  castSpell,
  resolveTopOfStack,
  canTarget,
  validateSpellTargets,
  createTargetingChoice,
  createModeChoice,
  createXValueChoice,
  getValidTargets,
} from '../spell-casting';
import {
  createInitialGameState,
  startGame,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import { Phase } from '../types';
import { addMana } from '../mana';
import type { ScryfallCard } from '@/app/actions';
import type { StackObject, Target } from '../types';

// Helper function to create a mock instant card
function createMockInstant(name: string, manaCost: string = '{1}{U}'): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Instant',
    keywords: [],
    oracle_text: 'Draw a card.',
    mana_cost: manaCost,
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock sorcery card
function createMockSorcery(name: string, manaCost: string = '{2}{R}'): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Sorcery',
    keywords: [],
    oracle_text: 'Deal 3 damage to any target.',
    mana_cost: manaCost,
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock creature card
function createMockCreature(name: string, power: number, toughness: number, keywords: string[] = []): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Creature — Test',
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(' '),
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock creature with flash
function createMockFlashCreature(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Creature — Test',
    power: '2',
    toughness: '2',
    keywords: ['Flash'],
    oracle_text: 'Flash',
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper to set up a game with a card in hand
function setupGameWithCardInHand(cardData: ScryfallCard) {
  let state = createInitialGameState(['Alice', 'Bob'], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];

  // Create the card and add to hand
  const card = createCardInstance(cardData, aliceId, aliceId);
  state.cards.set(card.id, card);

  const hand = state.zones.get(`${aliceId}-hand`)!;
  state.zones.set(`${aliceId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });

  // Add mana to cast
  state = addMana(state, aliceId, { blue: 2, red: 3, green: 2, generic: 5 });

  return { state, aliceId, bobId: playerIds[1], cardId: card.id };
}

describe('Spell Casting - Timing Restrictions', () => {
  describe('canCastSpell', () => {
    it('should allow casting instant at any time with priority', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(true);
    });

    it('should allow casting sorcery during main phase with empty stack on own turn', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockSorcery('Lightning Bolt'));
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(true);
    });

    it('should not allow casting sorcery during combat phase', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockSorcery('Lightning Bolt'));
      
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('main phase');
    });

    it('should not allow casting sorcery with non-empty stack', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockSorcery('Lightning Bolt'));
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [{ 
        id: 'other-spell', 
        type: 'spell',
        sourceCardId: null,
        controllerId: aliceId,
        name: 'Other Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      }] as StackObject[];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('Stack must be empty');
    });

    it('should not allow casting sorcery on opponent\'s turn', () => {
      const { state, aliceId, bobId, cardId } = setupGameWithCardInHand(createMockSorcery('Lightning Bolt'));
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.activePlayerId = bobId; // Bob's turn
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('your turn');
    });

    it('should allow casting creature with flash at instant speed', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockFlashCreature('Flash Creature'));
      
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [{ 
        id: 'other-spell', 
        type: 'spell',
        sourceCardId: null,
        controllerId: aliceId,
        name: 'Other Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      }] as StackObject[];

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(true);
    });

    it('should not allow casting without priority', () => {
      const { state, aliceId, bobId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = bobId; // Bob has priority

      const result = canCastSpell(state, aliceId, cardId);
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('priority');
    });

    it('should not allow casting card not in hand', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];
      
      // Create a card but don't add it to hand
      const cardData = createMockInstant('Counterspell');
      const card = createCardInstance(cardData, aliceId, aliceId);
      state.cards.set(card.id, card);

      state.priorityPlayerId = aliceId;

      const result = canCastSpell(state, aliceId, card.id);
      expect(result.canCast).toBe(false);
      expect(result.reason).toContain('not in hand');
    });
  });
});

describe('Spell Casting - Casting Process', () => {
  describe('castSpell', () => {
    it('should move card from hand to stack', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = castSpell(state, aliceId, cardId);
      
      expect(result.success).toBe(true);
      
      // Card should be on stack
      const stackZone = result.state.zones.get('stack')!;
      expect(stackZone.cardIds).toContain(cardId);
      
      // Card should not be in hand
      const hand = result.state.zones.get(`${aliceId}-hand`)!;
      expect(hand.cardIds).not.toContain(cardId);
    });

    it('should create a stack object for the spell', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = castSpell(state, aliceId, cardId);
      
      expect(result.success).toBe(true);
      expect(result.state.stack.length).toBe(1);
      
      const stackObject = result.state.stack[0];
      expect(stackObject.type).toBe('spell');
      expect(stackObject.controllerId).toBe(aliceId);
    });

    it('should spend mana when casting', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell', '{1}{U}'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const playerBefore = state.players.get(aliceId)!;
      const manaBefore = playerBefore.manaPool.blue + playerBefore.manaPool.generic;

      const result = castSpell(state, aliceId, cardId);
      
      expect(result.success).toBe(true);
      
      const playerAfter = result.state.players.get(aliceId)!;
      const manaAfter = playerAfter.manaPool.blue + playerAfter.manaPool.generic;
      
      // Should have spent 1 blue and 1 generic
      expect(manaBefore - manaAfter).toBeGreaterThanOrEqual(2);
    });

    it('should fail if not enough mana', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];
      
      // Create an expensive spell
      const cardData = createMockInstant('Expensive Spell', '{5}{U}{U}');
      const card = createCardInstance(cardData, aliceId, aliceId);
      state.cards.set(card.id, card);

      const hand = state.zones.get(`${aliceId}-hand`)!;
      state.zones.set(`${aliceId}-hand`, {
        ...hand,
        cardIds: [...hand.cardIds, card.id],
      });

      // Add only a little mana
      state = addMana(state, aliceId, { blue: 1 });
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = castSpell(state, aliceId, card.id);
      
      expect(result.success).toBe(false);
    });

    it('should pass priority after casting', () => {
      const { state, aliceId, bobId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = castSpell(state, aliceId, cardId);
      
      expect(result.success).toBe(true);
      // Priority should pass to next player
      expect(result.state.priorityPlayerId).toBe(bobId);
    });

    it('should handle X spells correctly', () => {
      const xSpell: ScryfallCard = {
        id: 'mock-x-spell',
        name: 'Fireball',
        type_line: 'Sorcery',
        keywords: [],
        oracle_text: 'Fireball deals X damage to any target.',
        mana_cost: '{X}{R}',
        cmc: 1,
        colors: ['R'],
        color_identity: ['R'],
        card_faces: undefined,
        layout: 'normal',
      } as ScryfallCard;

      const { state, aliceId, cardId } = setupGameWithCardInHand(xSpell);
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const result = castSpell(state, aliceId, cardId, [], [], 5);
      
      expect(result.success).toBe(true);
      
      const stackObject = result.state.stack[0];
      expect(stackObject.variableValues?.get('X')).toBe(5);
    });
  });
});

describe('Spell Casting - Stack Resolution', () => {
  describe('resolveTopOfStack', () => {
    it('should move instant to graveyard after resolution', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockInstant('Counterspell'));
      
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const castResult = castSpell(state, aliceId, cardId);
      const stateWithStack = castResult.state;
      
      // Resolve the spell
      const result = resolveTopOfStack(stateWithStack);
      
      // Stack should be empty
      expect(result.stack.length).toBe(0);
      
      // Card should be in graveyard
      const graveyard = result.zones.get(`${aliceId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(cardId);
    });

    it('should move creature to battlefield after resolution', () => {
      const { state, aliceId, cardId } = setupGameWithCardInHand(createMockCreature('Grizzly Bears', 2, 2));
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.turn.activePlayerId = aliceId;
      state.priorityPlayerId = aliceId;
      state.stack = [];

      const castResult = castSpell(state, aliceId, cardId);
      const stateWithStack = castResult.state;
      
      // Resolve the spell
      const result = resolveTopOfStack(stateWithStack);
      
      // Stack should be empty
      expect(result.stack.length).toBe(0);
      
      // Card should be on battlefield
      const battlefield = result.zones.get(`${aliceId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(cardId);
    });

    it('should handle empty stack gracefully', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      state.stack = [];
      
      const result = resolveTopOfStack(state);
      
      // Should return unchanged state
      expect(result.stack.length).toBe(0);
    });

    it('should resolve spells in LIFO order', () => {
      const setup = setupGameWithCardInHand(createMockInstant('Spell 1'));
      let state = setup.state;
      const aliceId = setup.aliceId;
      
      // Add two spells to hand
      const spell1Data = createMockInstant('Spell 1');
      const spell1 = createCardInstance(spell1Data, aliceId, aliceId);
      state.cards.set(spell1.id, spell1);
      
      const spell2Data = createMockInstant('Spell 2');
      const spell2 = createCardInstance(spell2Data, aliceId, aliceId);
      state.cards.set(spell2.id, spell2);
      
      const hand = state.zones.get(`${aliceId}-hand`)!;
      state.zones.set(`${aliceId}-hand`, {
        ...hand,
        cardIds: [...hand.cardIds, spell1.id, spell2.id],
      });
      
      state = addMana(state, aliceId, { blue: 4 });
      state.priorityPlayerId = aliceId;
      state.stack = [];

      // Cast both spells
      const result1 = castSpell(state, aliceId, spell1.id);
      // Pass priority back to cast second (simulating response)
      result1.state.priorityPlayerId = aliceId;
      const result2 = castSpell(result1.state, aliceId, spell2.id);
      
      expect(result2.state.stack.length).toBe(2);
      
      // Resolve top (spell 2)
      const afterFirstResolve = resolveTopOfStack(result2.state);
      expect(afterFirstResolve.stack.length).toBe(1);
      
      // The remaining spell should be spell 1
      const graveyard = afterFirstResolve.zones.get(`${aliceId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(spell2.id);
      expect(graveyard.cardIds).not.toContain(spell1.id);
    });
  });
});

describe('Spell Casting - Targeting', () => {
  describe('canTarget', () => {
    it('should allow targeting a card on the battlefield', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Create a creature on battlefield
      const creatureData = createMockCreature('Target Creature', 2, 2);
      const creature = createCardInstance(creatureData, aliceId, aliceId);
      state.cards.set(creature.id, creature);
      
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      const result = canTarget('card', creature.id, state, aliceId);
      expect(result).toBe(true);
    });

    it('should allow targeting a player', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      const result = canTarget('player', bobId, state, aliceId);
      expect(result).toBe(true);
    });

    it('should allow targeting a spell on the stack', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Add a spell to the stack
      const stackObject: StackObject = {
        id: 'stack-spell-1',
        type: 'spell',
        sourceCardId: 'some-card',
        controllerId: aliceId,
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };
      state.stack = [stackObject];

      const result = canTarget('stack', 'stack-spell-1', state, aliceId);
      expect(result).toBe(true);
    });

    it('should not allow targeting non-existent card', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];

      const result = canTarget('card', 'non-existent-card', state, aliceId);
      expect(result).toBe(false);
    });

    it('should not allow targeting non-existent player', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];

      const result = canTarget('player', 'non-existent-player', state, aliceId);
      expect(result).toBe(false);
    });
  });

  describe('validateSpellTargets', () => {
    it('should return true for spell with no targets required', () => {
      const stackObject: StackObject = {
        id: 'test-spell',
        type: 'spell',
        sourceCardId: 'card-1',
        controllerId: 'player-1',
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };

      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const result = validateSpellTargets(stackObject, state);
      expect(result).toBe(true);
    });

    it('should return true for spell with valid targets', () => {
      const target: Target = {
        type: 'player',
        targetId: 'player-1',
        isValid: true,
      };

      const stackObject: StackObject = {
        id: 'test-spell',
        type: 'spell',
        sourceCardId: 'card-1',
        controllerId: 'player-1',
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [target],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };

      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const result = validateSpellTargets(stackObject, state);
      expect(result).toBe(true);
    });

    it('should return false for spell with invalid targets', () => {
      const target: Target = {
        type: 'player',
        targetId: 'player-1',
        isValid: false,
      };

      const stackObject: StackObject = {
        id: 'test-spell',
        type: 'spell',
        sourceCardId: 'card-1',
        controllerId: 'player-1',
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [target],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };

      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const result = validateSpellTargets(stackObject, state);
      expect(result).toBe(false);
    });
  });

  describe('createTargetingChoice', () => {
    it('should create a targeting choice for a player', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];

      const validTargets = [
        { label: 'Target 1', value: 'target-1', isValid: true },
        { label: 'Target 2', value: 'target-2', isValid: true },
      ];

      const choice = createTargetingChoice(
        state,
        aliceId,
        'stack-1',
        'Test Spell',
        'card',
        validTargets
      );

      expect(choice.type).toBe('choose_targets');
      expect(choice.playerId).toBe(aliceId);
      expect(choice.choices).toHaveLength(2);
      expect(choice.minChoices).toBe(1);
      expect(choice.maxChoices).toBe(1);
    });
  });

  describe('createModeChoice', () => {
    it('should create a mode choice for modal spells', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];

      const modes = ['Deal 3 damage', 'Draw a card', 'Gain 3 life'];

      const choice = createModeChoice(
        state,
        aliceId,
        'stack-1',
        'Modal Spell',
        modes
      );

      expect(choice.type).toBe('choose_mode');
      expect(choice.playerId).toBe(aliceId);
      expect(choice.choices).toHaveLength(3);
    });
  });

  describe('createXValueChoice', () => {
    it('should create an X value choice for X spells', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const aliceId = Array.from(state.players.keys())[0];

      const choice = createXValueChoice(
        state,
        aliceId,
        'stack-1',
        'Fireball',
        10
      );

      expect(choice.type).toBe('choose_value');
      expect(choice.playerId).toBe(aliceId);
      expect(choice.choices).toHaveLength(11); // 0 through 10
    });
  });

  describe('getValidTargets', () => {
    it('should return empty array (stub implementation)', () => {
      // Note: getValidTargets is currently a stub that returns an empty array
      // A full implementation would parse spell text to determine valid targets
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Add a stack object
      const stackObject: StackObject = {
        id: 'stack-1',
        type: 'spell',
        sourceCardId: 'card-1',
        controllerId: aliceId,
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };
      state.stack = [stackObject];

      const targets = getValidTargets('stack-1', state, aliceId);
      
      // Currently returns empty array (stub implementation)
      expect(targets.length).toBe(0);
    });
  });
});

describe('Spell Casting - Edge Cases', () => {
  it('should handle casting spell with empty mana pool', () => {
    let state = createInitialGameState(['Alice'], 20, false);
    state = startGame(state);

    const aliceId = Array.from(state.players.keys())[0];
    
    // Create a spell
    const cardData = createMockInstant('Counterspell', '{1}{U}');
    const card = createCardInstance(cardData, aliceId, aliceId);
    state.cards.set(card.id, card);

    const hand = state.zones.get(`${aliceId}-hand`)!;
    state.zones.set(`${aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, card.id],
    });

    // Don't add any mana
    state.priorityPlayerId = aliceId;
    state.stack = [];

    const result = castSpell(state, aliceId, card.id);
    
    expect(result.success).toBe(false);
  });

  it('should handle multiple spells on stack resolving correctly', () => {
    const setup = setupGameWithCardInHand(createMockInstant('Spell'));
    let state = setup.state;
    const aliceId = setup.aliceId;
    
    // Create multiple spells
    const spell1Data = createMockInstant('Spell 1');
    const spell1 = createCardInstance(spell1Data, aliceId, aliceId);
    state.cards.set(spell1.id, spell1);
    
    const spell2Data = createMockInstant('Spell 2');
    const spell2 = createCardInstance(spell2Data, aliceId, aliceId);
    state.cards.set(spell2.id, spell2);
    
    const hand = state.zones.get(`${aliceId}-hand`)!;
    state.zones.set(`${aliceId}-hand`, {
      ...hand,
      cardIds: [...hand.cardIds, spell1.id, spell2.id],
    });
    
    state = addMana(state, aliceId, { blue: 6 });
    state.priorityPlayerId = aliceId;
    state.stack = [];

    // Cast both spells
    let result = castSpell(state, aliceId, spell1.id);
    result.state.priorityPlayerId = aliceId;
    result = castSpell(result.state, aliceId, spell2.id);
    
    // Resolve all
    while (result.state.stack.length > 0) {
      result.state = resolveTopOfStack(result.state);
    }
    
    // Both should be in graveyard
    const graveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
    expect(graveyard.cardIds).toContain(spell1.id);
    expect(graveyard.cardIds).toContain(spell2.id);
  });

  it('should handle flash creatures correctly during combat', () => {
    const { state, aliceId, cardId } = setupGameWithCardInHand(createMockFlashCreature('Ambush Viper'));
    
    state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
    state.turn.activePlayerId = aliceId;
    state.priorityPlayerId = aliceId;
    state.stack = [];

    const result = canCastSpell(state, aliceId, cardId);
    expect(result.canCast).toBe(true);
  });
});