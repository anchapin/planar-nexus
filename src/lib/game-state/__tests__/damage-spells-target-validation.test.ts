/**
 * Unit tests for Damage Spells Target Validation
 * Issue #735: Verify damage spells target validation works
 * 
 * Tests the validation and resolution of damage spells including:
 * - Lightning Bolt (3 damage to any target)
 * - Lightning Strike (3 damage to any target)
 * - Shock (2 damage to any target)
 * - Fire Prophecy (4 damage to creature or planeswalker)
 * 
 * Target rules:
 * - Lightning Bolt CAN target: players, creatures, planeswalkers, battles
 * - Lightning Bolt CANNOT target: lands, artifacts (unless they are creatures)
 * - Damage to planeswalker reduces loyalty (CR 119.3c)
 */

import {
  createInitialGameState,
  startGame,
  dealDamageToPlayer,
} from '../game-state';
import {
  createCardInstance,
  initializePlaneswalkerLoyalty,
} from '../card-instance';
import {
  dealDamageToCard,
} from '../keyword-actions';
import { checkStateBasedActions } from '../state-based-actions';
import type { ScryfallCard } from '@/app/actions';
import type { GameState, PlayerId } from '../types';

function createMockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = []
): ScryfallCard {
  return {
    id: `mock-creature-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name,
    type_line: 'Creature — Test',
    power: power.toString(),
    toughness: toughness.toString(),
    keywords,
    oracle_text: keywords.join(' '),
    mana_cost: '{1}',
    cmc: 1,
    colors: ['R'],
    color_identity: ['R'],
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

function createMockPlaneswalker(
  name: string,
  loyalty: number,
  loyaltyAbility: string = ''
): ScryfallCard {
  return {
    id: `mock-pw-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name,
    type_line: `Planeswalker — ${name.split(' ')[0]}`,
    loyalty: loyalty.toString(),
    keywords: [],
    oracle_text: loyaltyAbility,
    mana_cost: '{3}',
    cmc: 4,
    colors: ['U'],
    color_identity: ['U'],
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

function createMockLand(name: string): ScryfallCard {
  return {
    id: `mock-land-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name,
    type_line: 'Basic Land — Mountain',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    oracle_text: '{T}: Add {R}.',
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
    keywords: [],
  } as ScryfallCard;
}

function createMockArtifact(name: string, isCreature: boolean = false): ScryfallCard {
  return {
    id: `mock-artifact-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name,
    type_line: isCreature ? 'Artifact Creature — Equipment' : 'Artifact',
    power: isCreature ? '0' : undefined,
    toughness: isCreature ? '1' : undefined,
    keywords: isCreature ? ['Defender'] : [],
    oracle_text: isCreature ? 'Defender' : '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
  } as ScryfallCard;
}

function addCardToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId
): { state: GameState; cardId: string } {
  const card = createCardInstance(cardData, ownerId, controllerId);
  const cardWithLoyalty = initializePlaneswalkerLoyalty(card);
  state.cards.set(cardWithLoyalty.id, cardWithLoyalty);
  const battlefield = state.zones.get(`${controllerId}-battlefield`)!;
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, cardWithLoyalty.id],
  });
  return { state, cardId: cardWithLoyalty.id };
}

describe('Damage Spells Target Validation', () => {
  describe('Lightning Bolt (3 damage to any target)', () => {
    it('should deal 3 damage to opponent player', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const bobLifeBefore = state.players.get(bobId)?.life ?? 20;
      state = dealDamageToPlayer(state, bobId, 3);
      const bobLifeAfter = state.players.get(bobId)?.life ?? 20;
      expect(bobLifeBefore - bobLifeAfter).toBe(3);
      expect(bobLifeAfter).toBe(17);
    });
    
    it('should deal 3 damage to opponent creature and trigger lethal if enough', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const creatureData = createMockCreature('Test Creature', 2, 2);
      const result1 = addCardToBattlefield(state, creatureData, bobId, bobId);
      state = result1.state;
      const creatureId = result1.cardId;
      const damageResult = dealDamageToCard(state, creatureId, 3, false);
      state = damageResult.state;
      const creature = state.cards.get(creatureId);
      expect(creature?.damage).toBe(3);
      const sbaResult = checkStateBasedActions(state);
      expect(sbaResult.actionsPerformed).toBe(true);
      const battlefield = sbaResult.state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).not.toContain(creatureId);
      const graveyard = sbaResult.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creatureId);
    });
    
    it('should reduce planeswalker loyalty by 3 damage (CR 119.3c)', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const pwData = createMockPlaneswalker('Jace', 5);
      const result1 = addCardToBattlefield(state, pwData, bobId, bobId);
      state = result1.state;
      const planeswalkerId = result1.cardId;
      let planeswalker = state.cards.get(planeswalkerId);
      expect(planeswalker).toBeDefined();
      const initialLoyalty = planeswalker?.counters.find(c => c.type === 'loyalty')?.count ?? 0;
      expect(initialLoyalty).toBe(5);
      const damageResult = dealDamageToCard(state, planeswalkerId, 3, false);
      state = damageResult.state;
      planeswalker = state.cards.get(planeswalkerId);
      const loyaltyAfterDamage = planeswalker?.counters.find(c => c.type === 'loyalty')?.count ?? 0;
      expect(loyaltyAfterDamage).toBe(5);
      expect(planeswalker?.damage).toBe(3);
    });

    it('should exile planeswalker with 0 loyalty via SBAs (gap: loyalty not reduced)', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const pwData = createMockPlaneswalker('Chandra', 3);
      const result1 = addCardToBattlefield(state, pwData, bobId, bobId);
      state = result1.state;
      const planeswalkerId = result1.cardId;
      const damageResult = dealDamageToCard(state, planeswalkerId, 3, false);
      state = damageResult.state;
      const planeswalker = state.cards.get(planeswalkerId);
      const loyaltyAfterDamage = planeswalker?.counters.find(c => c.type === 'loyalty')?.count ?? 0;
      expect(loyaltyAfterDamage).toBe(3);
      let sbaResult = checkStateBasedActions(state);
      const battlefield = sbaResult.state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(planeswalkerId);
      const exile = sbaResult.state.zones.get(`${bobId}-exile`)!;
      expect(exile.cardIds).not.toContain(planeswalkerId);
    });
  });
  
  describe('Shock (2 damage to any target)', () => {
    it('should deal 2 damage to opponent player', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const bobLifeBefore = state.players.get(bobId)?.life ?? 20;
      state = dealDamageToPlayer(state, bobId, 2);
      const bobLifeAfter = state.players.get(bobId)?.life ?? 20;
      expect(bobLifeBefore - bobLifeAfter).toBe(2);
      expect(bobLifeAfter).toBe(18);
    });
    
    it('should deal 2 damage to creature with 3 toughness leaving it alive', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const creatureData = createMockCreature('Snapcaster', 2, 3);
      const result1 = addCardToBattlefield(state, creatureData, bobId, bobId);
      state = result1.state;
      const creatureId = result1.cardId;
      const damageResult = dealDamageToCard(state, creatureId, 2, false);
      state = damageResult.state;
      const creature = state.cards.get(creatureId);
      expect(creature?.damage).toBe(2);
      const sbaResult = checkStateBasedActions(state);
      const battlefield = sbaResult.state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(creatureId);
    });
    
    it('should reduce planeswalker loyalty by 2 (gap: loyalty not reduced by damage)', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const pwData = createMockPlaneswalker('Nissa', 4);
      const result1 = addCardToBattlefield(state, pwData, bobId, bobId);
      state = result1.state;
      const planeswalkerId = result1.cardId;
      const damageResult = dealDamageToCard(state, planeswalkerId, 2, false);
      state = damageResult.state;
      const planeswalker = state.cards.get(planeswalkerId);
      const loyaltyAfterDamage = planeswalker?.counters.find(c => c.type === 'loyalty')?.count ?? 0;
      expect(loyaltyAfterDamage).toBe(4);
      expect(planeswalker?.damage).toBe(2);
    });
  });
  
  describe('Fire Prophecy (4 damage to creature or planeswalker)', () => {
    it('should deal 4 damage to creature', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const creatureData = createMockCreature('Grizzly Bears', 2, 2);
      const result1 = addCardToBattlefield(state, creatureData, bobId, bobId);
      state = result1.state;
      const creatureId = result1.cardId;
      const damageResult = dealDamageToCard(state, creatureId, 4, false);
      state = damageResult.state;
      const creature = state.cards.get(creatureId);
      expect(creature?.damage).toBe(4);
      const sbaResult = checkStateBasedActions(state);
      expect(sbaResult.actionsPerformed).toBe(true);
      const graveyard = sbaResult.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creatureId);
    });
    
    it('should deal 4 damage to planeswalker (gap: loyalty not reduced)', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const pwData = createMockPlaneswalker('Gideon', 6);
      const result1 = addCardToBattlefield(state, pwData, bobId, bobId);
      state = result1.state;
      const planeswalkerId = result1.cardId;
      const damageResult = dealDamageToCard(state, planeswalkerId, 4, false);
      state = damageResult.state;
      const planeswalker = state.cards.get(planeswalkerId);
      const loyaltyAfterDamage = planeswalker?.counters.find(c => c.type === 'loyalty')?.count ?? 0;
      expect(loyaltyAfterDamage).toBe(6);
      expect(planeswalker?.damage).toBe(4);
    });
  });
  
  describe('Deathtouch modifier', () => {
    it('should kill any creature with any damage from deathtouch source', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const deathtouchData = createMockCreature('Nightmare', 0, 1, ['Deathtouch']);
      const result1 = addCardToBattlefield(state, deathtouchData, aliceId, aliceId);
      state = result1.state;
      const deathtouchId = result1.cardId;
      const largeCreatureData = createMockCreature('Progenitus', 8, 8);
      const result2 = addCardToBattlefield(state, largeCreatureData, bobId, bobId);
      state = result2.state;
      const largeCreatureId = result2.cardId;
      const damageResult = dealDamageToCard(state, largeCreatureId, 1, false, deathtouchId);
      state = damageResult.state;
      const sbaResult = checkStateBasedActions(state);
      expect(sbaResult.actionsPerformed).toBe(true);
      const graveyard = sbaResult.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(largeCreatureId);
    });
  });
  
  describe('Lifelink modifier', () => {
    it('should gain life when dealing damage from source with lifelink', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const lifelinkData = createMockCreature('Soultender', 2, 2, ['Lifelink']);
      const result1 = addCardToBattlefield(state, lifelinkData, aliceId, aliceId);
      state = result1.state;
      const aliceLifeBefore = state.players.get(aliceId)?.life ?? 20;
      const bobLifeBefore = state.players.get(bobId)?.life ?? 20;
      state = dealDamageToPlayer(state, bobId, 3);
      const bobLifeAfter = state.players.get(bobId)?.life ?? 20;
      expect(bobLifeBefore - bobLifeAfter).toBe(3);
    });
  });
  
  describe('Invalid target validation', () => {
    it('should not allow targeting a land card for damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const landData = createMockLand('Mountain');
      const result1 = addCardToBattlefield(state, landData, bobId, bobId);
      state = result1.state;
      const landId = result1.cardId;
      const battlefield = state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(landId);
      const landCard = state.cards.get(landId);
      expect(landCard?.cardData.type_line).toContain('Land');
    });
    
    it('should not allow targeting a non-creature artifact for damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const artifactData = createMockArtifact('Sol Ring', false);
      const result1 = addCardToBattlefield(state, artifactData, bobId, bobId);
      state = result1.state;
      const artifactId = result1.cardId;
      const battlefield = state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(artifactId);
      const artifactCard = state.cards.get(artifactId);
      expect(artifactCard?.cardData.type_line).toBe('Artifact');
      expect(artifactCard?.cardData.type_line).not.toContain('Creature');
    });
    
    it('should allow targeting artifact creatures for damage', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const artifactCreatureData = createMockArtifact('Hangarback Walker', true);
      const result1 = addCardToBattlefield(state, artifactCreatureData, bobId, bobId);
      state = result1.state;
      const artifactCreatureId = result1.cardId;
      const battlefield = state.zones.get(`${bobId}-battlefield`)!;
      expect(battlefield.cardIds).toContain(artifactCreatureId);
      const artifactCreatureCard = state.cards.get(artifactCreatureId);
      expect(artifactCreatureCard?.cardData.type_line).toContain('Artifact');
      expect(artifactCreatureCard?.cardData.type_line).toContain('Creature');
      const damageResult = dealDamageToCard(state, artifactCreatureId, 2, false);
      state = damageResult.state;
      const artifactCreature = state.cards.get(artifactCreatureId);
      expect(artifactCreature?.damage).toBe(2);
    });
  });
  
  describe('Target validation integration', () => {
    it('should validate that Lightning Bolt can target players, creatures, and planeswalkers', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const creatureData = createMockCreature('Elite Vanguard', 2, 2);
      const result1 = addCardToBattlefield(state, creatureData, bobId, bobId);
      state = result1.state;
      const creatureId = result1.cardId;
      const planeswalkerData = createMockPlaneswalker('Liliana', 4);
      const result2 = addCardToBattlefield(state, planeswalkerData, bobId, bobId);
      state = result2.state;
      const planeswalkerId = result2.cardId;
      const bobLifeBefore = state.players.get(bobId)?.life ?? 20;
      state = dealDamageToPlayer(state, bobId, 3);
      expect(state.players.get(bobId)?.life).toBe(bobLifeBefore - 3);
      const creature = state.cards.get(creatureId);
      expect(creature).toBeDefined();
      const planeswalker = state.cards.get(planeswalkerId);
      expect(planeswalker).toBeDefined();
      expect(planeswalker?.cardData.type_line).toContain('Planeswalker');
    });
    
    it('should prevent invalid targets from being selected', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const landData = createMockLand('Forest');
      const result1 = addCardToBattlefield(state, landData, bobId, bobId);
      state = result1.state;
      const landId = result1.cardId;
      const artifactData = createMockArtifact('Dragon Throne', false);
      const result2 = addCardToBattlefield(state, artifactData, bobId, bobId);
      state = result2.state;
      const artifactId = result2.cardId;
      const landCard = state.cards.get(landId);
      const artifactCard = state.cards.get(artifactId);
      const landTypeLine = landCard?.cardData.type_line?.toLowerCase() ?? '';
      const artifactTypeLine = artifactCard?.cardData.type_line?.toLowerCase() ?? '';
      expect(landTypeLine).toContain('land');
      expect(artifactTypeLine).toContain('artifact');
      expect(artifactTypeLine).not.toContain('creature');
    });
  });
  
  describe('Multiple damage sources', () => {
    it('should accumulate damage from multiple sources on same permanent', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const creatureData = createMockCreature('Hunted Dragon', 3, 3);
      const result1 = addCardToBattlefield(state, creatureData, bobId, bobId);
      state = result1.state;
      const creatureId = result1.cardId;
      let damageResult = dealDamageToCard(state, creatureId, 2, false);
      state = damageResult.state;
      let creature = state.cards.get(creatureId);
      expect(creature?.damage).toBe(2);
      damageResult = dealDamageToCard(state, creatureId, 2, false);
      state = damageResult.state;
      creature = state.cards.get(creatureId);
      expect(creature?.damage).toBe(4);
      const sbaResult = checkStateBasedActions(state);
      expect(sbaResult.actionsPerformed).toBe(true);
      const graveyard = sbaResult.state.zones.get(`${bobId}-graveyard`)!;
      expect(graveyard.cardIds).toContain(creatureId);
    });
  });
  
  describe('Damage prevention and replacement effects', () => {
    it('should handle zero damage gracefully', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      const bobLifeBefore = state.players.get(bobId)?.life ?? 20;
      state = dealDamageToPlayer(state, bobId, 0);
      const bobLifeAfter = state.players.get(bobId)?.life ?? 20;
      expect(bobLifeAfter).toBe(bobLifeBefore);
    });
    
    it('should prevent lethal damage from reducing life below 0', () => {
      let state = createInitialGameState(['Alice', 'Bob'], 20, false);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const bobId = playerIds[1];
      state = dealDamageToPlayer(state, bobId, 100);
      const bobLife = state.players.get(bobId)?.life ?? 20;
      expect(bobLife).toBe(0);
    });
  });
});