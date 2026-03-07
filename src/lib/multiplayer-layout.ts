/**
 * Multiplayer layout utilities for positioning players in game UI
 */

export type PlayerPosition = 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PlayerLayout {
  playerIndex: number;
  position: PlayerPosition;
  rotation: number;
}

/**
 * Get player layout for different player counts
 * Returns array of positions for each player index
 */
export function getPlayerLayout(playerCount: number): PlayerLayout[] {
  switch (playerCount) {
    case 2:
      return [
        { playerIndex: 0, position: 'bottom', rotation: 0 },
        { playerIndex: 1, position: 'top', rotation: 180 },
      ];
    
    case 3:
      return [
        { playerIndex: 0, position: 'bottom', rotation: 0 },
        { playerIndex: 1, position: 'top-right', rotation: 240 },
        { playerIndex: 2, position: 'top-left', rotation: 120 },
      ];
    
    case 4:
      return [
        { playerIndex: 0, position: 'bottom', rotation: 0 },
        { playerIndex: 1, position: 'left', rotation: 90 },
        { playerIndex: 2, position: 'top', rotation: 180 },
        { playerIndex: 3, position: 'right', rotation: 270 },
      ];
    
    default:
      // Fallback for other counts
      return Array.from({ length: playerCount }, (_, i) => ({
        playerIndex: i,
        position: 'bottom' as PlayerPosition,
        rotation: 0,
      }));
  }
}

/**
 * Get CSS class for player position
 */
export function getPositionClass(position: PlayerPosition): string {
  const classes: Record<PlayerPosition, string> = {
    top: 'top-4 left-1/2 -translate-x-1/2',
    bottom: 'bottom-4 left-1/2 -translate-x-1/2',
    left: 'left-4 top-1/2 -translate-y-1/2',
    right: 'right-4 top-1/2 -translate-y-1/2',
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };
  return classes[position];
}

/**
 * Get layout for team-based games (2v2)
 */
export function getTeamLayout(playerCount: number): PlayerLayout[] {
  if (playerCount !== 4) {
    return getPlayerLayout(playerCount);
  }
  
  // Team layout: Team 1 (bottom-left, top-left) vs Team 2 (bottom-right, top-right)
  return [
    { playerIndex: 0, position: 'bottom-left', rotation: 0 },
    { playerIndex: 1, position: 'top-left', rotation: 180 },
    { playerIndex: 2, position: 'bottom-right', rotation: 0 },
    { playerIndex: 3, position: 'top-right', rotation: 180 },
  ];
}

/**
 * Get turn indicator position
 */
export function getTurnIndicatorPosition(
  activePlayerIndex: number,
  playerCount: number
): PlayerPosition {
  const layout = getPlayerLayout(playerCount);
  return layout[activePlayerIndex]?.position || 'top';
}

/**
 * Check if a position is an opponent position (for attack arrows)
 */
export function isAdjacentPosition(
  from: PlayerPosition,
  to: PlayerPosition,
  playerCount: number
): boolean {
  // In 2-player, all attacks go through
  if (playerCount === 2) return true;
  
  // Define adjacency for multiplayer
  const adjacency: Record<number, Record<PlayerPosition, PlayerPosition[]>> = {
    3: {
      bottom: ['top-left', 'top-right'],
      'top-left': ['bottom', 'top-right'],
      'top-right': ['bottom', 'top-left'],
    },
    4: {
      bottom: ['left', 'right'],
      left: ['bottom', 'top'],
      top: ['left', 'right'],
      right: ['top', 'bottom'],
    },
  };
  
  const playerAdjacency = adjacency[playerCount];
  if (!playerAdjacency) return true;
  
  return playerAdjacency[from]?.includes(to) ?? true;
}
