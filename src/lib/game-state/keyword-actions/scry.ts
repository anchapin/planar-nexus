/**
 * Scry keyword action (CR 701.22).
 *
 * "Scry N" means: look at the top N cards of your library, then put any
 * number of them on the bottom of your library in any order and the rest on
 * top in any order. If the library holds fewer than N cards, the player
 * looks at all of them. Scrying 0 (or from an empty library) is legal and
 * changes nothing.
 *
 * Like surveil, the choice belongs to the scrying player, so the engine takes
 * it as a `ScryDecider` and only enforces the rule: every looked-at card lands
 * in exactly one pile, nothing else moves, and an illegal decision leaves the
 * state untouched.
 *
 * Issue #2540.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { KeywordActionResult } from "./shared";
import { getSurveilCards } from "./surveil";

/** What the scrying player chose to do with the cards they looked at. */
export interface ScryDecision {
  /** Cards to put on the bottom; index 0 ends up bottommost. */
  toBottom: CardInstanceId[];
  /** Cards to put back on top; index 0 ends up on top. */
  toTop: CardInstanceId[];
}

/** Chooses a scry outcome. `lookedAt` is ordered top card first. */
export type ScryDecider = (
  state: GameState,
  playerId: PlayerId,
  lookedAt: CardInstanceId[],
) => ScryDecision;

/** Default decision: keep every card on top in its current order. */
export const keepAllOnTopScry: ScryDecider = (_state, _playerId, lookedAt) => ({
  toBottom: [],
  toTop: [...lookedAt],
});

/** The cards a player would look at when scrying `count`, top card first. */
export const getScryCards = getSurveilCards;

/**
 * Check that a decision is a legal scry outcome for `lookedAt`. Returns an
 * error message, or null when legal.
 */
export function validateScryDecision(
  lookedAt: CardInstanceId[],
  decision: ScryDecision,
): string | null {
  const expected = new Set(lookedAt);
  const seen = new Set<CardInstanceId>();
  for (const id of [...decision.toBottom, ...decision.toTop]) {
    if (!expected.has(id)) {
      return `Card ${id} was not among the cards looked at`;
    }
    if (seen.has(id)) {
      return `Card ${id} was placed more than once`;
    }
    seen.add(id);
  }
  if (seen.size !== expected.size) {
    return "Every card looked at must go on the top or the bottom";
  }
  return null;
}

/** Perform "scry N" for a player. */
export function performScry(
  state: GameState,
  playerId: PlayerId,
  count: number,
  decide: ScryDecider = keepAllOnTopScry,
): KeywordActionResult {
  const player = state.players.get(playerId);
  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${playerId} not found`,
    };
  }

  const lookedAt = getScryCards(state, playerId, count);
  if (lookedAt.length === 0) {
    return {
      success: true,
      state,
      description: `${player.name} scried ${Math.max(0, count)} but looked at no cards`,
      affectedCards: [],
    };
  }

  const decision = decide(state, playerId, lookedAt);
  const error = validateScryDecision(lookedAt, decision);
  if (error) {
    return { success: false, state, description: "", error };
  }

  // The library's top is the end of `cardIds` and its bottom is index 0.
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey)!;
  const looked = new Set(lookedAt);
  const rest = library.cardIds.filter((id) => !looked.has(id));
  const zones = new Map(state.zones);
  zones.set(libraryKey, {
    ...library,
    cardIds: [...decision.toBottom, ...rest, ...[...decision.toTop].reverse()],
  });

  const b = decision.toBottom.length;
  const t = decision.toTop.length;
  return {
    success: true,
    state: { ...state, zones },
    description: `${player.name} scried ${lookedAt.length}: ${t} on top, ${b} on the bottom`,
    affectedCards: lookedAt,
  };
}
