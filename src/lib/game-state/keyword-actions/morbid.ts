/**
 * Morbid ability word (issue #2300, Standard remainder slice).
 *
 * Morbid has no rules meaning of its own (CR 207.2c); the cards check
 * whether a creature died this turn, i.e. any creature, under any player's
 * control, was put into a graveyard from the battlefield (CR 700.4). Tokens
 * count: they go to the graveyard before ceasing to exist (CR 704.5d).
 *
 * The five Standard cards (2026-10-02 snapshot):
 * - End-step intervening-if (CR 603.4): Cackling Prowler, Needletooth Pack,
 *   Wardens of the Cycle ("your end step"), Slumbering Cerberus ("each end
 *   step"). Read by `evaluateInterveningIfClause`.
 * - Tragic Banshee checks the condition on resolution ("If a creature died
 *   this turn, ... instead"); `hasCreatureDiedThisTurn` is the query for that.
 *
 * Tracked in `Turn.creatureDiedThisTurn`, set by `moveCardToZone` on a
 * battlefield-to-graveyard move of a creature and reset by `startNextTurn`.
 */
import type { CardInstance, GameState } from "../types";

/** Matches the morbid condition "a creature died this turn". */
export const MORBID_CONDITION = /\ba creature died this turn\b/;

/** True when any creature died this turn. */
export function hasCreatureDiedThisTurn(state: GameState): boolean {
  return state.turn.creatureDiedThisTurn === true;
}

/** Record that a creature died this turn. */
export function markCreatureDiedThisTurn(state: GameState): GameState {
  if (state.turn.creatureDiedThisTurn === true) return state;
  return { ...state, turn: { ...state.turn, creatureDiedThisTurn: true } };
}

/** Whether the card is a creature on its current face (before a zone change). */
export function isCreatureOnCurrentFace(card: CardInstance): boolean {
  const faces = card.cardData.card_faces;
  const face =
    faces && faces.length > 0
      ? faces[Math.min(card.currentFaceIndex ?? 0, faces.length - 1)]
      : undefined;
  const typeLine = face?.type_line ?? card.cardData.type_line ?? "";
  return typeLine.toLowerCase().includes("creature");
}
