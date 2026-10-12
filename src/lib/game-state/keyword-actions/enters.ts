/**
 * Enters-the-battlefield triggers for permanents that enter other than by a
 * resolving permanent spell (issue #2300).
 *
 * Spell resolution already raises "entersBattlefield" with the entering
 * card. This leaf does the same for lands played, tokens created,
 * permanents put onto the battlefield (`moveCardToZone`) and persist
 * returns, so "When this creature enters" and "Whenever another creature
 * you control enters" fire for them too (CR 603.6a). Phasing in is not
 * entering (CR 702.26d) and does not use this path.
 */
import type { GameState, CardInstance, CardInstanceId } from "../types";
import { checkTriggeredAbilities } from "../abilities/check";
import { getCardScript } from "../card-scripts/registry";
import { createEnterChoiceWaitingChoice, hasEnterChoice } from "./enter-choice";

/** Put every ETB trigger that cares about `enteringCardId` onto the stack. */
export function fireEntersTriggers(
  state: GameState,
  enteringCardId: CardInstanceId,
): GameState {
  // Wave 4.8 follow-up 4 lane 67 (#2614 follow-up): stamp
  // `enters_with_counters` on the entering card BEFORE the
  // ETB triggers fire. The triggers may consult the
  // counter ledger (a "when this enters, draw a card for
  // each stun counter on it" trigger would see the stamped
  // counter). The legacy `enters_with_counters_per_match`
  // stamping (lane 59) runs inside `resolveEnterChoice`
  // AFTER the choice resolves; for the lane 67 generalized
  // counter field there's no choice — the script declares
  // the count directly, so the stamp runs at the
  // `fireEntersTriggers` call site (and at the spell-cast
  // resolve.ts path).
  let next = applyScriptEntersWithCounters(state, enteringCardId);
  next = checkTriggeredAbilities(next, "entersBattlefield", {
    enteringCardId,
  }).state;
  // Wave 4.7 lane 39: "as this enters, choose a [thing]" (#2594
  // follow-up). Surface the choice after ETB triggers fire so any
  // "when this enters" trigger doesn't see the choice yet. Like
  // `resolve.ts` we no-op when another choice is already pending so
  // we don't clobber a higher-priority prompt (e.g. legend rule).
  const entering = next.cards.get(enteringCardId);
  if (entering && !next.waitingChoice && hasEnterChoice(entering)) {
    const choice = createEnterChoiceWaitingChoice(next, enteringCardId);
    if (choice) {
      next = {
        ...next,
        waitingChoice: choice,
        lastModifiedAt: Date.now(),
      };
    }
  }
  return next;
}

/**
 * Wave 4.8 follow-up 4 lane 67 (#2614 follow-up): stamp the
 * entering card's `enters_with_counters` declaration onto
 * both the generalized `instanceCounters` ledger (lane 59
 * substrate) and the legacy `card.counters` list (read by
 * the existing `untapOrRemoveStun` / `getEffectivePower`
 * paths). v1 supports the four counter types
 * `"+1/+1"`, `"-1/-1"`, `"stun"`, and `"finality"`.
 *
 * No-op when the card has no script or no
 * `enters_with_counters` field. Returns the original state
 * when the field is absent (the v1 default; the function is
 * safe to call from every ETB path).
 *
 * The mirror-to-`card.counters` is deliberate: the existing
 * untap path reads `card.counters.find(c => c.type ===
 * "stun")` (the legacy `SearchLibrary.stun` substrate
 * writes to that list), so the v1 stun counter is
 * functional on day one. The follow-up lane can move the
 * untap path to read from `instanceCounters` if the legacy
 * path is retired.
 */
export function applyScriptEntersWithCounters(
  state: GameState,
  enteringCardId: CardInstanceId,
): GameState {
  const card = state.cards.get(enteringCardId);
  if (!card) return state;
  const script = getCardScript(card.cardData.name);
  if (!script?.enters_with_counters) return state;

  let next: CardInstance = { ...card };
  // 1. Stamp the generalized `instanceCounters` ledger.
  const ledger: Record<string, number> = { ...(next.instanceCounters ?? {}) };
  // 2. Mirror to the legacy `card.counters` list for backward
  //    compat with the existing untap-skip + P/T paths.
  const countersList = [...(next.counters ?? [])];
  for (const entry of script.enters_with_counters) {
    ledger[entry.counter] = (ledger[entry.counter] ?? 0) + entry.count;
    // Replace existing entry of the same type (don't stack
    // duplicates in the legacy list).
    const existingIdx = countersList.findIndex((c) => c.type === entry.counter);
    const merged = {
      type: entry.counter,
      count:
        (existingIdx >= 0 ? countersList[existingIdx].count : 0) + entry.count,
    };
    if (existingIdx >= 0) countersList[existingIdx] = merged;
    else countersList.push(merged);
  }
  next = { ...next, instanceCounters: ledger, counters: countersList };

  const cards = new Map(state.cards);
  cards.set(enteringCardId, next);
  return { ...state, cards, lastModifiedAt: Date.now() };
}
