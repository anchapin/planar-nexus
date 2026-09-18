/**
 * Social Features Hook
 *
 * React hook for managing friends list and player profile.
 *
 * Issue #255: Add social features - friends list and match history.
 *
 * Match history note (issue #1863): this hook historically held a parallel
 * `matchHistory` `useLocalStorage` mirror as the UI-facing match-history
 * store, while `use-p2p-connection.ts` persisted `MatchRecord` rows to the
 * `localIntelligenceDb.match_records` Dexie store (the durable source of
 * truth per the persistence ADR §6 stage 3). The two paths drifted
 * independently because nothing connected them.
 *
 * Resolution: the P2P match-history surface is owned exclusively by
 * `localIntelligenceDb.match_records` (see `src/hooks/use-p2p-connection.ts`
 * `handleGameEnded` and `src/lib/db/local-intelligence-db.ts`). The mirror
 * in this hook has been removed so the two cannot drift. Future
 * match-history consumers MUST read from `match_records` (or via a
 * dedicated selector hook layered on top of it), NOT from `useLocalStorage`
 * with a `match-history` key.
 */

import { useEffect, useCallback } from "react";
import {
  Friend,
  FriendRequest,
  PlayerProfile,
  createFriend,
  createFriendRequest,
  createPlayerProfile,
  SOCIAL_STORAGE_KEYS,
} from "@/lib/social";
import { useLocalStorage } from "./use-local-storage";
import { PlayerId } from "@/lib/game-state";

export interface UseSocialReturn {
  // Friends
  friends: Friend[];
  friendRequests: FriendRequest[];
  blockedPlayers: PlayerId[];

  // Profile
  profile: PlayerProfile | null;

  // Friend Actions
  addFriend: (
    playerId: PlayerId,
    displayName: string,
    avatarUrl?: string,
  ) => void;
  removeFriend: (friendId: string) => void;
  sendFriendRequest: (toPlayerId: PlayerId, toDisplayName: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  rejectFriendRequest: (requestId: string) => void;
  blockPlayer: (playerId: PlayerId) => void;
  unblockPlayer: (playerId: PlayerId) => void;

  // Profile Actions
  updateProfile: (updates: Partial<PlayerProfile>) => void;
}

export function useSocial(
  playerId: PlayerId,
  playerName: string,
): UseSocialReturn {
  // Friends list
  const [friends, setFriends] = useLocalStorage<Friend[]>(
    `${SOCIAL_STORAGE_KEYS.FRIENDS}-${playerId}`,
    [],
  );

  // Friend requests
  const [friendRequests, setFriendRequests] = useLocalStorage<FriendRequest[]>(
    `${SOCIAL_STORAGE_KEYS.FRIEND_REQUESTS}-${playerId}`,
    [],
  );

  // Blocked players
  const [blockedPlayers, setBlockedPlayers] = useLocalStorage<PlayerId[]>(
    `${SOCIAL_STORAGE_KEYS.BLOCKED_PLAYERS}-${playerId}`,
    [],
  );

  // Player profile
  const [profile, setProfile] = useLocalStorage<PlayerProfile | null>(
    `${SOCIAL_STORAGE_KEYS.PLAYER_PROFILE}-${playerId}`,
    null,
  );

  // Initialize profile for new players
  useEffect(() => {
    if (!profile) {
      setProfile(createPlayerProfile(playerId, playerName));
    }
  }, [playerId, playerName, profile, setProfile]);

  // Add friend
  const addFriend = useCallback(
    (playerId: PlayerId, displayName: string, avatarUrl?: string) => {
      const newFriend = createFriend(playerId, displayName, avatarUrl);
      setFriends((prev) => [...prev, newFriend]);
    },
    [setFriends],
  );

  // Remove friend
  const removeFriend = useCallback(
    (friendId: string) => {
      setFriends((prev) => prev.filter((f) => f.id !== friendId));
    },
    [setFriends],
  );

  // Send friend request
  const sendFriendRequest = useCallback(
    (toPlayerId: PlayerId, _toDisplayName: string) => {
      const request = createFriendRequest(playerId, playerName, toPlayerId);
      setFriendRequests((prev) => [...prev, request]);
    },
    [playerId, playerName, setFriendRequests],
  );

  // Accept friend request
  const acceptFriendRequest = useCallback(
    (requestId: string) => {
      const request = friendRequests.find((r) => r.id === requestId);
      if (request) {
        // Add as friend
        addFriend(request.fromPlayerId, request.fromDisplayName);
        // Update request status
        setFriendRequests((prev) =>
          prev
            .map((r) =>
              r.id === requestId ? { ...r, status: "accepted" as const } : r,
            )
            .filter((r) => r.status === "pending"),
        );
      }
    },
    [friendRequests, addFriend, setFriendRequests],
  );

  // Reject friend request
  const rejectFriendRequest = useCallback(
    (requestId: string) => {
      setFriendRequests((prev) =>
        prev
          .map((r) =>
            r.id === requestId ? { ...r, status: "rejected" as const } : r,
          )
          .filter((r) => r.status === "pending"),
      );
    },
    [setFriendRequests],
  );

  // Block player
  const blockPlayer = useCallback(
    (playerId: PlayerId) => {
      setBlockedPlayers((prev) => [...prev, playerId]);
      // Remove from friends if present
      setFriends((prev) => prev.filter((f) => f.playerId !== playerId));
    },
    [setBlockedPlayers, setFriends],
  );

  // Unblock player
  const unblockPlayer = useCallback(
    (playerId: PlayerId) => {
      setBlockedPlayers((prev) => prev.filter((id) => id !== playerId));
    },
    [setBlockedPlayers],
  );

  // Update profile
  const updateProfile = useCallback(
    (updates: Partial<PlayerProfile>) => {
      setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
    },
    [setProfile],
  );

  return {
    friends,
    friendRequests,
    blockedPlayers,
    profile,
    addFriend,
    removeFriend,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    blockPlayer,
    unblockPlayer,
    updateProfile,
  };
}
