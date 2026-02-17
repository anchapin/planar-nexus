/**
 * State-Based Actions System
 * Implements MTG state-based actions (SBAs) as defined in Comprehensive Rules 704.
 * SBAs are checked continuously and performed automatically.
 */

import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from './types';
import {
  isCreature,
  isPlaneswalker,
  isEnchantment,
  getToughness,
  hasLethalDamage,
} from './card-instance';
import { destroyCard, exileCard, moveCardToZone } from './keyword-actions';

// Helper functions to check card types
function isAura(card: CardInstance): boolean {
  return card.cardData.type_line?.toLowerCase().includes('aura') ?? false;
}

function isEquipment(card: CardInstance): boolean {
  return card.cardData.type_line?.toLowerCase().includes('equipment') ?? false;
}

/**
 * Result of state-based action checking
 */
export interface StateBasedActionResult {
  /** Whether any SBAs were performed */
  actionsPerformed: boolean;
  /** Updated game state */
  state: GameState;
  /** Descriptions of actions performed */
  descriptions: string[];
}

/**
 * Check and perform state-based actions
 * Called after any game event that could trigger SBAs
 * Issue #15: Handle state-based actions
 */
export function checkStateBasedActions(state: GameState): StateBasedActionResult {
  let updatedState = { ...state };
  const descriptions: string[] = [];
  let actionsPerformed = false;

  // Check each player for SBAs
  for (const [playerId, player] of updatedState.players) {
    // SBA 704.5a: A player with 0 or less life loses the game
    if (player.life <= 0) {
      updatedState = {
        ...updatedState,
        players: new Map(updatedState.players).set(playerId, {
          ...player,
          hasLost: true,
          lossReason: 'Life total reached 0 or less',
        }),
      };
      descriptions.push(`${player.name} loses the game (0 or less life)`);
      actionsPerformed = true;
    }

    // SBA 704.5b: A player with 10 or more poison counters loses the game
    if (player.poisonCounters >= 10) {
      updatedState = {
        ...updatedState,
        players: new Map(updatedState.players).set(playerId, {
          ...player,
          hasLost: true,
          lossReason: 'Accumulated 10 or more poison counters',
        }),
      };
      descriptions.push(`${player.name} loses the game (10+ poison counters)`);
      actionsPerformed = true;
    }

    // SBA 704.5c: A player attempting to draw from an empty library loses the game
    // This is tracked separately - for now, we check if library is empty
    const libraryKey = `${playerId}-library`;
    const library = updatedState.zones.get(libraryKey);
    if (library && library.cardIds.length === 0) {
      // Player will lose on their next draw attempt
      // This is handled in the draw function
    }
  }

  // Check cards for SBAs
  const cardsToCheck = Array.from(updatedState.cards.values());
  const cardsToDestroy: CardInstanceId[] = [];
  const cardsToExile: CardInstanceId[] = [];

  for (const card of cardsToCheck) {
    // Find the card's current zone
    let currentZoneKey: string | null = null;
    for (const [zoneKey, zone] of updatedState.zones) {
      if (zone.cardIds.includes(card.id)) {
        currentZoneKey = zoneKey;
        break;
      }
    }

    if (!currentZoneKey) continue;

    // SBA 704.5f: A creature with lethal damage is destroyed
    if (isCreature(card) && hasLethalDamage(card)) {
      if (!cardsToDestroy.includes(card.id)) {
        cardsToDestroy.push(card.id);
        descriptions.push(`${card.cardData.name} is destroyed (lethal damage)`);
        actionsPerformed = true;
      }
    }

    // SBA 704.5g: A creature with toughness 0 or less is destroyed
    if (isCreature(card)) {
      const toughness = getToughness(card);
      if (toughness <= 0) {
        if (!cardsToDestroy.includes(card.id)) {
          cardsToDestroy.push(card.id);
        }
        descriptions.push(`${card.cardData.name} is destroyed (toughness 0 or less)`);
        actionsPerformed = true;
      }
    }

    // SBA 704.5i: A planeswalker with 0 loyalty is exiled
    if (isPlaneswalker(card)) {
      const loyaltyCounters = card.counters?.find(c => c.type === 'loyalty');
      if (loyaltyCounters && loyaltyCounters.count <= 0) {
        if (!cardsToExile.includes(card.id)) {
          cardsToExile.push(card.id);
        }
        descriptions.push(`${card.cardData.name} is exiled (0 loyalty)`);
        actionsPerformed = true;
      }
    }

    // SBA 704.5m: An Aura attached to an illegal object is put into its owner's graveyard
    if (isAura(card) && card.attachedToId) {
      const attachedTo = updatedState.cards.get(card.attachedToId);
      // Check if the target still exists and is on the battlefield
      let attachedToOnBattlefield = false;
      if (attachedTo) {
        for (const [zoneKey, zone] of updatedState.zones) {
          if (zoneKey.includes('battlefield') && zone.cardIds.includes(card.attachedToId!)) {
            attachedToOnBattlefield = true;
            break;
          }
        }
      }
      if (!attachedToOnBattlefield) {
        // Aura's target is gone - put aura in graveyard
        if (!cardsToDestroy.includes(card.id)) {
          cardsToDestroy.push(card.id);
        }
        descriptions.push(`${card.cardData.name} is destroyed (enchanting nothing)`);
        actionsPerformed = true;
      }
    }

    // SBA 704.5n: An Equipment or Fortification attached to a non-permanent is put in the graveyard
    if (isEquipment(card) && card.attachedToId) {
      const attachedTo = updatedState.cards.get(card.attachedToId);
      // Check if the attached object is on the battlefield
      let attachedToOnBattlefield = false;
      if (attachedTo) {
        for (const [zoneKey, zone] of updatedState.zones) {
          if (zoneKey.includes('battlefield') && zone.cardIds.includes(card.attachedToId!)) {
            attachedToOnBattlefield = true;
            break;
          }
        }
      }
      // Equipment can only attach to creatures - if target is not a creature or not on battlefield, it's illegal
      if (attachedTo && attachedToOnBattlefield && !isCreature(attachedTo)) {
        if (!cardsToDestroy.includes(card.id)) {
          cardsToDestroy.push(card.id);
        }
        descriptions.push(`${card.cardData.name} is destroyed (attached to non-creature)`);
        actionsPerformed = true;
      }
    }
  }

  // Destroy all marked cards
  for (const cardId of cardsToDestroy) {
    const destroyResult = destroyCard(updatedState, cardId);
    if (destroyResult.success) {
      updatedState = destroyResult.state;
      const card = updatedState.cards.get(cardId);
      if (card) {
        descriptions.push(`Destroyed ${card?.cardData.name}`);
      }
    }
  }

  // Exile all marked cards
  for (const cardId of cardsToExile) {
    const exileResult = exileCard(updatedState, cardId);
    if (exileResult.success) {
      updatedState = exileResult.state;
    }
  }

  // Check for legendary rule (SBA 704.5j)
  // Two legendary permanents with the same name - keep one, destroy the rest
  const legendaryPermanents = cardsToCheck.filter(card => {
    // Check if card is on battlefield by looking in zones
    let isOnBattlefield = false;
    for (const [zoneKey, zone] of updatedState.zones) {
      if (zoneKey.includes('battlefield') && zone.cardIds.includes(card.id)) {
        isOnBattlefield = true;
        break;
      }
    }
    const isLegendary = card.cardData.type_line?.toLowerCase().includes('legendary') ?? false;
    return isOnBattlefield && isLegendary;
  });

  const nameGroups = new Map<string, CardInstanceId[]>();
  for (const card of legendaryPermanents) {
    const name = card.cardData.name.toLowerCase();
    const existing = nameGroups.get(name) || [];
    existing.push(card.id);
    nameGroups.set(name, existing);
  }

  for (const [name, cardIds] of nameGroups) {
    if (cardIds.length > 1) {
      // Keep the first one, destroy the rest
      for (let i = 1; i < cardIds.length; i++) {
        const destroyResult = destroyCard(updatedState, cardIds[i]);
        if (destroyResult.success) {
          updatedState = destroyResult.state;
          const card = updatedState.cards.get(cardIds[i]);
          descriptions.push(`Destroyed ${card?.cardData.name} (legendary rule)`);
          actionsPerformed = true;
        }
      }
    }
  }

  // Check for world rule (SBA 704.5k)
  // Two world permanents exist - destroy the older one
  const worldPermanents = cardsToCheck.filter(card => {
    return card.cardData.type_line?.toLowerCase().includes('world') ?? false;
  });

  const worldNameGroups = new Map<string, { card: CardInstance; timestamp: number }[]>();
  for (const card of worldPermanents) {
    const name = card.cardData.name.toLowerCase();
    const existing = worldNameGroups.get(name) || [];
    existing.push({ card, timestamp: card.enteredBattlefieldTimestamp });
    worldNameGroups.set(name, existing);
  }

  for (const [name, cards] of worldNameGroups) {
    if (cards.length > 1) {
      // Sort by timestamp and keep the newest
      cards.sort((a, b) => b.timestamp - a.timestamp);
      for (let i = 1; i < cards.length; i++) {
        const destroyResult = destroyCard(updatedState, cards[i].card.id);
        if (destroyResult.success) {
          updatedState = destroyResult.state;
          descriptions.push(`Destroyed ${cards[i].card.cardData.name} (world rule)`);
          actionsPerformed = true;
        }
      }
    }
  }

  // Check for planeswalker uniqueness (SBA 704.5j variant)
  // A player can only control one planeswalker of each type
  const planeswalkers = cardsToCheck.filter(card => isPlaneswalker(card));
  const pwTypeGroups = new Map<string, CardInstanceId[]>();
  
  for (const pw of planeswalkers) {
    // Extract planeswalker type from type line (e.g., "Jace" from "Legendary Planeswalker - Jace")
    const typeLine = pw.cardData.type_line || '';
    // Handle both em dash and regular hyphen
    const pwType = typeLine.replace(/Legendary Planeswalker [-—] /, '').trim();

    const existing = pwTypeGroups.get(pwType) || [];
    existing.push(pw.id);
    pwTypeGroups.set(pwType, existing);
  }

  for (const [pwType, cardIds] of pwTypeGroups) {
    if (cardIds.length > 1) {
      // Keep the first one, destroy the rest
      for (let i = 1; i < cardIds.length; i++) {
        const destroyResult = destroyCard(updatedState, cardIds[i]);
        if (destroyResult.success) {
          updatedState = destroyResult.state;
          const card = updatedState.cards.get(cardIds[i]);
          descriptions.push(`Destroyed ${card?.cardData.name} (planeswalker uniqueness)`);
          actionsPerformed = true;
        }
      }
    }
  }

  // Check win condition after all SBAs
  // Always check win condition in case players were already marked as lost
  updatedState = checkWinCondition(updatedState);
  if (updatedState.status === 'completed' && state.status !== 'completed') {
    actionsPerformed = true;
  }

  return {
    actionsPerformed,
    state: updatedState,
    descriptions,
  };
}

/**
 * Check if the game has ended
 */
function checkWinCondition(state: GameState): GameState {
  const activePlayers = Array.from(state.players.values()).filter(
    (p) => !p.hasLost
  );

  if (activePlayers.length === 1) {
    return {
      ...state,
      status: 'completed' as const,
      winners: [activePlayers[0].id],
      endReason: 'All other players have lost the game',
      lastModifiedAt: Date.now(),
    };
  }

  if (activePlayers.length === 0) {
    // Draw game
    return {
      ...state,
      status: 'completed' as const,
      winners: [],
      endReason: 'All players lost the game simultaneously',
      lastModifiedAt: Date.now(),
    };
  }

  return state;
}

/**
 * Check if a player can draw (has cards in library)
 */
export function canDraw(state: GameState, playerId: PlayerId): boolean {
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey);
  return library !== undefined && library.cardIds.length > 0;
}

/**
 * Process a draw action with SBA checking
 * If library is empty, player loses
 */
export function drawWithSBAChecking(
  state: GameState,
  playerId: PlayerId
): { success: boolean; state: GameState; description: string } {
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey);
  const player = state.players.get(playerId);

  if (!library || !player) {
    return { success: false, state, description: 'Player or library not found' };
  }

  if (library.cardIds.length === 0) {
    // Player loses for trying to draw from empty library (SBA 704.5c)
    const updatedState = {
      ...state,
      players: new Map(state.players).set(playerId, {
        ...player,
        hasLost: true,
        lossReason: 'Attempted to draw from empty library',
      }),
    };
    
    return {
      success: false,
      state: checkWinCondition(updatedState),
      description: `${player.name} loses - attempted to draw from empty library`,
    };
  }

  // Normal draw - handled by drawCards in keyword-actions
  return { success: true, state, description: 'Draw available' };
}
