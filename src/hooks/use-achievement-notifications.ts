/**
 * Achievement notification hook
 * 
 * Provides toast notifications when achievements are unlocked
 */

import { useEffect, useCallback } from 'react';
import { useToast } from './use-toast';
import { achievementManager, type AchievementNotification } from '@/lib/achievements';

/**
 * Hook to subscribe to achievement notifications and display toasts
 */
export function useAchievementNotifications() {
  const { toast } = useToast();

  const showAchievementToast = useCallback((notification: AchievementNotification): void => {
    const { achievement } = notification;
    
    toast({
      title: `🏆 Achievement Unlocked!`,
      description: `${achievement.name} - ${achievement.description}`,
      variant: 'default',
      duration: 5000,
    });
  }, [toast]);

  useEffect(() => {
    // Subscribe to achievement notifications
    const unsubscribe = achievementManager.subscribe(
      (notification: AchievementNotification) => {
        showAchievementToast(notification);
      }
    );

    // Clean up subscription on unmount
    return () => {
      unsubscribe();
    };
  }, [showAchievementToast]);

  return {
    showAchievementToast,
  };
}
