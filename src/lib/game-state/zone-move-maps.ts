/**
 * Copy-once-per-action working maps for the card zone-move hot path
 * (issue #2419).
 *
 * The engine is immutable by convention: every helper that changes a card or
 * a zone copies the whole map first (`new Map(state.cards)`,
 * `new Map(state.zones)`). The zone-move path chains a handful of those
 * helpers — `moveCardToZone` copies the card map and the zone map for the
 * move itself, then the "enters with counters" / "enters the battlefield" /
 * "lore counter" helpers each copy the card map AGAIN — so a single card
 * movement used to duplicate a 100+ entry card map up to four times. That
 * is the same allocation hot spot the state-based-action pass already
 * fixed (see `sba-pass-cards.ts`, PR #2884): every copy is pure overhead
 * for simulation-heavy use (AI lookahead, replays, differential testing).
 *
 * This module owns the "copy once per move action, mutate locally,
 * publish at the end" contract for the move path:
 *
 *  - `createZoneMoveMaps` makes the ONE working copy of the card map and
 *    the ONE working copy of the zone map for a move action.
 *  - `acquireMoveCardMap` / `acquireMoveZoneMap` are the replacements for
 *    `new Map(state.cards)` / `new Map(state.zones)` inside the helpers on
 *    the move path: with a move context in scope they hand back the
 *    working copy (so the helper mutates it in place); without one they
 *    return a fresh copy, so every other caller keeps the historical
 *    copy-on-write behaviour.
 *
 * Unlike the SBA pass helper there is no global ownership registry and no
 * release step: the context is an ordinary value that is threaded through
 * the helpers of a single move action and dropped when the action ends.
 * A map that escapes the action is therefore an ordinary immutable map
 * again — no marker can leak, and no later call can mutate a published
 * map in place.
 *
 * The observable result of a move is unchanged: the caller still receives
 * a state whose card map and zone map are different objects from the
 * input's, holding the same cards and zones with the same contents.
 */
import type { CardInstance, CardInstanceId, GameState, Zone } from "./types";

/**
 * The working maps of one zone-move action: one copy of the card map and
 * one copy of the zone map, mutated in place by the helpers on the path.
 */
export interface ZoneMoveMaps {
  cards: Map<CardInstanceId, CardInstance>;
  zones: Map<string, Zone>;
}

/**
 * Create the single working copies of the card map and the zone map for
 * one zone-move action.
 */
export function createZoneMoveMaps(state: GameState): ZoneMoveMaps {
  return {
    cards: new Map(state.cards),
    zones: new Map(state.zones),
  };
}

/**
 * The card map a helper on the move path should write into.
 *
 * Inside a move action this is the working copy (mutated in place).
 * Outside a move action it is a fresh copy of `state.cards`, which keeps
 * the historical copy-on-write behaviour for every other caller.
 */
export function acquireMoveCardMap(
  state: GameState,
  maps?: ZoneMoveMaps,
): Map<CardInstanceId, CardInstance> {
  return maps ? maps.cards : new Map(state.cards);
}

/**
 * The zone map a helper on the move path should write into.
 *
 * Inside a move action this is the working copy (mutated in place).
 * Outside a move action it is a fresh copy of `state.zones`, which keeps
 * the historical copy-on-write behaviour for every other caller.
 */
export function acquireMoveZoneMap(
  state: GameState,
  maps?: ZoneMoveMaps,
): Map<string, Zone> {
  return maps ? maps.zones : new Map(state.zones);
}
