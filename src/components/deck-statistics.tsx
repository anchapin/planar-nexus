'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  PieChart,
  Activity,
  Download,
  Upload,
  Trash2,
  Calendar,
  Target,
  Flame,
  Droplets,
  Zap,
  Skull,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Deck statistics types
export interface DeckRecord {
  id: string;
  deckId: string;
  deckName: string;
  format: string;
  result: 'win' | 'loss' | 'draw';
  opponentName?: string;
  date: number;
  duration?: number; // in seconds
}

export interface DeckStatistics {
  deckId: string;
  deckName: string;
  format: string;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  averageGameDuration: number;
  records: DeckRecord[];
  lastPlayed?: number;
  colorDistribution: Record<string, number>;
  manaCurve: Record<number, number>;
}

// Color types for card analysis
export type CardColor = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

export interface CardAnalysis {
  totalCards: number;
  colorDistribution: Record<string, number>;
  manaCurve: Record<number, number>;
  typeDistribution: Record<string, number>;
  averageManaValue: number;
}

// Calculate win rate percentage
function calculateWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((wins / total) * 100);
}

// Calculate average
function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Deck statistics display component
interface DeckStatisticsCardProps {
  stats: DeckStatistics;
  className?: string;
}

export function DeckStatisticsCard({ stats, className }: DeckStatisticsCardProps) {
  const winRateTrend = useMemo(() => {
    // Calculate recent 5 games win rate vs overall
    const recentGames = stats.records.slice(-5);
    const recentWins = recentGames.filter(r => r.result === 'win').length;
    const recentWinRate = calculateWinRate(recentWins, recentGames.length);
    return recentWinRate - stats.winRate;
  }, [stats]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{stats.deckName}</span>
          <Badge variant="outline">{stats.format}</Badge>
        </CardTitle>
        <CardDescription>
          Last played: {stats.lastPlayed ? new Date(stats.lastPlayed).toLocaleDateString() : 'Never'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Win rate display */}
        <div className="flex items-center justify-center">
          <div className="text-center">
            <div className={cn(
              'text-4xl font-bold',
              stats.winRate >= 60 ? 'text-green-500' : 
              stats.winRate >= 40 ? 'text-yellow-500' : 'text-red-500'
            )}>
              {stats.winRate}%
            </div>
            <div className="text-sm text-muted-foreground">
              Win Rate ({stats.totalGames} games)
            </div>
            {winRateTrend !== 0 && (
              <div className={cn(
                'flex items-center justify-center gap-1 text-sm mt-1',
                winRateTrend > 0 ? 'text-green-500' : 'text-red-500'
              )}>
                {winRateTrend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {Math.abs(winRateTrend)}% recent trend
              </div>
            )}
          </div>
        </div>

        {/* W/L/D breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded bg-green-500/10">
            <div className="text-xl font-bold text-green-500">{stats.wins}</div>
            <div className="text-xs text-muted-foreground">Wins</div>
          </div>
          <div className="p-2 rounded bg-red-500/10">
            <div className="text-xl font-bold text-red-500">{stats.losses}</div>
            <div className="text-xs text-muted-foreground">Losses</div>
          </div>
          <div className="p-2 rounded bg-yellow-500/10">
            <div className="text-xl font-bold text-yellow-500">{stats.draws}</div>
            <div className="text-xs text-muted-foreground">Draws</div>
          </div>
        </div>

        {/* Average game duration */}
        {stats.averageGameDuration > 0 && (
          <div className="text-center text-sm text-muted-foreground">
            Average game: {Math.floor(stats.averageGameDuration / 60)}m {Math.round(stats.averageGameDuration % 60)}s
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Mana curve visualization
interface ManaCurveChartProps {
  manaCurve: Record<number, number>;
  className?: string;
}

export function ManaCurveChart({ manaCurve, className }: ManaCurveChartProps) {
  const maxCount = useMemo(() => {
    return Math.max(...Object.values(manaCurve), 1);
  }, [manaCurve]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Mana Curve
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-1 h-40">
          {Array.from({ length: 8 }, (_, i) => {
            const count = manaCurve[i] || 0;
            const height = (count / maxCount) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div 
                  className="w-full bg-primary rounded-t transition-all"
                  style={{ height: `${height}%` }}
                />
                <span className="text-xs mt-1">{i}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Color distribution pie chart
interface ColorDistributionChartProps {
  distribution: Record<string, number>;
  className?: string;
}

export function ColorDistributionChart({ distribution, className }: ColorDistributionChartProps) {
  const colorConfig: Record<string, { color: string; icon: React.ReactNode }> = {
    white: { color: 'bg-yellow-100 border-yellow-400', icon: <Shield className="w-4 h-4 text-yellow-600" /> },
    blue: { color: 'bg-blue-100 border-blue-400', icon: <Droplets className="w-4 h-4 text-blue-600" /> },
    black: { color: 'bg-gray-200 border-gray-500', icon: <Skull className="w-4 h-4 text-gray-700" /> },
    red: { color: 'bg-red-100 border-red-400', icon: <Flame className="w-4 h-4 text-red-600" /> },
    green: { color: 'bg-green-100 border-green-400', icon: <Activity className="w-4 h-4 text-green-600" /> },
    colorless: { color: 'bg-slate-100 border-slate-400', icon: <Minus className="w-4 h-4 text-slate-600" /> },
  };

  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="w-5 h-5" />
          Color Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(distribution).map(([color, count]) => {
          const config = colorConfig[color] || colorConfig.colorless;
          const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
          
          return (
            <div key={color} className="flex items-center gap-2">
              <div className={cn('w-8 h-8 rounded flex items-center justify-center', config.color)}>
                {config.icon}
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{color}</span>
                  <span className="text-muted-foreground">{count} ({percentage}%)</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn('h-full transition-all', config.color.split(' ')[0])}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Match history table
interface MatchHistoryTableProps {
  records: DeckRecord[];
  className?: string;
}

export function MatchHistoryTable({ records, className }: MatchHistoryTableProps) {
  const sortedRecords = [...records].sort((a, b) => b.date - a.date);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedRecords.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matches recorded yet.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sortedRecords.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <div className="flex items-center gap-2">
                  <Badge className={cn(
                    record.result === 'win' ? 'bg-green-500' : 
                    record.result === 'loss' ? 'bg-red-500' : 'bg-yellow-500'
                  )}>
                    {record.result.toUpperCase()}
                  </Badge>
                  <span className="text-sm">{record.opponentName || 'Unknown opponent'}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(record.date).toLocaleDateString()}
                  {record.duration && ` • ${Math.floor(record.duration / 60)}m`}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Analytics dashboard
interface DeckAnalyticsProps {
  statistics: DeckStatistics[];
  className?: string;
}

export function DeckAnalytics({ statistics, className }: DeckAnalyticsProps) {
  // Calculate overall stats
  const overallStats = useMemo(() => {
    const totalGames = statistics.reduce((sum, s) => sum + s.totalGames, 0);
    const totalWins = statistics.reduce((sum, s) => sum + s.wins, 0);
    const totalLosses = statistics.reduce((sum, s) => sum + s.losses, 0);
    const totalDraws = statistics.reduce((sum, s) => sum + s.draws, 0);
    
    return {
      totalGames,
      totalWins,
      totalLosses,
      totalDraws,
      overallWinRate: calculateWinRate(totalWins, totalGames)
    };
  }, [statistics]);

  // Get best/worst decks
  const { bestDeck, worstDeck } = useMemo(() => {
    if (statistics.length === 0) return { bestDeck: null, worstDeck: null };
    
    const sorted = [...statistics].sort((a, b) => b.winRate - a.winRate);
    return {
      bestDeck: sorted[0],
      worstDeck: sorted[sorted.length - 1]
    };
  }, [statistics]);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold">{overallStats.totalGames}</div>
              <div className="text-sm text-muted-foreground">Total Games</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-500">{overallStats.totalWins}</div>
              <div className="text-sm text-muted-foreground">Wins</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-red-500">{overallStats.totalLosses}</div>
              <div className="text-sm text-muted-foreground">Losses</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className={cn(
                'text-3xl font-bold',
                overallStats.overallWinRate >= 60 ? 'text-green-500' : 
                overallStats.overallWinRate >= 40 ? 'text-yellow-500' : 'text-red-500'
              )}>
                {overallStats.overallWinRate}%
              </div>
              <div className="text-sm text-muted-foreground">Win Rate</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best/Worst decks */}
      {bestDeck && worstDeck && bestDeck.deckId !== worstDeck.deckId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-green-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-500">
                <TrendingUp className="w-5 h-5" />
                Best Deck
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeckStatisticsCard stats={bestDeck} />
            </CardContent>
          </Card>
          <Card className="border-red-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-500">
                <TrendingDown className="w-5 h-5" />
                Needs Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeckStatisticsCard stats={worstDeck} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Individual deck stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statistics.map((stats) => (
          <DeckStatisticsCard key={stats.deckId} stats={stats} />
        ))}
      </div>
    </div>
  );
}

// Hook for managing deck statistics
interface UseDeckStatisticsOptions {
  storageKey?: string;
}

interface UseDeckStatisticsReturn {
  statistics: DeckStatistics[];
  recordGame: (deckId: string, deckName: string, format: string, result: 'win' | 'loss' | 'draw', opponentName?: string, duration?: number) => void;
  getDeckStats: (deckId: string) => DeckStatistics | undefined;
  clearDeckStats: (deckId: string) => void;
  clearAllStats: () => void;
  exportStats: () => string;
  importStats: (json: string) => boolean;
}

export function useDeckStatistics({ storageKey = 'deck-statistics' }: UseDeckStatisticsOptions = {}): UseDeckStatisticsReturn {
  const [statistics, setStatistics] = useState<DeckStatistics[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setStatistics(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse deck statistics:', e);
      }
    }
  }, [storageKey]);

  // Save to localStorage when changed
  const saveStats = useCallback((newStats: DeckStatistics[]) => {
    setStatistics(newStats);
    localStorage.setItem(storageKey, JSON.stringify(newStats));
  }, [storageKey]);

  const recordGame = useCallback((
    deckId: string, 
    deckName: string, 
    format: string, 
    result: 'win' | 'loss' | 'draw',
    opponentName?: string,
    duration?: number
  ) => {
    const newRecord: DeckRecord = {
      id: `record-${Date.now()}`,
      deckId,
      deckName,
      format,
      result,
      opponentName,
      date: Date.now(),
      duration
    };

    setStatistics((prev) => {
      // Find or create deck stats
      let deckStats = prev.find(s => s.deckId === deckId);
      
      if (!deckStats) {
        deckStats = {
          deckId,
          deckName,
          format,
          totalGames: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          winRate: 0,
          averageGameDuration: 0,
          records: [],
          colorDistribution: {},
          manaCurve: {}
        };
      }

      // Update stats
      const newWins = result === 'win' ? deckStats.wins + 1 : deckStats.wins;
      const newLosses = result === 'loss' ? deckStats.losses + 1 : deckStats.losses;
      const newDraws = result === 'draw' ? deckStats.draws + 1 : deckStats.draws;
      const newTotal = deckStats.totalGames + 1;
      
      // Calculate new average duration
      let newAvgDuration = deckStats.averageGameDuration;
      if (duration) {
        const totalDuration = (deckStats.averageGameDuration * deckStats.totalGames) + duration;
        newAvgDuration = totalDuration / newTotal;
      }

      const updatedDeckStats: DeckStatistics = {
        ...deckStats,
        totalGames: newTotal,
        wins: newWins,
        losses: newLosses,
        draws: newDraws,
        winRate: calculateWinRate(newWins, newTotal),
        averageGameDuration: newAvgDuration,
        records: [...deckStats.records, newRecord],
        lastPlayed: Date.now()
      };

      // Replace or add deck stats
      const existingIndex = prev.findIndex(s => s.deckId === deckId);
      if (existingIndex >= 0) {
        const newStats = [...prev];
        newStats[existingIndex] = updatedDeckStats;
        return newStats;
      } else {
        return [...prev, updatedDeckStats];
      }
    });
  }, []);

  const getDeckStats = useCallback((deckId: string) => {
    return statistics.find(s => s.deckId === deckId);
  }, [statistics]);

  const clearDeckStats = useCallback((deckId: string) => {
    setStatistics((prev) => prev.filter(s => s.deckId !== deckId));
  }, []);

  const clearAllStats = useCallback(() => {
    setStatistics([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const exportStats = useCallback(() => {
    return JSON.stringify(statistics, null, 2);
  }, [statistics]);

  const importStats = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        setStatistics(parsed);
        localStorage.setItem(storageKey, JSON.stringify(parsed));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [storageKey]);

  return {
    statistics,
    recordGame,
    getDeckStats,
    clearDeckStats,
    clearAllStats,
    exportStats,
    importStats
  };
}

// Import/Export controls component
interface ImportExportControlsProps {
  onImport: (json: string) => void;
  onExport: () => void;
  onClear: () => void;
  className?: string;
}

export function ImportExportControls({ onImport, onExport, onClear, className }: ImportExportControlsProps) {
  const [importText, setImportText] = useState('');

  const handleImport = () => {
    if (importText.trim()) {
      onImport(importText);
      setImportText('');
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          Import / Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Button onClick={onExport} className="w-full">
            <Upload className="w-4 h-4 mr-2" />
            Export Statistics
          </Button>
        </div>
        
        <div className="space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste exported JSON here..."
            className="w-full h-24 px-3 py-2 border rounded-md text-xs resize-none"
          />
          <Button 
            onClick={handleImport} 
            variant="outline" 
            disabled={!importText.trim()}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Import Statistics
          </Button>
        </div>

        <div className="border-t pt-4">
          <Button 
            onClick={onClear} 
            variant="destructive" 
            className="w-full"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All Statistics
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
