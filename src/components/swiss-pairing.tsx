'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Trophy, 
  Users, 
  Crown, 
  ChevronRight, 
  Check, 
  X,
  RefreshCw,
  Shuffle,
  ArrowRight,
  BarChart3,
  History,
  Tie
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Swiss tournament types
export type SwissTournamentStatus = 'setup' | 'in-progress' | 'completed';
export type SwissMatchStatus = 'pending' | 'in-progress' | 'completed' | 'draw';

export interface SwissPlayer {
  id: string;
  name: string;
  seed?: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  opponentIds: string[]; // Track who they've played against
  matchHistory: { round: number; result: 'win' | 'loss' | 'draw'; opponentId: string }[];
}

export interface SwissMatch {
  id: string;
  round: number;
  table: number;
  player1?: SwissPlayer;
  player2?: SwissPlayer;
  player1Points?: number;
  player2Points?: number;
  winner?: SwissPlayer;
  status: SwissMatchStatus;
}

export interface SwissRound {
  roundNumber: number;
  matches: SwissMatch[];
}

export interface SwissTournament {
  id: string;
  name: string;
  status: SwissTournamentStatus;
  players: SwissPlayer[];
  rounds: SwissRound[];
  currentRound: number;
  totalRounds: number;
  createdAt: number;
  completedAt?: number;
}

// Tiebreaker system (MTG-style)
export interface Tiebreakers {
  opponentMatchWinPercentage: number;
  gameWinPercentage: number;
  opponentGameWinPercentage: number;
  final: number;
}

// Calculate tiebreakers for a player
function calculateTiebreakers(player: SwissPlayer, allPlayers: SwissPlayer[]): Tiebreakers {
  // 1. Opponent Match Win Percentage (OMWP)
  let opponentWins = 0;
  let opponentLosses = 0;
  let opponentDraws = 0;
  
  player.opponentIds.forEach(oppId => {
    const opponent = allPlayers.find(p => p.id === oppId);
    if (opponent) {
      opponentWins += opponent.wins;
      opponentLosses += opponent.losses;
      opponentDraws += opponent.draws;
    }
  });
  
  const opponentMatches = opponentWins + opponentLosses + opponentDraws;
  const opponentMatchWinPercentage = opponentMatches > 0 
    ? (opponentWins + opponentDraws * 0.5) / opponentMatches 
    : 0.5;
  
  // 2. Game Win Percentage (GWP) - simplified since we track match results
  const totalGames = player.wins + player.losses + player.draws;
  const gameWinPercentage = totalGames > 0 
    ? (player.wins + player.draws * 0.5) / totalGames 
    : 0.5;
  
  // 3. Opponent Game Win Percentage (OGWP)
  // Simplified: use opponent match win percentage as proxy
  const opponentGameWinPercentage = opponentMatchWinPercentage;
  
  // Final tiebreaker (simplified)
  const final = (opponentMatchWinPercentage * 0.4) + (gameWinPercentage * 0.3) + (opponentGameWinPercentage * 0.3);
  
  return {
    opponentMatchWinPercentage,
    gameWinPercentage,
    opponentGameWinPercentage,
    final
  };
}

// Swiss pairing algorithm
function generateSwissPairings(players: SwissPlayer[], round: number): SwissMatch[] {
  // Sort by points (descending), then by tiebreakers
  const sortedPlayers = [...players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const tiebreakersA = calculateTiebreakers(a, players);
    const tiebreakersB = calculateTiebreakers(b, players);
    return tiebreakersB.final - tiebreakersA.final;
  });

  const matches: SwissMatch[] = [];
  const usedPlayerIds = new Set<string>();
  let tableNumber = 1;

  // First round: pair by seed or randomly
  if (round === 1) {
    for (let i = 0; i < sortedPlayers.length - 1; i += 2) {
      const player1 = sortedPlayers[i];
      const player2 = sortedPlayers[i + 1];
      
      if (!usedPlayerIds.has(player1.id) && !usedPlayerIds.has(player2.id)) {
        matches.push({
          id: `match-r${round}-t${tableNumber}`,
          round,
          table: tableNumber,
          player1,
          player2,
          status: 'pending'
        });
        
        usedPlayerIds.add(player1.id);
        usedPlayerIds.add(player2.id);
        tableNumber++;
      }
    }
    
    // Handle bye if odd number of players
    if (usedPlayerIds.size < sortedPlayers.length) {
      const byePlayer = sortedPlayers.find(p => !usedPlayerIds.has(p.id));
      if (byePlayer) {
        // Award bye as a win
        byePlayer.points += 3;
        byePlayer.wins += 1;
        byePlayer.opponentIds.push('bye');
      }
    }
  } else {
    // Subsequent rounds: pair by points, avoiding rematches
    for (const player1 of sortedPlayers) {
      if (usedPlayerIds.has(player1.id)) continue;
      
      // Find best opponent: same or closest points, hasn't played yet
      let bestOpponent: SwissPlayer | null = null;
      let bestScore = -1;
      
      for (const player2 of sortedPlayers) {
        if (usedPlayerIds.has(player2.id)) continue;
        if (player1.id === player2.id) continue;
        if (player1.opponentIds.includes(player2.id)) continue;
        
        const pointDiff = Math.abs(player1.points - player2.points);
        const score = 100 - pointDiff * 10;
        
        if (score > bestScore) {
          bestScore = score;
          bestOpponent = player2;
        }
      }
      
      if (bestOpponent) {
        matches.push({
          id: `match-r${round}-t${tableNumber}`,
          round,
          table: tableNumber,
          player1,
          player2: bestOpponent,
          status: 'pending'
        });
        
        usedPlayerIds.add(player1.id);
        usedPlayerIds.add(bestOpponent.id);
        tableNumber++;
      }
    }
  }

  return matches;
}

// Calculate standings with tiebreakers
function calculateStandings(players: SwissPlayer[]): { player: SwissPlayer; tiebreakers: Tiebreakers }[] {
  return [...players]
    .map(player => ({
      player,
      tiebreakers: calculateTiebreakers(player, players)
    }))
    .sort((a, b) => {
      // Sort by points first
      if (b.player.points !== a.player.points) {
        return b.player.points - a.player.points;
      }
      // Then by tiebreakers
      return b.tiebreakers.final - a.tiebreakers.final;
    });
}

// Swiss pairing display component
interface SwissPairingDisplayProps {
  tournament: SwissTournament;
  onMatchComplete?: (matchId: string, result: 'player1-win' | 'player2-win' | 'draw') => void;
  className?: string;
}

export function SwissPairingDisplay({ tournament, onMatchComplete, className }: SwissPairingDisplayProps) {
  const currentRound = tournament.rounds[tournament.currentRound - 1];

  if (!currentRound) return null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Round header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Round {tournament.currentRound} of {tournament.totalRounds}
        </h3>
        <Badge variant="outline">
          {tournament.players.length} Players
        </Badge>
      </div>

      {/* Pairings grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {currentRound.matches.map((match) => (
          <SwissMatchCard
            key={match.id}
            match={match}
            onResultSelect={(result) => onMatchComplete?.(match.id, result)}
          />
        ))}
      </div>
    </div>
  );
}

// Single Swiss match card
interface SwissMatchCardProps {
  match: SwissMatch;
  onResultSelect?: (result: 'player1-win' | 'player2-win' | 'draw') => void;
}

function SwissMatchCard({ match, onResultSelect }: SwissMatchCardProps) {
  const isComplete = match.status === 'completed';
  
  return (
    <Card className={cn(
      'w-full',
      isComplete && match.winner && 'border-green-500/50',
      isComplete && match.status === 'draw' && 'border-yellow-500/50'
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Table number */}
        <div className="text-xs text-muted-foreground text-center">
          Table {match.table}
        </div>
        
        {/* Player 1 */}
        <div 
          className={cn(
            'flex items-center justify-between p-2 rounded',
            match.winner?.id === match.player1?.id && 'bg-green-500/20 border border-green-500/50',
            match.status === 'draw' && 'bg-yellow-500/10',
            !isComplete && 'bg-muted'
          )}
        >
          <div className="flex items-center gap-2">
            {match.player1?.seed && (
              <span className="text-xs text-muted-foreground w-4">#{match.player1.seed}</span>
            )}
            <span className={cn('font-medium', !match.player1 && 'text-muted-foreground')}>
              {match.player1?.name || 'TBD'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {match.player1?.points || 0} pts
            </span>
            {isComplete && match.winner?.id === match.player1?.id && (
              <Crown className="w-4 h-4 text-yellow-500" />
            )}
          </div>
        </div>
        
        {/* VS divider */}
        <div className="flex items-center justify-center">
          <span className="text-xs text-muted-foreground">VS</span>
        </div>
        
        {/* Player 2 */}
        <div 
          className={cn(
            'flex items-center justify-between p-2 rounded',
            match.winner?.id === match.player2?.id && 'bg-green-500/20 border border-green-500/50',
            match.status === 'draw' && 'bg-yellow-500/10',
            !isComplete && 'bg-muted'
          )}
        >
          <div className="flex items-center gap-2">
            {match.player2?.seed && (
              <span className="text-xs text-muted-foreground w-4">#{match.player2.seed}</span>
            )}
            <span className={cn('font-medium', !match.player2 && 'text-muted-foreground')}>
              {match.player2?.name || 'TBD'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {match.player2?.points || 0} pts
            </span>
            {isComplete && match.winner?.id === match.player2?.id && (
              <Crown className="w-4 h-4 text-yellow-500" />
            )}
          </div>
        </div>
        
        {/* Result buttons (when in progress) */}
        {!isComplete && match.player1 && match.player2 && onResultSelect && (
          <div className="flex gap-2 pt-2">
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => onResultSelect('player1-win')}
            >
              <Check className="w-3 h-3 mr-1" />
              P1 Win
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => onResultSelect('draw')}
            >
              <Tie className="w-3 h-3 mr-1" />
              Draw
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => onResultSelect('player2-win')}
            >
              <Check className="w-3 h-3 mr-1" />
              P2 Win
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Swiss standings display
interface SwissStandingsProps {
  players: SwissPlayer[];
  className?: string;
}

export function SwissStandings({ players, className }: SwissStandingsProps) {
  const standings = useMemo(() => calculateStandings(players), [players]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Standings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {standings.map(({ player, tiebreakers }, index) => (
            <div
              key={player.id}
              className={cn(
                'flex items-center justify-between p-2 rounded',
                index === 0 && 'bg-yellow-500/10 border border-yellow-500/30',
                index === 1 && 'bg-gray-400/10 border border-gray-400/30',
                index === 2 && 'bg-amber-600/10 border border-amber-600/30'
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold',
                  index === 0 && 'bg-yellow-500 text-white',
                  index === 1 && 'bg-gray-400 text-white',
                  index === 2 && 'bg-amber-600 text-white',
                  index > 2 && 'bg-muted'
                )}>
                  {index + 1}
                </span>
                <span className="font-medium">{player.name}</span>
                {player.seed && (
                  <span className="text-xs text-muted-foreground">#{player.seed}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-lg">{player.points}</span>
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-green-500 text-xs">
                    {player.wins}W
                  </Badge>
                  <Badge variant="outline" className="text-yellow-500 text-xs">
                    {player.draws}D
                  </Badge>
                  <Badge variant="outline" className="text-red-500 text-xs">
                    {player.losses}L
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {/* Tiebreakers explanation */}
        <div className="mt-4 p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Tiebreakers:</strong> 1) Points, 2) Opponent Match Win %, 3) Game Win %, 4) Opponent Game Win %
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Swiss tournament setup form
interface SwissTournamentSetupProps {
  onStart: (name: string, playerNames: string[], totalRounds: number) => void;
  className?: string;
}

export function SwissTournamentSetup({ onStart, className }: SwissTournamentSetupProps) {
  const [tournamentName, setTournamentName] = useState('My Swiss Tournament');
  const [playersText, setPlayersText] = useState('');
  const [totalRounds, setTotalRounds] = useState(4);
  const [shuffle, setShuffle] = useState(true);

  const handleStart = () => {
    const playerNames = playersText
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    
    if (playerNames.length >= 2) {
      onStart(tournamentName, playerNames, totalRounds);
    }
  };

  const playerCount = playersText.split('\n').filter((n) => n.trim()).length;
  
  // Calculate recommended rounds based on player count
  const recommendedRounds = Math.min(
    Math.max(Math.ceil(Math.log2(playerCount)), 3),
    7
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          Create Swiss Tournament
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tournament-name">Tournament Name</Label>
          <Input
            id="tournament-name"
            value={tournamentName}
            onChange={(e) => setTournamentName(e.target.value)}
            placeholder="Enter tournament name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="players">Players (one per line)</Label>
          <textarea
            id="players"
            value={playersText}
            onChange={(e) => setPlayersText(e.target.value)}
            placeholder="Enter player names, one per line&#10;Player 1&#10;Player 2&#10;Player 3"
            className="w-full h-40 px-3 py-2 border rounded-md resize-none"
          />
          <p className="text-xs text-muted-foreground">
            {playerCount} player{playerCount !== 1 ? 's' : ''} entered
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rounds">Number of Rounds</Label>
          <Input
            id="rounds"
            type="number"
            min={1}
            max={10}
            value={totalRounds}
            onChange={(e) => setTotalRounds(parseInt(e.target.value) || 3)}
          />
          <p className="text-xs text-muted-foreground">
            Recommended: {recommendedRounds} rounds for {playerCount} players
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="shuffle-players"
            type="checkbox"
            checked={shuffle}
            onChange={(e) => setShuffle(e.target.checked)}
            className="rounded"
          />
          <Label htmlFor="shuffle-players" className="text-sm">
            <Shuffle className="w-4 h-4 inline mr-1" />
            Shuffle and seed randomly
          </Label>
        </div>

        <Button 
          onClick={handleStart} 
          disabled={playerCount < 2}
          className="w-full"
        >
          <ArrowRight className="w-4 h-4 mr-2" />
          Start Swiss Tournament
        </Button>
      </CardContent>
    </Card>
  );
}

// Hook for managing Swiss tournament state
interface UseSwissTournamentReturn {
  tournament: SwissTournament | null;
  startTournament: (name: string, playerNames: string[], totalRounds: number) => void;
  recordResult: (matchId: string, result: 'player1-win' | 'player2-win' | 'draw') => void;
  nextRound: () => void;
  resetTournament: () => void;
}

export function useSwissTournament(): UseSwissTournamentReturn {
  const [tournament, setTournament] = useState<SwissTournament | null>(null);

  const startTournament = useCallback((name: string, playerNames: string[], totalRounds: number) => {
    const players: SwissPlayer[] = playerNames.map((name, index) => ({
      id: `player-${index}`,
      name,
      seed: index + 1,
      points: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      opponentIds: [],
      matchHistory: []
    }));

    // Shuffle if needed
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    
    // Generate first round pairings
    const firstRound = generateSwissPairings(shuffled, 1);
    
    // Update player opponent IDs for first round
    firstRound.forEach(match => {
      if (match.player1 && match.player2) {
        match.player1.opponentIds.push(match.player2.id);
        match.player2.opponentIds.push(match.player1.id);
      }
    });

    setTournament({
      id: `swiss-${Date.now()}`,
      name,
      status: 'in-progress',
      players: shuffled,
      rounds: [{ roundNumber: 1, matches: firstRound }],
      currentRound: 1,
      totalRounds,
      createdAt: Date.now(),
    });
  }, []);

  const recordResult = useCallback((matchId: string, result: 'player1-win' | 'player2-win' | 'draw') => {
    setTournament((prev) => {
      if (!prev) return null;

      const newRounds = prev.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId) return match;

          const player1 = prev.players.find(p => p.id === match.player1?.id);
          const player2 = prev.players.find(p => p.id === match.player2?.id);
          
          let winner: SwissPlayer | undefined;
          let player1Points = 0;
          let player2Points = 0;

          if (result === 'player1-win' && player1) {
            winner = player1;
            player1Points = 3;
            player2Points = 0;
          } else if (result === 'player2-win' && player2) {
            winner = player2;
            player1Points = 0;
            player2Points = 3;
          } else {
            // Draw
            player1Points = 1;
            player2Points = 1;
          }

          // Update player stats
          const updatedPlayers = prev.players.map(p => {
            if (p.id === player1?.id) {
              return {
                ...p,
                points: p.points + player1Points,
                wins: p.wins + (result === 'player1-win' ? 1 : 0),
                losses: p.losses + (result === 'player2-win' ? 1 : 0),
                draws: p.draws + (result === 'draw' ? 1 : 0),
                matchHistory: [...p.matchHistory, { 
                  round: prev.currentRound, 
                  result: result === 'player1-win' ? 'win' : result === 'player2-win' ? 'loss' : 'draw',
                  opponentId: player2?.id || ''
                }]
              };
            }
            if (p.id === player2?.id) {
              return {
                ...p,
                points: p.points + player2Points,
                wins: p.wins + (result === 'player2-win' ? 1 : 0),
                losses: p.losses + (result === 'player1-win' ? 1 : 0),
                draws: p.draws + (result === 'draw' ? 1 : 0),
                matchHistory: [...p.matchHistory, { 
                  round: prev.currentRound, 
                  result: result === 'player2-win' ? 'win' : result === 'player1-win' ? 'loss' : 'draw',
                  opponentId: player1?.id || ''
                }]
              };
            }
            return p;
          });

          return { 
            ...match, 
            winner, 
            status: result === 'draw' ? 'draw' as const : 'completed' as const,
            player1Points,
            player2Points
          };
        }),
      }));

      return {
        ...prev,
        players: updatedPlayers,
        rounds: newRounds
      };
    });
  }, []);

  const nextRound = useCallback(() => {
    setTournament((prev) => {
      if (!prev) return null;
      
      const nextRoundNum = prev.currentRound + 1;
      if (nextRoundNum > prev.totalRounds) {
        return {
          ...prev,
          status: 'completed',
          completedAt: Date.now()
        };
      }

      const newPairings = generateSwissPairings(prev.players, nextRoundNum);
      
      // Update opponent IDs for new round
      newPairings.forEach(match => {
        if (match.player1 && match.player2) {
          const p1 = prev.players.find(p => p.id === match.player1?.id);
          const p2 = prev.players.find(p => p.id === match.player2?.id);
          if (p1) p1.opponentIds.push(match.player2!.id);
          if (p2) p2.opponentIds.push(match.player1!.id);
        }
      });

      return {
        ...prev,
        currentRound: nextRoundNum,
        rounds: [...prev.rounds, { roundNumber: nextRoundNum, matches: newPairings }]
      };
    });
  }, []);

  const resetTournament = useCallback(() => {
    setTournament(null);
  }, []);

  return {
    tournament,
    startTournament,
    recordResult,
    nextRound,
    resetTournament,
  };
}

// Match history component
interface MatchHistoryProps {
  players: SwissPlayer[];
  className?: string;
}

export function MatchHistory({ players, className }: MatchHistoryProps) {
  const allMatches = useMemo(() => {
    const matches: { round: number; player1: string; player2: string; result: string }[] = [];
    
    players.forEach(player => {
      player.matchHistory.forEach(match => {
        const opponent = players.find(p => p.id === match.opponentId);
        if (opponent) {
          matches.push({
            round: match.round,
            player1: player.name,
            player2: opponent.name,
            result: match.result === 'win' ? 'W' : match.result === 'loss' ? 'L' : 'D'
          });
        }
      });
    });
    
    return matches.sort((a, b) => a.round - b.round);
  }, [players]);

  if (allMatches.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No matches played yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="w-5 h-5" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {allMatches.map((match, index) => (
            <div key={index} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">R{match.round}</span>
              <span className="flex-1 px-2">{match.player1}</span>
              <Badge className={cn(
                'mx-2',
                match.result === 'W' && 'bg-green-500',
                match.result === 'L' && 'bg-red-500',
                match.result === 'D' && 'bg-yellow-500'
              )}>
                {match.result}
              </Badge>
              <span className="flex-1 px-2 text-right">{match.player2}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
