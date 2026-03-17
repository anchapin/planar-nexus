'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  getAllGameRecords,
  type GameRecord 
} from '@/lib/game-history';
import { 
  getCoachReport, 
  getPerformanceOverTime,
  type CoachReport 
} from '@/lib/coach-report-service';
import { 
  getAdaptiveDifficulty,
  getDifficultyInfo,
  type DifficultyAnalysis 
} from '@/lib/adaptive-difficulty';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus,
  BarChart3,
  Target,
  AlertTriangle,
  Trophy,
  Activity,
  RefreshCw
} from 'lucide-react';

export default function CoachReportPage() {
  const [report, setReport] = useState<CoachReport | null>(null);
  const [difficultyAnalysis, setDifficultyAnalysis] = useState<DifficultyAnalysis | null>(null);
  const [performance, setPerformance] = useState<Array<{ index: number; winRate: number; games: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadReport();
  }, []);

  function loadReport() {
    setIsLoading(true);
    
    // Load game records from localStorage (game-history uses localStorage)
    const records = getAllGameRecords();
    
    // Get coach report
    const coachReport = getCoachReport(records);
    setReport(coachReport);
    
    // Get performance over time
    const perf = getPerformanceOverTime(records, 5);
    setPerformance(perf);
    
    // Get adaptive difficulty recommendation
    const diffAnalysis = getAdaptiveDifficulty(records);
    setDifficultyAnalysis(diffAnalysis);
    
    setIsLoading(false);
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getTrendIcon(trend: number) {
    if (trend > 0) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend < 0) return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-500" />;
  }

  function getDifficultyColor(recommendation: string) {
    switch (recommendation) {
      case 'increase': return 'bg-green-500';
      case 'decrease': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!report || report.totalGames === 0) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
        <div className="mb-6">
          <h1 className="font-headline text-3xl font-bold">Coach Report</h1>
          <p className="text-muted-foreground mt-2">
            Your personal performance dashboard - play some games to see your stats!
          </p>
        </div>

        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center py-12">
            <BarChart3 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Games Yet</h2>
            <p className="text-muted-foreground max-w-md">
              Play some games in Single Player mode to start tracking your performance 
              and receive personalized coaching recommendations.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-3xl font-bold">Coach Report</h1>
          <p className="text-muted-foreground mt-2">
            Your personal performance dashboard with AI-powered insights.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadReport}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="mistakes">Mistakes</TabsTrigger>
          <TabsTrigger value="decks">Deck Stats</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Games</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{report.totalGames}</div>
                <p className="text-xs text-muted-foreground">games played</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{report.overallWinRate}%</div>
                <p className="text-xs text-muted-foreground">
                  {report.wins}W - {report.losses}L - {report.draws}D
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent Form</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{report.patterns.recentPerformance}%</div>
                <p className="text-xs text-muted-foreground">last 10 games</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {getTrendIcon(report.patterns.trend)}
                  <span className="text-2xl font-bold">
                    {report.patterns.trend > 0 ? '+' : ''}{report.patterns.trend}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">vs. previous games</p>
              </CardContent>
            </Card>
          </div>

          {/* Difficulty Suggestion */}
          {difficultyAnalysis && difficultyAnalysis.gamesAnalyzed >= 5 && (
            <Card className={`
              ${difficultyAnalysis.recommendation === 'increase' ? 'border-green-500 bg-green-50 dark:bg-green-950' : ''}
              ${difficultyAnalysis.recommendation === 'decrease' ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''}
              ${difficultyAnalysis.recommendation === 'maintain' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950' : ''}
            `}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  AI Difficulty Suggestion
                </CardTitle>
                <CardDescription>
                  Based on your recent performance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge className={getDifficultyColor(difficultyAnalysis.recommendation)}>
                        {difficultyAnalysis.recommendation.toUpperCase()}
                      </Badge>
                      {difficultyAnalysis.suggestedDifficulty && (
                        <span className="text-lg font-semibold">
                          → {getDifficultyInfo(difficultyAnalysis.suggestedDifficulty).label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {difficultyAnalysis.reason}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Analyzed {difficultyAnalysis.gamesAnalyzed} games at {difficultyAnalysis.currentDifficulty} difficulty
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Performance Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Over Time</CardTitle>
              <CardDescription>Win rate trends across your games</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {performance.map((p, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground w-16">
                      Games {p.index + 1}-{p.index + p.games}
                    </span>
                    <Progress value={p.winRate} className="flex-1" />
                    <span className="text-sm font-medium w-12 text-right">{p.winRate}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Avg Turns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.patterns.avgTurns}</div>
                <p className="text-xs text-muted-foreground">per game</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Avg Life</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.patterns.avgLife}</div>
                <p className="text-xs text-muted-foreground">at game end</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Avg Mulligans</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{report.patterns.avgMulligans}</div>
                <p className="text-xs text-muted-foreground">per game</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Mistakes Tab */}
        <TabsContent value="mistakes" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Top Mistakes
              </CardTitle>
              <CardDescription>
                Areas to focus on for improvement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.commonMistakes.length === 0 ? (
                <div className="text-center py-8">
                  <Trophy className="h-12 w-12 mx-auto text-green-500 mb-2" />
                  <p className="text-lg font-semibold">No mistakes recorded!</p>
                  <p className="text-muted-foreground">Keep playing to get coaching tips.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {report.commonMistakes.map((mistake, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{i + 1}</Badge>
                        <span>{mistake.mistake}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={mistake.frequency} className="w-24" />
                        <span className="text-sm text-muted-foreground w-12 text-right">
                          {mistake.frequency}%
                        </span>
                        <span className="text-xs text-muted-foreground w-8">
                          ({mistake.count})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Deck Stats Tab */}
        <TabsContent value="decks" className="space-y-6">
          {/* By Difficulty */}
          <Card>
            <CardHeader>
              <CardTitle>Win Rate by Difficulty</CardTitle>
              <CardDescription>Performance at each AI difficulty level</CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(report.winRateByDifficulty).length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No AI games played yet</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(report.winRateByDifficulty).map(([difficulty, winRate]) => {
                    const info = getDifficultyInfo(difficulty as any);
                    return (
                      <div 
                        key={difficulty} 
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div>
                          <span className={`font-medium ${info.color}`}>{info.label}</span>
                          <p className="text-xs text-muted-foreground">{info.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={winRate} className="w-32" />
                          <span className="text-lg font-bold w-12 text-right">{winRate}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* By Deck */}
          <Card>
            <CardHeader>
              <CardTitle>Win Rate by Deck</CardTitle>
              <CardDescription>Performance with each deck archetype</CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(report.winRateByDeck).length === 0 ? (
                <p className="text-muted-foreground text-center py-4">No deck data available</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(report.winRateByDeck).map(([deck, winRate]) => (
                    <div 
                      key={deck} 
                      className="flex items-center justify-between p-3 rounded-lg border"
                    >
                      <span className="font-medium">{deck}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={winRate} className="w-32" />
                        <span className="text-lg font-bold w-12 text-right">{winRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
