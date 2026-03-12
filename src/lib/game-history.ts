/**
 * @fileoverview Game History Tracking
 * 
 * Tracks game results for single-player sessions.
 * Stores win/loss records, game stats, and history.
 */

import type { PlayerId } from '@/lib/game-state/types';

/**
 * Game result types
 */
export type GameResult = 'win' | 'loss' | 'draw';

/**
 * Game mode types
 */
export type GameMode = 'vs_ai' | 'self_play' | 'goldfish';

/**
 * Single game record
 */
export interface GameRecord {
  id: string;
  date: number; // Timestamp
  mode: GameMode;
  result: GameResult;
  playerDeck: string; // Deck name or ID
  opponentDeck?: string; // AI deck archetype (for vs_ai mode)
  difficulty?: string; // AI difficulty (for vs_ai mode)
  turns: number; // Total turns played
  playerLifeAtEnd: number;
  opponentLifeAtEnd?: number;
  mulligans: number; // Player mulligan count
  notes?: string;
}

/**
 * Player statistics
 */
export interface PlayerStats {
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  
  // By mode
  vsAiStats: ModeStats;
  selfPlayStats: ModeStats;
  
  // By difficulty (for vs_ai)
  difficultyStats: {
    [difficulty: string]: ModeStats;
  };
  
  // Recent form (last 10 games)
  recentForm: GameResult[];
  
  // Average stats
  avgTurnsPerGame: number;
  avgLifeAtEnd: number;
}

/**
 * Stats for a specific mode
 */
export interface ModeStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

/**
 * Storage key for game history
 */
const STORAGE_KEY = 'planar-nexus-game-history';

/**
 * Get all game records
 */
export function getAllGameRecords(): GameRecord[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as GameRecord[];
  } catch (error) {
    console.error('Failed to load game history:', error);
    return [];
  }
}

/**
 * Save a game record
 */
export function saveGameRecord(record: GameRecord): void {
  try {
    const records = getAllGameRecords();
    records.unshift(record); // Add to beginning
    
    // Keep last 1000 games
    if (records.length > 1000) {
      records.splice(1000);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.error('Failed to save game record:', error);
  }
}

/**
 * Get player statistics
 */
export function getPlayerStats(playerId?: PlayerId): PlayerStats {
  const records = getAllGameRecords();
  
  const stats: PlayerStats = {
    totalGames: records.length,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    vsAiStats: { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 },
    selfPlayStats: { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 },
    difficultyStats: {},
    recentForm: [],
    avgTurnsPerGame: 0,
    avgLifeAtEnd: 0,
  };
  
  let totalTurns = 0;
  let totalLife = 0;
  
  for (const record of records) {
    // Overall stats
    if (record.result === 'win') stats.wins++;
    else if (record.result === 'loss') stats.losses++;
    else stats.draws++;
    
    // Mode-specific stats
    if (record.mode === 'vs_ai') {
      stats.vsAiStats.games++;
      if (record.result === 'win') stats.vsAiStats.wins++;
      else if (record.result === 'loss') stats.vsAiStats.losses++;
      else stats.vsAiStats.draws++;
      
      // Difficulty stats
      if (record.difficulty) {
        if (!stats.difficultyStats[record.difficulty]) {
          stats.difficultyStats[record.difficulty] = { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
        }
        stats.difficultyStats[record.difficulty].games++;
        if (record.result === 'win') stats.difficultyStats[record.difficulty].wins++;
        else if (record.result === 'loss') stats.difficultyStats[record.difficulty].losses++;
        else stats.difficultyStats[record.difficulty].draws++;
      }
    } else if (record.mode === 'self_play' || record.mode === 'goldfish') {
      stats.selfPlayStats.games++;
      if (record.result === 'win') stats.selfPlayStats.wins++;
      else if (record.result === 'loss') stats.selfPlayStats.losses++;
      else stats.selfPlayStats.draws++;
    }
    
    // Averages
    totalTurns += record.turns;
    totalLife += record.playerLifeAtEnd;
  }
  
  // Calculate win rates
  if (stats.totalGames > 0) {
    stats.winRate = Math.round((stats.wins / stats.totalGames) * 100);
  }
  if (stats.vsAiStats.games > 0) {
    stats.vsAiStats.winRate = Math.round((stats.vsAiStats.wins / stats.vsAiStats.games) * 100);
  }
  if (stats.selfPlayStats.games > 0) {
    stats.selfPlayStats.winRate = Math.round((stats.selfPlayStats.wins / stats.selfPlayStats.games) * 100);
  }
  
  // Calculate difficulty win rates
  for (const difficulty of Object.keys(stats.difficultyStats)) {
    const diffStats = stats.difficultyStats[difficulty];
    if (diffStats.games > 0) {
      diffStats.winRate = Math.round((diffStats.wins / diffStats.games) * 100);
    }
  }
  
  // Recent form (last 10)
  stats.recentForm = records.slice(0, 10).map(r => r.result);
  
  // Averages
  if (records.length > 0) {
    stats.avgTurnsPerGame = Math.round(totalTurns / records.length);
    stats.avgLifeAtEnd = Math.round(totalLife / records.length);
  }
  
  return stats;
}

/**
 * Get recent games
 */
export function getRecentGames(limit: number = 10): GameRecord[] {
  return getAllGameRecords().slice(0, limit);
}

/**
 * Clear all game history
 */
export function clearGameHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Create a game record from game end data
 */
export function createGameRecord(options: {
  mode: GameMode;
  result: GameResult;
  playerDeck: string;
  opponentDeck?: string;
  difficulty?: string;
  turns: number;
  playerLifeAtEnd: number;
  opponentLifeAtEnd?: number;
  mulligans: number;
  notes?: string;
}): GameRecord {
  return {
    id: `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    date: Date.now(),
    ...options,
  };
}
