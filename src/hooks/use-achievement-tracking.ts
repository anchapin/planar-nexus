/**
 * Achievement integration hook
 * 
 * Tracks game events and triggers achievement unlocks
 */

"use client";

import { useCallback } from 'react';
import { achievementManager } from '@/lib/achievements';
import type { GameState as UIGameState } from '@/types/game';

export interface AchievementTriggerContext {
  gameState: UIGameState;
  won: boolean;
}

/**
 * Hook to track achievements when games complete
 */
export function useAchievementTracking(playerId: string) {
  /**
   * Trigger achievements after a game ends
   */
  const onGameEnd = useCallback(async (context: AchievementTriggerContext) => {
    if (!playerId) return;
    
    const { gameState, won } = context;
    
    // Use the built-in game achievement checker
    await achievementManager.checkGameAchievements(playerId, gameState as any, won);
  }, [playerId]);

  /**
   * Track collection achievements (e.g., after adding cards)
   */
  const trackCollectionAchievements = useCallback(async (collectionSize: number) => {
    if (!playerId) return;
    await achievementManager.checkCollectionAchievements(playerId, collectionSize);
  }, [playerId]);

  return {
    onGameEnd,
    trackCollectionAchievements,
  };
}

