/**
 * Ranked Mode Hook
 *
 * React hook for managing ranked mode state, including player rating,
 * season, and leaderboard.
 *
 * Issue #254: Add competitive/ranked game mode.
 *
 * Match history note (issue #1863): this hook historically held a parallel
 * `matchHistory` `useLocalStorage` mirror as a match-history writer, while
 * `use-p2p-connection.ts` persisted `MatchRecord` rows to the
 * `localIntelligenceDb.match_records` Dexie store (the durable source of
 * truth per the persistence ADR §6 stage 3). The two paths drifted
 * independently because nothing connected them.
 *
 * Resolution: the P2P match-history surface is owned exclusively by
 * `localIntelligenceDb.match_records`. The mirror has been removed from this
 * hook so the two cannot drift. `playerRating`/`leaderboard`/`season` (the
 * ranked-mode ELO surface) are unaffected — they are derived state over
 * `match_records`, not raw match history.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PlayerRating,
  Season,
  LeaderboardEntry,
  createPlayerRating,
  ratingToRank,
  sortLeaderboard,
  createSeason,
  getSeasonDaysRemaining,
  getRankDisplayName,
  getRankColor,
  getPlayerRank,
  RANKED_STORAGE_KEYS,
} from "@/lib/ranked-mode";
import { useLocalStorage } from "./use-local-storage";
import { PlayerId } from "@/lib/game-state";

export interface UseRankedModeReturn {
  // Player state
  playerRating: PlayerRating | null;
  isNewPlayer: boolean;

  // Season state
  season: Season | null;
  daysRemaining: number;

  // Leaderboard
  leaderboard: LeaderboardEntry[];
  playerRank: number;

  // Actions
  startRankedMatch: (opponentRating: number) => void;
  resetRank: () => void;

  // UI helpers
  getRankDisplay: () => string;
  getRankTierColor: () => string;
}

const SEASON_KEY = "planar-nexus-season";

export function useRankedMode(
  playerId: PlayerId,
  playerName: string,
): UseRankedModeReturn {
  // Player rating storage
  const [playerRating, setPlayerRating] = useLocalStorage<PlayerRating | null>(
    `${RANKED_STORAGE_KEYS.PLAYER_RATING}-${playerId}`,
    null,
  );

  // Initialize rating for new players
  useEffect(() => {
    if (!playerRating) {
      setPlayerRating(createPlayerRating(playerId, playerName));
    }
  }, [playerId, playerName, playerRating, setPlayerRating]);

  // Season management
  const [season, setSeason] = useState<Season | null>(null);

  useEffect(() => {
    // Load or create season
    const storedSeason = localStorage.getItem(SEASON_KEY);
    if (storedSeason) {
      try {
        const parsed = JSON.parse(storedSeason);
        if (parsed.endDate > Date.now()) {
          setSeason(parsed);
        } else {
          // Season ended, create new one
          const newSeason = createSeason(
            (parsed.seasonNumber || 1) + 1,
            Date.now(),
          );
          setSeason(newSeason);
          localStorage.setItem(SEASON_KEY, JSON.stringify(newSeason));
        }
      } catch {
        const newSeason = createSeason(1, Date.now());
        setSeason(newSeason);
        localStorage.setItem(SEASON_KEY, JSON.stringify(newSeason));
      }
    } else {
      const newSeason = createSeason(1, Date.now());
      setSeason(newSeason);
      localStorage.setItem(SEASON_KEY, JSON.stringify(newSeason));
    }
  }, []);

  // Match history: removed (issue #1863). The P2P match-history surface is
  // owned exclusively by `localIntelligenceDb.match_records` (Dexie) — see
  // `src/hooks/use-p2p-connection.ts` `handleGameEnded` and
  // `src/lib/db/local-intelligence-db.ts`. A future selector hook layered
  // on `match_records` can replace this section if/when the ranked ELO
  // surface needs to compute from per-game results.

  // Leaderboard (mock data - in production would come from server)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  // Generate mock leaderboard for demo
  useEffect(() => {
    if (playerRating) {
      const mockPlayers: PlayerRating[] = [
        playerRating,
        ...Array.from({ length: 19 }, (_, i) =>
          createPlayerRating(`mock-${i}`, `Player ${i + 1}`),
        ),
      ];

      // Randomize ratings for mock
      mockPlayers.forEach((p, i) => {
        if (i > 0) {
          p.rating = Math.max(
            800,
            Math.min(2200, 1200 + Math.random() * 800 - 400),
          );
          p.wins = Math.floor(Math.random() * 50);
          p.losses = Math.floor(Math.random() * 30);
          p.rank = ratingToRank(p.rating);
        }
      });

      setLeaderboard(sortLeaderboard(mockPlayers));
    }
  }, [playerRating]);

  // Calculate player rank
  const playerRank = useMemo(() => {
    if (!playerRating) return -1;
    return getPlayerRank(
      playerId,
      leaderboard.map((e) => ({
        playerId: e.playerId,
        playerName: e.playerName,
        rating: e.rating,
        rank: e.rankInfo,
        wins: e.wins,
        losses: e.losses,
        draws: 0,
        currentStreak: 0,
        bestStreak: 0,
        seasonWins: e.wins,
        seasonLosses: e.losses,
        seasonGamesPlayed: e.wins + e.losses,
        lastPlayedAt: Date.now(),
      })),
    );
  }, [playerId, leaderboard, playerRating]);

  // Days remaining in season
  const daysRemaining = useMemo(() => {
    if (!season) return 0;
    return getSeasonDaysRemaining(season);
  }, [season]);

  // Start ranked match (placeholder for matchmaking)
  const startRankedMatch = useCallback((_opponentRating: number) => {
    // In production, this would trigger matchmaking
    // For now, just return - the match result will be recorded separately
  }, []);

  // Reset rank
  const resetRank = useCallback(() => {
    setPlayerRating(createPlayerRating(playerId, playerName));
  }, [playerId, playerName, setPlayerRating]);

  // UI helpers
  const getRankDisplay = useCallback(() => {
    if (!playerRating) return "Unranked";
    return getRankDisplayName(playerRating.rank);
  }, [playerRating]);

  const getRankTierColor = useCallback(() => {
    if (!playerRating) return "#808080";
    return getRankColor(playerRating.rank.tier);
  }, [playerRating]);

  return {
    playerRating,
    isNewPlayer: !playerRating || playerRating.seasonGamesPlayed === 0,
    season,
    daysRemaining,
    leaderboard,
    playerRank,
    startRankedMatch,
    resetRank,
    getRankDisplay,
    getRankTierColor,
  };
}
