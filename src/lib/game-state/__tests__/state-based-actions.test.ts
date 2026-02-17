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
  type StateBasedActionResult,
} from '../state-based-actions';
import {
  createInitialGameState,
  loadDeckForPlayer,
  startGame,
  drawCard,
  dealDamageToPlayer,
  gainLife,
} from '../game-state';
import {
  createCardInstance,
  markDamage,
  addCounters,
  removeCounters,
  isCreature,
  isPlaneswalker,
  getToughness,
  hasLethalDamage,
} from '../card-instance';
import { dealDamageToCard, destroyCard, exileCard } from '../keyword-actions';
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
      
      const jaceData2 = createMockPlaneswalker('Jace2', 3);
      jaceData2.type_line = 'Legendary Planeswalker - Jace';
      const jace2 = createCardInstance(jaceData2, playerIds[0], playerIds[0]);

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
});
