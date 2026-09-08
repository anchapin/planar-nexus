/**
 * Persist keyword action (CR 702.78): the dies-trigger return-to-battlefield handling.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId, Counter } from '../types';
import { hasPersist, canPersistTrigger } from '../evergreen-keywords';

/**
 * Handle persist keyword when a creature dies
 * CR 702.78: When a creature with persist dies, if it had no -1/-1 counters on it,
 * return it to the battlefield with a -1/-1 counter on it.
 *
 * `countersAtDeath` is the counters the creature had on the battlefield at the
 * moment it died. It MUST be supplied by death-path callers (e.g. state-based
 * actions), because destroyCard()/moveCardToZone() clears counters when moving
 * the card to the graveyard. Without it the intervening-"if" (CR 603.4) could
 * never fail and persist would wrongly re-trigger on a creature that died with
 * a -1/-1 counter. Callers that operate on a card whose counters are still
 * intact (e.g. direct unit tests) may omit it.
 */
export function handlePersist(
  state: GameState,
  deadCardId: CardInstanceId,
  countersAtDeath?: Counter[],
): {
  state: GameState;
  persistedCards: CardInstanceId[];
  descriptions: string[];
} {
  const card = state.cards.get(deadCardId);
  const persistedCards: CardInstanceId[] = [];
  const descriptions: string[] = [];

  if (!card) {
    return { state, persistedCards, descriptions };
  }

  // Only creatures can have persist
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) {
    return { state, persistedCards, descriptions };
  }

  // Check if the card has persist
  if (!hasPersist(card)) {
    return { state, persistedCards, descriptions };
  }

  // Check if persist can trigger (creature must NOT have -1/-1 counter at death)
  if (!canPersistTrigger(card, countersAtDeath)) {
    descriptions.push(
      `${card.cardData.name} had a -1/-1 counter, persist did not trigger`,
    );
    return { state, persistedCards, descriptions };
  }

  // Find the graveyard zone
  const graveyardKey = `${card.ownerId}-graveyard`;
  const graveyardZone = state.zones.get(graveyardKey);

  if (!graveyardZone || !graveyardZone.cardIds.includes(deadCardId)) {
    return { state, persistedCards, descriptions };
  }

  // Remove card from graveyard
  const updatedGraveyardZone = {
    ...graveyardZone,
    cardIds: graveyardZone.cardIds.filter((id) => id !== deadCardId),
  };

  // Add card to battlefield with -1/-1 counter
  const battlefieldKey = `${card.controllerId}-battlefield`;
  const battlefieldZone = state.zones.get(battlefieldKey);

  if (!battlefieldZone) {
    return { state, persistedCards, descriptions };
  }

  const updatedBattlefieldZone = {
    ...battlefieldZone,
    cardIds: [...battlefieldZone.cardIds, deadCardId],
  };

  // Update the card with -1/-1 counter and battlefield state
  const updatedCard: CardInstance = {
    ...card,
    counters: [{ type: "-1/-1", count: 1 }],
    hasSummoningSickness: true,
    damage: 0,
    isTapped: false,
    attachedToId: null,
    attachedCardIds: [],
    enteredBattlefieldTimestamp: Date.now(),
  };

  // Update state
  const updatedZones = new Map(state.zones);
  updatedZones.set(graveyardKey, updatedGraveyardZone);
  updatedZones.set(battlefieldKey, updatedBattlefieldZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(deadCardId, updatedCard);

  const updatedState = {
    ...state,
    zones: updatedZones,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };

  persistedCards.push(deadCardId);
  descriptions.push(
    `${card.cardData.name} returned to battlefield with -1/-1 counter (Persist)`,
  );

  return { state: updatedState, persistedCards, descriptions };
}

// ===========================================================================
// Cycling (CR 702.30) + Typecycling / Landcycling / Basic landcycling
// (CR 702.31)
//
// "Cycling {cost}" is an activated ability that may be activated from a
// player's hand only. The cost is {cost} + discard this card; the effect is to
// draw a card (CR 702.30a). Typecycling / Landcycling / Basic landcycling are
// defined in CR 702.31 and replace the draw with a library search for a card
// of the named type. The cycle ability uses the stack (CR 602.2), so it can be
// responded to like any other activated ability.
//
// Like other activated abilities with discard costs, cycling can only be
// activated at sorcery timing — the active player during a main phase while
// the stack is empty (CR 117.1a). The implementation enforces that here and
// surfaces it via canCycleCard so callers (UI, AI) can gate the action.
// ===========================================================================

