'use client';

import { useState, useEffect } from 'react';
import { 
  Trophy, 
  Star, 
  Lock, 
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
  GitCompare,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  achievementManager, 
  type Achievement, 
  type AchievementCategory,
  ACHIEVEMENTS,
  RARITY_COLORS,
  getTotalPossiblePoints 
} from '@/lib/achievements';

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
 * Achievement card component
 */
function AchievementCard({ 
  achievement, 
  progress,
}: { 
  achievement: Achievement; 
  progress?: { currentProgress: number; unlocked: boolean; unlockedAt?: number };
}) {
  const Icon = getIconComponent(achievement.icon);
  const isUnlocked = progress?.unlocked || false;
  const currentProgress = progress?.currentProgress || 0;
  const targetProgress = achievement.requirement.count;
  const progressPercent = Math.min((currentProgress / targetProgress) * 100, 100);

  return (
    <Card className={`relative overflow-hidden ${
      isUnlocked 
        ? 'border-2' 
        : 'opacity-75'
    }`}
    style={{ 
      borderColor: isUnlocked ? RARITY_COLORS[achievement.rarity] : undefined 
    }}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className={`p-2 rounded-lg ${
            isUnlocked 
              ? '' 
              : 'bg-slate-700'
          }`}
          style={{ 
            backgroundColor: isUnlocked ? RARITY_COLORS[achievement.rarity] + '20' : undefined 
          }}>
            {isUnlocked ? (
              <Icon className="w-6 h-6" style={{ color: RARITY_COLORS[achievement.rarity] }} />
            ) : (
              <Lock className="w-6 h-6 text-slate-500" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant="outline"
              style={{ 
                color: RARITY_COLORS[achievement.rarity],
                borderColor: RARITY_COLORS[achievement.rarity]
              }}
            >
              {achievement.rarity}
            </Badge>
            <Badge variant="secondary">
              {achievement.points} pts
            </Badge>
          </div>
        </div>
        <CardTitle className="text-lg mt-2">
          {achievement.name}
        </CardTitle>
        <CardDescription className="text-sm">
          {achievement.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isUnlocked && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-slate-400">
              <span>Progress</span>
              <span>{currentProgress} / {targetProgress}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}
        {isUnlocked && progress?.unlockedAt && (
          <div className="text-sm text-slate-400">
            Unlocked {new Date(progress.unlockedAt).toLocaleDateString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Main Achievements Page
 */
export default function AchievementsPage() {
  const [playerId] = useState('local-player');
  const [achievements, setAchievements] = useState<Array<{
    achievement: Achievement;
    progress: { currentProgress: number; unlocked: boolean; unlockedAt?: number };
  }>>([]);
  const [category, _setCategory] = useState<AchievementCategory | 'all'>('all');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['games', 'wins']));

  useEffect(() => {
    const displayProgress = achievementManager.getAchievementDisplayProgress(playerId);
    setAchievements(displayProgress);
  }, [playerId]);

  const filteredAchievements = category === 'all' 
    ? achievements 
    : achievements.filter(a => a.achievement.category === category);

  const unlockedCount = achievements.filter(a => a.progress.unlocked).length;
  const totalPoints = achievements
    .filter(a => a.progress.unlocked)
    .reduce((sum, a) => sum + a.achievement.points, 0);
  const totalPossiblePoints = getTotalPossiblePoints();

  const toggleCategory = (cat: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(cat)) {
      newExpanded.delete(cat);
    } else {
      newExpanded.add(cat);
    }
    setExpandedCategories(newExpanded);
  };

  // Group achievements by category
  const groupedAchievements = filteredAchievements.reduce((acc, item) => {
    const cat = item.achievement.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, typeof achievements>);

  const categoryNames: Record<AchievementCategory, string> = {
    games: 'Games Played',
    wins: 'Victories',
    collection: 'Collection',
    social: 'Social',
    special: 'Special',
  };

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
              <Trophy className="w-8 h-8 text-yellow-500" />
              Achievements
            </h1>
            <p className="text-muted-foreground mt-1">
              Track your progress and unlock badges
            </p>
          </div>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Achievements Unlocked</CardDescription>
            <CardTitle className="text-3xl">
              {unlockedCount} / {ACHIEVEMENTS.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={(unlockedCount / ACHIEVEMENTS.length) * 100} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Points</CardDescription>
            <CardTitle className="text-3xl">
              {totalPoints} / {totalPossiblePoints}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={(totalPoints / totalPossiblePoints) * 100} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rarest Unlocked</CardDescription>
          <CardTitle className="text-3xl flex items-center gap-2">
            {achievements.some(a => a.progress.unlocked && a.achievement.rarity === 'legendary') && (
              <Gem className="w-8 h-8 text-yellow-500" />
            )}
            {achievements.filter(a => a.progress.unlocked && a.achievement.rarity === 'legendary').length > 0 
              ? 'Legendary' 
              : '-'}
          </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {achievements.filter(a => a.progress.unlocked && a.achievement.rarity === 'epic').length} Epic, {' '}
              {achievements.filter(a => a.progress.unlocked && a.achievement.rarity === 'rare').length} Rare
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Tabs */}
      <Tabs defaultValue="all" className="space-y-6">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="games">Games</TabsTrigger>
          <TabsTrigger value="wins">Wins</TabsTrigger>
          <TabsTrigger value="collection">Collection</TabsTrigger>
          <TabsTrigger value="special">Special</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          {Object.entries(groupedAchievements).map(([cat, items]) => (
            <div key={cat} className="space-y-3">
              <button
                onClick={() => toggleCategory(cat)}
                className="flex items-center gap-2 text-lg font-semibold w-full text-left"
              >
                {expandedCategories.has(cat) ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronUp className="w-5 h-5" />
                )}
                {categoryNames[cat as AchievementCategory] || cat}
                <Badge variant="secondary" className="ml-2">
                  {items.filter(i => i.progress.unlocked).length} / {items.length}
                </Badge>
              </button>
              
              {expandedCategories.has(cat) && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map(({ achievement, progress }) => (
                    <AchievementCard
                      key={achievement.id}
                      achievement={achievement}
                      progress={progress}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        {(['games', 'wins', 'collection', 'special'] as const).map(cat => (
          <TabsContent key={cat} value={cat} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(groupedAchievements[cat] || []).map(({ achievement, progress }) => (
                <AchievementCard
                  key={achievement.id}
                  achievement={achievement}
                  progress={progress}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
