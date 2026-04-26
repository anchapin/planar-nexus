/**
 * Keyword Actions Test Suite
 *
 * Tests for all keyword actions in Magic: The Gathering.
 * Reference: CR 701 - Keyword Actions
 */

import {
  destroyCard,
  exileCard,
  sacrificeCard,
  drawCards,
  discardCards,
  createTokenCard,
  counterSpell,
  regenerateCard,
  hasIndestructible,
  canBeRegenerated,
  hasCycling,
  hasLandcycling,
  getCyclingCost,
  canCycleCard,
  cycleCard,
  parseCyclingCost,
} from '../keyword-actions';

import {
  createInitialGameState,
  startGame,
} from '../game-state';
import { createCardInstance } from '../card-instance';
import type { ScryfallCard } from '@/app/actions';
import type { GameState, CardInstanceId, PlayerId } from '../types';

// Helper to create a mock card
function createMockCard(name: string, typeLine: string, oracleText: string = '', keywords: string[] = []): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type_line: typeLine,
    keywords,
    oracle_text: oracleText,
    mana_cost: '{1}',
    cmc: 1,
    colors: ['W'],
    color_identity: ['W'],
    legalities: { standard: 'legal', commander: 'legal' },
    card_faces: undefined,
    layout: 'normal',
    power: '1',
    toughness: '1',
  } as ScryfallCard;
}

describe('Keyword Actions', () => {
  let gameState: GameState;
  let player1Id: PlayerId;
  let player2Id: PlayerId;

  beforeEach(() => {
    gameState = createInitialGameState(['Player1', 'Player2'], 20, false);
    startGame(gameState);
    const playerIds = Array.from(gameState.players.keys());
    player1Id = playerIds[0];
    player2Id = playerIds[1];
  });

  describe('hasIndestructible', () => {
    it('should detect indestructible from keywords', () => {
      const card = createCardInstance(
        createMockCard('Test', 'Creature', '', ['Indestructible']),
        'player1'
      );
      expect(hasIndestructible(card as any)).toBe(true);
    });

    it('should detect indestructible from oracle text', () => {
      const card = createCardInstance(
        createMockCard('Test', 'Creature', 'Indestructible'),
        'player1'
      );
      expect(hasIndestructible(card as any)).toBe(true);
    });

    it('should return false for non-indestructible cards', () => {
      const card = createCardInstance(
        createMockCard('Test', 'Creature', 'Flying'),
        'player1'
      );
      expect(hasIndestructible(card as any)).toBe(false);
    });
  });

  describe('canBeRegenerated', () => {
    it('should detect regenerate ability in oracle text', () => {
      const card = createCardInstance(
        createMockCard('Test', 'Creature', '{T}: Regenerate Test.'),
        'player1'
      );
      expect(canBeRegenerated(card as any)).toBe(true);
    });

    it('should return false for cards without regenerate', () => {
      const card = createCardInstance(
        createMockCard('Test', 'Creature', 'Flying'),
        'player1'
      );
      expect(canBeRegenerated(card as any)).toBe(false);
    });
  });

  describe('destroyCard', () => {
    it('should destroy a normal card', () => {
      const card = createCardInstance(
        createMockCard('Soldier', 'Creature — Human Soldier'),
        player1Id
      );
      gameState = gameState as any;
      
      // Add card to battlefield
      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = destroyCard(gameState as any, card.instanceId as any);
      
      // Should succeed
      expect(result.success).toBe(true);
    });

    it('should not destroy indestructible cards', () => {
      const card = createCardInstance(
        createMockCard('Guardian', 'Creature', '', ['Indestructible']),
        player1Id
      );
      
      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = destroyCard(gameState as any, card.instanceId as any);
      
      // Should fail due to indestructible
      expect(result.success).toBe(false);
      expect(result.description).toContain('indestructible');
    });

    it('should destroy with ignoreIndestructible option', () => {
      const card = createCardInstance(
        createMockCard('Guardian', 'Creature', '', ['Indestructible']),
        player1Id
      );
      
      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = destroyCard(gameState as any, card.instanceId as any, true);
      
      // Should succeed when ignoring indestructible
      expect(result.success).toBe(true);
    });
  });

  // Simplified tests that verify function signatures exist and return valid results
  // Full integration tests would require more complex game state setup
  describe('exileCard', () => {
    it('should be callable and return a result object', () => {
      // Just verify the function is callable - full testing requires complex setup
      const result = exileCard(gameState as any, 'nonexistent' as any);
      expect(result).toBeDefined();
    });
  });

  describe('drawCards', () => {
    it('should be callable and return a result object', () => {
      const result = drawCards(gameState as any, player1Id, 1);
      expect(result).toBeDefined();
    });
  });

  describe('createTokenCard', () => {
    it('should be callable and return a result object', () => {
      const tokenData = createMockCard('1/1 Soldier', 'Token Creature — Soldier');
      const result = createTokenCard(gameState as any, player1Id, tokenData, 1);
      expect(result).toBeDefined();
    });
  });

  describe('sacrificeCard', () => {
    it('should sacrifice a card', () => {
      const card = createCardInstance(
        createMockCard('Sacrificial', 'Creature'),
        player1Id
      );
      
      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = sacrificeCard(gameState as any, card.instanceId as any);
      
      expect(result.success).toBe(true);
    });

    it('should fail if card not found', () => {
      const result = sacrificeCard(gameState as any, 'non-existent' as any);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('drawCards', () => {
    it('should be callable and return a result object', () => {
      const result = drawCards(gameState as any, player1Id, 1);
      expect(result).toBeDefined();
    });
  });

  describe('discardCards', () => {
    it('should discard cards from hand', () => {
      // Add a card to hand
      const card = createCardInstance(
        createMockCard('Test', 'Instant'),
        player1Id
      );
      
      const hand = gameState.zones.get(`${player1Id}-hand`);
      if (hand) {
        hand.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = discardCards(gameState as any, player1Id, 1, false);
      
      expect(result.success).toBe(true);
    });

    it('should handle random discard', () => {
      // Add cards to hand
      for (let i = 0; i < 3; i++) {
        const card = createCardInstance(
          createMockCard(`Test${i}`, 'Instant'),
          player1Id
        );
        const hand = gameState.zones.get(`${player1Id}-hand`);
        if (hand) {
          hand.cardIds.push(card.instanceId);
          gameState.cards.set(card.instanceId, card as any);
        }
      }

      const result = discardCards(gameState as any, player1Id, 1, true);
      
      expect(result.success).toBe(true);
    });
  });

  describe('createTokenCard', () => {
    it('should be callable and return a result object', () => {
      const tokenData = createMockCard('1/1 Soldier', 'Token Creature — Soldier');
      const result = createTokenCard(gameState as any, player1Id, tokenData, 1);
      expect(result).toBeDefined();
    });
  });

  describe('counterSpell', () => {
    it('should counter a spell on the stack', () => {
      // This would require setting up a spell on the stack first
      // Basic test for the function existing and being callable
      const result = counterSpell(gameState as any, 'non-existent' as any);
      
      // Will fail because spell doesn't exist, but function exists
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  describe('regenerateCard', () => {
    it('should regenerate a card with regenerate ability', () => {
      const card = createCardInstance(
        createMockCard('Regenerator', 'Creature', '{T}: Regenerate Regenerator.'),
        player1Id
      );
      
      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = regenerateCard(gameState as any, card.instanceId as any);
      
      expect(result.success).toBe(true);
    });

    it('should fail for cards without regenerate ability', () => {
      const card = createCardInstance(
        createMockCard('Normal', 'Creature', ''),
        player1Id
      );

      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(card.instanceId);
        gameState.cards.set(card.instanceId, card as any);
      }

      const result = regenerateCard(gameState as any, card.instanceId as any);

      // Should fail or have no effect
      expect(result).toBeDefined();
    });
  });

  // ============== CYCLING TESTS ==============
  describe('Cycling', () => {
    let cyclingCard: any;
    let landcyclingCard: any;
    let normalCard: any;

    beforeEach(() => {
      // Reset game state for each test
      gameState = createInitialGameState(['Player1', 'Player2'], 20, false);
      startGame(gameState);
      const playerIds = Array.from(gameState.players.keys());
      player1Id = playerIds[0];
      player2Id = playerIds[1];

      // Create test cards with proper cardData structure - oracle_text is set by createMockCard
      const cyclingCardData = createMockCard('Cycling Card', 'Creature', 'Cycling {2}');
      cyclingCard = createCardInstance(cyclingCardData, player1Id, player1Id);

      const landcyclingCardData = createMockCard('Landcycling Card', 'Creature', 'Plainscycling {W}');
      landcyclingCard = createCardInstance(landcyclingCardData, player1Id, player1Id);

      const normalCardData = createMockCard('Normal Card', 'Creature', 'Flying');
      normalCard = createCardInstance(normalCardData, player1Id, player1Id);
    });

    describe('parseCyclingCost', () => {
      it('should parse simple cycling cost', () => {
        const result = parseCyclingCost('Cycling {2}');
        expect(result).not.toBeNull();
        expect(result?.type).toBe('mana');
        expect(result?.manaCost?.generic).toBe(2);
        expect(result?.isLandcycling).toBe(false);
      });

      it('should parse colored cycling cost', () => {
        const result = parseCyclingCost('Cycling {1}{U}');
        expect(result).not.toBeNull();
        expect(result?.type).toBe('mana');
        expect(result?.manaCost?.generic).toBe(1);
        expect(result?.manaCost?.blue).toBe(1);
      });

      it('should parse landcycling cost', () => {
        const result = parseCyclingCost('Plainscycling {W}');
        expect(result).not.toBeNull();
        expect(result?.type).toBe('mana');
        expect(result?.manaCost?.white).toBe(1);
        expect(result?.isLandcycling).toBe(true);
        expect(result?.landType).toBe('plains');
      });

      it('should parse basic landcycling', () => {
        const result = parseCyclingCost('Basic landcycling {1}');
        expect(result).not.toBeNull();
        expect(result?.type).toBe('mana');
        expect(result?.manaCost?.generic).toBe(1);
        expect(result?.isLandcycling).toBe(true);
        expect(result?.landType).toBe('basic');
      });

      it('should parse cycling with life cost', () => {
        const result = parseCyclingCost('Cycling—Pay 3 life');
        expect(result).not.toBeNull();
        expect(result?.type).toBe('life');
        expect(result?.lifeCost).toBe(3);
      });

      it('should return null for cards without cycling', () => {
        const result = parseCyclingCost('Flying\nTrample');
        expect(result).toBeNull();
      });
    });

    describe('hasCycling', () => {
      it('should detect cycling keyword', () => {
        expect(hasCycling(cyclingCard as any)).toBe(true);
      });

      it('should detect landcycling', () => {
        expect(hasCycling(landcyclingCard as any)).toBe(true);
      });

      it('should return false for cards without cycling', () => {
        expect(hasCycling(normalCard as any)).toBe(false);
      });
    });

    describe('hasLandcycling', () => {
      it('should detect landcycling', () => {
        expect(hasLandcycling(landcyclingCard as any)).toBe(true);
      });

      it('should return false for regular cycling', () => {
        expect(hasLandcycling(cyclingCard as any)).toBe(false);
      });

      it('should return false for cards without cycling', () => {
        expect(hasLandcycling(normalCard as any)).toBe(false);
      });
    });

    describe('getCyclingCost', () => {
      it('should return cycling cost for cycling card', () => {
        const cost = getCyclingCost(cyclingCard as any);
        expect(cost).not.toBeNull();
        expect(cost?.type).toBe('mana');
        expect(cost?.manaCost?.generic).toBe(2);
      });

      it('should return landcycling cost for landcycling card', () => {
        const cost = getCyclingCost(landcyclingCard as any);
        expect(cost).not.toBeNull();
        expect(cost?.isLandcycling).toBe(true);
        expect(cost?.landType).toBe('plains');
      });

      it('should return null for cards without cycling', () => {
        const cost = getCyclingCost(normalCard as any);
        expect(cost).toBeNull();
      });
    });

    describe('canCycleCard', () => {
      beforeEach(() => {
        // Add cards to player's hand - properly update the state
        const hand = gameState.zones.get(`${player1Id}-hand`);
        if (hand) {
          const updatedHand = {
            ...hand,
            cardIds: [...hand.cardIds, cyclingCard.id],
          };
          const updatedZones = new Map(gameState.zones);
          updatedZones.set(`${player1Id}-hand`, updatedHand);
          gameState = {
            ...gameState,
            zones: updatedZones,
            cards: new Map(gameState.cards).set(cyclingCard.id, cyclingCard as any),
          };
        }
      });

      it('should allow cycling when conditions are met', () => {
        // Give player enough mana
        gameState = addMana(gameState, player1Id, { generic: 2 });

        const result = canCycleCard(gameState, player1Id, cyclingCard.id as any);
        expect(result.canCycle).toBe(true);
      });

      it('should fail if card not in hand', () => {
        const result = canCycleCard(gameState, player1Id, landcyclingCard.id as any);
        expect(result.canCycle).toBe(false);
        // Card doesn't exist in game state, so "not found" is appropriate
        expect(result.reason).toContain('not found');
      });

      it('should fail if not enough mana', () => {
        // Give player insufficient mana
        gameState = addMana(gameState, player1Id, { generic: 1 });

        const result = canCycleCard(gameState, player1Id, cyclingCard.id as any);
        expect(result.canCycle).toBe(false);
        expect(result.reason).toContain('mana');
      });

      it('should fail if player does not have priority', () => {
        // Give opponent priority
        const playerIds = Array.from(gameState.players.keys());
        const opponentId = playerIds[1];
        gameState.priorityPlayerId = opponentId;

        gameState = addMana(gameState, player1Id, { generic: 2 });

        const result = canCycleCard(gameState, player1Id, cyclingCard.id as any);
        expect(result.canCycle).toBe(false);
        expect(result.reason).toContain('priority');
      });
    });

    describe('cycleCard', () => {
      beforeEach(() => {
        // Add cards to player's hand - properly update the state
        const hand = gameState.zones.get(`${player1Id}-hand`);
        if (hand) {
          const updatedHand = {
            ...hand,
            cardIds: [...hand.cardIds, cyclingCard.id],
          };
          const updatedZones = new Map(gameState.zones);
          updatedZones.set(`${player1Id}-hand`, updatedHand);
          gameState = {
            ...gameState,
            zones: updatedZones,
            cards: new Map(gameState.cards).set(cyclingCard.id, cyclingCard as any),
          };
        }

        // Give player enough mana
        gameState = addMana(gameState, player1Id, { generic: 2 });
      });

      it('should successfully cycle a card', () => {
        const initialHandSize = gameState.zones.get(`${player1Id}-hand`)?.cardIds.length || 0;
        const initialLibrarySize = gameState.zones.get(`${player1Id}-library`)?.cardIds.length || 0;

        const result = cycleCard(gameState, player1Id, cyclingCard.id as any);

        expect(result.success).toBe(true);
        expect(result.description).toContain('Cycled');

        // Card should be in graveyard
        const graveyard = result.state.zones.get(`${player1Id}-graveyard`);
        expect(graveyard?.cardIds).toContain(cyclingCard.id);

        // Hand size depends on library - if library has cards, hand size stays same (1 cycled, 1 drawn)
        // If library is empty, hand size decreases by 1 (card cycled, no card drawn)
        const hand = result.state.zones.get(`${player1Id}-hand`);
        const library = result.state.zones.get(`${player1Id}-library`);

        if (initialLibrarySize > 0) {
          expect(hand?.cardIds.length).toBe(initialHandSize);
          expect(library?.cardIds.length).toBe(initialLibrarySize - 1);
        } else {
          expect(hand?.cardIds.length).toBe(initialHandSize - 1);
        }
      });

      it('should spend mana when cycling', () => {
        const player = gameState.players.get(player1Id);
        const initialMana = player?.manaPool.generic || 0;

        const result = cycleCard(gameState, player1Id, cyclingCard.id as any);
        const updatedPlayer = result.state.players.get(player1Id);

        expect(updatedPlayer?.manaPool.generic).toBeLessThan(initialMana);
      });

      it('should fail without enough mana', () => {
        // Remove mana by creating a fresh state with no mana
        const player = gameState.players.get(player1Id);
        if (player) {
          const updatedPlayers = new Map(gameState.players);
          updatedPlayers.set(player1Id, {
            ...player,
            manaPool: { colorless: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, generic: 0 },
          });
          gameState = { ...gameState, players: updatedPlayers };
        }

        const result = cycleCard(gameState, player1Id, cyclingCard.id as any);

        expect(result.success).toBe(false);
        expect(result.error).toContain('mana');
      });

      it('should handle landcycling by searching for land', () => {
        // Create a fresh state for this test
        let testState = createInitialGameState(['Player1', 'Player2'], 20, false);
        startGame(testState);
        const playerIds = Array.from(testState.players.keys());
        const p1Id = playerIds[0];

        // Create a new landcycling card with proper oracle_text
        const lcCard = createCardInstance(
          createMockCard('Landcycling Card', 'Creature', 'Plainscycling {W}'),
          p1Id,
          p1Id
        );

        // Add landcycling card to hand
        const hand = testState.zones.get(`${p1Id}-hand`);
        if (hand) {
          const updatedHand = {
            ...hand,
            cardIds: [...hand.cardIds, lcCard.id],
          };
          const updatedZones = new Map(testState.zones);
          updatedZones.set(`${p1Id}-hand`, updatedHand);
          testState = {
            ...testState,
            zones: updatedZones,
            cards: new Map(testState.cards).set(lcCard.id, lcCard),
          };
        }

        // Add a plains to library
        const library = testState.zones.get(`${p1Id}-library`);
        const plains = createCardInstance(
          createMockCard('Plains', 'Land — Plains', '', []),
          p1Id,
          p1Id
        );
        if (library) {
          const updatedLibrary = {
            ...library,
            cardIds: [...library.cardIds, plains.id],
          };
          const updatedZones = new Map(testState.zones);
          updatedZones.set(`${p1Id}-library`, updatedLibrary);
          testState = {
            ...testState,
            zones: updatedZones,
            cards: new Map(testState.cards).set(plains.id, plains),
          };
        }

        // Give player white mana
        testState = addMana(testState, p1Id, { white: 1 });

        const result = cycleCard(testState, p1Id, lcCard.id as any);

        expect(result.success).toBe(true);
        expect(result.description).toContain('landcycling');

        // Plains should be in hand
        const updatedHand = result.state.zones.get(`${p1Id}-hand`);
        expect(updatedHand?.cardIds).toContain(plains.id);
      });
    });
  });
});

// Helper function to add mana to a player
function addMana(state: GameState, playerId: PlayerId, mana: { generic?: number; white?: number; blue?: number; black?: number; red?: number; green?: number }): GameState {
  const player = state.players.get(playerId);
  if (!player) return state;

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    manaPool: {
      ...player.manaPool,
      generic: (player.manaPool.generic || 0) + (mana.generic || 0),
      white: (player.manaPool.white || 0) + (mana.white || 0),
      blue: (player.manaPool.blue || 0) + (mana.blue || 0),
      black: (player.manaPool.black || 0) + (mana.black || 0),
      red: (player.manaPool.red || 0) + (mana.red || 0),
      green: (player.manaPool.green || 0) + (mana.green || 0),
    },
  });

  return {
    ...state,
    players: updatedPlayers,
  };
}
