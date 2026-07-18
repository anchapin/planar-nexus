/**
 * Corpse Keyword System
 *
 * Implements the Corpse keyword ability per CR 702.168.
 *
 *   CR 702.168a "Corpse [cost]" means "When this creature dies, you may pay
 *   [cost]. If you do, [effect]."
 *
 * Corpse is therefore a DEATH-TRIGGERED ABILITY (CR 603.2) — NOT an activated
 * ability. The controller may pay the cost only at the moment the trigger
 * resolves; they cannot "activate" it later at an arbitrary moment from the
 * graveyard. This file exposes:
 *
 *   - {@link parseCorpseAbility} / {@link hasCorpseAbility} / {@link getCorpseAbility}
 *     for recognising the keyword on oracle text.
 *   - {@link processCorpseOnDeath}, the SBA-hook entry point. The state-based
 *     actions destroy loop calls this exactly once per destroyed creature (the
 *     same place {@link handlePersist} and {@link resolveBlitzDeathDraw} run).
 *     It queues the dead card on {@link GameState.pendingCorpseOffers} and
 *     surfaces a `corpse_offer` {@link WaitingChoice} to the controller.
 *   - {@link resolveCorpseChoice}, which finalises a pending offer (pay +
 *     effect, or decline) and surfaces the next queued offer if any.
 *
 * Reference: CR 702.168 - Corpse.
 *
 * Issue #1411: previously shipped as an "activated-from-graveyard" ability,
 * which is rules-wrong (regression of #771). This file restores the death
 * trigger semantics.
 */

import {
  type GameState,
  type CardInstance,
  type CardInstanceId,
  type PlayerId,
  type WaitingChoice,
  type ChoiceOption,
  ZoneType,
} from "./types";
import { spendMana, getTotalMana } from "./mana";
import { exileCard } from "./keyword-actions";

/** Waiting-choice type value used for the Corpse death-trigger offer. */
export const CORPSE_CHOICE_TYPE = "corpse_offer" as const;

/**
 * Corpse ability data parsed from oracle text.
 *
 *   Format: "Corpse [cost]: [effect]"
 *
 *   Example: "Corpse 1: When this creature dies, you may exile a creature card
 *   from your graveyard."
 */
export interface CorpseAbility {
  /** Mana cost to pay when the trigger resolves. */
  cost: number;
  /** Description of the effect that executes when the cost is paid. */
  effectDescription: string;
  /** Whether the effect text contains a "you may" (always optional for Corpse). */
  isOptional: boolean;
}

/**
 * Result of {@link processCorpseOnDeath} — mirrors the minimal shape of
 * {@link BlitzEffectResult} so the SBA destroy loop integrates it uniformly.
 */
export interface CorpseTriggerResult {
  /** Updated game state. */
  state: GameState;
  /** Whether the corpse death-trigger fired for `deadCardId`. */
  applied: boolean;
}

/**
 * Parse a Corpse keyword from oracle text.
 *
 * Accepts the printed `Corpse N: <effect>` format. The cost is a single generic
 * mana amount (per the printed reminder text and the engine's ManaPool.generic
 * field). The effect description is captured verbatim so it can be replayed in
 * the corpse-offer prompt.
 */
export function parseCorpseAbility(oracleText: string): CorpseAbility | null {
  if (!oracleText) return null;

  // Match "Corpse N:" pattern (case-insensitive, requires the colon so we do
  // not match "Corpse" inside other words).
  const corpseMatch = oracleText.match(/corpse\s+(\d+)\s*:/i);
  if (!corpseMatch) return null;

  const cost = parseInt(corpseMatch[1], 10);
  if (isNaN(cost)) return null;

  // Extract the effect description after the first colon.
  const colonIndex = oracleText.indexOf(":");
  const effectDescription =
    colonIndex !== -1 ? oracleText.slice(colonIndex + 1).trim() : "";

  // Corpse is always optional ("you may pay"). Track whether the effect text
  // also contains "you may" so callers can render the prompt accordingly.
  const isOptional = /you\s+may/i.test(oracleText);

  return {
    cost,
    effectDescription,
    isOptional,
  };
}

/** True iff `card`'s oracle text contains a `Corpse N:` clause. */
export function hasCorpseAbility(card: CardInstance): boolean {
  return parseCorpseAbility(card.cardData.oracle_text || "") !== null;
}

/** Return the parsed Corpse ability for `card`, or `null` if it has none. */
export function getCorpseAbility(card: CardInstance): CorpseAbility | null {
  return parseCorpseAbility(card.cardData.oracle_text || "");
}

/**
 * True iff `state` currently has a `corpse_offer` choice awaiting the
 * controller's decision. Used by the SBA destroy loop to avoid clobbering an
 * in-flight offer when multiple Corpse creatures die in the same SBA pass —
 * extra offers are queued on {@link GameState.pendingCorpseOffers} instead.
 */
export function hasPendingCorpseOffer(state: GameState): boolean {
  return state.waitingChoice?.type === CORPSE_CHOICE_TYPE;
}

/**
 * Build the `corpse_offer` {@link WaitingChoice} for a dead Corpse creature.
 *
 * The controller picks one of two options. Option values encode both the
 * decision and the dead card ID so {@link resolveCorpseChoice} is self-contained
 * and does not depend on queue ordering:
 *
 *   - `pay:<deadCardId>`  → pay the cost; if it resolves, execute the effect
 *   - `decline:<deadCardId>` → decline; nothing happens
 */
export function createCorpseWaitingChoice(
  state: GameState,
  deadCardId: CardInstanceId,
): WaitingChoice | null {
  const deadCard = state.cards.get(deadCardId);
  if (!deadCard) return null;
  const ability = getCorpseAbility(deadCard);
  if (!ability) return null;

  const controllerId = deadCard.controllerId;
  const pool = state.players.get(controllerId)?.manaPool;
  const available = pool ? getTotalMana(pool) : 0;

  const name = deadCard.cardData.name || "Creature";
  const payLabel =
    available >= ability.cost
      ? `Pay ${ability.cost} — ${ability.effectDescription || "apply Corpse effect"}`
      : `Pay ${ability.cost} (not enough mana)`;
  const choices: ChoiceOption[] = [
    {
      label: payLabel,
      value: `pay:${deadCardId}`,
      // Block the "pay" option entirely when the controller cannot afford it,
      // so a UI cannot accidentally submit it. Decline is always available.
      isValid: available >= ability.cost,
    },
    {
      label: "Decline",
      value: `decline:${deadCardId}`,
      isValid: true,
    },
  ];

  return {
    type: CORPSE_CHOICE_TYPE,
    playerId: controllerId,
    stackObjectId: null,
    prompt: `Corpse (${name}): when it died, you may pay ${ability.cost}. If you do, ${
      ability.effectDescription || "apply its effect"
    }.`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Pop the head of {@link GameState.pendingCorpseOffers} and surface its offer
 * as the current `waitingChoice`. No-op when the queue is empty or when some
 * other choice is already pending (the next SBA pass / resolution call will
 * surface the queued offer once the prior choice clears).
 */
function surfaceNextCorpseOffer(state: GameState): GameState {
  const queue = state.pendingCorpseOffers ?? [];
  if (queue.length === 0) return state;
  if (state.waitingChoice) return state;

  const deadCardId = queue[0];
  const choice = createCorpseWaitingChoice(state, deadCardId);
  if (!choice) {
    // The dead card disappeared or lost its ability — drop it from the queue
    // and try the next one.
    return surfaceNextCorpseOffer({
      ...state,
      pendingCorpseOffers: queue.slice(1),
    });
  }
  return {
    ...state,
    waitingChoice: choice,
    lastModifiedAt: Date.now(),
  };
}

/**
 * CR 702.168a — fire the Corpse death trigger for a creature that just died.
 *
 * Contract:
 *  - Caller MUST invoke this exactly once per destroyed creature (mirrors how
 *    {@link handlePersist} and {@link resolveBlitzDeathDraw} are called from
 *    the SBA destroy loop). This function does not scan the graveyard, so a
 *    creature that has "been in the graveyard for a while" never spontaneously
 *    produces an offer — only a fresh death does (CR 702.168a "When this
 *    creature dies").
 *  - The dead card must still be in `state.cards` and reside in its owner's
 *    graveyard. If the zone change replaced death (e.g., via a replacement
 *    effect that exiles instead), the trigger does not fire.
 *  - The dead card's corpse ID is appended to {@link GameState.pendingCorpseOffers}
 *    exactly once; duplicate calls for the same dead card are a no-op.
 *  - If no other `waitingChoice` is pending, the offer is surfaced immediately.
 *    Otherwise it stays queued and is surfaced by {@link resolveCorpseChoice}
 *    when the prior offer resolves.
 */
export function processCorpseOnDeath(
  state: GameState,
  deadCardId: CardInstanceId,
): CorpseTriggerResult {
  const deadCard = state.cards.get(deadCardId);
  if (!deadCard) return { state, applied: false };

  // Only creatures have corpse (CR 702.168 — "this creature dies").
  const typeLine = deadCard.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) return { state, applied: false };

  if (!hasCorpseAbility(deadCard)) return { state, applied: false };

  // The ability triggers only on an actual death — a zone-change to graveyard
  // from the battlefield (CR 700.4 "dies"). If the card is not currently in
  // its owner's graveyard (e.g., a replacement effect exiled it instead), no
  // trigger. NOTE: we deliberately check via graveyard.cardIds.includes
  // rather than `currentZoneKey` because `moveCardToZone` does not refresh
  // `currentZoneKey` (a pre-existing engine quirk), and we want to be robust
  // to that. This mirrors the same lookup pattern as `handlePersist`.
  const graveyardKey = `${deadCard.ownerId}-${ZoneType.GRAVEYARD}`;
  const graveyardZone = state.zones.get(graveyardKey);
  if (!graveyardZone || !graveyardZone.cardIds.includes(deadCardId)) {
    return { state, applied: false };
  }

  // Idempotency: never queue the same corpse twice.
  const queue = state.pendingCorpseOffers ?? [];
  if (queue.includes(deadCardId)) return { state, applied: false };

  const nextState: GameState = {
    ...state,
    pendingCorpseOffers: [...queue, deadCardId],
    lastModifiedAt: Date.now(),
  };

  // Surface the offer immediately when nothing else is pending. Otherwise the
  // resolve path will surface it once the in-flight choice clears.
  const surfaced = surfaceNextCorpseOffer(nextState);
  return { state: surfaced, applied: true };
}

/**
 * Result of {@link resolveCorpseChoice}.
 */
export interface CorpseChoiceResolution {
  success: boolean;
  state: GameState;
  description: string;
}

/**
 * CR 702.168 — resolve a pending `corpse_offer` choice.
 *
 * `chosenValue` MUST be one of the option values produced by
 * {@link createCorpseWaitingChoice}: either `pay:<deadCardId>` or
 * `decline:<deadCardId>`.
 *
 *  - Decline: clears the offer; graveyard, mana, exile are untouched. The
 *    dead card is removed from `pendingCorpseOffers` (its trigger is spent).
 *  - Pay: validates that the controller can still afford the cost. If they
 *    cannot, the resolution fails with `success: false` and the offer remains
 *    pending so the caller can submit a different choice (typically decline).
 *    On success, the cost is paid via {@link spendMana} and a creature card
 *    other than the source (if any) is exiled from the controller's graveyard
 *    per the standard Corpse effect text. The offer is then cleared.
 *
 * After either resolution, the next queued offer (if any) is surfaced as the
 * new `waitingChoice`.
 */
export function resolveCorpseChoice(
  state: GameState,
  playerId: PlayerId,
  chosenValue: string,
): CorpseChoiceResolution {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== CORPSE_CHOICE_TYPE) {
    return { success: false, state, description: "No pending Corpse offer" };
  }
  if (choice.playerId !== playerId) {
    return {
      success: false,
      state,
      description: "Not this player's Corpse offer to resolve",
    };
  }

  // Validate the submitted value against the offer's recorded options.
  const validOption = choice.choices.find(
    (c) => String(c.value) === chosenValue,
  );
  if (!validOption || !validOption.isValid) {
    return {
      success: false,
      state,
      description: "Invalid choice for pending Corpse offer",
    };
  }

  const sep = chosenValue.indexOf(":");
  const decision = sep >= 0 ? chosenValue.slice(0, sep) : chosenValue;
  const deadCardId =
    sep >= 0 ? (chosenValue.slice(sep + 1) as CardInstanceId) : undefined;

  const queue = state.pendingCorpseOffers ?? [];
  // Defensive consistency: the resolved card should be the queue head.
  if (deadCardId && queue[0] !== deadCardId) {
    return {
      success: false,
      state,
      description:
        "Corpse offer mismatch: chosen card is not the pending offer",
    };
  }

  const deadCard = deadCardId ? state.cards.get(deadCardId) : undefined;
  const ability = deadCard ? getCorpseAbility(deadCard) : null;
  if (!deadCard || !ability) {
    // Source disappeared (e.g., exiled by an outside effect). Drop the offer.
    return finishCorpseResolution(state, deadCardId, queue, {
      success: true,
      description: "Corpse offer resolved: source no longer present",
    });
  }

  if (decision === "decline") {
    return finishCorpseResolution(state, deadCardId, queue, {
      success: true,
      description: `${deadCard.cardData.name || "Creature"}: Corpse declined`,
    });
  }

  if (decision !== "pay") {
    return {
      success: false,
      state,
      description: "Unknown Corpse choice (expected 'pay' or 'decline')",
    };
  }

  // --- Pay path (CR 702.168a) -------------------------------------------
  const controllerId = deadCard.controllerId;
  const controller = state.players.get(controllerId);
  if (!controller) {
    return {
      success: false,
      state,
      description: "Controller not found for Corpse resolution",
    };
  }

  const available = getTotalMana(controller.manaPool);
  if (available < ability.cost) {
    return {
      success: false,
      state,
      description: `Not enough mana to pay Corpse (need ${ability.cost}, have ${available})`,
    };
  }

  // Choose a creature card to exile. Prefer a creature OTHER than the source
  // (you typically exile chaff to pay for your own corpse, not the corpse
  // source itself). If the source is the only creature in the graveyard, it
  // is exiled by its own ability.
  const graveyardKey = `${controllerId}-${ZoneType.GRAVEYARD}`;
  const graveyard = state.zones.get(graveyardKey);
  if (!graveyard || graveyard.cardIds.length === 0) {
    // Cannot exile anything — the effect is impossible. Per CR 608.2b the
    // cost still does not get paid (no effect). Treat as a failed pay.
    return {
      success: false,
      state,
      description: "Corpse pay failed: no creature card in graveyard to exile",
    };
  }

  const creatureIds = graveyard.cardIds.filter((id) => {
    if (id === deadCardId) return false; // prefer non-source
    const c = state.cards.get(id);
    const tl = c?.cardData.type_line?.toLowerCase() ?? "";
    return tl.includes("creature");
  });
  const fallbackIds = graveyard.cardIds.filter((id) => {
    const c = state.cards.get(id);
    const tl = c?.cardData.type_line?.toLowerCase() ?? "";
    return tl.includes("creature");
  });
  const exileTargetId = creatureIds[0] ?? fallbackIds[0] ?? null;
  if (!exileTargetId) {
    return {
      success: false,
      state,
      description: "Corpse pay failed: no creature card in graveyard to exile",
    };
  }

  // 1) Spend the mana. Generic cost — matches the parser's "Corpse N" semantics.
  const manaResult = spendMana(state, controllerId, { generic: ability.cost });
  if (!manaResult.success) {
    return {
      success: false,
      state,
      description: "Corpse pay failed: could not spend mana",
    };
  }

  // 2) Exile the chosen creature card from the controller's graveyard.
  const exileResult = exileCard(manaResult.state, exileTargetId);
  if (!exileResult.success) {
    // Roll back the mana spend deterministically: cannot un-spend, but the
    // engine guarantees exileCard succeeds for a card in a known zone. If we
    // ever hit this branch, treat the whole resolution as failed (the cost is
    // lost — this is the same failure mode as resolveBlitzDeathDraw when the
    // library is empty).
    return {
      success: false,
      state: manaResult.state,
      description: exileResult.error ?? "Corpse pay failed: exile failed",
    };
  }

  const exiledName =
    exileResult.state.cards.get(exileTargetId)?.cardData.name ?? exileTargetId;

  return finishCorpseResolution(exileResult.state, deadCardId, queue, {
    success: true,
    description: `Corpse: paid ${ability.cost}, exiled ${exiledName}`,
  });
}

/**
 * Helper: clear the current offer, pop the resolved corpse ID from the queue,
 * surface the next queued offer (if any), and return the final state packed
 * with the supplied `result` fields.
 */
function finishCorpseResolution(
  state: GameState,
  deadCardId: CardInstanceId | undefined,
  queue: CardInstanceId[],
  result: { success: boolean; description: string },
): CorpseChoiceResolution {
  const filtered = deadCardId
    ? queue.filter((id) => id !== deadCardId)
    : queue.slice(1);
  const cleared: GameState = {
    ...state,
    waitingChoice: null,
    pendingCorpseOffers: filtered,
    lastModifiedAt: Date.now(),
  };
  const surfaced = surfaceNextCorpseOffer(cleared);
  return { ...result, state: surfaced };
}
