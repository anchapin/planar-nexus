/**
 * Draw/discard keyword actions (CR 701.14/701.16), including replacement-aware single-card draw.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId, PlayerId } from '../types';
import { moveCardToZone } from './removal';
import { KeywordActionResult } from './shared';

/**
 * Draw cards for a player
 * Handles replacement effects (e.g., "If you would draw a card, draw two instead")
 */
export function drawCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1,
): KeywordActionResult {
  const player = state.players.get(playerId);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  let cardsDrawn = 0;
  let currentState = state;
  const drawnCardIds: CardInstanceId[] = [];

  for (let i = 0; i < count; i++) {
    // Check for replacement effects
    const replacementEvent = {
      type: "draw_card" as const,
      timestamp: Date.now(),
      targetId: playerId,
      amount: 1,
    };

    const rem = currentState.replacementEffectManager;
    const apnapOrder = rem.createAPNAPOrder(
      currentState.turn.activePlayerId,
      Array.from(currentState.players.keys()),
    );
    const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
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
    description: `Drew ${cardsDrawn} card${cardsDrawn !== 1 ? "s" : ""} for ${player.name}`,
    affectedCards: drawnCardIds,
  };
}

/**
 * Draw a single card (internal function)
 */
function drawSingleCard(
  state: GameState,
  playerId: PlayerId,
): KeywordActionResult {
  const libraryZoneKey = `${playerId}-library`;
  const handZoneKey = `${playerId}-hand`;

  const library = state.zones.get(libraryZoneKey);
  const hand = state.zones.get(handZoneKey);

  if (!library || !hand) {
    return {
      success: false,
      state,
      description: "",
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
    description: card ? `Drew ${card.cardData.name}` : "Drew a card",
    affectedCards: cardId ? [cardId] : [],
  };
}

/**
 * Discard cards from a player's hand
 *
 * Issue #1414: an optional `specificCards` list may be passed to discard
 * exactly those cards (in order). When omitted the legacy behavior is
 * preserved — random mode picks one card at random; non-random mode
 * discards `count` cards from the end of the hand array. The
 * difficulty-scaled AI cleanup-phase helper
 * (`src/ai/cleanup-discard.ts`) uses `specificCards` to feed its
 * per-tier ranking into the engine.
 */
export function discardCards(
  state: GameState,
  playerId: PlayerId,
  count: number = 1,
  random: boolean = false,
  specificCards?: CardInstanceId[],
): KeywordActionResult {
  const player = state.players.get(playerId);
  const handZoneKey = `${playerId}-hand`;
  const hand = state.zones.get(handZoneKey);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  if (!hand) {
    return {
      success: false,
      state,
      description: "",
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

  if (specificCards && specificCards.length > 0) {
    // Issue #1414: caller (e.g. AI cleanup helper) supplied an ordered
    // candidate list — discard exactly those cards that are still in the
    // hand, capped at `count`. Cards already moved out of the hand are
    // silently skipped (defensive against double-discards).
    const inHand = new Set(hand.cardIds);
    cardsToDiscard = specificCards
      .filter((id) => inHand.has(id))
      .slice(0, Math.max(0, count));
    // Fall back to the legacy path if every named card was already gone.
    if (cardsToDiscard.length === 0) {
      if (random && hand.cardIds.length > 0) {
        const randomIndex = Math.floor(Math.random() * hand.cardIds.length);
        cardsToDiscard = [hand.cardIds[randomIndex]];
      } else {
        cardsToDiscard = hand.cardIds.slice(-count);
      }
    }
  } else if (random && hand.cardIds.length > 0) {
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
    const result = moveCardToZone(state, cardId, "graveyard");
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
    description: `Discarded ${discardedCards.length} card${discardedCards.length !== 1 ? "s" : ""} from ${player.name}'s hand`,
    affectedCards: discardedCards,
  };
}

