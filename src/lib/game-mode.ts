/**
 * Game mode definitions for different multiplayer formats
 */

export type GameMode = '1v1' | '2v2' | 'ffa' | 'commander-1v1' | 'commander-ffa';

export interface GameModeConfig {
  mode: GameMode;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  startingLife: number;
  commanderDamage: boolean;
  sharedTurns: boolean;
  teamChat: boolean;
}

export const GAME_MODES: Record<GameMode, GameModeConfig> = {
  '1v1': {
    mode: '1v1',
    name: '1v1 Duel',
    description: 'Classic two-player duel',
    minPlayers: 2,
    maxPlayers: 2,
    startingLife: 20,
    commanderDamage: false,
    sharedTurns: false,
    teamChat: false,
  },
  '2v2': {
    mode: '2v2',
    name: 'Two-Headed Giant',
    description: 'Teams of two players sharing turns',
    minPlayers: 4,
    maxPlayers: 4,
    startingLife: 30,
    commanderDamage: false,
    sharedTurns: true,
    teamChat: true,
  },
  'ffa': {
    mode: 'ffa',
    name: 'Free-for-All',
    description: 'Everyone for themselves',
    minPlayers: 3,
    maxPlayers: 4,
    startingLife: 20,
    commanderDamage: false,
    sharedTurns: false,
    teamChat: false,
  },
  'commander-1v1': {
    mode: 'commander-1v1',
    name: 'Commander 1v1',
    description: 'Two-player Commander duel',
    minPlayers: 2,
    maxPlayers: 2,
    startingLife: 30,
    commanderDamage: true,
    sharedTurns: false,
    teamChat: false,
  },
  'commander-ffa': {
    mode: 'commander-ffa',
    name: 'Commander Free-for-All',
    description: 'Multiplayer Commander',
    minPlayers: 3,
    maxPlayers: 4,
    startingLife: 40,
    commanderDamage: true,
    sharedTurns: false,
    teamChat: false,
  },
};

export function getGameModeForPlayerCount(playerCount: number, format: string): GameMode {
  if (format === 'commander') {
    if (playerCount === 2) return 'commander-1v1';
    return 'commander-ffa';
  }
  
  if (playerCount === 2) return '1v1';
  if (playerCount === 4) return '2v2';
  return 'ffa';
}

export function getGameModeConfig(mode: GameMode): GameModeConfig {
  return GAME_MODES[mode];
}
