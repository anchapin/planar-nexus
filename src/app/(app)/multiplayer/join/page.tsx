/**
 * Join game page
 * Allows players to join a game lobby using a game code and select their deck
 */

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Users, Crown, Check, Info, Eye, Clock } from 'lucide-react';
import { publicLobbyBrowser, PublicGameInfo } from '@/lib/public-lobby-browser';
import { DeckSelectorWithValidation } from '@/components/deck-selector-with-validation';
import { ConnectionQRCode } from '@/components/connection-qr-code';
import { GameFormat } from '@/lib/multiplayer-types';
import { validateDeckForLobby } from '@/lib/format-validator';
import type { SavedDeck } from '@/app/actions';
import { createP2PConnection } from '@/lib/webrtc-p2p';
import { decodeConnectionData, isValidConnectionDataString } from '@/lib/client-signaling';
import type { ConnectionData } from '@/lib/client-signaling';

interface JoinState {
  step: 'code' | 'name' | 'lobby';
  gameCode: string;
  playerName: string;
  game: PublicGameInfo | null;
  connectionData: ConnectionData | null;
}

function JoinGameContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Initialize with code from URL if present
  const initialCode = searchParams.get('code') || '';
  
  const [joinState, setJoinState] = useState<JoinState>({
    step: initialCode ? 'name' : 'code',
    gameCode: initialCode,
    playerName: '',
    game: null,
    connectionData: null,
  });
  
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null);
  const [deckValidation, setDeckValidation] = useState<{ isValid: boolean; errors: string[] }>({ isValid: true, errors: [] });
  const [error, setError] = useState<string | null>(null);
  const [joinedPlayer, setJoinedPlayer] = useState<{ id: string; name: string; deckId?: string; deckName?: string } | null>(null);
  const [ready, setReady] = useState(false);

  // Format display names
  const formatDisplayNames: Record<GameFormat, string> = {
    commander: 'Commander',
    modern: 'Modern',
    standard: 'Standard',
    pioneer: 'Pioneer',
    legacy: 'Legacy',
    vintage: 'Vintage',
    pauper: 'Pauper',
  };

  // Load game info when code is entered
  useEffect(() => {
    if (joinState.gameCode.length >= 6) {
      const game = publicLobbyBrowser.getGameByCode(joinState.gameCode.toUpperCase());
      if (game) {
        setJoinState(prev => ({ ...prev, game }));
        setError(null);
      } else {
        setError('Game not found. Check the code and try again.');
        setJoinState(prev => ({ ...prev, game: null }));
      }
    }
  }, [joinState.gameCode]);

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinState.gameCode.length >= 6) {
      setJoinState(prev => ({ ...prev, step: 'name' }));
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerNameInput.trim()) {
      setJoinState(prev => ({ ...prev, playerName: playerNameInput.trim() }));
      // Auto-join the player to the lobby
      joinGame();
    }
  };

  // Handle connection data from QR code or manual entry
  const handleConnectionDataEntry = async (dataString: string) => {
    try {
      // Validate connection data
      if (!isValidConnectionDataString(dataString)) {
        setError('Invalid connection data. Please check and try again.');
        return;
      }

      // Decode connection data
      const connectionData = decodeConnectionData(dataString);

      // Validate that it's an offer (host data)
      if (connectionData.type !== 'offer') {
        setError('Expected connection offer from host. Please scan the host QR code.');
        return;
      }

      // Store connection data
      setJoinState(prev => ({ ...prev, connectionData }));
      setError(null);

      // Initialize P2P connection as client
      initializeClientConnection(connectionData);

    } catch (err) {
      console.error('Failed to process connection data:', err);
      setError('Failed to process connection data. Please try again.');
    }
  };

  // Initialize client P2P connection
  const initializeClientConnection = async (hostConnectionData: ConnectionData) => {
    try {
      // Create P2P connection as client
      const p2pConnection = createP2PConnection({
        playerId: `client-${Date.now()}`,
        playerName: playerNameInput.trim(),
        isHost: false,
        remoteConnectionData: hostConnectionData,
        events: {
          onConnectionStateChange: (state) => {
            console.log('[Client] P2P connection state:', state);
            if (state === 'connected') {
              // Connection successful, proceed to lobby
              setJoinState(prev => ({ ...prev, step: 'lobby' }));
            }
          },
          onError: (error) => {
            console.error('[Client] P2P connection error:', error);
            setError('Failed to connect to host. Please try again.');
          },
        },
      });

      // Initialize WebRTC
      await p2pConnection.initialize();

      console.log('[Client] P2P connection initialized');

    } catch (error) {
      console.error('[Client] Failed to initialize P2P connection:', error);
      setError('Failed to establish connection. Please try again.');
    }
  };

  const joinGame = () => {
    if (!joinState.game) return;
    
    // Simulate joining - in a real app this would connect to server
    const playerId = `player-${Date.now()}`;
    const newPlayer = {
      id: playerId,
      name: joinState.playerName,
      deckId: selectedDeck?.id,
      deckName: selectedDeck?.name,
    };
    
    // Store in localStorage to simulate joined state
    localStorage.setItem('planar_nexus_joined_game', JSON.stringify({
      gameCode: joinState.gameCode,
      player: newPlayer,
    }));
    
    setJoinedPlayer(newPlayer);
    setJoinState(prev => ({ ...prev, step: 'lobby' }));
  };

  const handleDeckSelect = (deck: SavedDeck) => {
    setSelectedDeck(deck);
    
    // Validate deck for the game format
    if (joinState.game) {
      const validation = validateDeckForLobby(deck, joinState.game.format);
      setDeckValidation({
        isValid: validation.isValid && validation.canPlay,
        errors: [...validation.errors, ...validation.warnings],
      });
    }
    
    // Update local storage
    if (joinedPlayer) {
      const updatedPlayer = { ...joinedPlayer, deckId: deck.id, deckName: deck.name };
      setJoinedPlayer(updatedPlayer);
      localStorage.setItem('planar_nexus_joined_game', JSON.stringify({
        gameCode: joinState.gameCode,
        player: updatedPlayer,
      }));
    }
  };

  const handleReady = () => {
    setReady(!ready);
    // In a real app, this would send ready status to server
    alert(`Ready status: ${!ready ? 'Ready!' : 'Not ready'}\n\nNote: This is a prototype. P2P networking is not implemented.`);
  };

  const handleLeave = () => {
    localStorage.removeItem('planar_nexus_joined_game');
    router.push('/multiplayer');
  };

  // Step 1: Connect to game (QR code or manual entry)
  if (joinState.step === 'code') {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-md mx-auto">
        <Button variant="ghost" onClick={() => router.push('/multiplayer')} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Join a Game</CardTitle>
            <CardDescription>
              Scan the QR code or enter the connection string from the host
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectionQRCode
              connectionData={null}
              isHost={false}
              onManualEntry={handleConnectionDataEntry}
            />

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground mt-4 text-center">
              Ask your opponent to share their QR code or connection string to connect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Enter player name (after connection established)
  if (joinState.step === 'name') {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-md mx-auto">
        <Button variant="ghost" onClick={() => setJoinState(prev => ({ ...prev, step: 'code' }))} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Connected!</CardTitle>
            <CardDescription>
              Enter your name to join the lobby
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleNameSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="player-name">Your Name</Label>
                <Input
                  id="player-name"
                  placeholder="Enter your name"
                  value={playerNameInput}
                  onChange={(e) => setPlayerNameInput(e.target.value)}
                  maxLength={20}
                />
              </div>

              <Button type="submit" className="w-full" disabled={!playerNameInput.trim()}>
                Join Lobby
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 3: Lobby view
  return (
    <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto">
      <Button variant="ghost" onClick={handleLeave} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Leave Game
      </Button>
      
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
            {joinState.game?.name}
            <Badge variant="secondary">{formatDisplayNames[joinState.game?.format as GameFormat]}</Badge>
          </h1>
          <p className="text-muted-foreground mt-1">
            Waiting for game to start...
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold">{joinState.gameCode}</div>
          <div className="text-xs text-muted-foreground">Game Code</div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Player Info Card */}
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Your Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold">{joinedPlayer?.name}</div>
              <Badge variant={ready ? 'default' : 'secondary'}>
                {ready ? 'Ready' : 'Not Ready'}
              </Badge>
            </div>
            
            <Separator />
            
            {/* Deck Selection */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Info className="w-4 h-4" />
                Select Your Deck
              </Label>
              <DeckSelectorWithValidation
                lobbyFormat={joinState.game?.format as GameFormat}
                onDeckSelect={handleDeckSelect}
                selectedDeckId={selectedDeck?.id}
              />
              
              {deckValidation.errors.length > 0 && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription className="text-xs">
                    {deckValidation.errors[0]}
                  </AlertDescription>
                </Alert>
              )}
            </div>
            
            <Button
              onClick={handleReady}
              className="w-full"
              variant={ready ? 'outline' : 'default'}
            >
              {ready ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Ready
                </>
              ) : (
                'Ready Up'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Game Info */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Game Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Format</div>
                <div className="font-semibold">{formatDisplayNames[joinState.game?.format as GameFormat]}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Players</div>
                <div className="font-semibold">{joinState.game?.currentPlayers} / {joinState.game?.maxPlayers}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  Host
                </div>
                <div className="font-semibold">{joinState.game?.hostName}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  Spectators
                </div>
                <div className="font-semibold">{joinState.game?.allowSpectators ? 'Allowed' : 'Not Allowed'}</div>
              </div>
            </div>
            
            {joinState.game?.settings?.timerEnabled && (
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Turn Timer
                </div>
                <div className="font-semibold">{joinState.game.settings.timerMinutes} minutes</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground mt-6 text-center">
        Note: This is a prototype lobby. P2P networking (WebRTC) is not yet implemented.
        Deck selection is stored locally for demonstration.
      </p>
    </div>
  );
}

function JoinLoading() {
  return (
    <div className="flex-1 p-4 md:p-6 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Join a Game</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-10 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function JoinGamePage() {
  return (
    <Suspense fallback={<JoinLoading />}>
      <JoinGameContent />
    </Suspense>
  );
}
