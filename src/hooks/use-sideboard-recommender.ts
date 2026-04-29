"use client";

import { useState, useMemo, useCallback } from "react";
import type { MagicFormat } from "@/lib/meta";
import type { MatchupSideboardGuide } from "@/lib/sideboard-recommender";
import {
  getSideboardRecommendation,
  getAvailableMatchups,
  getMatchupSideboardPlans,
  searchSideboardRecommendations,
  getHighConfidenceSwaps,
  getUniqueRecommendedCards,
} from "@/lib/sideboard-recommender";

interface UseSideboardRecommenderOptions {
  format?: MagicFormat;
  playerArchetype?: string;
  opponentArchetype?: string;
  currentSideboard?: string[];
}

interface UseSideboardRecommenderReturn {
  recommendation: MatchupSideboardGuide | null;
  availableMatchups: ReturnType<typeof getAvailableMatchups>;
  matchupPlans: MatchupSideboardGuide[];
  searchResults: MatchupSideboardGuide[];
  uniqueCards: Map<
    string,
    { cardName: string; count: number; reasons: string[] }
  >;
  isLoading: boolean;
  error: string | null;
  getPlayerArchetypes: () => string[];
  getOpponentArchetypes: (player: string) => string[];
  fetchRecommendation: (
    player: string,
    opponent: string,
    sideboard?: string[],
  ) => void;
  search: (query: string) => void;
}

export function useSideboardRecommender(
  options: UseSideboardRecommenderOptions = {},
): UseSideboardRecommenderReturn {
  const { format: formatOption = "standard" } = options;

  const [recommendation, setRecommendation] =
    useState<MatchupSideboardGuide | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [playerArch, setPlayerArch] = useState(options.playerArchetype ?? "");
  const [opponentArch, setOpponentArch] = useState(
    options.opponentArchetype ?? "",
  );

  const availableMatchups = useMemo(
    () => getAvailableMatchups(formatOption),
    [formatOption],
  );

  const matchupPlans = useMemo(
    () =>
      playerArch ? getMatchupSideboardPlans(playerArch, formatOption) : [],
    [playerArch, formatOption],
  );

  const searchResults = useMemo(
    () =>
      searchQuery
        ? searchSideboardRecommendations(formatOption, searchQuery)
        : [],
    [searchQuery, formatOption],
  );

  const uniqueCards = useMemo(
    () =>
      playerArch
        ? getUniqueRecommendedCards(formatOption, playerArch)
        : new Map(),
    [playerArch, formatOption],
  );

  const fetchRecommendation = useCallback(
    (player: string, opponent: string, sideboard: string[] = []) => {
      setIsLoading(true);
      setError(null);
      setPlayerArch(player);
      setOpponentArch(opponent);

      try {
        const result = getSideboardRecommendation(
          player,
          opponent,
          formatOption,
          sideboard,
        );
        if (!result) {
          setError(
            `No sideboard data for ${player} vs ${opponent} in ${formatOption}`,
          );
        }
        setRecommendation(result);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to get recommendation",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [formatOption],
  );

  const search = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const getPlayerArchetypes = useCallback((): string[] => {
    const seen = new Set<string>();
    for (const m of availableMatchups) {
      seen.add(m.playerArchetype);
    }
    return Array.from(seen).sort();
  }, [availableMatchups]);

  const getOpponentArchetypes = useCallback(
    (player: string): string[] => {
      const seen = new Set<string>();
      for (const m of availableMatchups) {
        if (m.playerArchetype === player) {
          seen.add(m.opponentArchetype);
        }
      }
      return Array.from(seen).sort();
    },
    [availableMatchups],
  );

  return {
    recommendation,
    availableMatchups,
    matchupPlans,
    searchResults,
    uniqueCards,
    isLoading,
    error,
    getPlayerArchetypes,
    getOpponentArchetypes,
    fetchRecommendation,
    search,
  };
}

export function useHighConfidenceSwaps(guide: MatchupSideboardGuide | null): {
  bringIn: typeof guide extends null
    ? never
    : NonNullable<typeof guide>["bringIn"];
  takeOut: typeof guide extends null
    ? never
    : NonNullable<typeof guide>["takeOut"];
} {
  return useMemo(() => {
    if (!guide) return { bringIn: [], takeOut: [] };
    return getHighConfidenceSwaps(guide);
  }, [guide]);
}
