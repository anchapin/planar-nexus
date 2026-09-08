/**
 * Counter manipulation keyword actions: adding/removing counters on cards.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId } from '../types';
import { addCounters, removeCounters } from '../card-instance';
import { KeywordActionResult } from './shared';

/**
 * Add a counter to a card
 */
export function addCounterToCard(
  state: GameState,
  cardId: CardInstanceId,
  counterType: string,
  count: number = 1,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
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
    description: `Added ${count} ${counterType} counter${count !== 1 ? "s" : ""} to ${card.cardData.name}`,
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
  count: number = 1,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
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
    description: `Removed ${count} ${counterType} counter${count !== 1 ? "s" : ""} from ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

