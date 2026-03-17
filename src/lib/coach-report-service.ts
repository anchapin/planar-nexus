/**
 * @fileoverview Coach Report Service
 * 
 * Analyzes game history to generate performance reports.
 * Aggregates mistakes, identifies patterns, and calculates win rates
 * per difficulty and deck archetype.
 */

import type { GameRecord, GameResult, GameMode } from './game-history';

/**
 * Coach report containing aggregated performance data
 */
export interface CoachReport {
  /** Total games analyzed */
  totalGames: number;
  
  /** Overall win rate percentage */
  overallWinRate: number;
  
  /** Win/Loss/Draw counts */
  wins: number;
  losses: number;
  draws: number;
  
  /** Win rate by difficulty level */
  winRateByDifficulty: Record<string, number>;
  
  /** Win rate by deck archetype */
  winRateByDeck: Record<string, number>;
  
  /** Most common mistakes identified */
  commonMistakes: Array<{
    mistake: string;
    count: number;
    frequency: number;
  }>;
  
  /** Pattern analysis */
  patterns: {
    /** Average turns per game */
    avgTurns: number;
    
    /** Average life at end */
    avgLife: number;
    
    /** Average mulligans */
    avgMulligans: number;
    
    /** Win rate trend (positive = improving) */
    trend: number;
    
    /** Recent performance (last 10 games) */
    recentPerformance: number;
  };
  
  /** Suggested difficulty adjustment */
  difficultySuggestion: 'increase' | 'decrease' | 'maintain';
  
  /** Timestamp of report generation */
  generatedAt: number;
}

/**
 * Aggregates game records into a comprehensive coach report
 */
export function getCoachReport(records: GameRecord[]): CoachReport {
  if (!records || records.length === 0) {
    return {
      totalGames: 0,
      overallWinRate: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      winRateByDifficulty: {},
      winRateByDeck: {},
      commonMistakes: [],
      patterns: {
        avgTurns: 0,
        avgLife: 0,
        avgMulligans: 0,
        trend: 0,
        recentPerformance: 0,
      },
      difficultySuggestion: 'maintain',
      generatedAt: Date.now(),
    };
  }

  // Basic counts
  let wins = 0;
  let losses = 0;
  let draws = 0;
  
  // Track by difficulty
  const difficultyStats: Record<string, { wins: number; games: number }> = {};
  
  // Track by deck archetype
  const deckStats: Record<string, { wins: number; games: number }> = {};
  
  // Track mistakes
  const mistakeCounts: Record<string, number> = {};
  
  // Pattern tracking
  let totalTurns = 0;
  let totalLife = 0;
  let totalMulligans = 0;
  
  // For trend calculation
  const recentResults: GameResult[] = [];
  
  // Process each record
  for (const record of records) {
    // Basic counts
    if (record.result === 'win') wins++;
    else if (record.result === 'loss') losses++;
    else draws++;
    
    // Difficulty stats (for vs_ai mode)
    if (record.mode === 'vs_ai' && record.difficulty) {
      if (!difficultyStats[record.difficulty]) {
        difficultyStats[record.difficulty] = { wins: 0, games: 0 };
      }
      difficultyStats[record.difficulty].games++;
      if (record.result === 'win') {
        difficultyStats[record.difficulty].wins++;
      }
    }
    
    // Deck stats
    if (record.playerDeck) {
      if (!deckStats[record.playerDeck]) {
        deckStats[record.playerDeck] = { wins: 0, games: 0 };
      }
      deckStats[record.playerDeck].games++;
      if (record.result === 'win') {
        deckStats[record.playerDeck].wins++;
      }
    }
    
    // Track mistakes
    if (record.mistakes && Array.isArray(record.mistakes)) {
      for (const mistake of record.mistakes) {
        mistakeCounts[mistake] = (mistakeCounts[mistake] || 0) + 1;
      }
    }
    
    // Pattern stats
    totalTurns += record.turns;
    totalLife += record.playerLifeAtEnd;
    totalMulligans += record.mulligans;
    
    // Track recent results for trend
    recentResults.push(record.result);
  }
  
  const totalGames = records.length;
  const overallWinRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
  
  // Calculate win rates by difficulty
  const winRateByDifficulty: Record<string, number> = {};
  for (const [difficulty, stats] of Object.entries(difficultyStats)) {
    winRateByDifficulty[difficulty] = stats.games > 0
      ? Math.round((stats.wins / stats.games) * 100)
      : 0;
  }
  
  // Calculate win rates by deck
  const winRateByDeck: Record<string, number> = {};
  for (const [deck, stats] of Object.entries(deckStats)) {
    winRateByDeck[deck] = stats.games > 0
      ? Math.round((stats.wins / stats.games) * 100)
      : 0;
  }
  
  // Aggregate mistakes
  const commonMistakes = Object.entries(mistakeCounts)
    .map(([mistake, count]) => ({
      mistake,
      count,
      frequency: Math.round((count / totalGames) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 mistakes
  
  // Calculate trend (comparing first half vs second half of games)
  const midpoint = Math.floor(records.length / 2);
  const firstHalf = records.slice(0, midpoint);
  const secondHalf = records.slice(midpoint);
  
  const firstHalfWins = firstHalf.filter(r => r.result === 'win').length;
  const secondHalfWins = secondHalf.filter(r => r.result === 'win').length;
  
  const firstHalfRate = firstHalf.length > 0 ? firstHalfWins / firstHalf.length : 0;
  const secondHalfRate = secondHalf.length > 0 ? secondHalfWins / secondHalf.length : 0;
  
  const trend = Math.round((secondHalfRate - firstHalfRate) * 100);
  
  // Calculate recent performance (last 10 games)
  const recentWins = recentResults.slice(0, 10).filter(r => r === 'win').length;
  const recentPerformance = recentResults.length > 0
    ? Math.round((recentWins / Math.min(recentResults.length, 10)) * 100)
    : 0;
  
  // Determine difficulty suggestion based on win rate
  let difficultySuggestion: 'increase' | 'decrease' | 'maintain' = 'maintain';
  
  // Only suggest changes if there are enough games
  if (totalGames >= 5) {
    if (recentPerformance > 80) {
      difficultySuggestion = 'increase';
    } else if (recentPerformance < 20) {
      difficultySuggestion = 'decrease';
    }
  }
  
  return {
    totalGames,
    overallWinRate,
    wins,
    losses,
    draws,
    winRateByDifficulty,
    winRateByDeck,
    commonMistakes,
    patterns: {
      avgTurns: totalGames > 0 ? Math.round(totalTurns / totalGames) : 0,
      avgLife: totalGames > 0 ? Math.round(totalLife / totalGames) : 0,
      avgMulligans: totalGames > 0 ? Math.round(totalMulligans / totalGames) : 0,
      trend,
      recentPerformance,
    },
    difficultySuggestion,
    generatedAt: Date.now(),
  };
}

/**
 * Get win rate for a specific subset of records
 */
export function getWinRateByMode(records: GameRecord[], mode: GameMode): number {
  const filtered = records.filter(r => r.mode === mode);
  if (filtered.length === 0) return 0;
  
  const wins = filtered.filter(r => r.result === 'win').length;
  return Math.round((wins / filtered.length) * 100);
}

/**
 * Get performance over time (for charting)
 */
export function getPerformanceOverTime(
  records: GameRecord[],
  windowSize: number = 10
): Array<{ index: number; winRate: number; games: number }> {
  if (records.length < windowSize) {
    return [{
      index: 0,
      winRate: records.filter(r => r.result === 'win').length / Math.max(records.length, 1) * 100,
      games: records.length,
    }];
  }
  
  const result: Array<{ index: number; winRate: number; games: number }> = [];
  
  for (let i = 0; i <= records.length - windowSize; i += windowSize) {
    const window = records.slice(i, i + windowSize);
    const wins = window.filter(r => r.result === 'win').length;
    result.push({
      index: i,
      winRate: Math.round((wins / windowSize) * 100),
      games: windowSize,
    });
  }
  
  return result;
}
