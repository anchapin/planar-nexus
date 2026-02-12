/**
 * Turn phase and step management
 * Multiplayer turn order and round tracking
 */

import type { PlayerId, Turn, TurnOrderType } from "./types";
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
  isFirstTurn: boolean = false,
  turnOrder: PlayerId[] = [activePlayerId],
  turnOrderType: TurnOrderType = "clockwise"
): Turn {
  const activePlayerIndex = turnOrder.indexOf(activePlayerId);

  return {
    activePlayerId,
    currentPhase: Phase.UNTAP,
    turnNumber,
    extraTurns: 0,
    isFirstTurn,
    startedAt: Date.now(),
    roundNumber: 1,
    turnOrder,
    activePlayerIndex,
    turnOrderType,
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
  const nextPlayerIndex = turn.turnOrder.indexOf(nextPlayerId);

  // Calculate round number: round increments when we cycle back to the first player in turn order
  let newRoundNumber = turn.roundNumber;
  if (nextPlayerIndex === 0 && !isFirstTurnOfGame) {
    newRoundNumber = turn.roundNumber + 1;
  }

  return {
    activePlayerId: nextPlayerId,
    currentPhase: Phase.UNTAP,
    turnNumber: isFirstTurnOfGame ? turn.turnNumber : turn.turnNumber + 1,
    extraTurns: turn.extraTurns > 0 ? turn.extraTurns - 1 : 0,
    isFirstTurn: isFirstTurnOfGame,
    startedAt: Date.now(),
    roundNumber: newRoundNumber,
    turnOrder: turn.turnOrder,
    activePlayerIndex: nextPlayerIndex,
    turnOrderType: turn.turnOrderType,
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

// ============================================================================
// MULTIPLAYER TURN ORDER TRACKING
// ============================================================================

/**
 * Create a turn order for multiplayer games
 * @param playerIds - Array of player IDs in the game
 * @param turnOrderType - How to determine starting player
 * @returns Ordered array of player IDs representing turn order
 */
export function createTurnOrder(
  playerIds: PlayerId[],
  turnOrderType: TurnOrderType = "clockwise"
): PlayerId[] {
  if (playerIds.length === 0) {
    return [];
  }

  switch (turnOrderType) {
    case "random": {
      // Shuffle players for random starting player
      const shuffled = [...playerIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    case "clockwise":
    case "custom":
    default:
      // Use provided order (or default order)
      return [...playerIds];
  }
}

/**
 * Get the next player in turn order (clockwise)
 * @param turn - Current turn state
 * @returns ID of the next player in turn order
 */
export function getNextPlayerInTurnOrder(turn: Turn): PlayerId {
  const nextIndex = (turn.activePlayerIndex + 1) % turn.turnOrder.length;
  return turn.turnOrder[nextIndex];
}

/**
 * Get the previous player in turn order (counter-clockwise)
 * @param turn - Current turn state
 * @returns ID of the previous player in turn order
 */
export function getPreviousPlayerInTurnOrder(turn: Turn): PlayerId {
  const prevIndex =
    (turn.activePlayerIndex - 1 + turn.turnOrder.length) %
    turn.turnOrder.length;
  return turn.turnOrder[prevIndex];
}

/**
 * Get all opponents that can be attacked by the current player
 * In free-for-all multiplayer, you can attack any opponent
 * @param turn - Current turn state
 * @param allPlayerIds - All player IDs in the game
 * @returns Array of opponent player IDs
 */
export function getAttackableOpponents(
  turn: Turn,
  allPlayerIds: PlayerId[]
): PlayerId[] {
  return allPlayerIds.filter((id) => id !== turn.activePlayerId);
}

/**
 * Check if a player is to the left of another player in turn order
 * @param turn - Current turn state
 * @param playerId - Player to check
 * @param referencePlayerId - Reference player
 * @returns true if playerId is immediately to the left (clockwise neighbor)
 */
export function isLeftNeighbor(
  turn: Turn,
  playerId: PlayerId,
  referencePlayerId: PlayerId
): boolean {
  const refIndex = turn.turnOrder.indexOf(referencePlayerId);
  const leftIndex = (refIndex + 1) % turn.turnOrder.length;
  return turn.turnOrder[leftIndex] === playerId;
}

/**
 * Check if a player is to the right of another player in turn order
 * @param turn - Current turn state
 * @param playerId - Player to check
 * @param referencePlayerId - Reference player
 * @returns true if playerId is immediately to the right (counter-clockwise neighbor)
 */
export function isRightNeighbor(
  turn: Turn,
  playerId: PlayerId,
  referencePlayerId: PlayerId
): boolean {
  const refIndex = turn.turnOrder.indexOf(referencePlayerId);
  const rightIndex =
    (refIndex - 1 + turn.turnOrder.length) % turn.turnOrder.length;
  return turn.turnOrder[rightIndex] === playerId;
}

/**
 * Get turn order as player names (for display)
 * @param turn - Current turn state
 * @param playerNames - Map of player IDs to names
 * @returns Array of player names in turn order
 */
export function getTurnOrderDisplay(
  turn: Turn,
  playerNames: Map<PlayerId, string>
): string[] {
  return turn.turnOrder.map((id) => playerNames.get(id) || id);
}

/**
 * Calculate how many turns until a specific player's turn
 * @param turn - Current turn state
 * @param targetPlayerId - Player to check
 * @returns Number of turns until target player's turn (0 if it's their turn)
 */
export function getTurnsUntilPlayerTurn(
  turn: Turn,
  targetPlayerId: PlayerId
): number {
  if (turn.activePlayerId === targetPlayerId) {
    return 0;
  }

  const targetIndex = turn.turnOrder.indexOf(targetPlayerId);
  if (targetIndex === -1) {
    return -1; // Player not in turn order
  }

  // Calculate distance in turn order
  if (targetIndex > turn.activePlayerIndex) {
    return targetIndex - turn.activePlayerIndex;
  } else {
    return turn.turnOrder.length - turn.activePlayerIndex + targetIndex;
  }
}

/**
 * Check if we're in a specific round
 * @param turn - Current turn state
 * @param roundNumber - Round number to check
 * @returns true if current round matches
 */
export function isInRound(turn: Turn, roundNumber: number): boolean {
  return turn.roundNumber === roundNumber;
}

/**
 * Get information about the current round
 * @param turn - Current turn state
 * @returns Object with round information
 */
export function getRoundInfo(turn: Turn): {
  roundNumber: number;
  turnsInRound: number;
  currentPlayerInRound: number;
  isRoundStart: boolean;
  isRoundEnd: boolean;
} {
  const turnsInRound = turn.turnOrder.length;
  const currentPlayerInRound = turn.activePlayerIndex + 1;
  const isRoundStart = turn.activePlayerIndex === 0;
  const isRoundEnd = turn.activePlayerIndex === turnsInRound - 1;

  return {
    roundNumber: turn.roundNumber,
    turnsInRound,
    currentPlayerInRound,
    isRoundStart,
    isRoundEnd,
  };
}

/**
 * Update turn order (useful when a player leaves or joins)
 * @param turn - Current turn state
 * @param newTurnOrder - New turn order
 * @returns Updated turn with new turn order
 */
export function updateTurnOrder(turn: Turn, newTurnOrder: PlayerId[]): Turn {
  // Preserve active player if they're still in the game
  const activePlayerStillInGame = newTurnOrder.includes(turn.activePlayerId);
  const newActivePlayerId = activePlayerStillInGame
    ? turn.activePlayerId
    : newTurnOrder[0];
  const newActivePlayerIndex = newTurnOrder.indexOf(newActivePlayerId);

  return {
    ...turn,
    turnOrder: newTurnOrder,
    activePlayerId: newActivePlayerId,
    activePlayerIndex: newActivePlayerIndex,
  };
}

/**
 * Get the player seat positions for visual representation
 * @param turn - Current turn state
 * @returns Array of seat positions
 */
export function getPlayerSeats(turn: Turn): Array<{
  playerId: PlayerId;
  seatPosition: number;
  leftNeighborId: PlayerId | null;
  rightNeighborId: PlayerId | null;
}> {
  const seats = turn.turnOrder.map((playerId, index) => {
    const leftIndex = (index + 1) % turn.turnOrder.length;
    const rightIndex =
      (index - 1 + turn.turnOrder.length) % turn.turnOrder.length;

    return {
      playerId,
      seatPosition: index,
      leftNeighborId: turn.turnOrder[leftIndex],
      rightNeighborId: turn.turnOrder[rightIndex],
    };
  });

  return seats;
}

/**
 * Initialize turn order for a new game
 * @param playerIds - All player IDs
 * @param turnOrderType - Type of turn order to use
 * @param startingPlayerId - Optional specific starting player (for custom order)
 * @returns Turn order array
 */
export function initializeTurnOrder(
  playerIds: PlayerId[],
  turnOrderType: TurnOrderType = "clockwise",
  startingPlayerId?: PlayerId
): PlayerId[] {
  let order = createTurnOrder(playerIds, turnOrderType);

  // If a specific starting player is provided and turn order is custom
  if (startingPlayerId && turnOrderType === "custom") {
    const startIndex = order.indexOf(startingPlayerId);
    if (startIndex !== -1) {
      // Rotate the array so starting player is first
      order = [
        ...order.slice(startIndex),
        ...order.slice(0, startIndex),
      ];
    }
  }

  return order;
}
