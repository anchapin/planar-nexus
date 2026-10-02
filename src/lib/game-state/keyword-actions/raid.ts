/**
 * Raid ability word (issue #2300, Standard remainder slice).
 *
 * "Raid — When this creature enters, if you attacked this turn, ..." and
 * "Raid — At the beginning of your end step, if you attacked this turn, ...".
 * Raid has no rules meaning of its own (CR 207.2c); the cards gate on
 * whether their controller declared an attacker this turn. That is tracked
 * per player in `Player.attackedThisTurn`, set by `declareAttackers` and
 * cleared at the start of each turn. The intervening-if clause is read by
 * `evaluateInterveningIfClause`.
 */
import type { GameState, PlayerId } from "../types";

/** True when the player declared at least one attacker this turn. */
export function hasAttackedThisTurn(
  state: GameState,
  playerId: PlayerId,
): boolean {
  return state.players.get(playerId)?.attackedThisTurn === true;
}

/** Record that each listed player declared an attacker this turn. */
export function markAttackedThisTurn(
  state: GameState,
  playerIds: Iterable<PlayerId>,
): GameState {
  let players: GameState["players"] | null = null;
  for (const playerId of playerIds) {
    const player = (players ?? state.players).get(playerId);
    if (!player || player.attackedThisTurn === true) continue;
    players ??= new Map(state.players);
    players.set(playerId, { ...player, attackedThisTurn: true });
  }
  return players ? { ...state, players } : state;
}

/** Matches the raid condition "you attacked this turn" (and "with a creature"). */
export const RAID_CONDITION =
  /\byou attacked(?: with (?:a|one or more) creatures?)? this turn\b/;
