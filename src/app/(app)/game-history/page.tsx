'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trophy, Swords, History, TrendingUp, Activity, Trash2 } from 'lucide-react';
import { 
  getAllGameRecords, 
  getPlayerStats, 
  getRecentGames,
  clearGameHistory,
  type GameRecord,
  type PlayerStats 
} from '@/lib/game-history';

export default function GameHistoryPage() {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [recentGames, setRecentGames] = useState<GameRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  function loadStats() {
    setStats(getPlayerStats());
    setRecentGames(getRecentGames(20));
    setIsLoading(false);
  }

  function handleClearHistory() {
    if (confirm('Are you sure you want to clear all game history? This cannot be undone.')) {
      clearGameHistory();
      loadStats();
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getResultColor(result: string): string {
    switch (result) {
      case 'win': return 'bg-green-500';
      case 'loss': return 'bg-red-500';
      case 'draw': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  }

  function getResultIcon(result: string): string {
    switch (result) {
      case 'win': return '✓';
      case 'loss': return '✗';
      case 'draw': return '○';
      default: return '?';
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Game History</h1>
        <p className="text-muted-foreground">
          Track your single-player performance
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Games</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalGames ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              All time games played
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.winRate ?? 0}%</div>
            <p className="text-xs text-muted-foreground">
              {stats?.wins ?? 0}W - {stats?.losses ?? 0}L - {stats?.draws ?? 0}D
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vs AI Win Rate</CardTitle>
            <Swords className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.vsAiStats.winRate ?? 0}%</div>
            <p className="text-xs text-muted-foreground">
              {stats?.vsAiStats.wins ?? 0}W - {stats?.vsAiStats.losses ?? 0}L
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Turns</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.avgTurnsPerGame ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              Per game average
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="recent" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recent">Recent Games</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  Recent Games
                </span>
                {stats && stats.totalGames > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearHistory}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear History
                  </Button>
                )}
              </CardTitle>
              <CardDescription>
                Your last {recentGames.length} games
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentGames.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No games played yet</p>
                  <p className="text-sm">Start a single-player game to track your results!</p>
                </div>
              ) : (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {recentGames.map((game) => (
                      <div
                        key={game.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full ${getResultColor(game.result)} flex items-center justify-center text-white font-bold`}
                            title={game.result}
                          >
                            {getResultIcon(game.result)}
                          </div>
                          <div>
                            <div className="font-medium">
                              {game.mode === 'vs_ai' ? 'vs AI' : game.mode === 'self_play' ? 'Self Play' : 'Goldfish'}
                              {game.difficulty && ` (${game.difficulty})`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {game.playerDeck}
                              {game.opponentDeck && ` vs ${game.opponentDeck}`}
                              {' • '}
                              {formatDate(game.date)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {game.result === 'win' ? 'Victory' : game.result === 'loss' ? 'Defeat' : 'Draw'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {game.turns} turns • {game.playerLifeAtEnd} life
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By Mode</CardTitle>
                <CardDescription>Performance breakdown</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Vs AI</span>
                    <Badge variant={stats?.vsAiStats.winRate && stats.vsAiStats.winRate >= 50 ? 'default' : 'secondary'}>
                      {stats?.vsAiStats.winRate ?? 0}% WR
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats?.vsAiStats.wins}W - {stats?.vsAiStats.losses}L - {stats?.vsAiStats.draws}D
                    {' '}({stats?.vsAiStats.games} games)
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Self Play</span>
                    <Badge variant={stats?.selfPlayStats.winRate && stats.selfPlayStats.winRate >= 50 ? 'default' : 'secondary'}>
                      {stats?.selfPlayStats.winRate ?? 0}% WR
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats?.selfPlayStats.wins}W - {stats?.selfPlayStats.losses}L - {stats?.selfPlayStats.draws}D
                    {' '}({stats?.selfPlayStats.games} games)
                  </div>
                </div>
              </CardContent>
            </Card>

            {stats && Object.keys(stats.difficultyStats).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>By Difficulty</CardTitle>
                  <CardDescription>AI difficulty performance</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(stats.difficultyStats).map(([difficulty, diffStats]) => (
                    <div key={difficulty}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium capitalize">{difficulty}</span>
                        <Badge variant={diffStats.winRate >= 50 ? 'default' : 'secondary'}>
                          {diffStats.winRate}% WR
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {diffStats.wins}W - {diffStats.losses}L - {diffStats.draws}D
                        {' '}({diffStats.games} games)
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {stats && stats.recentForm.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Form</CardTitle>
                <CardDescription>Last 10 games</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  {stats.recentForm.map((result, index) => (
                    <div
                      key={index}
                      className={`w-8 h-8 rounded-full ${getResultColor(result)} flex items-center justify-center text-white font-bold text-sm`}
                      title={`Game ${index + 1}: ${result}`}
                    >
                      {getResultIcon(result)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
