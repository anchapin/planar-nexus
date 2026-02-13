/**
 * Public game browser page
 * Allows players to discover and join public games
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Search, Users, Clock, Lock, Eye, Gamepad2, Crown } from 'lucide-react';
import { publicLobbyBrowser, PublicGameInfo } from '@/lib/public-lobby-browser';
import { GameFormat, PlayerCount } from '@/lib/multiplayer-types';

const formatDisplayNames: Record<GameFormat, string> = {
  commander: 'Commander',
  modern: 'Modern',
  standard: 'Standard',
  pioneer: 'Pioneer',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
};

export default function BrowseGamesPage() {
  const [games, setGames] = useState<PublicGameInfo[]>([]);
  const [filteredGames, setFilteredGames] = useState<PublicGameInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<GameFormat | 'all'>('all');
  const [playerCountFilter, setPlayerCountFilter] = useState<PlayerCount | 'all'>('all');

  // Load games on mount
  useEffect(() => {
    loadGames();

    // Subscribe to game updates
    const unsubscribe = publicLobbyBrowser.subscribe((updatedGames) => {
      setGames(updatedGames);
      setLastRefresh(new Date());
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Apply filters whenever games or filter criteria change
  useEffect(() => {
    let filtered = games;

    // Apply search
    if (searchQuery.trim()) {
      filtered = publicLobbyBrowser.searchGames(searchQuery);
    }

    // Apply format filter
    if (formatFilter !== 'all') {
      filtered = filtered.filter(g => g.format === formatFilter);
    }

    // Apply player count filter
    if (playerCountFilter !== 'all') {
      filtered = filtered.filter(g => g.maxPlayers === playerCountFilter);
    }

    setFilteredGames(filtered);
  }, [games, searchQuery, formatFilter, playerCountFilter]);

  const loadGames = useCallback(() => {
    const allGames = publicLobbyBrowser.getPublicGames();
    setGames(allGames);
    setLastRefresh(new Date());
    setIsLoading(false);
  }, []);

  const handleRefresh = () => {
    publicLobbyBrowser.cleanupOldGames();
    loadGames();
  };

  const handleJoinGame = (gameCode: string) => {
    // Store the game code and redirect to join page
    // For now, redirect to multiplayer main page with the code
    // In production, this would navigate to a dedicated join/game page
    alert(`Join game with code: ${gameCode}\n\nNote: Join functionality is not yet implemented. Use this code on the main multiplayer page.`);
  };

  const isGameFull = (game: PublicGameInfo) => {
    return game.currentPlayers >= parseInt(game.maxPlayers);
  };

  const getPlayerCountColor = (game: PublicGameInfo) => {
    const maxPlayers = parseInt(game.maxPlayers);
    const percentage = (game.currentPlayers / maxPlayers) * 100;

    if (percentage >= 100) return 'destructive';
    if (percentage >= 75) return 'default';
    return 'secondary';
  };

  const getTimeSinceCreation = (createdAt: number) => {
    const minutes = Math.floor((Date.now() - createdAt) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className="flex-1 p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-6">
        <Button
          variant="ghost"
          onClick={() => window.location.href = '/multiplayer'}
          className="mb-4"
        >
          ← Back
        </Button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
              <Gamepad2 className="w-8 h-8" />
              Browse Games
            </h1>
            <p className="text-muted-foreground mt-1">
              Find and join public games waiting for players.
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </p>
      </header>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Filter Games</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Search */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Search className="w-4 h-4" />
                Search
              </label>
              <Input
                placeholder="Game name or host..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Format Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Format</label>
              <Select value={formatFilter} onValueChange={(value: any) => setFormatFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Formats</SelectItem>
                  <SelectItem value="commander">Commander</SelectItem>
                  <SelectItem value="modern">Modern</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="pioneer">Pioneer</SelectItem>
                  <SelectItem value="legacy">Legacy</SelectItem>
                  <SelectItem value="vintage">Vintage</SelectItem>
                  <SelectItem value="pauper">Pauper</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Player Count Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Users className="w-4 h-4" />
                Players
              </label>
              <Select value={playerCountFilter} onValueChange={(value: any) => setPlayerCountFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Size</SelectItem>
                  <SelectItem value="2">2 Players</SelectItem>
                  <SelectItem value="3">3 Players</SelectItem>
                  <SelectItem value="4">4 Players</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active Filters */}
          {(searchQuery || formatFilter !== 'all' || playerCountFilter !== 'all') && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
              {searchQuery && (
                <Badge variant="secondary" className="cursor-pointer" onClick={() => setSearchQuery('')}>
                  Search: "{searchQuery}" ×
                </Badge>
              )}
              {formatFilter !== 'all' && (
                <Badge variant="secondary" className="cursor-pointer" onClick={() => setFormatFilter('all')}>
                  Format: {formatDisplayNames[formatFilter]} ×
                </Badge>
              )}
              {playerCountFilter !== 'all' && (
                <Badge variant="secondary" className="cursor-pointer" onClick={() => setPlayerCountFilter('all')}>
                  {playerCountFilter} Players ×
                </Badge>
              )}
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => {
                setSearchQuery('');
                setFormatFilter('all');
                setPlayerCountFilter('all');
              }}>
                Clear all
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Game List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Available Games</span>
            <Badge variant="secondary">{filteredGames.length}</Badge>
          </CardTitle>
          <CardDescription>
            {filteredGames.length === 0
              ? 'No public games available. Create your own lobby to start playing!'
              : `${filteredGames.length} game${filteredGames.length !== 1 ? 's' : ''} waiting for players`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin" />
              <p>Loading games...</p>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="text-center py-12">
              <Gamepad2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Games Found</h3>
              <p className="text-muted-foreground mb-4">
                {games.length === 0
                  ? 'There are no public games available right now.'
                  : 'No games match your filters.'}
              </p>
              {games.length > 0 && (
                <Button variant="outline" onClick={() => {
                  setSearchQuery('');
                  setFormatFilter('all');
                  setPlayerCountFilter('all');
                }}>
                  Clear Filters
                </Button>
              )}
              {games.length === 0 && (
                <Button onClick={() => window.location.href = '/multiplayer/host'} className="ml-2">
                  Create a Game
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Game Name</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Players</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="text-right">Join</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGames.map((game) => (
                    <TableRow key={game.id}>
                      <TableCell>
                        <div className="font-medium">{game.name}</div>
                        <div className="text-xs text-muted-foreground font-mono mt-1">
                          {game.gameCode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Crown className="w-3 h-3 text-yellow-500" />
                          {game.hostName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{formatDisplayNames[game.format]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getPlayerCountColor(game)}>
                          {game.currentPlayers} / {game.maxPlayers}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={game.status === 'waiting' ? 'secondary' : 'default'}>
                          {game.status === 'waiting' ? 'Waiting' : 'In Progress'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 items-center">
                          {game.hasPassword && (
                            <span title="Password protected">
                              <Lock className="w-4 h-4 text-muted-foreground" />
                            </span>
                          )}
                          {game.allowSpectators && (
                            <span title="Spectators allowed">
                              <Eye className="w-4 h-4 text-muted-foreground" />
                            </span>
                          )}
                          {!game.hasPassword && !game.allowSpectators && (
                            <span className="text-xs text-muted-foreground">Open</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {getTimeSinceCreation(game.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          disabled={isGameFull(game) || game.status === 'in-progress'}
                          onClick={() => handleJoinGame(game.gameCode)}
                        >
                          {isGameFull(game) ? 'Full' : 'Join'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Alert */}
      <Alert className="mt-6">
        <AlertDescription className="text-sm">
          <strong>Note:</strong> This is a prototype game browser. Games shown are stored locally in your browser.
          In production, this would connect to a central server to show games from all players.
          Create a public game from the host page to see it appear here!
        </AlertDescription>
      </Alert>
    </div>
  );
}
