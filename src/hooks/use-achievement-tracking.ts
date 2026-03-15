/**
 * Achievement Tracking Hook
 * 
 * Tracks game achievements when games end and collection achievements when collection changes
 */

import { useCallback } from 'react';
import { achievementManager, type AchievementNotification } from '@/lib/achievements';
import { useToast } from './use-toast';
import type { GameState as UIGameState } from '@/types/game';

/**
 * Hook to track game and collection achievements
 */
export function useAchievementTracking() {
  const { toast } = useToast();

  /**
   * Check and update achievements after a game ends
   */
  const trackGameAchievements = useCallback(async (
    playerId: string,
    gameState: UIGameState,
    won: boolean
  ): Promise<AchievementNotification[]> => {
    // Convert gameState to achievement-compatible format
    const achievementState = {
      players: new Map(
        gameState.players.map(p => [p.id, { life: p.lifeTotal }])
      ),
      format: gameState.format,
      turn: { turnNumber: gameState.turnNumber }
    };

    try {
      const notifications = await achievementManager.checkGameAchievements(
        playerId,
        achievementState as any,
        won
      );

      // Show toast for each new achievement
      notifications.forEach(notification => {
        toast({
          title: `🏆 Achievement Unlocked!`,
          description: `${notification.achievement.name} - ${notification.achievement.description}`,
          variant: 'default',
          duration: 5000,
        });
      });

      return notifications;
    } catch (error) {
      console.error('Failed to track game achievements:', error);
      return [];
    }
  }, [toast]);

  /**
   * Check and update achievements after collection changes
   */
  const trackCollectionAchievements = useCallback(async (
    playerId: string,
    collectionSize: number
  ): Promise<AchievementNotification[]> => {
    try {
      const notifications = await achievementManager.checkCollectionAchievements(
        playerId,
        collectionSize
      );

      // Show toast for each new achievement
      notifications.forEach(notification => {
        toast({
          title: `🏆 Achievement Unlocked!`,
          description: `${notification.achievement.name} - ${notification.achievement.description}`,
          variant: 'default',
          duration: 5000,
        });
      });

      return notifications;
    } catch (error) {
      console.error('Failed to track collection achievements:', error);
      return [];
    }
  }, [toast]);

  return {
    trackGameAchievements,
    trackCollectionAchievements,
  };
}
