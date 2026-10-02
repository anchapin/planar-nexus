/**
 * Persist keyword action (CR 702.78): the dies-trigger return-to-battlefield handling.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 *
 * Issue #2338 — evergreen keyword enforcement (persist portion).
 *
 * Before this change, persist was gated *only* through
 * `evergreen-keywords.hasPersist` -> `hasKeyword(card, "persist")`, and
 * `hasKeyword` resolves as
 *
 *     keywords.some(exact) || oracleText.includes("persist")
 *
 * The second arm is an **unanchored substring** test. That matters far more
 * here than for most keywords, because persist's gate sits on the
 * state-based-action death path:
 *
 *     state-based-actions.ts  -> handlePersist() -> hasPersist() -> hasKeyword()
 *
 * `handlePersist` returns the card **to the battlefield from the graveyard**
 * with a -1/-1 counter. So a creature whose `keywords` array omits the tag but
 * whose oracle text merely contains the substring `persist` was wrongly
 * re-entered onto the battlefield by the SBA loop. `includes("persist")`
 * matches inside `persistent`, `persists`, `persisted`, and `impersistency`,
 * not just the standalone keyword.
 *
 * `hasPersistStrict` below establishes the canonical contract — consult ONLY
 * the parsed `keywords` array — mirroring `hasHasteStrict`, `hasShroudStrict`,
 * `hasLifelinkStrict`, `hasDeathtouchStrict`, `hasHexproofStrict`, and the
 * other strict checks in this directory.
 *
 * Note: unlike most of those siblings this module is not a pure leaf — it
 * imports `hasPersist` / `canPersistTrigger` from `evergreen-keywords`, which
 * in turn imports `hasPersistStrict` from here. That cycle is safe because
 * every cross-reference is a hoisted function declaration and the strict check
 * is only ever invoked at runtime, never during module evaluation.
 */
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  Counter,
} from "../types";
import { hasPersist, canPersistTrigger } from "../evergreen-keywords";
import { fireEntersTriggers } from "./enters";

/**
 * CR 702.78 — strict check for the Persist keyword.
 *
 * True iff the parsed `keywords` array contains "persist" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHasteStrict` / `hasShroudStrict` / `hasLifelinkStrict` in consulting
 * only the parsed keyword list, never the raw oracle text.
 *
 * The word-boundary anchor matters: a keyword entry of "persistent" or
 * "persists" is a *mention*, not the keyword, and must not grant persist.
 */
export function hasPersistStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^persist\b/i.test(k.trim()));
}

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
    currentZoneKey: battlefieldKey,
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

  // Returning from the graveyard is entering the battlefield (CR 603.6a).
  return {
    state: fireEntersTriggers(updatedState, deadCardId),
    persistedCards,
    descriptions,
  };
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
