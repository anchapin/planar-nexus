/**
 * Maximum hand size (CR 402.2, CR 514.1, issue #2446).
 *
 * A player's limit is `maxHandSize` (7) plus `currentHandSizeModifier`.
 * "You have no maximum hand size" (Proft's Eidetic Memory) lifts it while a
 * permanent with that text is on the battlefield under that player's control.
 */
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  WaitingChoice,
} from "../types";
import { discardCards } from "./draw";
import type { KeywordActionResult } from "./shared";

const NO_MAX_HAND_SIZE = /\byou have no maximum hand size\b/i;

/** True when the player controls a permanent saying "You have no maximum hand size". */
export function hasNoMaximumHandSize(
  state: GameState,
  playerId: PlayerId,
): boolean {
  const battlefield = state.zones.get(`${playerId}-battlefield`);
  for (const cardId of battlefield?.cardIds ?? []) {
    const card = state.cards.get(cardId);
    if (!card || card.controllerId !== playerId) continue;
    if (NO_MAX_HAND_SIZE.test(card.cardData.oracle_text ?? "")) return true;
  }
  return false;
}

/** The player's current maximum hand size; Infinity when it has been lifted. */
export function getPlayerMaxHandSize(
  state: GameState,
  playerId: PlayerId,
): number {
  if (hasNoMaximumHandSize(state, playerId)) return Infinity;
  const player = state.players.get(playerId);
  if (!player) return 7;
  return Math.max(
    0,
    (player.maxHandSize ?? 7) + (player.currentHandSizeModifier ?? 0),
  );
}

/** How many cards the player must discard in cleanup (CR 514.1). */
export function cardsOverHandSize(
  state: GameState,
  playerId: PlayerId,
): number {
  const hand = state.zones.get(`${playerId}-hand`);
  const max = getPlayerMaxHandSize(state, playerId);
  if (!hand || max === Infinity) return 0;
  return Math.max(0, hand.cardIds.length - max);
}

/**
 * Discard down to maximum hand size. `chosen` is the player's pick, in order;
 * without it the last cards in hand are discarded.
 */
export function discardToHandSize(
  state: GameState,
  playerId: PlayerId,
  chosen?: CardInstanceId[],
): KeywordActionResult {
  const excess = cardsOverHandSize(state, playerId);
  if (excess === 0) {
    return { success: true, state, description: "" };
  }
  return discardCards(state, playerId, excess, false, chosen);
}

/** Waiting-choice type for the cleanup discard (CR 514.1). */
export const HAND_SIZE_DISCARD_CHOICE_TYPE = "discard_to_hand_size" as const;

/**
 * The choice a player makes in cleanup when over maximum hand size: pick
 * exactly as many cards from hand as they must discard. Null when no discard
 * is needed.
 */
export function createHandSizeDiscardChoice(
  state: GameState,
  playerId: PlayerId,
): WaitingChoice | null {
  const excess = cardsOverHandSize(state, playerId);
  if (excess === 0) return null;
  const hand = state.zones.get(`${playerId}-hand`)?.cardIds ?? [];
  const max = getPlayerMaxHandSize(state, playerId);
  return {
    type: HAND_SIZE_DISCARD_CHOICE_TYPE,
    playerId,
    stackObjectId: null,
    prompt: `Discard ${excess} card${excess === 1 ? "" : "s"} down to your maximum hand size of ${max}.`,
    choices: hand.map((cardId) => ({
      label: state.cards.get(cardId)?.cardData.name ?? cardId,
      value: cardId,
      isValid: true,
    })),
    minChoices: excess,
    maxChoices: excess,
    presentedAt: Date.now(),
  };
}

/**
 * Check a cleanup-discard answer: exactly the required number of distinct
 * cards, all in the player's hand. Returns an error message, or null when
 * the pick is legal.
 */
export function validateHandSizeDiscard(
  state: GameState,
  playerId: PlayerId,
  chosen: readonly string[],
): string | null {
  const excess = cardsOverHandSize(state, playerId);
  if (chosen.length !== excess) {
    return `Choose exactly ${excess} card${excess === 1 ? "" : "s"} to discard`;
  }
  if (new Set(chosen).size !== chosen.length) {
    return "Each card can only be discarded once";
  }
  const hand = new Set(state.zones.get(`${playerId}-hand`)?.cardIds ?? []);
  if (chosen.some((id) => !hand.has(id))) {
    return "You can only discard cards in your hand";
  }
  return null;
}
