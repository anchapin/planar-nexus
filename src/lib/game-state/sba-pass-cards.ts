/**
 * Copy-once-per-pass card map for the state-based-action pass (issue #2419).
 *
 * The engine is immutable by convention: every helper that changes a card
 * copies the whole card map first (`new Map(state.cards)`). The SBA pass
 * chains a dozen of those helpers, so a single `checkStateBasedActions` call
 * used to copy a 100+ entry `Map` up to a dozen times — the dominant
 * allocation cost of the pass and a multiplier for every simulation step
 * (AI lookahead, goldfish, replays, differential tests).
 *
 * This module owns the "copy once at the pass boundary, mutate locally,
 * freeze at the end" contract:
 *
 *  - `createPassCardMap` makes the ONE working copy of the card map for a
 *    pass and marks it as owned by that pass.
 *  - `acquireCardMap` is the replacement for `new Map(state.cards)` inside
 *    the helpers on the SBA path: it returns the pass-owned map when the
 *    state carries one (so the helper mutates the shared working copy) and
 *    a fresh copy otherwise (so every other caller keeps the old
 *    copy-on-write behaviour).
 *  - `releasePassCardMap` drops the ownership marker when the pass ends, so
 *    the map published to the caller is treated as an ordinary immutable
 *    map again.
 *
 * Ownership is deliberately NOT a property of the map alone: the marker is
 * removed in a `finally` block by the pass, so a map that escapes the pass
 * can never be mutated in place by a later, unrelated call.
 *
 * The observable result of a pass is unchanged: the caller still receives a
 * state whose card map is a different object from the input's, holding the
 * same cards with the same contents.
 */
import type { CardInstance, CardInstanceId, GameState } from "./types";

/** Card maps that are currently owned by an in-flight SBA pass. */
const passOwnedCardMaps = new WeakSet<Map<CardInstanceId, CardInstance>>();

/**
 * Create the single working copy of the card map for one SBA pass and mark
 * it as owned by that pass.
 */
export function createPassCardMap(
  state: GameState,
): Map<CardInstanceId, CardInstance> {
  const cards = new Map(state.cards);
  passOwnedCardMaps.add(cards);
  return cards;
}

/**
 * Return the map a helper should write into.
 *
 * Inside an SBA pass this is the pass-owned working copy (mutated in
 * place). Outside a pass it is a fresh copy of `state.cards`, which keeps
 * the historical copy-on-write behaviour for every other caller.
 */
export function acquireCardMap(
  state: GameState,
): Map<CardInstanceId, CardInstance> {
  const cards = state.cards;
  return passOwnedCardMaps.has(cards) ? cards : new Map(cards);
}

/**
 * Release the pass ownership of a card map. Called when the pass ends so the
 * published map is treated as an ordinary immutable map again.
 */
export function releasePassCardMap(
  cards: Map<CardInstanceId, CardInstance>,
): void {
  passOwnedCardMaps.delete(cards);
}
