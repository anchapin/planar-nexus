/**
 * Surveil keyword action (Comprehensive Rules, "Surveil").
 *
 * "Surveil N" means: look at the top N cards of your library, then put any
 * number of them into your graveyard and the rest on top of your library in
 * any order. If the library holds fewer than N cards, the player looks at all
 * of them. Surveilling 0 (or from an empty library) is legal and changes
 * nothing.
 *
 * The choice belongs to the surveilling player, so the engine takes it as a
 * `SurveilDecider`. The engine's job is to enforce the rule: only the cards
 * actually looked at may move, every one of them must land in exactly one of
 * the two destinations, and the kept cards go back on top in the chosen
 * order. An illegal decision is rejected and the state is left untouched.
 *
 * Issue #2300 (Standard remainder slice): surveil was the most common
 * unenforced Standard keyword in the gap report.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { moveCardToZone } from "./removal";
import { KeywordActionResult } from "./shared";

/** What the surveilling player chose to do with the cards they looked at. */
export interface SurveilDecision {
  /** Cards to put into the graveyard. */
  toGraveyard: CardInstanceId[];
  /** Cards to put back on top of the library; index 0 ends up on top. */
  toTop: CardInstanceId[];
}

/**
 * Chooses a surveil outcome. `lookedAt` is ordered top card first.
 */
export type SurveilDecider = (
  state: GameState,
  playerId: PlayerId,
  lookedAt: CardInstanceId[],
) => SurveilDecision;

/**
 * Default decision: keep every card on top in its current order. This is
 * always legal; callers with a real player choice (UI prompt, AI policy)
 * pass their own decider.
 */
export const keepAllOnTop: SurveilDecider = (_state, _playerId, lookedAt) => ({
  toGraveyard: [],
  toTop: [...lookedAt],
});

/**
 * The cards a player would look at when surveilling `count`, top card first.
 */
export function getSurveilCards(
  state: GameState,
  playerId: PlayerId,
  count: number,
): CardInstanceId[] {
  const library = state.zones.get(`${playerId}-library`);
  if (!library || count <= 0) return [];
  return library.cardIds.slice(-count).reverse();
}

/**
 * Check that a decision is a legal surveil outcome for `lookedAt`: every
 * looked-at card appears exactly once across the two piles and nothing else
 * does. Returns an error message, or null when legal.
 */
export function validateSurveilDecision(
  lookedAt: CardInstanceId[],
  decision: SurveilDecision,
): string | null {
  const expected = new Set(lookedAt);
  const seen = new Set<CardInstanceId>();
  for (const id of [...decision.toGraveyard, ...decision.toTop]) {
    if (!expected.has(id)) {
      return `Card ${id} was not among the cards looked at`;
    }
    if (seen.has(id)) {
      return `Card ${id} was placed more than once`;
    }
    seen.add(id);
  }
  if (seen.size !== expected.size) {
    return "Every card looked at must go to the graveyard or back on top";
  }
  return null;
}

/**
 * Perform "surveil N" for a player.
 */
export function performSurveil(
  state: GameState,
  playerId: PlayerId,
  count: number,
  decide: SurveilDecider = keepAllOnTop,
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

  const lookedAt = getSurveilCards(state, playerId, count);
  if (lookedAt.length === 0) {
    return {
      success: true,
      state,
      description: `${player.name} surveilled ${Math.max(0, count)} but looked at no cards`,
      affectedCards: [],
    };
  }

  const decision = decide(state, playerId, lookedAt);
  const error = validateSurveilDecision(lookedAt, decision);
  if (error) {
    return { success: false, state, description: "", error };
  }

  let currentState = state;
  for (const cardId of decision.toGraveyard) {
    const moved = moveCardToZone(currentState, cardId, "graveyard");
    if (!moved.success) {
      return {
        success: false,
        state,
        description: "",
        error: moved.error ?? `Could not move ${cardId} to the graveyard`,
      };
    }
    currentState = moved.state;
  }

  // Put the kept cards back on top in the chosen order. The library's top is
  // the end of `cardIds`, so the card chosen to be on top goes last.
  const libraryKey = `${playerId}-library`;
  const library = currentState.zones.get(libraryKey);
  if (library && decision.toTop.length > 0) {
    const kept = new Set(decision.toTop);
    const rest = library.cardIds.filter((id) => !kept.has(id));
    const zones = new Map(currentState.zones);
    zones.set(libraryKey, {
      ...library,
      cardIds: [...rest, ...[...decision.toTop].reverse()],
    });
    currentState = { ...currentState, zones };
  }

  const g = decision.toGraveyard.length;
  const t = decision.toTop.length;
  return {
    success: true,
    state: currentState,
    description: `${player.name} surveilled ${lookedAt.length}: ${g} to graveyard, ${t} on top`,
    affectedCards: lookedAt,
  };
}
