/**
 * Explore keyword action (Comprehensive Rules, CR 701.18).
 *
 * "When a permanent explores, its controller reveals the top card of their
 * library. If that card is a land card, they put it into their hand.
 * Otherwise, they put a +1/+1 counter on the permanent and may put the
 * revealed card into their graveyard (it otherwise stays on top)."
 *
 * The engine follows the same shape as the surveil/scry deciders: the choice
 * of what happens to a revealed non-land card belongs to the exploring
 * player, so the engine takes it as an `ExploreDecider` and only enforces the
 * rule: the revealed card must end up in exactly one of the two places
 * (graveyard or back on top of the library) and an illegal decision is
 * rejected with the state left untouched.
 *
 * Issue #2965.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { moveCardToZone } from "./removal";
import { addCounterToCard } from "./counters";
import { KeywordActionResult } from "./shared";

/** What the exploring player chose to do with the card that was revealed. */
export interface ExploreDecision {
  /** Cards to put into the graveyard. */
  toGraveyard: CardInstanceId[];
  /** Cards to put back on top of the library; index 0 ends up on top. */
  toTop: CardInstanceId[];
}

/**
 * Chooses an explore outcome. `revealed` holds the revealed card(s), top
 * card first.
 */
export type ExploreDecider = (
  state: GameState,
  playerId: PlayerId,
  revealed: CardInstanceId[],
) => ExploreDecision;

/**
 * Default decision: keep the revealed card on top of the library. This is
 * always legal; callers with a real player choice (UI prompt, AI policy)
 * pass their own decider.
 */
export const keepExploredOnTop: ExploreDecider = (
  _state,
  _playerId,
  revealed,
) => ({
  toGraveyard: [],
  toTop: [...revealed],
});

/**
 * Check that a decision is a legal explore outcome for `revealed`: every
 * revealed card appears exactly once across the two piles and nothing else
 * does. Returns an error message, or null when legal.
 */
export function validateExploreDecision(
  revealed: CardInstanceId[],
  decision: ExploreDecision,
): string | null {
  const expected = new Set(revealed);
  const seen = new Set<CardInstanceId>();
  for (const id of [...decision.toGraveyard, ...decision.toTop]) {
    if (!expected.has(id)) {
      return `Card ${id} was not among the cards revealed`;
    }
    if (seen.has(id)) {
      return `Card ${id} was placed more than once`;
    }
    seen.add(id);
  }
  if (seen.size !== expected.size) {
    return "Every revealed card must go to the graveyard or back on top";
  }
  return null;
}

/** Is the revealed card a land card (CR 301.1)? */
function isLandCard(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  return /\bLand\b/.test(card.cardData.type_line ?? "");
}

/**
 * Perform "explore" for a permanent controlled by `playerId`.
 *
 * The exploring permanent is `exploringCardId`; it must be on the
 * battlefield. An empty library is a legal no-op.
 */
export function performExplore(
  state: GameState,
  playerId: PlayerId,
  exploringCardId: CardInstanceId,
  decide: ExploreDecider = keepExploredOnTop,
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

  const exploring = state.cards.get(exploringCardId);
  if (!exploring) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${exploringCardId} not found`,
    };
  }

  // The exploring permanent must be on the battlefield. When it is not (it
  // died before the ability resolved, or it was never a permanent), explore
  // does nothing at all: the state is returned untouched.
  const battlefieldKey = `${exploring.controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldKey);
  if (!battlefield || !battlefield.cardIds.includes(exploringCardId)) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${exploringCardId} is not on the battlefield`,
    };
  }

  // The library's top is the END of `cardIds` (the same end surveil and
  // scry treat as the top).
  const libraryKey = `${playerId}-library`;
  const library = state.zones.get(libraryKey);
  const revealedId = library?.cardIds[library.cardIds.length - 1];
  if (!library || !revealedId) {
    return {
      success: true,
      state,
      description: `${player.name} explored but revealed no cards`,
      affectedCards: [],
    };
  }

  // A land card is put into the exploring player's hand (CR 701.18).
  if (isLandCard(state, revealedId)) {
    const moved = moveCardToZone(state, revealedId, "hand");
    if (!moved.success) {
      return {
        success: false,
        state,
        description: "",
        error: moved.error ?? `Could not move ${revealedId} to hand`,
      };
    }
    return {
      success: true,
      state: moved.state,
      description: `${player.name} explored and put a land into their hand`,
      affectedCards: [revealedId],
    };
  }

  // A non-land card: the player chooses whether it goes to their graveyard
  // or stays on top of their library.
  const decision = decide(state, playerId, [revealedId]);
  const error = validateExploreDecision([revealedId], decision);
  if (error) {
    return { success: false, state, description: "", error };
  }

  let currentState = state;
  if (decision.toGraveyard.includes(revealedId)) {
    const moved = moveCardToZone(currentState, revealedId, "graveyard");
    if (!moved.success) {
      return {
        success: false,
        state,
        description: "",
        error: moved.error ?? `Could not move ${revealedId} to the graveyard`,
      };
    }
    currentState = moved.state;
  }
  // Otherwise the revealed card stays where it is: on top of the library.

  // CR 701.18: the exploring permanent gets a +1/+1 counter.
  const countered = addCounterToCard(currentState, exploringCardId, "+1/+1", 1);
  if (!countered.success) {
    return {
      success: false,
      state,
      description: "",
      error: countered.error ?? `Could not add a +1/+1 counter`,
    };
  }

  const name = exploring.cardData.name;
  return {
    success: true,
    state: countered.state,
    description: `${player.name} explored with ${name}: +1/+1 counter`,
    affectedCards: [revealedId, exploringCardId],
  };
}
