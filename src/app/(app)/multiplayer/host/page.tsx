/**
 * Host game lobby page
 * Allows players to create and manage a game lobby
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, Check, Users, Settings, Play, X, Crown, Clock, Eye, Info } from 'lucide-react';
import { useLobby } from '@/hooks/use-lobby';
import { HostGameConfig, PlayerStatus } from '@/lib/multiplayer-types';
import { FormatRulesDisplay } from '@/components/format-rules-display';
import { DeckSelectorWithValidation } from '@/components/deck-selector-with-validation';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { SavedDeck } from '@/app/actions';

export default function HostLobbyPage() {
  const { lobby, isHost, isLoading, error, createLobby, updatePlayerStatus, updatePlayerDeck, canStartGame, startGame, closeLobby, getGameCode, validateDeckForFormat } = useLobby();

  // Form state
  const [gameName, setGameName] = useState('');
  const [gameFormat, setGameFormat] = useState<'commander' | 'modern' | 'standard' | 'pioneer' | 'legacy' | 'vintage' | 'pauper'>('commander');
  const [playerCount, setPlayerCount] = useState<'2' | '3' | '4'>('4');
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(30);
  const [isPublic, setIsPublic] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null);
  const [deckValidation, setDeckValidation] = useState<{ isValid: boolean; errors: string[] }>({ isValid: true, errors: [] });

  // UI state
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(true);

  const gameCode = getGameCode();

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const handleCreateLobby = () => {
    if (!gameName.trim()) {
      return;
    }

    const config: HostGameConfig = {
      name: gameName,
      format: gameFormat,
      maxPlayers: playerCount,
      settings: {
        allowSpectators,
        isPublic,
        timerEnabled,
        timerMinutes: timerEnabled ? timerMinutes : undefined,
      },
    };

    // Get player name from localStorage or use default
    const hostName = localStorage.getItem('planar_nexus_player_name') || 'Host Player';

    createLobby(config, hostName);
    setShowCreateForm(false);
    setShowSettings(false);

    // Auto-select first valid deck if available
    const [savedDecks] = getStoredDecks();
    const validDeck = savedDecks.find((deck: SavedDeck) => {
      const validation = validateDeckForFormat(deck);
      return validation.isValid;
    });
    if (validDeck && lobby) {
      handleDeckSelect(validDeck);
    }
  };

  // Helper to get stored decks
  const getStoredDecks = () => {
    const stored = localStorage.getItem('saved-decks');
    return stored ? JSON.parse(stored) : [];
  };

  // Handle deck selection with validation
  const handleDeckSelect = (deck: SavedDeck, validation?: { isValid: boolean; errors: string[] }) => {
    setSelectedDeck(deck);
    const deckValidationResult = validation || validateDeckForFormat(deck);
    setDeckValidation(deckValidationResult);

    // Update player deck in lobby
    if (lobby) {
      const hostPlayer = lobby.players.find(p => p.id === lobby.hostId);
      if (hostPlayer) {
        updatePlayerDeck(lobby.hostId, deck.id, deck.name, deck);
      }
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(lobby?.gameCode || '');
    setCopied(true);
  };

  const handleReadyToggle = () => {
    if (!lobby) return;

    const hostPlayer = lobby.players.find(p => p.id === lobby.hostId);
    if (hostPlayer) {
      const newStatus: PlayerStatus = hostPlayer.status === 'ready' ? 'not-ready' : 'ready';
      updatePlayerStatus(lobby.hostId, newStatus);
    }
  };

  const handleStartGame = () => {
    const success = startGame();
    if (success) {
      // TODO: Navigate to game board when implemented
      console.log('Starting game...');
    }
  };

  const handleCloseLobby = () => {
    if (confirm('Are you sure you want to close the lobby? This will disconnect all players.')) {
      closeLobby();
      window.location.href = '/multiplayer';
    }
  };

  const handleLeaveLobby = () => {
    if (confirm('Are you sure you want to leave? The lobby will be closed for all players.')) {
      closeLobby();
      window.location.href = '/multiplayer';
    }
  };

  // Format display name
  const formatDisplayNames: Record<string, string> = {
    commander: 'Commander',
    modern: 'Modern',
    standard: 'Standard',
    pioneer: 'Pioneer',
    legacy: 'Legacy',
    vintage: 'Vintage',
    pauper: 'Pauper',
  };

  if (showCreateForm && !lobby) {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <Button variant="ghost" onClick={() => window.location.href = '/multiplayer'} className="mb-4">
            ← Back
          </Button>
          <h1 className="font-headline text-3xl font-bold">Host a Game</h1>
          <p className="text-muted-foreground mt-1">
            Create a new lobby and invite your friends to play.
          </p>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Lobby Settings</CardTitle>
              <CardDescription>Configure your game lobby</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Game Name */}
              <div className="space-y-2">
                <Label htmlFor="game-name">Game Name *</Label>
                <Input
                  id="game-name"
                  placeholder="e.g., Friday Night Commander"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                />
              </div>

              {/* Game Format */}
              <div className="space-y-2">
                <Label htmlFor="format">Format *</Label>
                <Select value={gameFormat} onValueChange={(value: any) => setGameFormat(value)}>
                  <SelectTrigger id="format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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

              {/* Player Count */}
              <div className="space-y-2">
                <Label htmlFor="players">Max Players</Label>
                <Select value={playerCount} onValueChange={(value: any) => setPlayerCount(value)}>
                  <SelectTrigger id="players">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 Players (1v1)</SelectItem>
                    <SelectItem value="3">3 Players (Free-for-all)</SelectItem>
                    <SelectItem value="4">4 Players (Free-for-all)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Format Rules Display */}
              <FormatRulesDisplay format={gameFormat} className="mt-4" />

              <Separator />

              {/* Additional Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Public Game</Label>
                    <p className="text-xs text-muted-foreground">
                      Allow others to see your game in the browser
                    </p>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Allow Spectators</Label>
                    <p className="text-xs text-muted-foreground">
                      Let others watch your game
                    </p>
                  </div>
                  <Switch checked={allowSpectators} onCheckedChange={setAllowSpectators} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Timer</Label>
                    <p className="text-xs text-muted-foreground">
                      Add a turn timer for competitive play
                    </p>
                  </div>
                  <Switch checked={timerEnabled} onCheckedChange={setTimerEnabled} />
                </div>

                {timerEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="timer-minutes">Turn Timer (minutes)</Label>
                    <Input
                      id="timer-minutes"
                      type="number"
                      min={1}
                      max={60}
                      value={timerMinutes}
                      onChange={(e) => setTimerMinutes(parseInt(e.target.value) || 30)}
                    />
                  </div>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleCreateLobby}
                disabled={!gameName.trim() || isLoading}
                className="w-full"
                size="lg"
              >
                {isLoading ? 'Creating...' : 'Create Lobby'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (lobby) {
    const maxPlayers = parseInt(lobby.maxPlayers);
    const playerSlots = maxPlayers - lobby.players.length;

    return (
      <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto">
        <header className="mb-6">
          <Button variant="ghost" onClick={handleLeaveLobby} className="mb-4">
            ← Leave Lobby
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
                {lobby.name}
                <Badge variant="secondary">{formatDisplayNames[lobby.format]}</Badge>
              </h1>
              <p className="text-muted-foreground mt-1">
                Waiting for players to join...
              </p>
            </div>
            <Button variant="destructive" onClick={handleCloseLobby} size="sm">
              Close Lobby
            </Button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Game Code Card */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Invite Players
              </CardTitle>
              <CardDescription>Share this code with your friends
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-4xl font-mono font-bold tracking-wider mb-2">
                  {gameCode}
                </div>
                <Button
                  onClick={handleCopyCode}
                  variant={copied ? "default" : "outline"}
                  className="w-full"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Code
                    </>
                  )}
                </Button>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">{formatDisplayNames[lobby.format]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Players:</span>
                  <span className="font-medium">{lobby.players.length} / {maxPlayers}</span>
                </div>
                {lobby.settings.timerEnabled && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Timer:
                    </span>
                    <span className="font-medium">{lobby.settings.timerMinutes} min turns</span>
                  </div>
                )}
                {lobby.settings.allowSpectators && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      Spectators:
                    </span>
                    <span className="font-medium">Allowed</span>
                  </div>
                )}
              </div>

              {playerSlots > 0 && (
                <Alert>
                  <AlertDescription className="text-center">
                    Waiting for {playerSlots} more player{playerSlots > 1 ? 's' : ''}...
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Format Rules */}
          <FormatRulesDisplay format={lobby.format} className="md:col-span-3" />

          {/* Deck Selection for Host */}
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                Deck Selection
              </CardTitle>
              <CardDescription>
                Select a valid {formatDisplayNames[lobby.format]} deck to play
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeckSelectorWithValidation
                lobbyFormat={lobby.format}
                onDeckSelect={handleDeckSelect}
                selectedDeckId={selectedDeck?.id}
                className="max-w-md"
              />
            </CardContent>
          </Card>

          {/* Players List */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Players in Lobby</CardTitle>
              <CardDescription>
                All players must be ready and have valid decks before starting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lobby.players.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-4 border rounded-lg bg-card"
                  >
                    <div className="flex items-center gap-3">
                      {player.id === lobby.hostId && (
                        <Crown className="w-5 h-5 text-yellow-500" />
                      )}
                      <div>
                        <div className="font-medium">
                          {player.name}
                          {player.id === lobby.hostId && (
                            <Badge variant="outline" className="ml-2">Host</Badge>
                          )}
                        </div>
                        {player.deckName && (
                          <div className="text-sm text-muted-foreground">
                            Deck: {player.deckName}
                            {player.deckFormat && player.deckFormat !== lobby.format && (
                              <span className="text-yellow-600 ml-2">
                                ({player.deckFormat} deck)
                              </span>
                            )}
                          </div>
                        )}
                        {player.deckValidationErrors && player.deckValidationErrors.length > 0 && (
                          <div className="text-xs text-red-500 mt-1">
                            {player.deckValidationErrors[0]}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={player.status === 'ready' || player.status === 'host' ? 'default' : 'secondary'}
                    >
                      {player.status === 'ready' ? 'Ready' : player.status === 'host' ? 'Host' : 'Not Ready'}
                    </Badge>
                  </div>
                ))}

                {/* Empty slots */}
                {Array.from({ length: playerSlots }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex items-center justify-center p-4 border-2 border-dashed rounded-lg bg-muted/20"
                  >
                    <span className="text-sm text-muted-foreground">
                      Waiting for player...
                    </span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <div className="flex gap-3">
                {isHost ? (
                  <Button
                    onClick={handleStartGame}
                    disabled={!canStartGame}
                    className="flex-1"
                    size="lg"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Start Game
                  </Button>
                ) : (
                  <Button
                    onClick={handleReadyToggle}
                    variant={lobby.players.find(p => p.id === lobby.hostId)?.status === 'ready' ? 'outline' : 'default'}
                    className="flex-1"
                    size="lg"
                  >
                    {lobby.players.find(p => p.id === lobby.hostId)?.status === 'ready' ? (
                      <>
                        <X className="w-4 h-4 mr-2" />
                        Not Ready
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Ready Up
                      </>
                    )}
                  </Button>
                )}
              </div>

              {!canStartGame && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {lobby.players.length < 2
                    ? 'Need at least 2 players to start'
                    : lobby.players.some(p => !p.deckId)
                    ? 'All players must select a deck'
                    : 'All players must have valid decks and be ready to start'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          Note: This is a prototype lobby. P2P networking (WebRTC) is not yet implemented.
        </p>
      </div>
    );
  }

  return null;
}
