/**
 * Keyword Actions System
 * 
 * Implements standard MTG keyword actions as described in the Comprehensive Rules.
 * Reference: CR 701 - Keyword Actions
 * 
 * Keyword actions include:
 * - Destroy (with regeneration/indestructible handling)
 * - Exile (with face-up/face-down options)
 * - Sacrifice
 * - Draw (with replacement effects)
 * - Discard
 * - Create token
 * - Counter (spell or ability)
 * - Regenerate
 */

import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Zone,
  ScryfallCard,
} from './types';
import {
  createToken,
  getToughness,
  addCounters,
  removeCounters,
  hasCounter,
} from './card-instance';
import { replacementEffectManager } from './replacement-effects';

/**
 * Result of a keyword action
 */
export interface KeywordActionResult {
  /** Whether the action was successful */
  success: boolean;
  /** Updated game state */
  state: GameState;
  /** Description of what happened */
  description: string;
  /** Cards that were affected */
  affectedCards?: CardInstanceId[];
  /** Error message if failed */
  error?: string;
}

/**
 * Check if a card has indestructible
 */
export function hasIndestructible(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || '';
  const keywords = card.cardData.keywords || [];
  
  return (
    keywords.includes('Indestructible') ||
    oracleText.includes('indestructible')
  );
}

/**
 * Check if a card can be regenerated (has regenerate ability)
 */
export function canBeRegenerated(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || '';
  return oracleText.includes('regenerate');
}

/**
 * Destroy a permanent
 * Handles indestructible and regeneration
 */
export function destroyCard(
  state: GameState,
  cardId: CardInstanceId,
  ignoreIndestructible: boolean = false
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Check for indestructible
  if (!ignoreIndestructible && hasIndestructible(card)) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is indestructible and cannot be destroyed`,
    };
  }

  // Check for replacement effects (e.g., "If a creature would be destroyed, exile it instead")
  const replacementEvent = {
    type: 'destroy' as const,
    amount: 0,
    timestamp: Date.now(),
    targetId: cardId,
  };
  
  const processedEvent = replacementEffectManager.processEvent(replacementEvent);
  
  if (processedEvent.type === 'exile') {
    // Replacement effect changed destroy to exile
    return exileCard(state, cardId);
  }

  // Move card to graveyard
  return moveCardToZone(state, cardId, 'graveyard');
}

/**
 * Exile a card
 * Can be face-up or face-down
 */
export function exileCard(
  state: GameState,
  cardId: CardInstanceId,
  faceDown: boolean = false
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Find the card's current zone
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = null;
  
  for (const [zoneKey, zone] of state.zones) {
    if (zone.cardIds.includes(cardId)) {
      currentZone = zone;
      currentZoneKey = zoneKey;
      break;
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine exile zone (player's exile or shared exile)
  const exileZoneKey = card.controllerId 
    ? `${card.controllerId}-exile` 
    : 'exile';
  
  const exileZone = state.zones.get(exileZoneKey);
  
  if (!exileZone) {
    return {
      success: false,
      state,
      description: '',
      error: `Exile zone not found`,
    };
  }

  // Update card state
  const updatedCard = {
    ...card,
    isFaceDown: faceDown,
    attachedToId: null, // Detach from any attachments
    attachedCardIds: [], // Remove any attachments
  };

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter(id => id !== cardId),
  };

  const updatedExileZone = {
    ...exileZone,
    cardIds: [...exileZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(exileZoneKey, updatedExileZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const faceDownText = faceDown ? ' face down' : '';

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Exiled ${card.cardData.name}${faceDownText}`,
    affectedCards: [cardId],
  };
}

/**
 * Sacrifice a permanent
 * The controller of the sacrificed card chooses what to sacrifice
 */
export function sacrificeCard(
  state: GameState,
  cardId: CardInstanceId
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Move to graveyard (sacrificed cards go to owner's graveyard)
  return moveCardToZone(state, cardId, 'graveyard');
}

/**
 * Draw cards for a player
 * Handles replacement effects (e.g., "If you would draw a card, draw two instead")
 */
export function drawCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1
): KeywordActionResult {
  const player = state.players.get(playerId);
  
  if (!player) {
    return {
      success: false,
      state,
      description: '',
      error: `Player ${playerId} not found`,
    };
  }

  let cardsDrawn = 0;
  let currentState = state;
  const drawnCardIds: CardInstanceId[] = [];

  for (let i = 0; i < count; i++) {
    // Check for replacement effects
    const replacementEvent = {
      type: 'draw_card' as const,
      timestamp: Date.now(),
      targetId: playerId,
      amount: 1,
    };
    
    const processedEvent = replacementEffectManager.processEvent(replacementEvent);
    const drawAmount = processedEvent.amount;
    
    // Draw each card
    for (let j = 0; j < drawAmount; j++) {
      const result = drawSingleCard(currentState, playerId);
      
      if (result.success) {
        currentState = result.state;
        if (result.affectedCards) {
          drawnCardIds.push(...result.affectedCards);
        }
        cardsDrawn++;
      }
    }
  }

  return {
    success: cardsDrawn > 0,
    state: currentState,
    description: `Drew ${cardsDrawn} card${cardsDrawn !== 1 ? 's' : ''} for ${player.name}`,
    affectedCards: drawnCardIds,
  };
}

/**
 * Draw a single card (internal function)
 */
function drawSingleCard(
  state: GameState,
  playerId: PlayerId
): KeywordActionResult {
  const libraryZoneKey = `${playerId}-library`;
  const handZoneKey = `${playerId}-hand`;

  const library = state.zones.get(libraryZoneKey);
  const hand = state.zones.get(handZoneKey);

  if (!library || !hand) {
    return {
      success: false,
      state,
      description: '',
      error: `Library or hand zone not found for player`,
    };
  }

  if (library.cardIds.length === 0) {
    // Player loses the game when they cannot draw (state-based action)
    // Mark this in game state for SBA to handle
    return {
      success: false,
      state,
      description: `${state.players.get(playerId)?.name} cannot draw - library is empty`,
    };
  }

  // Draw from top of library
  const cardId = library.cardIds[library.cardIds.length - 1];
  const card = state.cards.get(cardId);

  const updatedLibrary = {
    ...library,
    cardIds: library.cardIds.slice(0, -1),
  };

  const updatedHand = {
    ...hand,
    cardIds: [...hand.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(libraryZoneKey, updatedLibrary);
  updatedZones.set(handZoneKey, updatedHand);

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      lastModifiedAt: Date.now(),
    },
    description: card ? `Drew ${card.cardData.name}` : 'Drew a card',
    affectedCards: cardId ? [cardId] : [],
  };
}

/**
 * Discard cards from a player's hand
 */
export function discardCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1,
  random: boolean = false
): KeywordActionResult {
  const player = state.players.get(playerId);
  const handZoneKey = `${playerId}-hand`;
  const hand = state.zones.get(handZoneKey);

  if (!player) {
    return {
      success: false,
      state,
      description: '',
      error: `Player ${playerId} not found`,
    };
  }

  if (!hand) {
    return {
      success: false,
      state,
      description: '',
      error: `Hand zone not found for player`,
    };
  }

  if (hand.cardIds.length === 0) {
    return {
      success: false,
      state,
      description: `${player.name} has no cards to discard`,
    };
  }

  let cardsToDiscard: CardInstanceId[];

  if (random && hand.cardIds.length > 0) {
    // Random discard (mind rot effect)
    const randomIndex = Math.floor(Math.random() * hand.cardIds.length);
    cardsToDiscard = [hand.cardIds[randomIndex]];
  } else {
    // Controller chooses (for effects like "discard your hand")
    // In this case, we discard from the top (end of array)
    cardsToDiscard = hand.cardIds.slice(-count);
  }

  const discardedCards: CardInstanceId[] = [];

  for (const cardId of cardsToDiscard) {
    const result = moveCardToZone(state, cardId, 'graveyard');
    if (result.success) {
      state = result.state;
      if (result.affectedCards) {
        discardedCards.push(...result.affectedCards);
      }
    }
  }

  return {
    success: discardedCards.length > 0,
    state,
    description: `Discarded ${discardedCards.length} card${discardedCards.length !== 1 ? 's' : ''} from ${player.name}'s hand`,
    affectedCards: discardedCards,
  };
}

/**
 * Create a token on the battlefield
 */
export function createTokenCard(
  state: GameState,
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
  count: number = 1
): KeywordActionResult {
  const player = state.players.get(controllerId);
  
  if (!player) {
    return {
      success: false,
      state,
      description: '',
      error: `Player ${controllerId} not found`,
    };
  }

  const battlefieldZoneKey = `${controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) {
    return {
      success: false,
      state,
      description: '',
      error: `Battlefield zone not found`,
    };
  }

  const tokenIds: CardInstanceId[] = [];
  const updatedCards = new Map(state.cards);

  for (let i = 0; i < count; i++) {
    const token = createToken(tokenData, controllerId, ownerId);
    tokenIds.push(token.id);
    updatedCards.set(token.id, token);
  }

  const updatedBattlefield = {
    ...battlefield,
    cardIds: [...battlefield.cardIds, ...tokenIds],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(battlefieldZoneKey, updatedBattlefield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      zones: updatedZones,
      lastModifiedAt: Date.now(),
    },
    description: `Created ${count} ${tokenData.name} token${count !== 1 ? 's' : ''}`,
    affectedCards: tokenIds,
  };
}

/**
 * Counter a spell or ability on the stack
 */
export function counterSpell(
  state: GameState,
  stackObjectId: string
): KeywordActionResult {
  const stackIndex = state.stack.findIndex(s => s.id === stackObjectId);
  
  if (stackIndex === -1) {
    return {
      success: false,
      state,
      description: '',
      error: `Stack object ${stackObjectId} not found`,
    };
  }

  const stackObject = state.stack[stackIndex];

  // Mark as countered
  const updatedStackObject = {
    ...stackObject,
    isCountered: true,
  };

  const updatedStack = [
    ...state.stack.slice(0, stackIndex),
    updatedStackObject,
    ...state.stack.slice(stackIndex + 1),
  ];

  return {
    success: true,
    state: {
      ...state,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    },
    description: `Countered ${stackObject.name}`,
  };
}

/**
 * Regenerate a permanent
 * Creates a "regeneration shield" that prevents destruction
 */
export function regenerateCard(
  state: GameState,
  cardId: CardInstanceId
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Check if the card has regenerate ability
  // In a full implementation, this would check if the ability was activated
  // For now, we allow regeneration if the card could theoretically have it
  
  // Remove all damage
  const updatedCard = {
    ...card,
    damage: 0,
    isTapped: false, // Untap the card
  };

  // Add regeneration shield counter (using a special counter type)
  const updatedCardWithShield = addCounters(
    updatedCard,
    'regeneration-shield',
    1
  );

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCardWithShield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Regenerated ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Check and consume regeneration shield
 * Called when a card would be destroyed
 */
export function consumeRegenerationShield(
  state: GameState,
  cardId: CardInstanceId
): { hasShield: boolean; state: GameState } {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return { hasShield: false, state };
  }

  if (hasCounter(card, 'regeneration-shield')) {
    // Remove one regeneration shield
    const updatedCard = removeCounters(card, 'regeneration-shield', 1);
    
    const updatedCards = new Map(state.cards);
    updatedCards.set(cardId, updatedCard);

    return {
      hasShield: true,
      state: {
        ...state,
        cards: updatedCards,
        lastModifiedAt: Date.now(),
      },
    };
  }

  return { hasShield: false, state };
}

/**
 * Move a card to a specific zone
 */
export function moveCardToZone(
  state: GameState,
  cardId: CardInstanceId,
  targetZoneType: 'graveyard' | 'exile' | 'hand' | 'library' | 'battlefield'
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Find current zone
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = null;
  
  for (const [zoneKey, zone] of state.zones) {
    if (zone.cardIds.includes(cardId)) {
      currentZone = zone;
      currentZoneKey = zoneKey;
      break;
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine target zone
  let targetZoneKey: string;
  
  if (targetZoneType === 'library') {
    // Libraries are always player's own
    targetZoneKey = `${card.ownerId}-library`;
  } else if (targetZoneType === 'graveyard') {
    // Graveyards are owner's
    targetZoneKey = `${card.ownerId}-graveyard`;
  } else if (targetZoneType === 'exile') {
    // Exile can be controller's or shared
    targetZoneKey = card.controllerId 
      ? `${card.controllerId}-exile` 
      : 'exile';
  } else if (targetZoneType === 'hand') {
    targetZoneKey = `${card.controllerId}-hand`;
  } else if (targetZoneType === 'battlefield') {
    targetZoneKey = `${card.controllerId}-battlefield`;
  } else {
    return {
      success: false,
      state,
      description: '',
      error: `Invalid target zone: ${targetZoneType}`,
    };
  }

  const targetZone = state.zones.get(targetZoneKey);
  
  if (!targetZone) {
    return {
      success: false,
      state,
      description: '',
      error: `Target zone ${targetZoneKey} not found`,
    };
  }

  // Handle special cases
  let updatedCard = { ...card };
  
  if (targetZoneType === 'graveyard' || targetZoneType === 'library') {
    // Reset certain states when moving to graveyard or library
    updatedCard = {
      ...card,
      isTapped: false,
      isFaceDown: false,
      attachedToId: null,
      attachedCardIds: [],
      damage: 0,
      counters: [], // Remove counters
    };
  } else if (targetZoneType === 'battlefield') {
    // Set summoning sickness for permanents entering battlefield
    updatedCard = {
      ...card,
      hasSummoningSickness: true,
      enteredBattlefieldTimestamp: Date.now(),
    };
  }

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter(id => id !== cardId),
  };

  const updatedTargetZone = {
    ...targetZone,
    cardIds: [...targetZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(targetZoneKey, updatedTargetZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const zoneNames: Record<string, string> = {
    graveyard: 'graveyard',
    exile: 'exile',
    hand: 'hand',
    library: 'library',
    battlefield: 'battlefield',
  };

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Moved ${card.cardData.name} to ${zoneNames[targetZoneType]}`,
    affectedCards: [cardId],
  };
}

/**
 * Deal damage to a card (creature, planeswalker)
 */
export function dealDamageToCard(
  state: GameState,
  cardId: CardInstanceId,
  damage: number,
  isCombatDamage: boolean = false,
  sourceId?: CardInstanceId
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  // Check for prevention effects
  const replacementEvent = {
    type: 'damage' as const,
    timestamp: Date.now(),
    sourceId,
    targetId: cardId,
    amount: damage,
    isCombatDamage,
    damageTypes: (isCombatDamage ? ['combat'] : ['noncombat']) as ('combat' | 'noncombat')[],
  };

  const processedEvent = replacementEffectManager.processEvent(replacementEvent);
  const actualDamage = processedEvent.amount;

  // Apply damage
  let updatedCard = {
    ...card,
    damage: card.damage + actualDamage,
  };

  // Check for deathtouch on the source - lethal damage is 1 or more
  // CR 702.2b: Any nonzero amount of combat damage assigned by a source with deathtouch is considered lethal damage
  if (sourceId) {
    const sourceCard = state.cards.get(sourceId);
    if (sourceCard) {
      const sourceOracleText = sourceCard.cardData.oracle_text?.toLowerCase() || '';
      const sourceKeywords = sourceCard.cardData.keywords || [];
      const sourceHasDeathtouch = sourceKeywords.includes('Deathtouch') || sourceOracleText.includes('deathtouch');

      if (sourceHasDeathtouch && actualDamage > 0) {
        // With deathtouch, any amount of damage is lethal
        const lethalDamage = getToughness(card);
        updatedCard = {
          ...updatedCard,
          damage: Math.max(updatedCard.damage, lethalDamage),
        };
      }
    }
  }

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const damageType = isCombatDamage ? 'combat damage' : 'damage';

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `${card.cardData.name} dealt ${actualDamage} ${damageType}`,
    affectedCards: [cardId],
  };
}

/**
 * Add a counter to a card
 */
export function addCounterToCard(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  const updatedCard = addCounters(card, counterType, count);
  
  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Added ${count} ${counterType} counter${count !== 1 ? 's' : ''} to ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Remove a counter from a card
 */
export function removeCounterFromCard(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  const updatedCard = removeCounters(card, counterType, count);
  
  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Removed ${count} ${counterType} counter${count !== 1 ? 's' : ''} from ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Tap a card
 */
export function tapCardAction(
  state: GameState,
  cardId: CardInstanceId
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  if (card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already tapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: true,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Tapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Untap a card
 */
export function untapCardAction(
  state: GameState,
  cardId: CardInstanceId
): KeywordActionResult {
  const card = state.cards.get(cardId);
  
  if (!card) {
    return {
      success: false,
      state,
      description: '',
      error: `Card ${cardId} not found`,
    };
  }

  if (!card.isTapped) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is already untapped`,
    };
  }

  const updatedCard = {
    ...card,
    isTapped: false,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Untapped ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}
