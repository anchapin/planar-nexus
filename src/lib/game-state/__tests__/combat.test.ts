/**
 * Comprehensive unit tests for Combat System
 * Issue #323: Add comprehensive unit tests for game engine modules
 *
 * Tests combat edge cases including:
 * - Attacker/blocker declaration validation
 * - Damage assignment and trample
 * - First strike and double strike
 * - Deathtouch and lifelink interactions
 * - Flying, reach, and other evasion
 * - Multi-blocker scenarios
 */

import {
  canAttack,
  canBlock,
  declareAttackers,
  declareBlockers,
  resolveCombatDamage,
  getAvailableAttackers,
  getAvailableBlockers,
} from '../combat';
import {
  createInitialGameState,
  startGame,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import { Phase } from '../types';
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

// Helper to set up a game with creatures on the battlefield
function setupGameWithCreatures(
  player1Creatures: Array<{ name: string; power: number; toughness: number; keywords?: string[] }> = [],
  player2Creatures: Array<{ name: string; power: number; toughness: number; keywords?: string[] }> = []
) {
  let state = createInitialGameState(['Alice', 'Bob'], 20, false);
  state = startGame(state);

  const playerIds = Array.from(state.players.keys());
  const aliceId = playerIds[0];
  const bobId = playerIds[1];

  // Add creatures to Alice's battlefield
  for (const creature of player1Creatures) {
    const creatureData = createMockCreature(creature.name, creature.power, creature.toughness, creature.keywords);
    const creatureInstance = createCardInstance(creatureData, aliceId, aliceId);
    // Clear summoning sickness for creatures that should be able to attack
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);
    
    const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
    state.zones.set(`${aliceId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  // Add creatures to Bob's battlefield
  for (const creature of player2Creatures) {
    const creatureData = createMockCreature(creature.name, creature.power, creature.toughness, creature.keywords);
    const creatureInstance = createCardInstance(creatureData, bobId, bobId);
    // Clear summoning sickness
    creatureInstance.hasSummoningSickness = false;
    state.cards.set(creatureInstance.id, creatureInstance);
    
    const battlefield = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...battlefield,
      cardIds: [...battlefield.cardIds, creatureInstance.id],
    });
  }

  return { state, aliceId, bobId };
}

describe('Combat System - Attacker Declaration', () => {
  describe('canAttack', () => {
    it('should allow untapped creature without summoning sickness to attack', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it('should prevent tapped creature from attacking', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];
      
      // Tap the creature
      const creature = state.cards.get(creatureId)!;
      creature.isTapped = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should allow tapped creature with vigilance to attack', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Vigilant Creature', power: 2, toughness: 2, keywords: ['Vigilance'] }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];
      
      // Tap the creature (it has vigilance, so it should still be able to attack)
      const creature = state.cards.get(creatureId)!;
      creature.isTapped = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it('should prevent creature with summoning sickness from attacking', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];
      
      // Give the creature summoning sickness
      const creature = state.cards.get(creatureId)!;
      creature.hasSummoningSickness = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('Summoning sickness');
    });

    it('should allow creature with haste to attack despite summoning sickness', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Hasty Creature', power: 2, toughness: 2, keywords: ['Haste'] }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];
      
      // Give the creature summoning sickness
      const creature = state.cards.get(creatureId)!;
      creature.hasSummoningSickness = true;

      const result = canAttack(state, creatureId, bobId);
      expect(result.canAttack).toBe(true);
    });

    it('should prevent non-creature from attacking', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);

      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      // Create a non-creature permanent (land)
      const landData = {
        id: 'mock-land',
        name: 'Forest',
        type_line: 'Land — Forest',
        keywords: [],
        oracle_text: '',
        mana_cost: '',
        cmc: 0,
        colors: [],
        color_identity: [],
        card_faces: undefined,
        layout: 'normal',
      } as ScryfallCard;
      const land = createCardInstance(landData, aliceId, aliceId);
      state.cards.set(land.id, land);
      
      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      state.zones.set(`${aliceId}-battlefield`, {
        ...battlefield,
        cardIds: [...battlefield.cardIds, land.id],
      });

      const result = canAttack(state, land.id, bobId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('Only creatures can attack');
    });

    it('should require a defender to be specified', () => {
      const { state, aliceId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = canAttack(state, creatureId);
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('No defender specified');
    });
  });

  describe('declareAttackers', () => {
    it('should tap attacking creatures without vigilance', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId }
      ]);

      expect(result.success).toBe(true);
      const attacker = result.state.cards.get(creatureId);
      expect(attacker?.isTapped).toBe(true);
    });

    it('should not tap attacking creatures with vigilance', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Vigilant Creature', power: 2, toughness: 2, keywords: ['Vigilance'] }
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId }
      ]);

      expect(result.success).toBe(true);
      const attacker = result.state.cards.get(creatureId);
      expect(attacker?.isTapped).toBe(false);
    });

    it('should fail if not in combat phase', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Grizzly Bears', power: 2, toughness: 2 }
      ]);

      // Set phase to main phase (not combat)
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureId = battlefield.cardIds[0];

      const result = declareAttackers(state, [
        { cardId: creatureId, defenderId: bobId }
      ]);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle multiple attackers', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures([
        { name: 'Creature 1', power: 2, toughness: 2 },
        { name: 'Creature 2', power: 3, toughness: 3 },
        { name: 'Creature 3', power: 1, toughness: 1 }
      ]);

      // Set phase to declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

      const battlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureIds = battlefield.cardIds;

      const result = declareAttackers(state, [
        { cardId: creatureIds[0], defenderId: bobId },
        { cardId: creatureIds[1], defenderId: bobId },
        { cardId: creatureIds[2], defenderId: bobId }
      ]);

      expect(result.success).toBe(true);
      expect(result.state.combat.attackers).toHaveLength(3);
    });
  });
});

describe('Combat System - Blocker Declaration', () => {
  describe('canBlock', () => {
    it('should allow untapped creature to block', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Attacker', power: 2, toughness: 2 }],
        [{ name: 'Blocker', power: 2, toughness: 2 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });

    it('should prevent tapped creature from blocking', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Attacker', power: 2, toughness: 2 }],
        [{ name: 'Blocker', power: 2, toughness: 2 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Tap the blocker
      const blocker = state.cards.get(blockerId)!;
      blocker.isTapped = true;

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('tapped');
    });

    it('should prevent non-flying, non-reach creature from blocking flying', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Flying Attacker', power: 2, toughness: 2, keywords: ['Flying'] }],
        [{ name: 'Ground Blocker', power: 2, toughness: 2 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(false);
      expect(result.reason).toContain('flying');
    });

    it('should allow flying creature to block flying', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Flying Attacker', power: 2, toughness: 2, keywords: ['Flying'] }],
        [{ name: 'Flying Blocker', power: 2, toughness: 2, keywords: ['Flying'] }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });

    it('should allow reach creature to block flying', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Flying Attacker', power: 2, toughness: 2, keywords: ['Flying'] }],
        [{ name: 'Reach Blocker', power: 2, toughness: 2, keywords: ['Reach'] }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      const result = canBlock(state, blockerId, attackerId);
      expect(result.canBlock).toBe(true);
    });
  });

  describe('declareBlockers', () => {
    it('should assign blockers to attackers', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Attacker', power: 2, toughness: 2 }],
        [{ name: 'Blocker', power: 2, toughness: 2 }]
      );

      // Set up combat phase with attackers
      state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
      
      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // First declare attackers
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      // Then declare blockers
      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);

      const result = declareBlockers(stateWithAttackers, blockerAssignments);
      expect(result.success).toBe(true);
      expect(result.state.combat.blockers.has(attackerId)).toBe(true);
    });

    it('should handle multiple blockers for one attacker', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Big Attacker', power: 5, toughness: 5 }],
        [
          { name: 'Blocker 1', power: 2, toughness: 2 },
          { name: 'Blocker 2', power: 2, toughness: 2 },
          { name: 'Blocker 3', power: 2, toughness: 2 }
        ]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerIds = bobBattlefield.cardIds;

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, blockerIds);

      const result = declareBlockers(stateWithAttackers, blockerAssignments);
      expect(result.success).toBe(true);
      expect(result.state.combat.blockers.get(attackerId)).toHaveLength(3);
    });
  });
});

describe('Combat System - Damage Resolution', () => {
  describe('resolveCombatDamage', () => {
    it('should deal damage to defending player from unblocked attacker', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Attacker', power: 3, toughness: 3 }],
        []
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;

      // Resolve combat
      const result = resolveCombatDamage(stateWithAttackers);
      expect(result.success).toBe(true);

      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17
    });

    it('should deal damage between attacker and blocker', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Attacker', power: 3, toughness: 3 }],
        [{ name: 'Blocker', power: 3, toughness: 3 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Both creatures should have lethal damage and be in graveyard
      // Attacker (3/3) deals 3 damage to Blocker (3/3) - lethal
      // Blocker (3/3) deals 3 damage to Attacker (3/3) - lethal
      const aliceGraveyard = result.state.zones.get(`${aliceId}-graveyard`)!;
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      
      expect(aliceGraveyard.cardIds).toContain(attackerId);
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it('should handle trample damage correctly', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Trampler', power: 5, toughness: 5, keywords: ['Trample'] }],
        [{ name: 'Blocker', power: 2, toughness: 2 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Blocker takes 2 lethal damage, 3 tramples over
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(17); // 20 - 3 = 17 (trample damage)
    });

    it('should handle deathtouch correctly', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Deathtouch Attacker', power: 1, toughness: 1, keywords: ['Deathtouch'] }],
        [{ name: 'Big Blocker', power: 10, toughness: 10 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // Big blocker should die from 1 deathtouch damage
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it('should handle lifelink correctly', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Lifelink Attacker', power: 3, toughness: 3, keywords: ['Lifelink'] }],
        []
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Damage Alice first to have life to gain
      const alice = state.players.get(aliceId)!;
      state.players.set(aliceId, { ...alice, life: 15 });

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;

      // Resolve combat
      const result = resolveCombatDamage(stateWithAttackers);
      expect(result.success).toBe(true);

      // Alice should gain 3 life from lifelink
      const updatedAlice = result.state.players.get(aliceId)!;
      expect(updatedAlice.life).toBe(18); // 15 + 3 = 18
    });

    it('should handle first strike correctly', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'First Strike Attacker', power: 2, toughness: 2, keywords: ['First Strike'] }],
        [{ name: 'Regular Blocker', power: 2, toughness: 2 }]
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];
      const blockerId = bobBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;
      stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

      const blockerAssignments = new Map();
      blockerAssignments.set(attackerId, [blockerId]);
      const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

      // Resolve combat
      const result = resolveCombatDamage(blockResult.state);
      expect(result.success).toBe(true);

      // First striker deals damage first, blocker dies before dealing damage
      // Attacker should survive
      const aliceBattlefieldAfter = result.state.zones.get(`${aliceId}-battlefield`)!;
      const bobGraveyard = result.state.zones.get(`${bobId}-graveyard`)!;
      
      expect(aliceBattlefieldAfter.cardIds).toContain(attackerId);
      expect(bobGraveyard.cardIds).toContain(blockerId);
    });

    it('should handle double strike correctly', () => {
      const { state, aliceId, bobId } = setupGameWithCreatures(
        [{ name: 'Double Strike Attacker', power: 2, toughness: 2, keywords: ['Double Strike'] }],
        []
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const attackerId = aliceBattlefield.cardIds[0];

      // Set up combat
      state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
      const attackResult = declareAttackers(state, [
        { cardId: attackerId, defenderId: bobId }
      ]);
      const stateWithAttackers = attackResult.state;

      // Resolve combat
      const result = resolveCombatDamage(stateWithAttackers);
      expect(result.success).toBe(true);

      // Double strike deals damage twice: 2 + 2 = 4
      const bob = result.state.players.get(bobId)!;
      expect(bob.life).toBe(16); // 20 - 4 = 16
    });
  });
});

describe('Combat System - Edge Cases', () => {
  it('should handle attacker with 0 power', () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: 'Zero Power', power: 0, toughness: 3 }],
      []
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId }
    ]);
    const stateWithAttackers = attackResult.state;

    // Resolve combat
    const result = resolveCombatDamage(stateWithAttackers);
    expect(result.success).toBe(true);

    // No damage should be dealt
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(20);
  });

  it('should handle multiple blockers with trample', () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: 'Big Trampler', power: 10, toughness: 10, keywords: ['Trample'] }],
      [
        { name: 'Blocker 1', power: 2, toughness: 3 },
        { name: 'Blocker 2', power: 2, toughness: 3 }
      ]
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];
    const blockerIds = bobBattlefield.cardIds;

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId }
    ]);
    const stateWithAttackers = attackResult.state;
    stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    const blockerAssignments = new Map();
    blockerAssignments.set(attackerId, blockerIds);
    const blockResult = declareBlockers(stateWithAttackers, blockerAssignments);

    // Resolve combat
    const result = resolveCombatDamage(blockResult.state);
    expect(result.success).toBe(true);

    // 10 power - 3 (first blocker) - 3 (second blocker) = 4 trample
    const bob = result.state.players.get(bobId)!;
    expect(bob.life).toBe(16); // 20 - 4 = 16
  });

  it('should handle no attackers declared', () => {
    const { state } = setupGameWithCreatures([], []);

    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;

    // Empty attacker array is allowed - it means no attack is declared
    const result = declareAttackers(state, []);
    expect(result.success).toBe(true);
    expect(result.state.combat.attackers).toHaveLength(0);
  });

  it('should handle no blockers declared', () => {
    const { state, aliceId, bobId } = setupGameWithCreatures(
      [{ name: 'Attacker', power: 2, toughness: 2 }],
      []
    );

    const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
    const attackerId = aliceBattlefield.cardIds[0];

    // Set up combat
    state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const attackResult = declareAttackers(state, [
      { cardId: attackerId, defenderId: bobId }
    ]);
    const stateWithAttackers = attackResult.state;
    stateWithAttackers.turn.currentPhase = Phase.DECLARE_BLOCKERS;

    // Declare no blockers
    const blockerAssignments = new Map();
    const result = declareBlockers(stateWithAttackers, blockerAssignments);
    
    // Should succeed with no blockers
    expect(result.success).toBe(true);
  });
});

describe('Combat System - Utility Functions', () => {
  describe('getAvailableAttackers', () => {
    it('should return all creatures that can attack', () => {
      const { state, aliceId } = setupGameWithCreatures(
        [
          { name: 'Can Attack', power: 2, toughness: 2 },
          { name: 'Tapped', power: 2, toughness: 2 },
          { name: 'Has Haste', power: 2, toughness: 2, keywords: ['Haste'] }
        ],
        []
      );

      const aliceBattlefield = state.zones.get(`${aliceId}-battlefield`)!;
      const creatureIds = aliceBattlefield.cardIds;

      // Tap the second creature
      const tappedCreature = state.cards.get(creatureIds[1])!;
      tappedCreature.isTapped = true;

      // Give the third creature summoning sickness (but it has haste)
      const hastyCreature = state.cards.get(creatureIds[2])!;
      hastyCreature.hasSummoningSickness = true;

      const available = getAvailableAttackers(state, aliceId);
      
      // Should include first creature and hasty creature
      expect(available).toContain(creatureIds[0]);
      expect(available).toContain(creatureIds[2]);
      expect(available).not.toContain(creatureIds[1]);
    });
  });

  describe('getAvailableBlockers', () => {
    it('should return all creatures that can block', () => {
      const { state, bobId } = setupGameWithCreatures(
        [],
        [
          { name: 'Can Block', power: 2, toughness: 2 },
          { name: 'Tapped', power: 2, toughness: 2 }
        ]
      );

      const bobBattlefield = state.zones.get(`${bobId}-battlefield`)!;
      const creatureIds = bobBattlefield.cardIds;

      // Tap the second creature
      const tappedCreature = state.cards.get(creatureIds[1])!;
      tappedCreature.isTapped = true;

      const available = getAvailableBlockers(state, bobId);
      
      expect(available).toContain(creatureIds[0]);
      expect(available).not.toContain(creatureIds[1]);
    });
  });
});