/**
 * Turn order utilities for multiplayer games
 */

export type TurnDirection = 'clockwise' | 'counterclockwise';

export interface TurnOrderConfig {
  direction: TurnDirection;
  startPlayerIndex: number;
}

/**
 * Get the next player in turn order based on current player index
 */
export function getNextPlayerIndex(
  currentIndex: number,
  totalPlayers: number,
  direction: TurnDirection = 'clockwise'
): number {
  if (direction === 'clockwise') {
    return (currentIndex + 1) % totalPlayers;
  } else {
    return (currentIndex - 1 + totalPlayers) % totalPlayers;
  }
}

/**
 * Calculate turn order for a multiplayer game
 * Returns array of player indices in turn order
 */
export function calculateTurnOrder(
  totalPlayers: number,
  startPlayerIndex: number = 0,
  direction: TurnDirection = 'clockwise'
): number[] {
  const order: number[] = [];
  
  for (let i = 0; i < totalPlayers; i++) {
    if (direction === 'clockwise') {
      order.push((startPlayerIndex + i) % totalPlayers);
    } else {
      const index = (startPlayerIndex - i + totalPlayers) % totalPlayers;
      order.push(index);
    }
  }
  
  return order;
}

/**
 * Get the player who goes first based on format rules
 */
export function determineStartingPlayer(
  playerCount: number,
  _format: string
): number {
  // Random starting player for now
  // In competitive play, could use dice roll or winner of previous game
  return Math.floor(Math.random() * playerCount);
}

/**
 * Check if a player is an opponent in multiplayer
 */
export function isOpponent(
  playerIndex: number,
  otherPlayerIndex: number,
  playerCount: number,
  teams?: Map<number, number> // Optional team assignments
): boolean {
  // If teams exist, check if they're on different teams
  if (teams) {
    const playerTeam = teams.get(playerIndex);
    const otherTeam = teams.get(otherPlayerIndex);
    if (playerTeam !== undefined && otherTeam !== undefined) {
      return playerTeam !== otherTeam;
    }
  }
  
  // Otherwise, anyone not yourself is an opponent in FFA
  return playerIndex !== otherPlayerIndex;
}

/**
 * Get all opponents for a player
 */
export function getOpponents(
  playerIndex: number,
  playerCount: number,
  teams?: Map<number, number>
): number[] {
  const opponents: number[] = [];
  
  for (let i = 0; i < playerCount; i++) {
    if (i !== playerIndex && isOpponent(playerIndex, i, playerCount, teams)) {
      opponents.push(i);
    }
  }
  
  return opponents;
}

/**
 * Check win condition - in FFA, a player wins if all opponents have lost
 */
export function checkWinCondition(
  playerIndex: number,
  playerStatuses: boolean[], // true = still in game
  teams?: Map<number, number>
): boolean {
  const playerCount = playerStatuses.length;
  
  // If teams exist, check if all opposing teams have lost
  if (teams) {
    const playerTeam = teams.get(playerIndex);
    if (playerTeam !== undefined) {
      // Check if any opposing team still has active players
      for (let i = 0; i < playerCount; i++) {
        const otherTeam = teams.get(i);
        if (otherTeam !== undefined && otherTeam !== playerTeam && playerStatuses[i]) {
          return false;
        }
      }
      return true;
    }
  }
  
  // In FFA, check if all other players have lost
  for (let i = 0; i < playerCount; i++) {
    if (i !== playerIndex && playerStatuses[i]) {
      return false;
    }
  }
  return true;
}
