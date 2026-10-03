/**
 * Maximum hand size (CR 402.2, CR 514.1, issue #2446).
 *
 * A player's limit is `maxHandSize` (7) plus `currentHandSizeModifier`.
 * "You have no maximum hand size" (Proft's Eidetic Memory) lifts it while a
 * permanent with that text is on the battlefield under that player's control.
 */
import type { CardInstanceId, GameState, PlayerId } from "../types";
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
