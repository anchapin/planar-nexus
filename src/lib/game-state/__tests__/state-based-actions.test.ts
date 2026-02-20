/**
 * Unit tests for State-Based Actions System
 * Issue #250: Phase 1.3: Handle state-based actions
 * 
 * Tests the implementation of MTG state-based actions (SBAs) as defined in Comprehensive Rules 704.
 */

import {
  checkStateBasedActions,
  canDraw,
  drawWithSBAChecking,
} from '../state-based-actions';
import {
  createInitialGameState,
  startGame,
  dealDamageToPlayer,
} from '../game-state';
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from '../card-instance';
import { dealDamageToCard } from '../keyword-actions';
import type { ScryfallCard } from '@/app/actions';

// Helper function to create a mock creature card
function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
  isLegendary: boolean = false
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: `${isLegendary ? 'Legendary ' : ''}Creature — Test`,
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(' '),
    mana_cost: '{1}',
    cmc: 2,
    colors: ['R'],
    color_identity: ['R'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock planeswalker card
function createMockPlaneswalker(
  name: string,
  loyalty: number,
  isLegendary: boolean = true
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: `${isLegendary ? 'Legendary ' : ''}Planeswalker — Test`,
    loyalty: loyalty.toString(),
    keywords: [],
    oracle_text: '',
    mana_cost: '{3}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock aura card
function createMockAura(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Enchantment — Aura',
    keywords: [],
    oracle_text: 'Enchant creature',
    mana_cost: '{1}{W}',
    cmc: 2,
    colors: ['W'],
    color_identity: ['W'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock equipment card
function createMockEquipment(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Artifact — Equipment',
    keywords: [],
    oracle_text: 'Equipped creature gets +1/+1',
    mana_cost: '{2}',
    cmc: 2,
    colors: [],
    color_identity: [],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

describe('State-Based Actions', () => {
  describe('Player Life Total (SBA 704.5a)', () => {
    it('should make a player lose when life reaches 0', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      // Deal lethal damage to Alice
      state = dealDamageToPlayer(state, Array.from(state.players.keys())[0], 20);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const alice = result.state.players.get(Array.from(state.players.keys())[0]);
      expect(alice?.hasLost).toBe(true);
      expect(alice?.lossReason).toBe('Life total reached 0 or less');
    });

    it('should make a player lose when life is less than 0', () => {
      let state = createInitialGameState(['Alice'], 5, false);
      state = startGame(state);

      // Deal more damage than life
      state = dealDamageToPlayer(state, Array.from(state.players.keys())[0], 10);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const alice = result.state.players.get(Array.from(state.players.keys())[0]);
      expect(alice?.hasLost).toBe(true);
    });

    it('should not make a player lose when life is above 0', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      // Deal non-lethal damage to Alice
      state = dealDamageToPlayer(state, playerIds[0], 15);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const alice = result.state.players.get(playerIds[0]);
      expect(alice?.hasLost).toBe(false);
    });
  });

  describe('Poison Counters (SBA 704.5b)', () => {
    it('should make a player lose with 10 or more poison counters', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const alice = state.players.get(playerIds[0])!;

      // Give Alice 10 poison counters
      state.players.set(playerIds[0], {
        ...alice,
        poisonCounters: 10,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const updatedAlice = result.state.players.get(playerIds[0]);
      expect(updatedAlice?.hasLost).toBe(true);
      expect(updatedAlice?.lossReason).toBe('Accumulated 10 or more poison counters');
    });

    it('should not make a player lose with less than 10 poison counters', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const alice = state.players.get(playerIds[0])!;

      // Give Alice 9 poison counters
      state.players.set(playerIds[0], {
        ...alice,
        poisonCounters: 9,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const updatedAlice = result.state.players.get(playerIds[0]);
      expect(updatedAlice?.hasLost).toBe(false);
    });
  });

  describe('Creature with Lethal Damage (SBA 704.5f)', () => {
    it('should destroy a creature with damage >= toughness', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Add creature to battlefield
      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      // Deal lethal damage
      const damageResult = dealDamageToCard(state, creature.id, 3, true);
      state = damageResult.state;

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      // Creature should be in graveyard
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creature.id);
    });

    it('should destroy a creature with more damage than toughness', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 2, 2);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      // Deal more than lethal damage
      const damageResult = dealDamageToCard(state, creature.id, 5, true);
      state = damageResult.state;

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creature.id);
    });

    it('should not destroy a creature with non-lethal damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      // Deal non-lethal damage
      const damageResult = dealDamageToCard(state, creature.id, 2, true);
      state = damageResult.state;

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      expect(battlefieldAfter.cardIds).toContain(creature.id);
    });
  });

  describe('Creature with Toughness 0 or Less (SBA 704.5g)', () => {
    it('should destroy a creature with toughness 0', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Apply toughness modifier to make toughness 0
      creature.toughnessModifier = -3;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creature.id);
    });

    it('should destroy a creature with negative toughness', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Apply toughness modifier to make toughness negative
      creature.toughnessModifier = -5;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creature.id);
    });
  });

  describe('Planeswalker with 0 Loyalty (SBA 704.5i)', () => {
    it('should exile a planeswalker with 0 loyalty', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const pwData = createMockPlaneswalker('Test Planeswalker', 3);
      const planeswalker = createCardInstance(pwData, playerIds[0], playerIds[0]);

      // Set loyalty to 0
      planeswalker.counters = [{ type: 'loyalty', count: 0 }];

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(planeswalker.id, planeswalker);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalker.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const exile = result.state.zones.get(`${playerIds[0]}-exile`)!;
      expect(exile.cardIds).toContain(planeswalker.id);
    });

    it('should not exile a planeswalker with loyalty > 0', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const pwData = createMockPlaneswalker('Test Planeswalker', 3);
      const planeswalker = createCardInstance(pwData, playerIds[0], playerIds[0]);

      // Set loyalty to 1
      planeswalker.counters = [{ type: 'loyalty', count: 1 }];

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(planeswalker.id, planeswalker);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, planeswalker.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      expect(battlefieldAfter.cardIds).toContain(planeswalker.id);
    });
  });

  describe('Aura attached to illegal object (SBA 704.5m)', () => {
    it('should destroy an Aura when its enchanted creature leaves the battlefield', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create creature and aura
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);
      const auraData = createMockAura('Test Aura');
      const aura = createCardInstance(auraData, playerIds[0], playerIds[0]);

      // Attach aura to creature
      aura.attachedToId = creature.id;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.cards.set(aura.id, aura);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, creature.id, aura.id],
      });

      // Remove creature from battlefield (simulate it leaving)
      const updatedBattlefield = {
        ...battlefield,
        cardIds: [aura.id], // Only aura remains
      };
      state.zones.set(`${playerIds[0]}-battlefield`, updatedBattlefield);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      // Aura should be destroyed
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(aura.id);
    });
  });

  describe('Equipment attached to non-creature (SBA 704.5n)', () => {
    it('should destroy Equipment when attached to non-creature permanent', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create land and equipment
      const landData = createMockCreature('Test Land', 0, 0);
      landData.type_line = 'Land';
      const land = createCardInstance(landData, playerIds[0], playerIds[0]);
      const equipData = createMockEquipment('Test Equipment');
      const equipment = createCardInstance(equipData, playerIds[0], playerIds[0]);

      // Attach equipment to land (illegal)
      equipment.attachedToId = land.id;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(land.id, land);
      state.cards.set(equipment.id, equipment);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, land.id, equipment.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(equipment.id);
    });
  });

  describe('+1/+1 and -1/-1 Counter Cancellation (SBA 704.5q)', () => {
    it('should remove equal number of +1/+1 and -1/-1 counters', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Add both types of counters
      creature.counters = [
        { type: '+1/+1', count: 3 },
        { type: '-1/-1', count: 2 }
      ];

      // Add creature to battlefield
      const battlefieldKey = `${playerIds[0]}-battlefield`;
      const battlefield = state.zones.get(battlefieldKey)!;
      state.cards.set(creature.id, creature);
      state = {
        ...state,
        zones: new Map(state.zones).set(battlefieldKey, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, creature.id],
        }),
      };

      const result = checkStateBasedActions(state);

      const updatedCreature = result.state.cards.get(creature.id)!;
      const plusOneCounters = updatedCreature.counters.find(c => c.type === '+1/+1');
      const minusOneCounters = updatedCreature.counters.find(c => c.type === '-1/-1');

      // Should remove 2 of each (the smaller count)
      expect(plusOneCounters?.count).toBe(1);
      expect(minusOneCounters).toBeUndefined();
      expect(result.actionsPerformed).toBe(true);
    });

    it('should remove all counters when counts are equal', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Add equal counters
      creature.counters = [
        { type: '+1/+1', count: 2 },
        { type: '-1/-1', count: 2 }
      ];

      const battlefieldKey = `${playerIds[0]}-battlefield`;
      const battlefield = state.zones.get(battlefieldKey)!;
      state.cards.set(creature.id, creature);
      state = {
        ...state,
        zones: new Map(state.zones).set(battlefieldKey, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, creature.id],
        }),
      };

      const result = checkStateBasedActions(state);

      const updatedCreature = result.state.cards.get(creature.id)!;
      // All counters should be removed
      expect(updatedCreature.counters.length).toBe(0);
    });

    it('should not remove counters when only one type is present', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Add only +1/+1 counters
      creature.counters = [{ type: '+1/+1', count: 3 }];

      const battlefieldKey = `${playerIds[0]}-battlefield`;
      const battlefield = state.zones.get(battlefieldKey)!;
      state.cards.set(creature.id, creature);
      state = {
        ...state,
        zones: new Map(state.zones).set(battlefieldKey, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, creature.id],
        }),
      };

      const result = checkStateBasedActions(state);

      const updatedCreature = result.state.cards.get(creature.id)!;
      const plusOneCounters = updatedCreature.counters.find(c => c.type === '+1/+1');
      // Counters should remain unchanged (no cancellation when only one type present)
      expect(plusOneCounters?.count).toBe(3);
      // Note: actionsPerformed might be true due to other SBAs being checked
      // The important thing is that counters were not modified
    });

    it('should handle multiple counter types correctly', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);

      // Add multiple counter types
      creature.counters = [
        { type: '+1/+1', count: 2 },
        { type: '-1/-1', count: 1 },
        { type: 'charge', count: 3 }
      ];

      const battlefieldKey = `${playerIds[0]}-battlefield`;
      const battlefield = state.zones.get(battlefieldKey)!;
      state.cards.set(creature.id, creature);
      state = {
        ...state,
        zones: new Map(state.zones).set(battlefieldKey, {
          ...battlefield,
          cardIds: [...battlefield.cardIds, creature.id],
        }),
      };

      const result = checkStateBasedActions(state);

      const updatedCreature = result.state.cards.get(creature.id)!;
      const plusOneCounters = updatedCreature.counters.find(c => c.type === '+1/+1');
      const minusOneCounters = updatedCreature.counters.find(c => c.type === '-1/-1');
      const chargeCounters = updatedCreature.counters.find(c => c.type === 'charge');

      // Only +1/+1 and -1/-1 should be affected
      expect(plusOneCounters?.count).toBe(1);
      expect(minusOneCounters).toBeUndefined();
      expect(chargeCounters?.count).toBe(3);
    });
  });

  describe('Legendary Rule (SBA 704.5j)', () => {
    it('should destroy duplicate legendary permanents with the same name', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create two legendary creatures with the same name
      const legendData = createMockCreature('Legendary Creature', 3, 3, [], true);
      const legend1 = createCardInstance(legendData, playerIds[0], playerIds[0]);
      const legend2 = createCardInstance(legendData, playerIds[0], playerIds[0]);

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(legend1.id, legend1);
      state.cards.set(legend2.id, legend2);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, legend1.id, legend2.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;

      // One should remain, one should be destroyed
      expect(battlefieldAfter.cardIds.length).toBe(1);
      expect(graveyard.cardIds.length).toBe(1);
    });

    it('should not destroy unique legendary permanents', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create one legendary creature
      const legendData = createMockCreature('Legendary Creature', 3, 3, [], true);
      const legend = createCardInstance(legendData, playerIds[0], playerIds[0]);

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(legend.id, legend);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, legend.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      expect(battlefieldAfter.cardIds).toContain(legend.id);
    });
  });

  describe('World Rule (SBA 704.5k)', () => {
    it('should destroy older world permanents when a newer one enters', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create two world enchantments with the same name
      const worldData = createMockCreature('World Enchantment', 0, 0);
      worldData.type_line = 'Enchantment — World';
      const world1 = createCardInstance(worldData, playerIds[0], playerIds[0]);
      const world2 = createCardInstance(worldData, playerIds[0], playerIds[0]);

      // Make world2 newer
      world2.enteredBattlefieldTimestamp = Date.now() + 1000;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(world1.id, world1);
      state.cards.set(world2.id, world2);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, world1.id, world2.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;

      // Newer one should remain, older one should be destroyed
      expect(battlefieldAfter.cardIds).toContain(world2.id);
      expect(graveyard.cardIds).toContain(world1.id);
    });
  });

  describe('Planeswalker Uniqueness Rule', () => {
    it('should destroy duplicate planeswalkers of the same type', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create two Jace planeswalkers with the same type
      const jaceData1 = createMockPlaneswalker('Jace1', 3);
      jaceData1.type_line = 'Legendary Planeswalker - Jace';
      const jace1 = createCardInstance(jaceData1, playerIds[0], playerIds[0]);
      // Initialize loyalty counters
      jace1.counters = [{ type: 'loyalty', count: 3 }];

      const jaceData2 = createMockPlaneswalker('Jace2', 3);
      jaceData2.type_line = 'Legendary Planeswalker - Jace';
      const jace2 = createCardInstance(jaceData2, playerIds[0], playerIds[0]);
      // Initialize loyalty counters
      jace2.counters = [{ type: 'loyalty', count: 3 }];

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(jace1.id, jace1);
      state.cards.set(jace2.id, jace2);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, jace1.id, jace2.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;

      // One should remain, one should be destroyed
      // Filter to only count the jace planeswalkers
      const jaceOnBattlefield = battlefieldAfter.cardIds.filter(id =>
        id === jace1.id || id === jace2.id
      );
      const jaceInGraveyard = graveyard.cardIds.filter(id =>
        id === jace1.id || id === jace2.id
      );
      expect(jaceOnBattlefield.length).toBe(1);
      expect(jaceInGraveyard.length).toBe(1);
    });
  });

  describe('Win Condition Checking', () => {
    it('should end the game when only one player remains', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Make Bob lose
      const bob = state.players.get(playerIds[1])!;
      state.players.set(playerIds[1], {
        ...bob,
        hasLost: true,
        lossReason: 'Test loss',
      });

      const result = checkStateBasedActions(state);

      expect(result.state.status).toBe('completed');
      expect(result.state.winners).toContain(playerIds[0]);
    });

    it('should end the game as a draw when all players lose', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Make both players lose
      const alice = state.players.get(playerIds[0])!;
      const bob = state.players.get(playerIds[1])!;
      state.players.set(playerIds[0], {
        ...alice,
        hasLost: true,
        lossReason: 'Test loss',
      });
      state.players.set(playerIds[1], {
        ...bob,
        hasLost: true,
        lossReason: 'Test loss',
      });

      const result = checkStateBasedActions(state);

      expect(result.state.status).toBe('completed');
      expect(result.state.winners).toHaveLength(0);
      expect(result.state.endReason).toBe('All players lost the game simultaneously');
    });
  });

  describe('canDraw', () => {
    it('should return true when library has cards', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      // Check that library has cards after startGame draws starting hand
      const library = state.zones.get(`${playerIds[0]}-library`);
      expect(library).toBeDefined();
      expect(canDraw(state, playerIds[0])).toBe(library!.cardIds.length > 0);
    });

    it('should return false when library is empty', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const library = state.zones.get(`${playerIds[0]}-library`)!;
      state.zones.set(`${playerIds[0]}-library`, {
        ...library,
        cardIds: [],
      });

      expect(canDraw(state, playerIds[0])).toBe(false);
    });
  });

  describe('drawWithSBAChecking', () => {
    it('should allow drawing when library has cards', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      // Ensure library has cards
      const library = state.zones.get(`${playerIds[0]}-library`)!;
      if (library.cardIds.length === 0) {
        // Add a mock card to the library
        const mockCard = createMockCreature('Test', 1, 1);
        const cardInstance = createCardInstance(mockCard, playerIds[0], playerIds[0]);
        state.cards.set(cardInstance.id, cardInstance);
        state.zones.set(`${playerIds[0]}-library`, {
          ...library,
          cardIds: [cardInstance.id],
        });
      }

      const result = drawWithSBAChecking(state, playerIds[0]);

      expect(result.success).toBe(true);
      expect(result.description).toBe('Draw available');
    });

    it('should make player lose when trying to draw from empty library', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const library = state.zones.get(`${playerIds[0]}-library`)!;
      state.zones.set(`${playerIds[0]}-library`, {
        ...library,
        cardIds: [],
      });

      const result = drawWithSBAChecking(state, playerIds[0]);

      expect(result.success).toBe(false);
      expect(result.description).toContain('loses');
      expect(result.description).toContain('empty library');

      const player = result.state.players.get(playerIds[0]);
      expect(player?.hasLost).toBe(true);
      expect(player?.lossReason).toBe('Attempted to draw from empty library');
    });
  });

  describe('Commander Damage (CR 903.10a)', () => {
    it('should make a player lose with 21 or more commander damage from same commander', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Create a commander (legendary creature)
      const commanderData = createMockCreature('Commander', 4, 4, [], true);
      const commander = createCardInstance(commanderData, bobId, bobId);

      // Add commander to Bob's battlefield
      const battlefield = state.zones.get(`${bobId}-battlefield`)!;
      state.cards.set(commander.id, commander);
      state.zones.set(`${bobId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, commander.id],
      });

      // Give Alice 21 commander damage from this commander
      const alice = state.players.get(aliceId)!;
      const updatedCommanderDamage = new Map(alice.commanderDamage);
      updatedCommanderDamage.set(commander.id, 21);
      state.players.set(aliceId, {
        ...alice,
        commanderDamage: updatedCommanderDamage,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const updatedAlice = result.state.players.get(aliceId);
      expect(updatedAlice?.hasLost).toBe(true);
      expect(updatedAlice?.lossReason).toContain('commander damage');
    });

    it('should not make a player lose with less than 21 commander damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Give Alice 20 commander damage
      const alice = state.players.get(aliceId)!;
      const updatedCommanderDamage = new Map(alice.commanderDamage);
      updatedCommanderDamage.set('commander-1', 20);
      state.players.set(aliceId, {
        ...alice,
        commanderDamage: updatedCommanderDamage,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const updatedAlice = result.state.players.get(aliceId);
      expect(updatedAlice?.hasLost).toBe(false);
    });

    it('should handle multiple commanders dealing damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Give Alice 20 damage from commander 1 and 21 from commander 2
      const alice = state.players.get(aliceId)!;
      const updatedCommanderDamage = new Map(alice.commanderDamage);
      updatedCommanderDamage.set('commander-1', 20);
      updatedCommanderDamage.set('commander-2', 21);
      state.players.set(aliceId, {
        ...alice,
        commanderDamage: updatedCommanderDamage,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const updatedAlice = result.state.players.get(aliceId);
      expect(updatedAlice?.hasLost).toBe(true);
      expect(updatedAlice?.lossReason).toContain('commander damage');
    });
  });

  describe('Combat Damage Integration', () => {
    it('should destroy creatures with lethal damage after combat', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Create creatures for both players
      const aliceCreatureData = createMockCreature('Alice Creature', 3, 3);
      const aliceCreature = createCardInstance(aliceCreatureData, aliceId, aliceId);
      const bobCreatureData = createMockCreature('Bob Creature', 3, 3);
      const bobCreature = createCardInstance(bobCreatureData, bobId, bobId);

      // Add creatures to battlefields
      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      state.cards.set(aliceCreature.id, aliceCreature);
      state.cards.set(bobCreature.id, bobCreature);
      state.zones.set(`${aliceId}-battlefield`, {
        ...aliceBattlefield,
        cardIds: [aliceCreature.id],
      });
      state.zones.set(`${bobId}-battlefield`, {
        ...bobBattlefield,
        cardIds: [bobCreature.id],
      });

      // Deal combat damage to both creatures
      state = dealDamageToCard(state, aliceCreature.id, 3, true).state;
      state = dealDamageToCard(state, bobCreature.id, 3, true).state;

      // Check SBAs - both creatures should be destroyed
      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const aliceGraveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(aliceGraveyard.cardIds).toContain(aliceCreature.id);
      expect(bobGraveyard.cardIds).toContain(bobCreature.id);
    });

    it('should handle deathtouch lethal damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Create a creature with deathtouch
      const deathtouchCreatureData = createMockCreature('Deathtouch Creature', 1, 1, ['Deathtouch']);
      const deathtouchCreature = createCardInstance(deathtouchCreatureData, aliceId, aliceId);

      // Create a larger creature
      const bigCreatureData = createMockCreature('Big Creature', 5, 5);
      const bigCreature = createCardInstance(bigCreatureData, aliceId, aliceId);

      // Add creatures to battlefield
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.cards.set(deathtouchCreature.id, deathtouchCreature);
      state.cards.set(bigCreature.id, bigCreature);
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [deathtouchCreature.id, bigCreature.id],
      });

      // Deal 1 damage from deathtouch creature to big creature
      state = dealDamageToCard(state, bigCreature.id, 1, true, deathtouchCreature.id).state;

      // Check SBAs - big creature should be destroyed due to deathtouch
      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(bigCreature.id);
    });
  });

  describe('Planeswalker Loyalty Initialization', () => {
    it('should initialize planeswalker with loyalty counters', () => {
      const pwData = createMockPlaneswalker('Test Planeswalker', 4);
      const planeswalker = createCardInstance(pwData, 'player1', 'player1');

      // Initialize loyalty
      const initialized = initializePlaneswalkerLoyalty(planeswalker);

      const loyaltyCounter = initialized.counters?.find(c => c.type === 'loyalty');
      expect(loyaltyCounter).toBeDefined();
      expect(loyaltyCounter?.count).toBe(4);
    });

    it('should not modify non-planeswalker cards', () => {
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, 'player1', 'player1');

      const result = initializePlaneswalkerLoyalty(creature);

      expect(result).toBe(creature);
      expect(result.counters).toEqual([]);
    });

    it('should handle planeswalkers without loyalty field', () => {
      const pwData = createMockPlaneswalker('Test Planeswalker', 0);
      // Delete the loyalty property to simulate a planeswalker without loyalty
      delete (pwData as Partial<ScryfallCard>).loyalty;
      const planeswalker = createCardInstance(pwData, 'player1', 'player1');

      const result = initializePlaneswalkerLoyalty(planeswalker);

      expect(result.counters).toEqual([]);
    });
  });

  describe('Equipment and Aura Attachment Rules', () => {
    it('should destroy Equipment when attached creature leaves battlefield', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create creature and equipment
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);
      const equipData = createMockEquipment('Test Equipment');
      const equipment = createCardInstance(equipData, playerIds[0], playerIds[0]);

      // Attach equipment to creature
      equipment.attachedToId = creature.id;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.cards.set(equipment.id, equipment);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [creature.id, equipment.id],
      });

      // Remove creature from battlefield (simulate it leaving)
      const updatedBattlefield = {
        ...battlefield,
        cardIds: [equipment.id], // Only equipment remains
      };
      state.zones.set(`${playerIds[0]}-battlefield`, updatedBattlefield);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      // Equipment should be destroyed
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      expect(graveyard.cardIds).toContain(equipment.id);
    });

    it('should not destroy Equipment attached to a creature', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create creature and equipment
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, playerIds[0], playerIds[0]);
      const equipData = createMockEquipment('Test Equipment');
      const equipment = createCardInstance(equipData, playerIds[0], playerIds[0]);

      // Attach equipment to creature
      equipment.attachedToId = creature.id;

      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      state.cards.set(creature.id, creature);
      state.cards.set(equipment.id, equipment);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [creature.id, equipment.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(false);
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;
      expect(battlefieldAfter.cardIds).toContain(equipment.id);
    });
  });

  describe('Multiple SBA Simultaneous Resolution', () => {
    it('should handle multiple creatures dying simultaneously', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());

      // Create multiple creatures
      const creature1Data = createMockCreature('Creature 1', 2, 2);
      const creature1 = createCardInstance(creature1Data, playerIds[0], playerIds[0]);
      const creature2Data = createMockCreature('Creature 2', 3, 3);
      const creature2 = createCardInstance(creature2Data, playerIds[0], playerIds[0]);
      const creature3Data = createMockCreature('Creature 3', 4, 4);
      const creature3 = createCardInstance(creature3Data, playerIds[0], playerIds[0]);

      // Add creatures to battlefield with lethal damage
      const battlefield = state.zones.get(`${playerIds[0]}-battlefield`)!;
      creature1.damage = 2;
      creature2.damage = 3;
      creature3.damage = 1; // Not lethal

      state.cards.set(creature1.id, creature1);
      state.cards.set(creature2.id, creature2);
      state.cards.set(creature3.id, creature3);
      state.zones.set(`${playerIds[0]}-battlefield`, {
        ...battlefield,
        cardIds: [creature1.id, creature2.id, creature3.id],
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const graveyard = result.state.zones.get(`${playerIds[0]}-graveyard`)!;
      const battlefieldAfter = result.state.zones.get(`${playerIds[0]}-battlefield`)!;

      // Creatures 1 and 2 should be destroyed, creature 3 should remain
      expect(graveyard.cardIds).toContain(creature1.id);
      expect(graveyard.cardIds).toContain(creature2.id);
      expect(battlefieldAfter.cardIds).toContain(creature3.id);
    });

    it('should handle player loss and creature death simultaneously', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];

      // Create a creature for Alice
      const creatureData = createMockCreature('Test Creature', 3, 3);
      const creature = createCardInstance(creatureData, aliceId, aliceId);

      // Add creature to battlefield with lethal damage
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      creature.damage = 3;
      state.cards.set(creature.id, creature);
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [creature.id],
      });

      // Set Alice's life to 0
      const alice = state.players.get(aliceId)!;
      state.players.set(aliceId, {
        ...alice,
        life: 0,
      });

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      const updatedAlice = result.state.players.get(aliceId);
      expect(updatedAlice?.hasLost).toBe(true);

      // Creature should also be destroyed
      const graveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creature.id);
    });
  });
});
