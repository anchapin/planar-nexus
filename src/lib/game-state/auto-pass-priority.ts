import type { GameState, PlayerId } from "./types";
import { Phase } from "./types";

/**
 * Combat phases where the human player may need to take a specific action
 * (declare attackers/blockers, order combat damage). Priority must not be
 * auto-passed through these, otherwise the player loses their chance to act.
 */
const HUMAN_INTERACTIVE_COMBAT_PHASES: ReadonlySet<Phase> = new Set([
  Phase.DECLARE_ATTACKERS,
  Phase.DECLARE_BLOCKERS,
  Phase.COMBAT_DAMAGE,
  Phase.COMBAT_DAMAGE_FIRST_STRIKE,
]);

export interface AutoPassContext {
  /** Player whose turn it is (the AI opponent in single-player mode). */
  activePlayerId: PlayerId;
  /** Human player on whose behalf priority would be auto-passed. */
  humanPlayerId: PlayerId;
}

/**
 * Decide whether it is safe to auto-pass priority on behalf of the human
 * player during the opponent's turn, so they do not have to babysit every
 * phase/step.
 *
 * CRITICAL (#910): the stack MUST be empty. Auto-passing while objects are on
 * the stack destroys the response window — the player can never cast
 * instants/counterspells or activate abilities in response. Per CR 117 the
 * player must retain priority and have a genuine opportunity to respond before
 * anything resolves. Auto-passing is only appropriate between phases/steps
 * (empty stack), which keeps the game flowing without skipping responses.
 */
export function shouldAutoPassPriority(
  state: GameState,
  ctx: AutoPassContext,
): boolean {
  if (!state) return false;
  if (state.status !== "in_progress") return false;

  // Preserve the response window: never yield priority while the stack is live.
  if (state.stack.length > 0) return false;

  // Only auto-pass on the opponent's turn when the human actually has priority.
  if (state.turn.activePlayerId !== ctx.activePlayerId) return false;
  if (state.priorityPlayerId !== ctx.humanPlayerId) return false;

  // Don't auto-pass through combat steps where the human may want to act.
  if (HUMAN_INTERACTIVE_COMBAT_PHASES.has(state.turn.currentPhase)) return false;

  return true;
}
