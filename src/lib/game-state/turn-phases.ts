/**
 * Turn phase and step management
 */

import type { PlayerId, Turn, GameState } from "./types";
import { Phase } from "./types";

/**
 * Get the next phase in the turn structure
 */
export function getNextPhase(currentPhase: Phase): Phase | null {
  const phaseOrder: Phase[] = [
    Phase.UNTAP,
    Phase.UPKEEP,
    Phase.DRAW,
    Phase.PRECOMBAT_MAIN,
    Phase.BEGIN_COMBAT,
    Phase.DECLARE_ATTACKERS,
    Phase.DECLARE_BLOCKERS,
    Phase.COMBAT_DAMAGE_FIRST_STRIKE,
    Phase.COMBAT_DAMAGE,
    Phase.END_COMBAT,
    Phase.POSTCOMBAT_MAIN,
    Phase.END,
    Phase.CLEANUP,
  ];

  const currentIndex = phaseOrder.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) {
    return null;
  }

  return phaseOrder[currentIndex + 1];
}

/**
 * Get the previous phase in the turn structure
 */
export function getPreviousPhase(currentPhase: Phase): Phase | null {
  const phaseOrder: Phase[] = [
    Phase.UNTAP,
    Phase.UPKEEP,
    Phase.DRAW,
    Phase.PRECOMBAT_MAIN,
    Phase.BEGIN_COMBAT,
    Phase.DECLARE_ATTACKERS,
    Phase.DECLARE_BLOCKERS,
    Phase.COMBAT_DAMAGE_FIRST_STRIKE,
    Phase.COMBAT_DAMAGE,
    Phase.END_COMBAT,
    Phase.POSTCOMBAT_MAIN,
    Phase.END,
    Phase.CLEANUP,
  ];

  const currentIndex = phaseOrder.indexOf(currentPhase);
  if (currentIndex <= 0) {
    return null;
  }

  return phaseOrder[currentIndex - 1];
}

/**
 * Check if a phase is a main phase
 */
export function isMainPhase(phase: Phase): boolean {
  return (
    phase === Phase.PRECOMBAT_MAIN || phase === Phase.POSTCOMBAT_MAIN
  );
}

/**
 * Check if a phase is a combat phase
 */
export function isCombatPhase(phase: Phase): boolean {
  const combatPhases: Phase[] = [
    Phase.BEGIN_COMBAT,
    Phase.DECLARE_ATTACKERS,
    Phase.DECLARE_BLOCKERS,
    Phase.COMBAT_DAMAGE_FIRST_STRIKE,
    Phase.COMBAT_DAMAGE,
    Phase.END_COMBAT,
  ];
  return combatPhases.includes(phase);
}

/**
 * Check if players get priority during this phase
 */
export function playersGetPriority(phase: Phase): boolean {
  // No priority in untap step
  if (phase === Phase.UNTAP) {
    return false;
  }

  // Cleanup step only has priority if something triggered
  if (phase === Phase.CLEANUP) {
    return false;
  }

  return true;
}

/**
 * Check if a player receives priority during the draw step
 * (Only if it's not their first turn)
 */
export function playerDrawsCard(turn: Turn): boolean {
  return !turn.isFirstTurn;
}

/**
 * Create a new turn
 */
export function createTurn(
  activePlayerId: PlayerId,
  turnNumber: number,
  isFirstTurn: boolean = false
): Turn {
  return {
    activePlayerId,
    currentPhase: Phase.UNTAP,
    turnNumber,
    extraTurns: 0,
    isFirstTurn,
    startedAt: Date.now(),
  };
}

/**
 * Advance to the next phase
 */
export function advancePhase(turn: Turn): Turn {
  const nextPhase = getNextPhase(turn.currentPhase);

  if (nextPhase === null) {
    // End of turn - would normally advance to next player's turn
    return turn;
  }

  return {
    ...turn,
    currentPhase: nextPhase,
  };
}

/**
 * Start the next player's turn
 */
export function startNextTurn(
  turn: Turn,
  nextPlayerId: PlayerId,
  isFirstTurnOfGame: boolean = false
): Turn {
  return {
    activePlayerId: nextPlayerId,
    currentPhase: Phase.UNTAP,
    turnNumber: isFirstTurnOfGame ? turn.turnNumber : turn.turnNumber + 1,
    extraTurns: turn.extraTurns > 0 ? turn.extraTurns - 1 : 0,
    isFirstTurn: isFirstTurnOfGame,
    startedAt: Date.now(),
  };
}

/**
 * Add an extra turn
 */
export function addExtraTurn(turn: Turn, count: number = 1): Turn {
  return {
    ...turn,
    extraTurns: turn.extraTurns + count,
  };
}

/**
 * Check if the current player gets an extra turn after this one
 */
export function hasExtraTurn(turn: Turn): boolean {
  return turn.extraTurns > 0;
}

/**
 * Check if we're in a step where players can cast sorcery-speed spells
 */
export function canCastSorcerySpeedSpells(phase: Phase, stackIsEmpty: boolean): boolean {
  if (!isMainPhase(phase)) {
    return false;
  }

  if (!stackIsEmpty) {
    return false;
  }

  return true;
}

/**
 * Check if we're in a step where players can cast instant-speed spells
 */
export function canCastInstantSpeedSpells(phase: Phase): boolean {
  if (!playersGetPriority(phase)) {
    return false;
  }

  return true;
}

/**
 * Check if combat damage is being dealt
 */
export function isCombatDamageStep(phase: Phase): boolean {
  return (
    phase === Phase.COMBAT_DAMAGE_FIRST_STRIKE ||
    phase === Phase.COMBAT_DAMAGE
  );
}

/**
 * Determine whether a first-strike combat damage step should occur.
 *
 * CR 510.5: The first-strike step is an additional combat damage step that
 * only happens if at least one attacking or blocking creature has first
 * strike (CR 702.7) or double strike (CR 702.4). When no creature in combat
 * has either ability, the first-strike step is skipped and combat proceeds
 * directly from Declare Blockers to the (single) Combat Damage step.
 *
 * Issue #969: gate the first-strike combat damage step so it is only entered
 * when it would actually have participants.
 *
 * @param state the game state to inspect (must have combat attackers/blockers populated)
 * @returns true if at least one attacker or blocker deals first-strike damage
 */
export function shouldHaveFirstStrikeStep(state: GameState): boolean {
  const { attackers, blockers } = state.combat;
  for (const attacker of attackers) {
    if (attacker.hasFirstStrike || attacker.hasDoubleStrike) {
      return true;
    }
  }
  for (const blockerList of blockers.values()) {
    for (const blocker of blockerList) {
      if (blocker.hasFirstStrike || blocker.hasDoubleStrike) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if we're in the beginning phase (untap, upkeep, draw)
 */
export function isBeginningPhase(phase: Phase): boolean {
  return (
    phase === Phase.UNTAP ||
    phase === Phase.UPKEEP ||
    phase === Phase.DRAW
  );
}

/**
 * Check if we're in the ending phase (end, cleanup)
 */
export function isEndingPhase(phase: Phase): boolean {
  return phase === Phase.END || phase === Phase.CLEANUP;
}

/**
 * Get phase name for display
 */
export function getPhaseName(phase: Phase): string {
  const names: Record<Phase, string> = {
    [Phase.UNTAP]: "Untap",
    [Phase.UPKEEP]: "Upkeep",
    [Phase.DRAW]: "Draw",
    [Phase.PRECOMBAT_MAIN]: "Pre-Combat Main",
    [Phase.BEGIN_COMBAT]: "Begin Combat",
    [Phase.DECLARE_ATTACKERS]: "Declare Attackers",
    [Phase.DECLARE_BLOCKERS]: "Declare Blockers",
    [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: "Combat Damage (First Strike)",
    [Phase.COMBAT_DAMAGE]: "Combat Damage",
    [Phase.END_COMBAT]: "End Combat",
    [Phase.POSTCOMBAT_MAIN]: "Post-Combat Main",
    [Phase.END]: "End",
    [Phase.CLEANUP]: "Cleanup",
  };
  return names[phase];
}

/**
 * Get short phase name for UI
 */
export function getPhaseShortName(phase: Phase): string {
  const names: Record<Phase, string> = {
    [Phase.UNTAP]: "Untap",
    [Phase.UPKEEP]: "Upkeep",
    [Phase.DRAW]: "Draw",
    [Phase.PRECOMBAT_MAIN]: "Main 1",
    [Phase.BEGIN_COMBAT]: "Combat",
    [Phase.DECLARE_ATTACKERS]: "Attackers",
    [Phase.DECLARE_BLOCKERS]: "Blockers",
    [Phase.COMBAT_DAMAGE_FIRST_STRIKE]: "First Strike",
    [Phase.COMBAT_DAMAGE]: "Damage",
    [Phase.END_COMBAT]: "End Combat",
    [Phase.POSTCOMBAT_MAIN]: "Main 2",
    [Phase.END]: "End",
    [Phase.CLEANUP]: "Cleanup",
  };
  return names[phase];
}
