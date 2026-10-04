/**
 * "Whenever you cast ..." triggers (CR 601.2i, 603.2), issue #2496.
 * Wired into `castSpell` once the spell is on the stack; the triggers go on
 * the stack above it (CR 603.3), active player's first (CR 603.3b).
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import type { TriggeredAbilityInstance } from "../abilities/types";
import {
  putTriggersOnStack,
  sortTriggersAPNAP,
} from "../trigger-system/stack-ops";

export function detectCastTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers = detectTriggeredAbilities(state, "spellCast", {
    spellCardId,
    castingPlayerId,
  });
  return sortTriggersAPNAP(triggers, state, state.turn.activePlayerId);
}

export function fireCastTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
): GameState {
  const triggers = detectCastTriggers(state, spellCardId, castingPlayerId);
  if (triggers.length === 0) return state;
  return putTriggersOnStack(state, triggers).state;
}
