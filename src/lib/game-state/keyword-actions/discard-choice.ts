/**
 * Discard chosen by the discarding player (CR 701.8a, issue #2536).
 *
 * A scripted "discards N cards" pauses the game on a `discard_cards` waiting
 * choice: the discarding player picks exactly N cards from hand. With N or
 * fewer cards in hand there is nothing to choose and the whole hand goes.
 * When several players discard for one effect, the later ones are queued on
 * the choice and asked in turn.
 */
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  WaitingChoice,
} from "../types";
import { discardCards } from "./draw";

/** Waiting-choice type for a scripted discard. */
export const SCRIPTED_DISCARD_CHOICE_TYPE = "discard_cards" as const;

type PendingDiscard = { playerId: PlayerId; amount: number };

function handOf(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-hand`)?.cardIds ?? [];
}

/**
 * Discard exactly `cards` and keep each discarded card's `currentZoneKey`
 * pointing at the graveyard, as the scripted Mill op does.
 */
function discardExactly(
  state: GameState,
  playerId: PlayerId,
  cards: readonly CardInstanceId[],
): ReturnType<typeof discardCards> {
  const r = discardCards(state, playerId, cards.length, false, [...cards]);
  if (!r.success) return r;
  const graveyardKey = `${playerId}-graveyard`;
  const next = new Map(r.state.cards);
  for (const cardId of r.affectedCards ?? []) {
    const card = next.get(cardId);
    if (card) next.set(cardId, { ...card, currentZoneKey: graveyardKey });
  }
  return { ...r, state: { ...r.state, cards: next } };
}

function discardChoice(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): WaitingChoice {
  return {
    type: SCRIPTED_DISCARD_CHOICE_TYPE,
    playerId,
    stackObjectId: null,
    prompt: `Discard ${amount} card${amount === 1 ? "" : "s"}.`,
    choices: handOf(state, playerId).map((cardId) => ({
      label: state.cards.get(cardId)?.cardData.name ?? cardId,
      value: cardId,
      isValid: true,
    })),
    minChoices: amount,
    maxChoices: amount,
    presentedAt: Date.now(),
  };
}

/**
 * Make `playerId` discard `amount` cards. Asks the player to choose when they
 * hold more than `amount`; otherwise discards their whole hand at once.
 */
export function startDiscard(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): GameState {
  const hand = handOf(state, playerId);
  if (hand.length === 0 || amount <= 0) return state;
  if (hand.length <= amount) {
    const r = discardExactly(state, playerId, hand);
    return r.success ? r.state : state;
  }
  const pending = state.waitingChoice;
  if (pending?.type === SCRIPTED_DISCARD_CHOICE_TYPE) {
    return {
      ...state,
      waitingChoice: {
        ...pending,
        pendingDiscards: [
          ...(pending.pendingDiscards ?? []),
          { playerId, amount },
        ],
      },
    };
  }
  if (pending) {
    // Another choice is already open; never clobber it. Fall back to the
    // engine's default pick rather than losing the discard.
    const r = discardCards(state, playerId, amount);
    return r.success ? r.state : state;
  }
  return { ...state, waitingChoice: discardChoice(state, playerId, amount) };
}

/** Start the queued discards in order until one needs a choice. */
function continueQueue(
  state: GameState,
  queue: readonly PendingDiscard[],
): GameState {
  let next = state;
  for (let i = 0; i < queue.length; i++) {
    next = startDiscard(next, queue[i].playerId, queue[i].amount);
    if (next.waitingChoice?.type === SCRIPTED_DISCARD_CHOICE_TYPE) {
      const rest = queue.slice(i + 1);
      if (rest.length === 0) return next;
      return {
        ...next,
        waitingChoice: {
          ...next.waitingChoice,
          pendingDiscards: [
            ...(next.waitingChoice.pendingDiscards ?? []),
            ...rest,
          ],
        },
      };
    }
  }
  return next;
}

/**
 * Answer a `discard_cards` choice: exactly the asked number of distinct cards
 * from the player's hand. Then asks the next queued player, if any.
 */
export function resolveScriptedDiscard(
  state: GameState,
  playerId: PlayerId,
  chosen: readonly string[],
): { success: boolean; state: GameState; description?: string } {
  const choice = state.waitingChoice;
  if (
    choice?.type !== SCRIPTED_DISCARD_CHOICE_TYPE ||
    choice.playerId !== playerId
  ) {
    return { success: false, state, description: "No discard to answer" };
  }
  const need = choice.minChoices;
  if (chosen.length !== need) {
    return {
      success: false,
      state,
      description: `Choose exactly ${need} card${need === 1 ? "" : "s"} to discard`,
    };
  }
  if (new Set(chosen).size !== chosen.length) {
    return {
      success: false,
      state,
      description: "Each card can only be discarded once",
    };
  }
  const hand = new Set<string>(handOf(state, playerId));
  if (chosen.some((id) => !hand.has(id))) {
    return {
      success: false,
      state,
      description: "You can only discard cards in your hand",
    };
  }
  const discarded = discardExactly(
    { ...state, waitingChoice: null },
    playerId,
    chosen as CardInstanceId[],
  );
  if (!discarded.success) {
    return { success: false, state, description: discarded.description };
  }
  return {
    success: true,
    state: continueQueue(discarded.state, choice.pendingDiscards ?? []),
    description: discarded.description,
  };
}
