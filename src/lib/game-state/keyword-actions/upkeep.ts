/**
 * "At the beginning of your/each upkeep" triggers (CR 503.1a), issue #2498.
 * Wired into the step advance in `game-state/index.ts`.
 */
import type { GameState, PlayerId } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import type { TriggeredAbilityInstance } from "../abilities/types";
import { putTriggersOnStack } from "../trigger-system/stack-ops";

export function detectUpkeepTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  return detectTriggeredAbilities(state, "upkeep", {
    upkeepPlayerId: activePlayerId,
  });
}

export function fireUpkeepTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): GameState {
  const triggers = detectUpkeepTriggers(state, activePlayerId);
  if (triggers.length === 0) return state;
  return putTriggersOnStack(state, triggers).state;
}
