/**
 * Achievement Notification Toast Component
 * 
 * Displays toast notifications when achievements are unlocked
 */

'use client';

import { useEffect } from 'react';
import { 
  achievementManager, 
  type AchievementNotification,
  RARITY_COLORS,
  formatRarity
} from '@/lib/achievements';
import { 
  Trophy, 
  Star, 
  Play,
  Shield,
  Boxes,
  Heart,
  Timer,
  Award,
  Crown,
  Gem,
  Flame,
  Medal,
  Gamepad2,
  Zap,
  Flag,
  Compass,
  Library,
  Archive,
  ShieldCheck,
  GitCompare
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Icon mapping for achievements
 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Play,
  Gamepad2,
  Trophy,
  Medal,
  Crown,
  Star,
  Zap,
  Award,
  Flame,
  Gem,
  Shield,
  ShieldCheck,
  Flag,
  Compass,
  Boxes,
  Library,
  Archive,
  Heart,
  Timer,
  GitCompare,
};

/**
 * Get icon component
 */
function getIconComponent(iconName: string) {
  return ICON_MAP[iconName] || Trophy;
}

/**
 * Achievement Notification Toast Component
 */
export function AchievementNotificationToast() {
  const { toast } = useToast();

  useEffect(() => {
    // Subscribe to achievement notifications
    const unsubscribe = achievementManager.subscribe(
      (notification: AchievementNotification) => {
        // Trigger a toast notification
        const Icon = getIconComponent(notification.achievement.icon);
        const rarityColor = RARITY_COLORS[notification.achievement.rarity];
        
        toast({
          title: (
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5" style={{ color: rarityColor }} />
              <span>Achievement Unlocked!</span>
            </div>
          ),
          description: (
            <div className="flex flex-col gap-1">
              <span className="font-semibold" style={{ color: rarityColor }}>
                {notification.achievement.name}
              </span>
              <span className="text-sm text-muted-foreground">
                {notification.achievement.description}
              </span>
              <span className="text-xs text-muted-foreground">
                +{notification.achievement.points} points • {formatRarity(notification.achievement.rarity)}
              </span>
            </div>
          ),
          duration: 5000,
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [toast]);

  return null;
}

/**
 * Hook to trigger achievement notifications manually
 * Useful for testing or custom achievement triggers
 */
export function useAchievementToast() {
  const { toast } = useToast();

  const showAchievementToast = (notification: AchievementNotification) => {
    const Icon = getIconComponent(notification.achievement.icon);
    const rarityColor = RARITY_COLORS[notification.achievement.rarity];
    
    toast({
      title: (
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color: rarityColor }} />
          <span>Achievement Unlocked!</span>
        </div>
      ),
      description: (
        <div className="flex flex-col gap-1">
          <span className="font-semibold" style={{ color: rarityColor }}>
            {notification.achievement.name}
          </span>
          <span className="text-sm text-muted-foreground">
            {notification.achievement.description}
          </span>
          <span className="text-xs text-muted-foreground">
            +{notification.achievement.points} points • {formatRarity(notification.achievement.rarity)}
          </span>
        </div>
      ),
      duration: 5000,
    });
  };

  return { showAchievementToast };
}
