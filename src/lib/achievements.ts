/**
 * @fileOverview Achievement and badge system for player milestones
 * 
 * Issue #96: Phase 5.3: Implement achievement and badge system
 * 
 * Provides:
 * - Achievement definitions
 * - Achievement tracking
 * - Badge display
 * - Achievement notifications
 * - Rarity tiers
 */

import type { GameState } from './game-state/types';

/**
 * Achievement rarity tiers
 */
export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * Achievement categories
 */
export type AchievementCategory = 'games' | 'wins' | 'collection' | 'social' | 'special';

/**
 * Achievement definition
 */
export interface Achievement {
  /** Unique achievement ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Rarity tier */
  rarity: AchievementRarity;
  /** Category */
  category: AchievementCategory;
  /** Icon name (lucide-react) */
  icon: string;
  /** Points awarded */
  points: number;
  /** Requirement to unlock */
  requirement: AchievementRequirement;
  /** Hidden achievements show only when unlocked */
  hidden?: boolean;
}

/**
 * Achievement requirement
 */
export interface AchievementRequirement {
  /** Type of requirement */
  type: 'games_played' | 'wins' | 'games_with_format' | 'consecutive_wins' | 'cards_collected' | 'special';
  /** Required count */
  count: number;
  /** Optional format for format-specific achievements */
  format?: string;
}

/**
 * Player's achievement progress
 */
export interface AchievementProgress {
  /** Achievement ID */
  achievementId: string;
  /** Current progress count */
  currentProgress: number;
  /** Whether unlocked */
  unlocked: boolean;
  /** When unlocked (timestamp) */
  unlockedAt?: number;
}

/**
 * Player's achievement data
 */
export interface PlayerAchievements {
  /** Player ID */
  playerId: string;
  /** All achievement progress */
  achievements: AchievementProgress[];
  /** Total points */
  totalPoints: number;
  /** Last updated */
  lastUpdated: number;
}

/**
 * Achievement notification
 */
export interface AchievementNotification {
  achievement: Achievement;
  timestamp: number;
}

/**
 * All available achievements
 */
export const ACHIEVEMENTS: Achievement[] = [
  // Games Played
  {
    id: 'first_game',
    name: 'First Steps',
    description: 'Play your first game',
    rarity: 'common',
    category: 'games',
    icon: 'Play',
    points: 10,
    requirement: { type: 'games_played', count: 1 },
  },
  {
    id: 'games_10',
    name: 'Getting Started',
    description: 'Play 10 games',
    rarity: 'common',
    category: 'games',
    icon: 'Gamepad2',
    points: 25,
    requirement: { type: 'games_played', count: 10 },
  },
  {
    id: 'games_50',
    name: 'Regular Player',
    description: 'Play 50 games',
    rarity: 'uncommon',
    category: 'games',
    icon: 'Trophy',
    points: 50,
    requirement: { type: 'games_played', count: 50 },
  },
  {
    id: 'games_100',
    name: 'Dedicated Player',
    description: 'Play 100 games',
    rarity: 'rare',
    category: 'games',
    icon: 'Medal',
    points: 100,
    requirement: { type: 'games_played', count: 100 },
  },
  {
    id: 'games_500',
    name: 'Veteran',
    description: 'Play 500 games',
    rarity: 'epic',
    category: 'games',
    icon: 'Crown',
    points: 250,
    requirement: { type: 'games_played', count: 500 },
  },

  // Wins
  {
    id: 'first_win',
    name: 'First Victory',
    description: 'Win your first game',
    rarity: 'common',
    category: 'wins',
    icon: 'Star',
    points: 15,
    requirement: { type: 'wins', count: 1 },
  },
  {
    id: 'wins_10',
    name: 'Winning Streak',
    description: 'Win 10 games',
    rarity: 'uncommon',
    category: 'wins',
    icon: 'Zap',
    points: 40,
    requirement: { type: 'wins', count: 10 },
  },
  {
    id: 'wins_50',
    name: 'Champion',
    description: 'Win 50 games',
    rarity: 'rare',
    category: 'wins',
    icon: 'Award',
    points: 100,
    requirement: { type: 'wins', count: 50 },
  },
  {
    id: 'wins_100',
    name: 'Legend',
    description: 'Win 100 games',
    rarity: 'epic',
    category: 'wins',
    icon: 'Flame',
    points: 200,
    requirement: { type: 'wins', count: 100 },
  },
  {
    id: 'wins_500',
    name: 'Immortal',
    description: 'Win 500 games',
    rarity: 'legendary',
    category: 'wins',
    icon: 'Gem',
    points: 500,
    requirement: { type: 'wins', count: 500 },
  },

  // Format-specific
  {
    id: 'commander_first',
    name: 'Commander Initiate',
    description: 'Play your first Commander game',
    rarity: 'common',
    category: 'games',
    icon: 'Shield',
    points: 15,
    requirement: { type: 'games_with_format', count: 1, format: 'commander' },
  },
  {
    id: 'commander_10',
    name: 'Commander Veteran',
    description: 'Play 10 Commander games',
    rarity: 'uncommon',
    category: 'games',
    icon: 'ShieldCheck',
    points: 50,
    requirement: { type: 'games_with_format', count: 10, format: 'commander' },
  },
  {
    id: 'standard_first',
    name: 'Standard Bearer',
    description: 'Play your first Standard game',
    rarity: 'common',
    category: 'games',
    icon: 'Flag',
    points: 15,
    requirement: { type: 'games_with_format', count: 1, format: 'standard' },
  },
  {
    id: 'modern_first',
    name: 'Modern Explorer',
    description: 'Play your first Modern game',
    rarity: 'common',
    category: 'games',
    icon: 'Compass',
    points: 15,
    requirement: { type: 'games_with_format', count: 1, format: 'modern' },
  },

  // Collection
  {
    id: 'collection_10',
    name: 'Collector',
    description: 'Add 10 cards to your collection',
    rarity: 'common',
    category: 'collection',
    icon: 'Boxes',
    points: 25,
    requirement: { type: 'cards_collected', count: 10 },
  },
  {
    id: 'collection_100',
    name: 'Curator',
    description: 'Add 100 cards to your collection',
    rarity: 'uncommon',
    category: 'collection',
    icon: 'Library',
    points: 75,
    requirement: { type: 'cards_collected', count: 100 },
  },
  {
    id: 'collection_500',
    name: 'Archivist',
    description: 'Add 500 cards to your collection',
    rarity: 'rare',
    category: 'collection',
    icon: 'Archive',
    points: 150,
    requirement: { type: 'cards_collected', count: 500 },
  },

  // Special
  {
    id: 'comeback_win',
    name: 'Never Give Up',
    description: 'Win a game with less than 5 life',
    rarity: 'uncommon',
    category: 'special',
    icon: 'Heart',
    points: 50,
    requirement: { type: 'special', count: 1 },
  },
  {
    id: 'quick_win',
    name: 'Speed Demon',
    description: 'Win a game in 5 turns or fewer',
    rarity: 'rare',
    category: 'special',
    icon: 'Timer',
    points: 75,
    requirement: { type: 'special', count: 1 },
  },
  {
    id: 'mirror_win',
    name: 'Mirror Match',
    description: 'Win a mirror match (same commander/deck)',
    rarity: 'rare',
    category: 'special',
    icon: 'GitCompare',
    points: 75,
    requirement: { type: 'special', count: 1 },
  },
];

/**
 * Rarity colors
 */
export const RARITY_COLORS: Record<AchievementRarity, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
};

/**
 * Rarity points
 */
export const RARITY_POINTS: Record<AchievementRarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

/**
 * Achievement manager class
 */
class AchievementManager {
  private storageKey = 'planar_nexus_achievements';
  private listeners: Set<(notification: AchievementNotification) => void> = new Set();

  /**
   * Get player achievements
   */
  getPlayerAchievements(playerId: string): PlayerAchievements {
    if (typeof window === 'undefined') {
      return this.createEmptyAchievements(playerId);
    }

    const stored = localStorage.getItem(`${this.storageKey}_${playerId}`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return this.createEmptyAchievements(playerId);
      }
    }

    return this.createEmptyAchievements(playerId);
  }

  /**
   * Create empty achievements
   */
  private createEmptyAchievements(playerId: string): PlayerAchievements {
    return {
      playerId,
      achievements: ACHIEVEMENTS.map(a => ({
        achievementId: a.id,
        currentProgress: 0,
        unlocked: false,
      })),
      totalPoints: 0,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Save player achievements
   */
  private saveAchievements(achievements: PlayerAchievements): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      `${this.storageKey}_${achievements.playerId}`,
      JSON.stringify(achievements)
    );
  }

  /**
   * Get achievement by ID
   */
  getAchievement(id: string): Achievement | undefined {
    return ACHIEVEMENTS.find(a => a.id === id);
  }

  /**
   * Get all achievements
   */
  getAllAchievements(): Achievement[] {
    return ACHIEVEMENTS;
  }

  /**
   * Get achievements by category
   */
  getAchievementsByCategory(category: AchievementCategory): Achievement[] {
    return ACHIEVEMENTS.filter(a => a.category === category);
  }

  /**
   * Get achievement progress
   */
  getAchievementProgress(playerId: string, achievementId: string): AchievementProgress | null {
    const playerData = this.getPlayerAchievements(playerId);
    return playerData.achievements.find(a => a.achievementId === achievementId) || null;
  }

  /**
   * Check and update achievements after a game
   */
  checkGameAchievements(
    playerId: string,
    gameState: GameState,
    won: boolean
  ): AchievementNotification[] {
    const notifications: AchievementNotification[] = [];
    const playerData = this.getPlayerAchievements(playerId);
    const player = gameState.players.get(playerId);

    if (!player) return notifications;

    // Calculate games played
    const gamesPlayed = this.getStat(playerId, 'games_played') + 1;
    this.setStat(playerId, 'games_played', gamesPlayed);

    // Calculate wins
    let wins = this.getStat(playerId, 'wins');
    if (won) {
      wins++;
      this.setStat(playerId, 'wins', wins);
    }

    // Calculate format-specific games
    const format = gameState.format || 'unknown';
    const formatGames = this.getStat(playerId, `format_${format}`) + 1;
    this.setStat(playerId, `format_${format}`, formatGames);

    // Check each achievement
    for (const achievement of ACHIEVEMENTS) {
      const progress = playerData.achievements.find(
        a => a.achievementId === achievement.id
      );

      if (!progress || progress.unlocked) continue;

      let shouldUnlock = false;
      let newProgress = 0;

      switch (achievement.requirement.type) {
        case 'games_played':
          newProgress = gamesPlayed;
          shouldUnlock = gamesPlayed >= achievement.requirement.count;
          break;
        case 'wins':
          newProgress = wins;
          shouldUnlock = wins >= achievement.requirement.count;
          break;
        case 'games_with_format':
          if (achievement.requirement.format === format) {
            newProgress = formatGames;
            shouldUnlock = formatGames >= achievement.requirement.count;
          }
          break;
        case 'special':
          // Special achievements need manual checking
          if (achievement.id === 'comeback_win' && won && player.life < 5) {
            shouldUnlock = true;
            newProgress = 1;
          }
          if (achievement.id === 'quick_win' && won && gameState.turn.turnNumber <= 5) {
            shouldUnlock = true;
            newProgress = 1;
          }
          break;
      }

      // Update progress
      if (newProgress > progress.currentProgress) {
        progress.currentProgress = newProgress;
      }

      // Check for unlock
      if (shouldUnlock && !progress.unlocked) {
        progress.unlocked = true;
        progress.unlockedAt = Date.now();
        playerData.totalPoints += achievement.points;
        notifications.push({
          achievement,
          timestamp: Date.now(),
        });
      }
    }

    playerData.lastUpdated = Date.now();
    this.saveAchievements(playerData);

    // Notify listeners
    notifications.forEach(notification => {
      this.listeners.forEach(listener => listener(notification));
    });

    return notifications;
  }

  /**
   * Update collection achievements
   */
  checkCollectionAchievements(playerId: string, collectionSize: number): AchievementNotification[] {
    const notifications: AchievementNotification[] = [];
    const playerData = this.getPlayerAchievements(playerId);

    for (const achievement of ACHIEVEMENTS) {
      if (achievement.requirement.type !== 'cards_collected') continue;

      const progress = playerData.achievements.find(
        a => a.achievementId === achievement.id
      );

      if (!progress || progress.unlocked) continue;

      progress.currentProgress = collectionSize;

      if (collectionSize >= achievement.requirement.count) {
        progress.unlocked = true;
        progress.unlockedAt = Date.now();
        playerData.totalPoints += achievement.points;
        notifications.push({
          achievement,
          timestamp: Date.now(),
        });
      }
    }

    playerData.lastUpdated = Date.now();
    this.saveAchievements(playerData);

    notifications.forEach(notification => {
      this.listeners.forEach(listener => listener(notification));
    });

    return notifications;
  }

  /**
   * Get achievement stats
   */
  private getStat(playerId: string, stat: string): number {
    if (typeof window === 'undefined') return 0;
    const stats = JSON.parse(localStorage.getItem(`planar_nexus_stats_${playerId}`) || '{}');
    return stats[stat] || 0;
  }

  /**
   * Set achievement stats
   */
  private setStat(playerId: string, stat: string, value: number): void {
    if (typeof window === 'undefined') return;
    const stats = JSON.parse(localStorage.getItem(`planar_nexus_stats_${playerId}`) || '{}');
    stats[stat] = value;
    localStorage.setItem(`planar_nexus_stats_${playerId}`, JSON.stringify(stats));
  }

  /**
   * Get unlocked achievements
   */
  getUnlockedAchievements(playerId: string): Achievement[] {
    const playerData = this.getPlayerAchievements(playerId);
    return playerData.achievements
      .filter(p => p.unlocked)
      .map(p => this.getAchievement(p.achievementId))
      .filter((a): a is Achievement => a !== undefined);
  }

  /**
   * Get achievement progress for display
   */
  getAchievementDisplayProgress(playerId: string): Array<{
    achievement: Achievement;
    progress: AchievementProgress;
  }> {
    const playerData = this.getPlayerAchievements(playerId);
    return ACHIEVEMENTS.map(achievement => {
      const progress = playerData.achievements.find(
        a => a.achievementId === achievement.id
      ) || {
        achievementId: achievement.id,
        currentProgress: 0,
        unlocked: false,
      };
      return { achievement, progress };
    });
  }

  /**
   * Subscribe to achievement notifications
   */
  subscribe(listener: (notification: AchievementNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Reset achievements (for testing)
   */
  resetAchievements(playerId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${this.storageKey}_${playerId}`);
    localStorage.removeItem(`planar_nexus_stats_${playerId}`);
  }
}

// Singleton instance
export const achievementManager = new AchievementManager();

/**
 * Helper to format rarity
 */
export function formatRarity(rarity: AchievementRarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

/**
 * Helper to get rarity color
 */
export function getRarityColor(rarity: AchievementRarity): string {
  return RARITY_COLORS[rarity];
}

/**
 * Calculate total possible points
 */
export function getTotalPossiblePoints(): number {
  return ACHIEVEMENTS.reduce((sum, a) => sum + a.points, 0);
}
