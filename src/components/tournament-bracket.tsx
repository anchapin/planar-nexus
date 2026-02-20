'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Trophy, 
  Crown, 
  Check, 
  Shuffle,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Tournament types
export type TournamentStatus = 'setup' | 'in-progress' | 'completed';
export type MatchStatus = 'pending' | 'in-progress' | 'completed';

export interface TournamentPlayer {
  id: string;
  name: string;
  seed?: number;
  wins: number;
  losses: number;
}

export interface TournamentMatch {
  id: string;
  round: number;
  player1?: TournamentPlayer;
  player2?: TournamentPlayer;
  winner?: TournamentPlayer;
  status: MatchStatus;
}

export interface TournamentRound {
  roundNumber: number;
  matches: TournamentMatch[];
}

export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  players: TournamentPlayer[];
  rounds: TournamentRound[];
  currentRound: number;
  createdAt: number;
}

// Generate initial bracket based on player count
function generateBracket(players: TournamentPlayer[]): TournamentRound[] {
  const playerCount = players.length;
  if (playerCount < 2) return [];

  // Calculate number of rounds needed (next power of 2)
  const rounds = Math.ceil(Math.log2(playerCount));
  const bracketSize = Math.pow(2, rounds);
  
  const seededPlayers = [...players].sort((a, b) => (a.seed || 999) - (b.seed || 999));
  
  // Generate first round matches
  const firstRound: TournamentMatch[] = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const player1 = seededPlayers[i * 2];
    const player2 = seededPlayers[i * 2 + 1];
    
    firstRound.push({
      id: `match-r1-m${i + 1}`,
      round: 1,
      player1: player1,
      player2: player2,
      status: player1 && player2 ? 'pending' : 'pending',
    });
  }

  // Generate subsequent rounds (empty placeholders)
  const tournamentRounds: TournamentRound[] = [{ roundNumber: 1, matches: firstRound }];
  
  for (let r = 2; r <= rounds; r++) {
    const roundMatches: TournamentMatch[] = [];
    const matchCount = bracketSize / Math.pow(2, r);
    for (let m = 0; m < matchCount; m++) {
      roundMatches.push({
        id: `match-r${r}-m${m + 1}`,
        round: r,
        status: 'pending',
      });
    }
    tournamentRounds.push({ roundNumber: r, matches: roundMatches });
  }

  return tournamentRounds;
}

// Shuffle players for random seeding
function shufflePlayers(players: TournamentPlayer[]): TournamentPlayer[] {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((p, i) => ({ ...p, seed: i + 1 }));
}

// Tournament bracket component
interface TournamentBracketProps {
  tournament: Tournament;
  onMatchComplete?: (matchId: string, winnerId: string) => void;
  className?: string;
}

export function TournamentBracket({ tournament, onMatchComplete, className }: TournamentBracketProps) {
  return (
    <div className={cn('space-y-8 overflow-x-auto', className)}>
      {tournament.rounds.map((round) => (
        <div key={round.roundNumber} className="flex flex-col items-center">
          <h3 className="text-sm font-semibold mb-4 text-muted-foreground">
            {round.roundNumber === tournament.rounds.length
              ? 'Finals'
              : round.roundNumber === tournament.rounds.length - 1
              ? 'Semifinals'
              : `Round ${round.roundNumber}`}
          </h3>
          <div className="flex flex-col gap-4">
            {round.matches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                onWinnerSelect={(winnerId) => onMatchComplete?.(match.id, winnerId)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Single match card
interface MatchCardProps {
  match: TournamentMatch;
  onWinnerSelect?: (winnerId: string) => void;
}

function MatchCard({ match, onWinnerSelect }: MatchCardProps) {
  const isComplete = match.status === 'completed';
  
  return (
    <Card className={cn(
      'w-48',
      isComplete && 'opacity-70'
    )}>
      <CardContent className="p-3 space-y-2">
        {/* Player 1 */}
        <div 
          className={cn(
            'flex items-center justify-between p-2 rounded',
            match.winner?.id === match.player1?.id && 'bg-green-500/20 border border-green-500/50',
            !isComplete && 'bg-muted'
          )}
        >
          <div className="flex items-center gap-2">
            {match.player1?.seed && (
              <span className="text-xs text-muted-foreground w-4">{match.player1.seed}</span>
            )}
            <span className={cn('text-sm', !match.player1 && 'text-muted-foreground')}>
              {match.player1?.name || 'TBD'}
            </span>
          </div>
          {isComplete && match.winner?.id === match.player1?.id && (
            <Crown className="w-4 h-4 text-yellow-500" />
          )}
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
            !isComplete && 'bg-muted'
          )}
        >
          <div className="flex items-center gap-2">
            {match.player2?.seed && (
              <span className="text-xs text-muted-foreground w-4">{match.player2.seed}</span>
            )}
            <span className={cn('text-sm', !match.player2 && 'text-muted-foreground')}>
              {match.player2?.name || 'TBD'}
            </span>
          </div>
          {isComplete && match.winner?.id === match.player2?.id && (
            <Crown className="w-4 h-4 text-yellow-500" />
          )}
        </div>
        
        {/* Winner selection buttons (when in progress) */}
        {!isComplete && match.player1 && match.player2 && onWinnerSelect && (
          <div className="flex gap-2 mt-2">
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => onWinnerSelect(match.player1!.id)}
            >
              <Check className="w-3 h-3 mr-1" />
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="flex-1"
              onClick={() => onWinnerSelect(match.player2!.id)}
            >
              <Check className="w-3 h-3 mr-1" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Tournament leaderboard
interface LeaderboardProps {
  players: TournamentPlayer[];
  className?: string;
}

export function Leaderboard({ players, className }: LeaderboardProps) {
  const sortedPlayers = [...players].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.losses - b.losses;
  });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Standings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sortedPlayers.map((player, index) => (
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
                <Badge variant="outline" className="text-green-500">
                  {player.wins}W
                </Badge>
                <Badge variant="outline" className="text-red-500">
                  {player.losses}L
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Tournament setup form
interface TournamentSetupProps {
  onStart: (name: string, playerNames: string[]) => void;
  className?: string;
}

export function TournamentSetup({ onStart, className }: TournamentSetupProps) {
  const [tournamentName, setTournamentName] = useState('My Tournament');
  const [playersText, setPlayersText] = useState('');
  const [shuffle, setShuffle] = useState(true);

  const handleStart = () => {
    const playerNames = playersText
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    
    if (playerNames.length >= 2) {
      onStart(tournamentName, shuffle ? shufflePlayers(playerNames.map((n, i) => ({ id: `p${i}`, name: n, wins: 0, losses: 0 }))).map(p => p.name) : playerNames);
    }
  };

  const playerCount = playersText.split('\n').filter((n) => n.trim()).length;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          Create Tournament
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
          Start Tournament
        </Button>
      </CardContent>
    </Card>
  );
}

// Hook for managing tournament state
interface UseTournamentReturn {
  tournament: Tournament | null;
  startTournament: (name: string, playerNames: string[]) => void;
  recordWinner: (matchId: string, winnerId: string) => void;
  resetTournament: () => void;
}

export function useTournament(): UseTournamentReturn {
  const [tournament, setTournament] = useState<Tournament | null>(null);

  const startTournament = useCallback((name: string, playerNames: string[]) => {
    const players: TournamentPlayer[] = playerNames.map((name, index) => ({
      id: `player-${index}`,
      name,
      seed: index + 1,
      wins: 0,
      losses: 0,
    }));

    const rounds = generateBracket(players);

    setTournament({
      id: `tournament-${Date.now()}`,
      name,
      status: 'in-progress',
      players,
      rounds,
      currentRound: 1,
      createdAt: Date.now(),
    });
  }, []);

  const recordWinner = useCallback((matchId: string, winnerId: string) => {
    setTournament((prev) => {
      if (!prev) return null;

      const newRounds = prev.rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId) return match;

          const winner = prev.players.find((p) => p.id === winnerId);
          const loser = match.player1?.id === winnerId 
            ? match.player2 
            : match.player1;

          // Update player stats
          const updatedPlayers = prev.players.map((p) => {
            if (p.id === winnerId) return { ...p, wins: p.wins + 1 };
            if (p.id === loser?.id) return { ...p, losses: p.losses + 1 };
            return p;
          });

          // Advance winner to next round
          const nextRound = match.round + 1;
          if (nextRound <= prev.rounds.length) {
            const matchIndex = round.matches.indexOf(match);
            const nextRoundMatchIndex = Math.floor(matchIndex / 2);
            
            const isFirstPlayer = matchIndex % 2 === 0;
            
            // Update next round match
            const updatedRounds = prev.rounds.map((r) => {
              if (r.roundNumber !== nextRound) return r;
              return {
                ...r,
                matches: r.matches.map((m, mi) => {
                  if (mi !== nextRoundMatchIndex) return m;
                  return {
                    ...m,
                    [isFirstPlayer ? 'player1' : 'player2']: winner,
                    status: m.player1 && m.player2 ? 'pending' : 'pending',
                  };
                }),
              };
            });

            return { 
              ...match, 
              winner, 
              status: 'completed' as MatchStatus,
              players: updatedPlayers,
              rounds: updatedRounds,
            };
          }

          return { 
            ...match, 
            winner, 
            status: 'completed' as MatchStatus,
          };
        }),
      }));

      // Check if tournament is complete
      const allMatchesComplete = newRounds.every((r) => 
        r.matches.every((m) => m.status === 'completed')
      );

      return {
        ...prev,
        rounds: newRounds,
        status: allMatchesComplete ? 'completed' : 'in-progress',
      };
    });
  }, []);

  const resetTournament = useCallback(() => {
    setTournament(null);
  }, []);

  return {
    tournament,
    startTournament,
    recordWinner,
    resetTournament,
  };
}
