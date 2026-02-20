/**
 * Social Features Hook
 * 
 * React hook for managing friends list and match history.
 * 
 * Issue #255: Add social features - friends list and match history
 */

import { useEffect, useCallback, useMemo } from 'react';
import {
  Friend,
  FriendRequest,
  MatchHistoryEntry,
  PlayerProfile,
  createFriend,
  createFriendRequest,
  createMatchHistoryEntry,
  createPlayerProfile,
  updateProfileWithResult,
  getWinRateFromHistory,
  getRecentResults,
  SOCIAL_STORAGE_KEYS,
} from '@/lib/social';
import { useLocalStorage } from './use-local-storage';
import { PlayerId } from '@/lib/game-state/types';

export interface UseSocialReturn {
  // Friends
  friends: Friend[];
  friendRequests: FriendRequest[];
  blockedPlayers: PlayerId[];
  
  // Match History
  matchHistory: MatchHistoryEntry[];
  recentMatches: MatchHistoryEntry[];
  overallWinRate: number;
  formatWinRates: Record<string, number>;
  
  // Profile
  profile: PlayerProfile | null;
  
  // Friend Actions
  addFriend: (playerId: PlayerId, displayName: string, avatarUrl?: string) => void;
  removeFriend: (friendId: string) => void;
  sendFriendRequest: (toPlayerId: PlayerId, toDisplayName: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  rejectFriendRequest: (requestId: string) => void;
  blockPlayer: (playerId: PlayerId) => void;
  unblockPlayer: (playerId: PlayerId) => void;
  
  // Match History Actions
  addMatchResult: (
    opponentId: PlayerId,
    opponentName: string,
    result: 'win' | 'loss' | 'draw',
    format: MatchHistoryEntry['format'],
    yourDeckName?: string,
    opponentDeckName?: string,
    duration?: number
  ) => void;
  
  // Profile Actions
  updateProfile: (updates: Partial<PlayerProfile>) => void;
}

const MAX_HISTORY = 100;

export function useSocial(playerId: PlayerId, playerName: string): UseSocialReturn {
  // Friends list
  const [friends, setFriends] = useLocalStorage<Friend[]>(
    `${SOCIAL_STORAGE_KEYS.FRIENDS}-${playerId}`,
    []
  );
  
  // Friend requests
  const [friendRequests, setFriendRequests] = useLocalStorage<FriendRequest[]>(
    `${SOCIAL_STORAGE_KEYS.FRIEND_REQUESTS}-${playerId}`,
    []
  );
  
  // Blocked players
  const [blockedPlayers, setBlockedPlayers] = useLocalStorage<PlayerId[]>(
    `${SOCIAL_STORAGE_KEYS.BLOCKED_PLAYERS}-${playerId}`,
    []
  );
  
  // Match history
  const [matchHistory, setMatchHistory] = useLocalStorage<MatchHistoryEntry[]>(
    `${SOCIAL_STORAGE_KEYS.MATCH_HISTORY}-${playerId}`,
    []
  );
  
  // Player profile
  const [profile, setProfile] = useLocalStorage<PlayerProfile | null>(
    `${SOCIAL_STORAGE_KEYS.PLAYER_PROFILE}-${playerId}`,
    null
  );
  
  // Initialize profile for new players
  useEffect(() => {
    if (!profile) {
      setProfile(createPlayerProfile(playerId, playerName));
    }
  }, [playerId, playerName, profile, setProfile]);
  
  // Recent matches
  const recentMatches = useMemo(() => getRecentResults(matchHistory, 10), [matchHistory]);
  
  // Overall win rate
  const overallWinRate = useMemo(() => getWinRateFromHistory(matchHistory), [matchHistory]);
  
  // Win rate by format
  const formatWinRates = useMemo(() => {
    const formats: Record<string, MatchHistoryEntry[]> = {};
    matchHistory.forEach(m => {
      if (!formats[m.format]) {
        formats[m.format] = [];
      }
      formats[m.format].push(m);
    });
    
    return Object.fromEntries(
      Object.entries(formats).map(([format, matches]) => [
        format,
        getWinRateFromHistory(matches),
      ])
    );
  }, [matchHistory]);
  
  // Add friend
  const addFriend = useCallback((playerId: PlayerId, displayName: string, avatarUrl?: string) => {
    const newFriend = createFriend(playerId, displayName, avatarUrl);
    setFriends(prev => [...prev, newFriend]);
  }, [setFriends]);
  
  // Remove friend
  const removeFriend = useCallback((friendId: string) => {
    setFriends(prev => prev.filter(f => f.id !== friendId));
  }, [setFriends]);
  
  // Send friend request
  const sendFriendRequest = useCallback((toPlayerId: PlayerId, _toDisplayName: string) => {
    const request = createFriendRequest(playerId, playerName, toPlayerId);
    setFriendRequests(prev => [...prev, request]);
  }, [playerId, playerName, setFriendRequests]);
  
  // Accept friend request
  const acceptFriendRequest = useCallback((requestId: string) => {
    const request = friendRequests.find(r => r.id === requestId);
    if (request) {
      // Add as friend
      addFriend(request.fromPlayerId, request.fromDisplayName);
      // Update request status
      setFriendRequests(prev =>
        prev.map(r =>
          r.id === requestId ? { ...r, status: 'accepted' as const } : r
        ).filter(r => r.status === 'pending')
      );
    }
  }, [friendRequests, addFriend, setFriendRequests]);
  
  // Reject friend request
  const rejectFriendRequest = useCallback((requestId: string) => {
    setFriendRequests(prev =>
      prev.map(r =>
        r.id === requestId ? { ...r, status: 'rejected' as const } : r
      ).filter(r => r.status === 'pending')
    );
  }, [setFriendRequests]);
  
  // Block player
  const blockPlayer = useCallback((playerId: PlayerId) => {
    setBlockedPlayers(prev => [...prev, playerId]);
    // Remove from friends if present
    setFriends(prev => prev.filter(f => f.playerId !== playerId));
  }, [setBlockedPlayers, setFriends]);
  
  // Unblock player
  const unblockPlayer = useCallback((playerId: PlayerId) => {
    setBlockedPlayers(prev => prev.filter(id => id !== playerId));
  }, [setBlockedPlayers]);
  
  // Add match result
  const addMatchResult = useCallback((
    opponentId: PlayerId,
    opponentName: string,
    result: 'win' | 'loss' | 'draw',
    format: MatchHistoryEntry['format'],
    yourDeckName?: string,
    opponentDeckName?: string,
    duration: number = 0
  ) => {
    const entry = createMatchHistoryEntry(
      opponentId,
      opponentName,
      result,
      format,
      yourDeckName,
      opponentDeckName,
      duration
    );
    
    setMatchHistory(prev => [entry, ...prev].slice(0, MAX_HISTORY));
    
    // Update profile stats
    if (profile) {
      setProfile(updateProfileWithResult(profile, result));
    }
  }, [profile, setMatchHistory, setProfile]);
  
  // Update profile
  const updateProfile = useCallback((updates: Partial<PlayerProfile>) => {
    setProfile(prev => prev ? { ...prev, ...updates } : null);
  }, [setProfile]);
  
  return {
    friends,
    friendRequests,
    blockedPlayers,
    matchHistory,
    recentMatches,
    overallWinRate,
    formatWinRates,
    profile,
    addFriend,
    removeFriend,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    blockPlayer,
    unblockPlayer,
    addMatchResult,
    updateProfile,
  };
}
