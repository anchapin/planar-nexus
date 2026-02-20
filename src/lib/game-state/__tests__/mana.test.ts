/**
 * Comprehensive unit tests for Mana System
 * Issue #323: Add comprehensive unit tests for game engine modules
 *
 * Tests mana pool management including:
 * - Adding and spending mana
 * - Mana pool emptying at end of phases
 * - Land playing restrictions
 * - Mana ability activation
 * - Mana cost parsing
 */

import {
  createEmptyManaPool,
  addMana,
  spendMana,
  emptyManaPool,
  emptyAllManaPools,
  canPlayLand,
  playLand,
  getTotalMana,
  hasMana,
  formatManaPool,
  resetLandPlays,
  setMaxLandsPerTurn,
  addLandPlay,
  getSpellManaCost,
  isManaAbility,
} from '../mana';
import {
  createInitialGameState,
  startGame,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import { Phase } from '../types';
import type { ScryfallCard } from '@/app/actions';
import type { ManaPool, StackObject } from '../types';

// Helper function to create a mock land card
function createMockLand(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Land',
    keywords: [],
    oracle_text: 'T: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

// Helper function to create a mock creature card
function createMockCreature(name: string, power: number, toughness: number): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: 'Creature — Test',
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

describe('Mana Pool Management', () => {
  describe('createEmptyManaPool', () => {
    it('should create an empty mana pool with all colors at 0', () => {
      const pool = createEmptyManaPool();
      
      expect(pool.colorless).toBe(0);
      expect(pool.white).toBe(0);
      expect(pool.blue).toBe(0);
      expect(pool.black).toBe(0);
      expect(pool.red).toBe(0);
      expect(pool.green).toBe(0);
      expect(pool.generic).toBe(0);
    });
  });

  describe('addMana', () => {
    it('should add colored mana to a player\'s pool', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { green: 3, red: 2 });
      
      const player = state.players.get(playerId)!;
      expect(player.manaPool.green).toBe(3);
      expect(player.manaPool.red).toBe(2);
    });

    it('should add colorless mana to a player\'s pool', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { colorless: 5 });
      
      const player = state.players.get(playerId)!;
      expect(player.manaPool.colorless).toBe(5);
    });

    it('should add generic mana to a player\'s pool', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { generic: 4 });
      
      const player = state.players.get(playerId)!;
      expect(player.manaPool.generic).toBe(4);
    });

    it('should accumulate mana when adding multiple times', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { green: 2 });
      state = addMana(state, playerId, { green: 3 });
      
      const player = state.players.get(playerId)!;
      expect(player.manaPool.green).toBe(5);
    });

    it('should add multiple types of mana at once', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, {
        white: 1,
        blue: 2,
        black: 3,
        red: 4,
        green: 5,
        colorless: 6,
      });
      
      const player = state.players.get(playerId)!;
      expect(player.manaPool.white).toBe(1);
      expect(player.manaPool.blue).toBe(2);
      expect(player.manaPool.black).toBe(3);
      expect(player.manaPool.red).toBe(4);
      expect(player.manaPool.green).toBe(5);
      expect(player.manaPool.colorless).toBe(6);
    });
  });

  describe('spendMana', () => {
    it('should spend colored mana from the pool', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { green: 3 });
      const result = spendMana(state, playerId, { green: 2 });
      
      expect(result.success).toBe(true);
      const player = result.state.players.get(playerId)!;
      expect(player.manaPool.green).toBe(1);
    });

    it('should fail if not enough colored mana', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { green: 1 });
      const result = spendMana(state, playerId, { green: 3 });
      
      expect(result.success).toBe(false);
      const player = state.players.get(playerId)!;
      expect(player.manaPool.green).toBe(1); // Unchanged
    });

    it('should allow spending generic mana with colored mana', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add colored mana that can pay for generic
      state = addMana(state, playerId, { green: 3 });
      const result = spendMana(state, playerId, { generic: 2 });
      
      expect(result.success).toBe(true);
      const player = result.state.players.get(playerId)!;
      expect(player.manaPool.green).toBe(1);
    });

    it('should allow spending colorless mana for generic costs', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { colorless: 5 });
      const result = spendMana(state, playerId, { generic: 3 });
      
      expect(result.success).toBe(true);
      const player = result.state.players.get(playerId)!;
      expect(player.manaPool.colorless).toBe(2);
    });

    it('should prioritize colored mana requirements over generic', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add 2 green and 2 red
      state = addMana(state, playerId, { green: 2, red: 2 });
      
      // Spend 1 green (colored) and 2 generic
      const result = spendMana(state, playerId, { green: 1, generic: 2 });
      
      expect(result.success).toBe(true);
      const player = result.state.players.get(playerId)!;
      // Green should be 1 (2 - 1 for colored requirement)
      // Remaining generic could come from red or remaining green
      expect(player.manaPool.green + player.manaPool.red).toBe(1);
    });

    it('should handle complex mana costs', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add mana for a spell costing {2}{G}{G}
      state = addMana(state, playerId, { green: 2, red: 1, colorless: 1 });
      const result = spendMana(state, playerId, { generic: 2, green: 2 });
      
      expect(result.success).toBe(true);
    });

    it('should fail if total mana is insufficient', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add only 2 mana
      state = addMana(state, playerId, { green: 2 });
      const result = spendMana(state, playerId, { generic: 5 });
      
      expect(result.success).toBe(false);
    });
  });

  describe('emptyManaPool', () => {
    it('should empty a player\'s mana pool', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state = addMana(state, playerId, { green: 5, red: 3, blue: 2 });
      state = emptyManaPool(state, playerId);
      
      const player = state.players.get(playerId)!;
      expect(getTotalMana(player.manaPool)).toBe(0);
    });
  });

  describe('emptyAllManaPools', () => {
    it('should empty all players\' mana pools', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      
      const playerIds = Array.from(state.players.keys());
      
      state = addMana(state, playerIds[0], { green: 5 });
      state = addMana(state, playerIds[1], { red: 3 });
      
      state = emptyAllManaPools(state);
      
      for (const playerId of playerIds) {
        const player = state.players.get(playerId)!;
        expect(getTotalMana(player.manaPool)).toBe(0);
      }
    });
  });
});

describe('Land Playing', () => {
  describe('canPlayLand', () => {
    it('should allow playing a land during main phase with empty stack', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Set up conditions for land play
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      expect(canPlayLand(state, playerId)).toBe(true);
    });

    it('should not allow playing a land during combat phase', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      expect(canPlayLand(state, playerId)).toBe(false);
    });

    it('should not allow playing a land with non-empty stack', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [{ 
        id: 'test-spell', 
        type: 'spell',
        sourceCardId: null,
        controllerId: playerId,
        name: 'Test Spell',
        text: '',
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      }] as StackObject[];
      
      expect(canPlayLand(state, playerId)).toBe(false);
    });

    it('should not allow playing a land without priority', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      
      const playerIds = Array.from(state.players.keys());
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerIds[1]; // Bob has priority
      state.stack = [];
      
      expect(canPlayLand(state, playerIds[0])).toBe(false); // Alice can't play
    });

    it('should not allow playing more than one land per turn by default', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      // Simulate having already played a land
      const player = state.players.get(playerId)!;
      state.players.set(playerId, { ...player, landsPlayedThisTurn: 1 });
      
      expect(canPlayLand(state, playerId)).toBe(false);
    });
  });

  describe('playLand', () => {
    it('should move a land from hand to battlefield', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add a land to hand
      const landData = createMockLand('Forest');
      const land = createCardInstance(landData, playerId, playerId);
      state.cards.set(land.id, land);
      
      const hand = state.zones.get(`${playerId}-hand`)!;
      state.zones.set(`${playerId}-hand`, {
        ...hand,
        cardIds: [...hand.cardIds, land.id],
      });
      
      // Set up conditions for land play
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      const result = playLand(state, playerId, land.id);
      
      expect(result.success).toBe(true);
      
      // Check land moved to battlefield
      const battlefield = result.state.zones.get(`${playerId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(land.id);
      
      // Check land removed from hand
      const updatedHand = result.state.zones.get(`${playerId}-hand`)!;
      expect(updatedHand.cardIds).not.toContain(land.id);
      
      // Check lands played this turn incremented
      const player = result.state.players.get(playerId)!;
      expect(player.landsPlayedThisTurn).toBe(1);
    });

    it('should fail if player cannot play a land', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add a land to hand
      const landData = createMockLand('Forest');
      const land = createCardInstance(landData, playerId, playerId);
      state.cards.set(land.id, land);
      
      const hand = state.zones.get(`${playerId}-hand`)!;
      state.zones.set(`${playerId}-hand`, {
        ...hand,
        cardIds: [...hand.cardIds, land.id],
      });
      
      // Set up conditions that prevent land play (combat phase)
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      const result = playLand(state, playerId, land.id);
      
      expect(result.success).toBe(false);
    });

    it('should fail if card is not a land', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add a creature to hand
      const creatureData = createMockCreature('Grizzly Bears', 2, 2);
      const creature = createCardInstance(creatureData, playerId, playerId);
      state.cards.set(creature.id, creature);
      
      const hand = state.zones.get(`${playerId}-hand`)!;
      state.zones.set(`${playerId}-hand`, {
        ...hand,
        cardIds: [...hand.cardIds, creature.id],
      });
      
      // Set up conditions for land play
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      const result = playLand(state, playerId, creature.id);
      
      expect(result.success).toBe(false);
    });
  });

  describe('Land play modifications', () => {
    it('should allow additional land plays with setMaxLandsPerTurn', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Set max lands to 2
      state = setMaxLandsPerTurn(state, playerId, 2);
      
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
      state.priorityPlayerId = playerId;
      state.stack = [];
      
      // Simulate having already played one land
      const player = state.players.get(playerId)!;
      state.players.set(playerId, { ...player, landsPlayedThisTurn: 1 });
      
      expect(canPlayLand(state, playerId)).toBe(true);
    });

    it('should add land plays with addLandPlay', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Add 2 extra land plays
      state = addLandPlay(state, playerId, 2);
      
      const player = state.players.get(playerId)!;
      expect(player.maxLandsPerTurn).toBe(3); // Default 1 + 2
    });

    it('should reset land plays with resetLandPlays', () => {
      let state = createInitialGameState(['Alice'], 20, false);
      state = startGame(state);
      
      const playerId = Array.from(state.players.keys())[0];
      
      // Simulate having played lands
      const player = state.players.get(playerId)!;
      state.players.set(playerId, { 
        ...player, 
        landsPlayedThisTurn: 2,
        hasActivatedManaAbility: true,
      });
      
      state = resetLandPlays(state, playerId);
      
      const updatedPlayer = state.players.get(playerId)!;
      expect(updatedPlayer.landsPlayedThisTurn).toBe(0);
      expect(updatedPlayer.hasActivatedManaAbility).toBe(false);
    });
  });
});

describe('Mana Utility Functions', () => {
  describe('getTotalMana', () => {
    it('should return the total mana in a pool', () => {
      const pool: ManaPool = {
        colorless: 2,
        white: 1,
        blue: 0,
        black: 3,
        red: 0,
        green: 2,
        generic: 1,
      };
      
      expect(getTotalMana(pool)).toBe(9);
    });

    it('should return 0 for empty pool', () => {
      const pool = createEmptyManaPool();
      expect(getTotalMana(pool)).toBe(0);
    });
  });

  describe('hasMana', () => {
    it('should return true when pool has mana', () => {
      const pool: ManaPool = {
        ...createEmptyManaPool(),
        green: 3,
      };
      
      expect(hasMana(pool)).toBe(true);
    });

    it('should return false when pool is empty', () => {
      const pool = createEmptyManaPool();
      expect(hasMana(pool)).toBe(false);
    });
  });

  describe('formatManaPool', () => {
    it('should format mana pool as a string', () => {
      const pool: ManaPool = {
        colorless: 2,
        white: 1,
        blue: 0,
        black: 3,
        red: 0,
        green: 2,
        generic: 1,
      };
      
      const formatted = formatManaPool(pool);
      
      expect(formatted).toContain('1W');
      expect(formatted).toContain('3B');
      expect(formatted).toContain('2G');
      expect(formatted).toContain('2C');
      expect(formatted).toContain('1');
    });

    it('should return "0" for empty pool', () => {
      const pool = createEmptyManaPool();
      expect(formatManaPool(pool)).toBe('0');
    });
  });
});

describe('Mana Cost Parsing', () => {
  describe('getSpellManaCost', () => {
    it('should parse a simple mana cost', () => {
      const cost = getSpellManaCost({ mana_cost: '{2}{G}' });
      
      expect(cost.generic).toBe(2);
      expect(cost.green).toBe(1);
      expect(cost.hasX).toBe(false);
    });

    it('should parse a multi-colored mana cost', () => {
      const cost = getSpellManaCost({ mana_cost: '{W}{U}{B}{R}{G}' });
      
      expect(cost.white).toBe(1);
      expect(cost.blue).toBe(1);
      expect(cost.black).toBe(1);
      expect(cost.red).toBe(1);
      expect(cost.green).toBe(1);
      expect(cost.generic).toBe(0);
    });

    it('should parse a cost with only generic mana', () => {
      const cost = getSpellManaCost({ mana_cost: '{3}' });
      
      expect(cost.generic).toBe(3);
      expect(cost.hasX).toBe(false);
    });

    it('should parse a cost with X', () => {
      const cost = getSpellManaCost({ mana_cost: '{X}{G}' });
      
      expect(cost.hasX).toBe(true);
      expect(cost.green).toBe(1);
    });

    it('should parse a cost with multiple X', () => {
      const cost = getSpellManaCost({ mana_cost: '{X}{X}{G}' });
      
      expect(cost.hasX).toBe(true);
      expect(cost.green).toBe(1);
    });

    it('should handle empty mana cost', () => {
      const cost = getSpellManaCost({ mana_cost: '' });
      
      expect(cost.generic).toBe(0);
      expect(cost.hasX).toBe(false);
    });

    it('should handle undefined mana cost', () => {
      const cost = getSpellManaCost({});
      
      expect(cost.generic).toBe(0);
      expect(cost.hasX).toBe(false);
    });
  });

  describe('isManaAbility', () => {
    it('should identify tap add mana abilities', () => {
      expect(isManaAbility('test', '{T}: Add {G}.')).toBe(true);
      expect(isManaAbility('test', 'Tap: Add {U}.')).toBe(true);
    });

    it('should identify abilities that produce colored mana', () => {
      expect(isManaAbility('test', 'Add {W} or {U}.')).toBe(true);
      expect(isManaAbility('test', 'Produces {R}.')).toBe(true);
    });

    it('should identify abilities that produce colorless mana', () => {
      expect(isManaAbility('test', 'Add {C}.')).toBe(true);
    });

    it('should not identify non-mana abilities', () => {
      expect(isManaAbility('test', 'Flying')).toBe(false);
      expect(isManaAbility('test', 'Destroy target creature.')).toBe(false);
    });
  });
});

describe('Mana System - Edge Cases', () => {
  it('should handle spending exactly all mana', () => {
    let state = createInitialGameState(['Alice'], 20, false);
    state = startGame(state);
    
    const playerId = Array.from(state.players.keys())[0];
    
    state = addMana(state, playerId, { green: 3 });
    const result = spendMana(state, playerId, { green: 3 });
    
    expect(result.success).toBe(true);
    const player = result.state.players.get(playerId)!;
    expect(player.manaPool.green).toBe(0);
  });

  it('should handle spending with mixed mana types', () => {
    let state = createInitialGameState(['Alice'], 20, false);
    state = startGame(state);
    
    const playerId = Array.from(state.players.keys())[0];
    
    // Add various mana types
    state = addMana(state, playerId, { 
      green: 2, 
      red: 1, 
      colorless: 2,
      generic: 1 
    });
    
    // Spend a complex cost
    const result = spendMana(state, playerId, { 
      green: 1, 
      red: 1, 
      generic: 3 
    });
    
    expect(result.success).toBe(true);
  });

  it('should handle adding mana to non-existent player gracefully', () => {
    let state = createInitialGameState(['Alice'], 20, false);
    state = startGame(state);
    
    // Try to add mana to non-existent player
    const result = addMana(state, 'non-existent', { green: 1 });
    
    // Should return unchanged state
    expect(result).toBe(state);
  });

  it('should handle spending from non-existent player gracefully', () => {
    let state = createInitialGameState(['Alice'], 20, false);
    state = startGame(state);
    
    // Try to spend mana from non-existent player
    const result = spendMana(state, 'non-existent', { green: 1 });
    
    expect(result.success).toBe(false);
  });
});