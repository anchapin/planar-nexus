/**
 * Shared priority-check helper (issue #1594)
 *
 * The guard comparing `state.priorityPlayerId` to the acting player's id via
 * strict inequality was hand-rolled in 11
 * sites across 6 rules-engine modules (game-state, mutate, prototype,
 * spell-casting, mana, keyword-actions, abilities). This module collapses
 * those duplicates into ONE positive-form predicate so the priority contract
 * has a single source of truth — and a single target for mutation testing.
 *
 * Failure semantics intentionally stay at the call sites: previously-throwing
 * sites still throw their own error, and check-style sites still return their
 * own `{ canCast: false, reason: ... }` / `{ success: false, ... }` results.
 * Call sites that enforce "must have priority" negate this helper.
 */

import type { GameState, PlayerId } from "./types";

/**
 * Returns `true` when `playerId` is the player currently holding priority.
 *
 * Positive form of the previously-duplicated priority-inequality guards
 * (issue #1594). Strict equality
 * against `priorityPlayerId` (which may be `null`) is exactly the negation of
 * the old guards, so behavior is preserved at every call site.
 *
 * @param state - Game state (only `priorityPlayerId` is read)
 * @param playerId - Player to check
 */
export function isPriorityPlayer(
  state: Pick<GameState, "priorityPlayerId">,
  playerId: PlayerId,
): boolean {
  return state.priorityPlayerId === playerId;
}
