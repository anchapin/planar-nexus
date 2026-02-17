/**
 * Social Features System
 * 
 * Implements friends list and match history for social features.
 * 
 * Issue #255: Add social features - friends list and match history
 */

import { PlayerId } from './game-state/types';

// ============================================================
// Types
// ============================================================

export type FriendStatus = 'none' | 'pending' | 'friends' | 'blocked';

export interface Friend {
  id: string;
  playerId: PlayerId;
  displayName: string;
  avatarUrl?: string;
  status: 'online' | 'offline' | 'in-game';
  lastSeen?: number;
  addedAt: number;
}

export interface FriendRequest {
  id: string;
  fromPlayerId: PlayerId;
  fromDisplayName: string;
  toPlayerId: PlayerId;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface MatchHistoryEntry {
  id: string;
  opponentId: PlayerId;
  opponentName: string;
  result: 'win' | 'loss' | 'draw';
  format: 'standard' | 'draft' | 'sealed' | 'commander' | 'casual';
  yourDeckName?: string;
  opponentDeckName?: string;
  playedAt: number;
  duration: number; // in seconds
}

export interface PlayerProfile {
  playerId: PlayerId;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  joinedAt: number;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  favoriteFormat?: string;
  favoriteDeck?: string;
}

// ============================================================
// Storage Keys
// ============================================================

export const SOCIAL_STORAGE_KEYS = {
  FRIENDS: 'planar-nexus-friends',
  FRIEND_REQUESTS: 'planar-nexus-friend-requests',
  MATCH_HISTORY: 'planar-nexus-match-history',
  BLOCKED_PLAYERS: 'planar-nexus-blocked-players',
  PLAYER_PROFILE: 'planar-nexus-player-profile',
} as const;

// ============================================================
// Friend Management
// ============================================================

/**
 * Create a new friend entry
 */
export function createFriend(
  playerId: PlayerId,
  displayName: string,
  avatarUrl?: string
): Friend {
  return {
    id: `friend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    playerId,
    displayName,
    avatarUrl,
    status: 'offline',
    addedAt: Date.now(),
  };
}

/**
 * Create a friend request
 */
export function createFriendRequest(
  fromPlayerId: PlayerId,
  fromDisplayName: string,
  toPlayerId: PlayerId
): FriendRequest {
  return {
    id: `request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    fromPlayerId,
    fromDisplayName,
    toPlayerId,
    timestamp: Date.now(),
    status: 'pending',
  };
}

// ============================================================
// Match History
// ============================================================

/**
 * Create a match history entry
 */
export function createMatchHistoryEntry(
  opponentId: PlayerId,
  opponentName: string,
  result: 'win' | 'loss' | 'draw',
  format: MatchHistoryEntry['format'],
  yourDeckName?: string,
  opponentDeckName?: string,
  duration: number = 0
): MatchHistoryEntry {
  return {
    id: `match-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    opponentId,
    opponentName,
    result,
    format,
    yourDeckName,
    opponentDeckName,
    playedAt: Date.now(),
    duration,
  };
}

/**
 * Get win rate from match history
 */
export function getWinRateFromHistory(history: MatchHistoryEntry[]): number {
  if (history.length === 0) return 0;
  
  const wins = history.filter(m => m.result === 'win').length;
  const draws = history.filter(m => m.result === 'draw').length;
  
  return ((wins + draws * 0.5) / history.length) * 100;
}

/**
 * Get recent results (last N games)
 */
export function getRecentResults(history: MatchHistoryEntry[], count: number = 10): MatchHistoryEntry[] {
  return [...history]
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, count);
}

/**
 * Get results by format
 */
export function getResultsByFormat(
  history: MatchHistoryEntry[],
  format: MatchHistoryEntry['format']
): MatchHistoryEntry[] {
  return history.filter(m => m.format === format);
}

// ============================================================
// Player Profile
// ============================================================

/**
 * Create a default player profile
 */
export function createPlayerProfile(
  playerId: PlayerId,
  displayName: string
): PlayerProfile {
  return {
    playerId,
    displayName,
    joinedAt: Date.now(),
    totalGames: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

/**
 * Update profile with match result
 */
export function updateProfileWithResult(
  profile: PlayerProfile,
  result: 'win' | 'loss' | 'draw'
): PlayerProfile {
  return {
    ...profile,
    totalGames: profile.totalGames + 1,
    wins: profile.wins + (result === 'win' ? 1 : 0),
    losses: profile.losses + (result === 'loss' ? 1 : 0),
    draws: profile.draws + (result === 'draw' ? 1 : 0),
  };
}

/**
 * Get overall win rate
 */
export function getOverallWinRate(profile: PlayerProfile): number {
  if (profile.totalGames === 0) return 0;
  return ((profile.wins + profile.draws * 0.5) / profile.totalGames) * 100;
}
