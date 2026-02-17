/**
 * Ranked Mode System
 * 
 * Implements competitive ranked gameplay with Elo rating system,
 * seasons, and leaderboards.
 * 
 * Issue #254: Add competitive/ranked game mode
 */

import { PlayerId } from './game-state/types';

// ============================================================
// Types
// ============================================================

export type RankTier = 
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster';

export type RankDivision = 1 | 2 | 3 | 4;

export interface Rank {
  tier: RankTier;
  division: RankDivision;
  lp: number; // League Points
}

export interface PlayerRating {
  playerId: PlayerId;
  playerName: string;
  rating: number; // Elo rating
  rank: Rank;
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number; // positive = win streak, negative = loss streak
  bestStreak: number;
  seasonWins: number;
  seasonLosses: number;
  seasonGamesPlayed: number;
  lastPlayedAt: number;
}

export interface MatchResult {
  playerId: PlayerId;
  opponentId: PlayerId;
  result: 'win' | 'loss' | 'draw';
  ratingChange: number;
  lpChange: number;
  opponentRating: number;
  timestamp: number;
}

export interface Season {
  id: string;
  name: string;
  startDate: number;
  endDate: number;
  isActive: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: PlayerId;
  playerName: string;
  rating: number;
  rankInfo: Rank;
  wins: number;
  losses: number;
}

// ============================================================
// Constants
// ============================================================

const RANK_TIERS: RankTier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];

const RANK_THRESHOLDS: Record<RankTier, number> = {
  bronze: 0,
  silver: 1000,
  gold: 1200,
  platinum: 1400,
  diamond: 1600,
  master: 1800,
  grandmaster: 2000,
};

const LP_PER_DIVISION = 100;

const RANKED_STARTING_RATING = 1000;

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the tier for a given rating
 */
export function getTierForRating(rating: number): RankTier {
  if (rating >= RANK_THRESHOLDS.grandmaster) return 'grandmaster';
  if (rating >= RANK_THRESHOLDS.master) return 'master';
  if (rating >= RANK_THRESHOLDS.diamond) return 'diamond';
  if (rating >= RANK_THRESHOLDS.platinum) return 'platinum';
  if (rating >= RANK_THRESHOLDS.gold) return 'gold';
  if (rating >= RANK_THRESHOLDS.silver) return 'silver';
  return 'bronze';
}

/**
 * Get division within a tier based on LP
 */
export function getDivisionForLP(lp: number): RankDivision {
  const division = Math.floor(lp / LP_PER_DIVISION) + 1;
  return Math.min(4, Math.max(1, division)) as RankDivision;
}

/**
 * Calculate LP from rating and tier
 */
export function calculateLP(rating: number, tier: RankTier): number {
  const tierStart = RANK_THRESHOLDS[tier];
  return Math.max(0, rating - tierStart);
}

/**
 * Convert rating to rank object
 */
export function ratingToRank(rating: number): Rank {
  const tier = getTierForRating(rating);
  const lp = calculateLP(rating, tier);
  return {
    tier,
    division: getDivisionForLP(lp),
    lp,
  };
}

/**
 * Get tier index (0 = bronze, 6 = grandmaster)
 */
export function getTierIndex(tier: RankTier): number {
  return RANK_TIERS.indexOf(tier);
}

/**
 * Get display name for rank
 */
export function getRankDisplayName(rank: Rank): string {
  const tierName = rank.tier.charAt(0).toUpperCase() + rank.tier.slice(1);
  if (rank.tier === 'grandmaster' || rank.tier === 'master') {
    return tierName;
  }
  return `${tierName} ${rank.division}`;
}

/**
 * Get rank color for UI
 */
export function getRankColor(tier: RankTier): string {
  const colors: Record<RankTier, string> = {
    bronze: '#cd7f32',
    silver: '#c0c0c0',
    gold: '#ffd700',
    platinum: '#e5e4e2',
    diamond: '#b9f2ff',
    master: '#9d4edd',
    grandmaster: '#ff6b6b',
  };
  return colors[tier];
}

// ============================================================
// Elo Rating System
// ============================================================

/**
 * Calculate expected score for a match
 */
export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate rating change after a match
 * Uses K-factor to determine volatility
 */
export function calculateRatingChange(
  playerRating: number,
  opponentRating: number,
  actualScore: number, // 1 = win, 0.5 = draw, 0 = loss
  kFactor?: number
): number {
  // K-factor determines how much rating can change
  // Higher K = more volatile ratings
  const k = kFactor ?? getKFactor(playerRating);
  
  const expectedScore = calculateExpectedScore(playerRating, opponentRating);
  return Math.round(k * (actualScore - expectedScore));
}

/**
 * Get K-factor based on rating
 * Lower rated players have higher K-factor (faster progression)
 */
export function getKFactor(rating: number): number {
  if (rating < 1200) return 40; // New players
  if (rating < 1400) return 32; // Bronze/Silver
  if (rating < 1600) return 24; // Gold/Platinum
  if (rating < 1800) return 16; // Diamond
  return 12; // Master+ (more stable)
}

/**
 * Calculate LP change based on match result and rank
 */
export function calculateLPChange(
  result: 'win' | 'loss' | 'draw',
  rank: Rank,
  isPromoteMatch: boolean = false
): number {
  const baseLP = {
    win: 20,
    draw: 10,
    loss: 0,
  }[result];

  // Bonus for winning at promotion threshold
  if (isPromoteMatch && result === 'win') {
    return baseLP + 10;
  }

  // Reduced LP loss at higher ranks
  const tierIndex = getTierIndex(rank.tier);
  const reduction = Math.min(tierIndex * 2, 10);
  
  return result === 'loss' 
    ? -Math.max(10, baseLP - reduction) 
    : baseLP;
}

// ============================================================
// Season Management
// ============================================================

const SEASON_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Generate a new season
 */
export function createSeason(seasonNumber: number, startDate?: number): Season {
  const start = startDate ?? Date.now();
  return {
    id: `season-${seasonNumber}`,
    name: `Season ${seasonNumber}`,
    startDate: start,
    endDate: start + SEASON_DURATION_MS,
    isActive: true,
  };
}

/**
 * Check if a season is active
 */
export function isSeasonActive(season: Season): boolean {
  const now = Date.now();
  return now >= season.startDate && now <= season.endDate;
}

/**
 * Get days remaining in season
 */
export function getSeasonDaysRemaining(season: Season): number {
  const remaining = season.endDate - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

// ============================================================
// Player Rating Management
// ============================================================

/**
 * Create a new player rating entry
 */
export function createPlayerRating(
  playerId: PlayerId,
  playerName: string
): PlayerRating {
  return {
    playerId,
    playerName,
    rating: RANKED_STARTING_RATING,
    rank: ratingToRank(RANKED_STARTING_RATING),
    wins: 0,
    losses: 0,
    draws: 0,
    currentStreak: 0,
    bestStreak: 0,
    seasonWins: 0,
    seasonLosses: 0,
    seasonGamesPlayed: 0,
    lastPlayedAt: Date.now(),
  };
}

/**
 * Process a match result and update player rating
 */
export function processMatchResult(
  rating: PlayerRating,
  opponentRating: number,
  result: 'win' | 'loss' | 'draw'
): { updatedRating: PlayerRating; matchResult: MatchResult } {
  const actualScore = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  const ratingChange = calculateRatingChange(rating.rating, opponentRating, actualScore);
  
  // Calculate LP change
  const newRating = Math.max(0, rating.rating + ratingChange);
  const newRank = ratingToRank(newRating);
  const lpChange = calculateLPChange(result, rating.rank);
  const newLP = Math.max(0, rating.rank.lp + lpChange);
  
  // Check for promotion
  const wasPromoted = getTierIndex(newRank.tier) > getTierIndex(rating.rank.tier);
  
  // Update streak
  const newStreak = result === 'win' 
    ? rating.currentStreak + 1 
    : result === 'loss' 
    ? rating.currentStreak - 1 
    : 0;
  const newBestStreak = Math.max(rating.bestStreak, Math.abs(newStreak));
  
  const updatedRating: PlayerRating = {
    ...rating,
    rating: newRating,
    rank: { ...newRank, lp: newLP },
    wins: rating.wins + (result === 'win' ? 1 : 0),
    losses: rating.losses + (result === 'loss' ? 1 : 0),
    draws: rating.draws + (result === 'draw' ? 1 : 0),
    currentStreak: newStreak,
    bestStreak: newBestStreak,
    seasonWins: rating.seasonWins + (result === 'win' ? 1 : 0),
    seasonLosses: rating.seasonLosses + (result === 'loss' ? 1 : 0),
    seasonGamesPlayed: rating.seasonGamesPlayed + 1,
    lastPlayedAt: Date.now(),
  };

  const matchResult: MatchResult = {
    playerId: rating.playerId,
    opponentId: '', // Would be set by caller
    result,
    ratingChange,
    lpChange,
    opponentRating,
    timestamp: Date.now(),
  };

  return { updatedRating, matchResult };
}

/**
 * Get win rate percentage
 */
export function getWinRate(rating: PlayerRating): number {
  const totalGames = rating.wins + rating.losses + rating.draws;
  if (totalGames === 0) return 0;
  return ((rating.wins + rating.draws * 0.5) / totalGames) * 100;
}

/**
 * Get season win rate
 */
export function getSeasonWinRate(rating: PlayerRating): number {
  const totalGames = rating.seasonGamesPlayed;
  if (totalGames === 0) return 0;
  return ((rating.seasonWins + rating.seasonLosses * 0) / totalGames) * 100;
}

// ============================================================
// Leaderboard
// ============================================================

/**
 * Sort players by rating for leaderboard
 */
export function sortLeaderboard(ratings: PlayerRating[]): LeaderboardEntry[] {
  return ratings
    .sort((a, b) => b.rating - a.rating)
    .map((rating, index) => ({
      rank: index + 1,
      playerId: rating.playerId,
      playerName: rating.playerName,
      rating: rating.rating,
      rankInfo: rating.rank,
      wins: rating.wins,
      losses: rating.losses,
    }));
}

/**
 * Get top N players from leaderboard
 */
export function getTopPlayers(ratings: PlayerRating[], count: number = 10): LeaderboardEntry[] {
  return sortLeaderboard(ratings).slice(0, count);
}

/**
 * Get player's rank on leaderboard
 */
export function getPlayerRank(playerId: PlayerId, ratings: PlayerRating[]): number {
  const sorted = sortLeaderboard(ratings);
  const entry = sorted.find(e => e.playerId === playerId);
  return entry?.rank ?? -1;
}

// ============================================================
// Storage Keys
// ============================================================

export const RANKED_STORAGE_KEYS = {
  PLAYER_RATING: 'planar-nexus-ranked-rating',
  SEASON: 'planar-nexus-ranked-season',
  MATCH_HISTORY: 'planar-nexus-ranked-history',
  LEADERBOARD: 'planar-nexus-ranked-leaderboard',
} as const;
