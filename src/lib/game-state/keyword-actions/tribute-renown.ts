/**
 * Renown and Tribute (CR 702.112/702.131): ETB triggers and the tribute waiting-choice flow.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId, PlayerId, WaitingChoice, ChoiceOption } from '../types';
import { spendMana, getTotalMana } from '../mana';
import { parseRenown, parseTribute } from '../oracle-text-parser';
import { addCounterToCard } from './counters';

export const TRIBUTE_CHOICE_TYPE = "tribute_offer" as const;

/**
 * Result of {@link processRenownOnEtb} / {@link processTributeOnEtb} — mirrors
 * the minimal shape of {@link CorpseTriggerResult} so the ETB hook integrates
 * uniformly with other keyword hooks.
 */
export interface KeywordEtbTriggerResult {
  /** Updated game state. */
  state: GameState;
  /** Whether the keyword's ETB trigger fired for `cardId`. */
  applied: boolean;
}

/**
 * Apply Renown on a creature's ETB (CR 702.100).
 *
 *  - If the card has no Renown ability, or is already renowned, this is a
 *    no-op (`applied: false`).
 *  - Otherwise: parse the printed N, place N +1/+1 counters on the card via
 *    the standard counter path, and set `card.renowned = true`. Subsequent
 *    calls for the same card instance are no-ops (CR 702.100b).
 *
 * Callers should invoke this exactly once per ETB event for the entering
 * card. The function is idempotent regardless.
 */
export function processRenownOnEtb(
  state: GameState,
  cardId: CardInstanceId,
): KeywordEtbTriggerResult {
  const card = state.cards.get(cardId);
  if (!card) return { state, applied: false };

  // Only creatures can be renowned.
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) return { state, applied: false };

  const info = parseRenown(card.cardData.oracle_text || "");
  if (!info.hasRenown) return { state, applied: false };
  const count = info.renownCount ?? 0;
  if (count <= 0) return { state, applied: false };

  // CR 702.100b — intervening "if it isn't renowned". Once renowned, never
  // again.
  if (card.renowned === true) return { state, applied: false };

  // Apply N +1/+1 counters via the shared counter path.
  const counterResult = addCounterToCard(state, cardId, "+1/+1", count);
  if (!counterResult.success) {
    return { state, applied: false };
  }

  // Flip the renowned flag on the same card. The counter path returned a new
  // state with a new card instance, so fetch and patch it.
  const intermediate = counterResult.state;
  const updatedCard = intermediate.cards.get(cardId)!;
  const withFlag: CardInstance = { ...updatedCard, renowned: true };
  const updatedCards = new Map(intermediate.cards);
  updatedCards.set(cardId, withFlag);

  return {
    state: {
      ...intermediate,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    applied: true,
  };
}

/**
 * Apply Tribute on a creature's ETB (CR 702.101).
 *
 *  - If the card has no Tribute ability, this is a no-op.
 *  - Otherwise: append the card ID to `state.pendingTributeOffers` and
 *    surface a `tribute_offer` {@link WaitingChoice} to the FIRST opponent
 *    (in turn order) of the creature's controller. Additional tribute
 *    creatures that enter while an offer is already pending remain queued
 *    and are surfaced FIFO once the prior offer resolves via
 *    {@link resolveTributeChoice}.
 *
 * Per CR 702.101a the controller of the Tribute creature chooses which
 * opponent is offered the choice. The engine surfaces the offer to the
 * first opponent (turn order from active player) as a deterministic
 * default; multi-opponent choice is out of scope for this framework.
 */
export function processTributeOnEtb(
  state: GameState,
  cardId: CardInstanceId,
): KeywordEtbTriggerResult {
  const card = state.cards.get(cardId);
  if (!card) return { state, applied: false };

  // Only creatures carry Tribute (CR 702.101 — "this creature enters").
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) return { state, applied: false };

  const info = parseTribute(card.cardData.oracle_text || "");
  if (!info.hasTribute) return { state, applied: false };
  const count = info.tributeCount ?? 0;
  if (count <= 0) return { state, applied: false };

  // Idempotency: never queue the same tribute twice for the same card.
  const queue = state.pendingTributeOffers ?? [];
  if (queue.includes(cardId)) return { state, applied: false };

  const nextState: GameState = {
    ...state,
    pendingTributeOffers: [...queue, cardId],
    lastModifiedAt: Date.now(),
  };

  // Surface the offer immediately when nothing else is pending. Otherwise
  // the resolve path will surface it once the in-flight choice clears.
  const surfaced = surfaceNextTributeOffer(nextState);
  return { state: surfaced, applied: true };
}

/**
 * Pick the FIRST opponent (in turn order from active player) of `controllerId`.
 * Returns null in a 1-player scenario (Commander's "no opposing player" case).
 */
function pickFirstOpponent(
  state: GameState,
  controllerId: PlayerId,
): PlayerId | null {
  const playerIds = Array.from(state.players.keys());
  if (playerIds.length < 2) return null;
  const active = state.turn.activePlayerId ?? controllerId;
  const activeIdx = playerIds.indexOf(active);
  const order =
    activeIdx >= 0
      ? [...playerIds.slice(activeIdx), ...playerIds.slice(0, activeIdx)]
      : playerIds;
  for (const pid of order) {
    if (pid !== controllerId) return pid;
  }
  return null;
}

/**
 * Build the `tribute_offer` {@link WaitingChoice} for a Tribute creature that
 * just entered the battlefield.
 *
 * The chosen opponent picks one of two options:
 *  - `accept:<cardId>`  → pay the cost (life or mana); the secondary
 *    "tribute wasn't paid" trigger is suppressed (CR 702.101b).
 *  - `decline:<cardId>` → refuse; the printed effect fires.
 *
 * For the framework, "pay" is interpreted as the cost being affordable —
 * the engine gates the option's `isValid` flag on the opponent having the
 * resources. The actual resource deduction is done at resolution.
 */
export function createTributeWaitingChoice(
  state: GameState,
  cardId: CardInstanceId,
): WaitingChoice | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  const info = parseTribute(card.cardData.oracle_text || "");
  if (!info.hasTribute) return null;
  const count = info.tributeCount ?? 0;

  const opponentId = pickFirstOpponent(state, card.controllerId);
  if (opponentId === null) return null;

  const opponent = state.players.get(opponentId);
  if (!opponent) return null;

  // The cost is generic-mana-equivalent for the framework. CR 702.101 says
  // the opponent "may pay N life or have this creature enter with N +1/+1
  // counters"; the printed form is ambiguous on what the cost actually is
  // (it varies by card). We treat the cost as N generic mana so the offer
  // remains testable and deterministic.
  const available = getTotalMana(opponent.manaPool);
  const name = card.cardData.name || "Creature";

  const acceptLabel =
    available >= count
      ? `Pay ${count} — suppress the tribute effect`
      : `Pay ${count} (not enough mana)`;
  const choices: ChoiceOption[] = [
    {
      label: acceptLabel,
      value: `accept:${cardId}`,
      isValid: available >= count,
    },
    {
      label: "Decline — let the tribute effect fire",
      value: `decline:${cardId}`,
      isValid: true,
    },
  ];

  return {
    type: TRIBUTE_CHOICE_TYPE,
    playerId: opponentId,
    stackObjectId: null,
    prompt: `Tribute (${name}): as it entered the battlefield, you may pay ${count}. If you do, its tribute effect is suppressed. If you decline, the printed effect fires.`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * True iff `state` currently has a `tribute_offer` choice awaiting the
 * opponent's decision.
 */
export function hasPendingTributeOffer(state: GameState): boolean {
  return state.waitingChoice?.type === TRIBUTE_CHOICE_TYPE;
}

/**
 * Pop the head of {@link GameState.pendingTributeOffers} and surface its
 * offer as the current `waitingChoice`. No-op when the queue is empty or
 * when some other choice is already pending.
 */
function surfaceNextTributeOffer(state: GameState): GameState {
  const queue = state.pendingTributeOffers ?? [];
  if (queue.length === 0) return state;
  if (state.waitingChoice) return state;

  const cardId = queue[0];
  const choice = createTributeWaitingChoice(state, cardId);
  if (!choice) {
    // The card disappeared or lost its ability — drop it from the queue
    // and try the next one.
    return surfaceNextTributeOffer({
      ...state,
      pendingTributeOffers: queue.slice(1),
    });
  }
  return {
    ...state,
    waitingChoice: choice,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Result of {@link resolveTributeChoice}.
 */
export interface TributeChoiceResolution {
  success: boolean;
  state: GameState;
  description: string;
}

/**
 * CR 702.101 — resolve a pending `tribute_offer` choice.
 *
 * `chosenValue` MUST be one of the option values produced by
 * {@link createTributeWaitingChoice}: either `accept:<cardId>` or
 * `decline:<cardId>`.
 *
 *  - Accept: validates that the opponent can still afford the cost. If they
 *    cannot, the resolution fails with `success: false` and the offer
 *    remains pending so the caller can submit a different choice (typically
 *    decline). On success, the cost is paid via {@link spendMana} and the
 *    card's `tributePaid` flag is set to `true` (suppressing the secondary
 *    trigger).
 *  - Decline: marks `tributePaid = false` on the card; the printed effect
 *    is allowed to fire (the trigger system reads `tributePaid === false`
 *    to gate the secondary ability).
 *
 * After either resolution, the next queued offer (if any) is surfaced as
 * the new `waitingChoice`.
 */
export function resolveTributeChoice(
  state: GameState,
  playerId: PlayerId,
  chosenValue: string,
): TributeChoiceResolution {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== TRIBUTE_CHOICE_TYPE) {
    return { success: false, state, description: "No pending Tribute offer" };
  }
  if (choice.playerId !== playerId) {
    return {
      success: false,
      state,
      description: "Not this player's Tribute offer to resolve",
    };
  }

  const validOption = choice.choices.find(
    (c) => String(c.value) === chosenValue,
  );
  if (!validOption || !validOption.isValid) {
    return {
      success: false,
      state,
      description: "Invalid choice for pending Tribute offer",
    };
  }

  const sep = chosenValue.indexOf(":");
  const decision = sep >= 0 ? chosenValue.slice(0, sep) : chosenValue;
  const cardId =
    sep >= 0 ? (chosenValue.slice(sep + 1) as CardInstanceId) : undefined;

  const queue = state.pendingTributeOffers ?? [];
  // Defensive consistency: the resolved card should be the queue head.
  if (cardId && queue[0] !== cardId) {
    return {
      success: false,
      state,
      description:
        "Tribute offer mismatch: chosen card is not the pending offer",
    };
  }

  const card = cardId ? state.cards.get(cardId) : undefined;
  const info = card ? parseTribute(card.cardData.oracle_text || "") : null;
  if (!card || !info || !info.hasTribute) {
    return finishTributeResolution(state, cardId, queue, {
      success: true,
      description: "Tribute offer resolved: source no longer present",
    });
  }

  const cost = info.tributeCount ?? 0;

  if (decision === "decline") {
    // Mark tributePaid = false so the secondary trigger fires.
    const marked = markTributePaid(state, cardId!, false);
    return finishTributeResolution(marked, cardId, queue, {
      success: true,
      description: `${card.cardData.name || "Creature"}: Tribute declined — effect fires`,
    });
  }

  if (decision !== "accept") {
    return {
      success: false,
      state,
      description: "Unknown Tribute choice (expected 'accept' or 'decline')",
    };
  }

  // --- Accept path (CR 702.101b) ---------------------------------------
  const opponent = state.players.get(playerId);
  if (!opponent) {
    return {
      success: false,
      state,
      description: "Opponent not found for Tribute resolution",
    };
  }

  const available = getTotalMana(opponent.manaPool);
  if (available < cost) {
    return {
      success: false,
      state,
      description: `Not enough mana to pay Tribute (need ${cost}, have ${available})`,
    };
  }

  const manaResult = spendMana(state, playerId, { generic: cost });
  if (!manaResult.success) {
    return {
      success: false,
      state,
      description: "Tribute pay failed: could not spend mana",
    };
  }

  // Mark tributePaid = true → secondary trigger is suppressed.
  const marked = markTributePaid(manaResult.state, cardId!, true);
  return finishTributeResolution(marked, cardId, queue, {
    success: true,
    description: `Tribute: opponent paid ${cost} — effect suppressed`,
  });
}

/** Helper: stamp `tributePaid` on a card without touching anything else. */
function markTributePaid(
  state: GameState,
  cardId: CardInstanceId,
  paid: boolean,
): GameState {
  const card = state.cards.get(cardId);
  if (!card) return state;
  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, { ...card, tributePaid: paid });
  return {
    ...state,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };
}

/**
 * Helper: clear the current offer, pop the resolved tribute card from the
 * queue, surface the next queued offer (if any), and return the final state
 * packed with the supplied `result` fields.
 */
function finishTributeResolution(
  state: GameState,
  cardId: CardInstanceId | undefined,
  queue: CardInstanceId[],
  result: { success: boolean; description: string },
): TributeChoiceResolution {
  const filtered = cardId
    ? queue.filter((id) => id !== cardId)
    : queue.slice(1);
  const cleared: GameState = {
    ...state,
    waitingChoice: null,
    pendingTributeOffers: filtered,
    lastModifiedAt: Date.now(),
  };
  const surfaced = surfaceNextTributeOffer(cleared);
  return { ...result, state: surfaced };
}

