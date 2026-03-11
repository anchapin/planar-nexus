/**
 * P2P Host Page
 * Issue #444: Unit 10: Client-Side Multiplayer Signaling
 *
 * Allows players to host a P2P game using QR code and manual signaling
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Crown, Clock, Eye, Users, Play } from 'lucide-react';
import { useP2PSignaling } from '@/hooks/use-p2p-signaling';
import { SignalingExchange } from '@/components/signaling-exchange';
import { QRCodeDisplay } from '@/components/qr-code-display';
import type { P2PMessage } from '@/lib/webrtc-p2p';

interface HostState {
  step: 'setup' | 'signaling' | 'connected';
  playerName: string;
  gameName: string;
  gameFormat: 'commander' | 'modern' | 'standard' | 'pioneer' | 'legacy' | 'vintage' | 'pauper';
  allowSpectators: boolean;
  timerEnabled: boolean;
  timerMinutes: number;
}

export default function P2PHostPage() {
  const [hostState, setHostState] = useState<HostState>({
    step: 'setup',
    playerName: '',
    gameName: '',
    gameFormat: 'commander',
    allowSpectators: true,
    timerEnabled: false,
    timerMinutes: 30,
  });

  const signaling = useP2PSignaling({
    onConnected: () => {
      setHostState(prev => ({ ...prev, step: 'connected' }));
    },
    onMessage: (message: P2PMessage) => {
      console.log('Received message:', message);
      // Handle incoming messages
    },
    onError: (error) => {
      console.error('Signaling error:', error);
    },
  });

  const formatDisplayNames: Record<string, string> = {
    commander: 'Commander',
    modern: 'Modern',
    standard: 'Standard',
    pioneer: 'Pioneer',
    legacy: 'Legacy',
    vintage: 'Vintage',
    pauper: 'Pauper',
  };

  const handleSetupComplete = async () => {
    try {
      setHostState(prev => ({ ...prev, step: 'signaling' }));
      await signaling.initializeAsHost(hostState.playerName);
      // Auto-generate offer after initialization
      await signaling.startHostConnection();
    } catch (error) {
      console.error('Failed to initialize host:', error);
    }
  };

  const handleReceiveAnswer = async (answer: string) => {
    try {
      await signaling.handleAnswer(answer);
    } catch (error) {
      console.error('Failed to handle answer:', error);
    }
  };

  const handleStartGame = () => {
    console.log('Starting game...');
    // Navigate to game board or start game logic
    window.location.href = '/game-board';
  };

  // Setup Step
  if (hostState.step === 'setup') {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
        <Button variant="ghost" onClick={() => window.location.href = '/multiplayer'} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <header className="mb-6">
          <h1 className="font-headline text-3xl font-bold">Host P2P Game</h1>
          <p className="text-muted-foreground mt-1">
            Create a peer-to-peer game and share the connection code with your opponent
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Lobby Settings</CardTitle>
            <CardDescription>Configure your game lobby</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Player Name */}
            <div className="space-y-2">
              <Label htmlFor="player-name">Your Name *</Label>
              <Input
                id="player-name"
                placeholder="Enter your name"
                value={hostState.playerName}
                onChange={(e) => setHostState(prev => ({ ...prev, playerName: e.target.value }))}
                maxLength={20}
              />
            </div>

            {/* Game Name */}
            <div className="space-y-2">
              <Label htmlFor="game-name">Game Name *</Label>
              <Input
                id="game-name"
                placeholder="e.g., Friday Night Commander"
                value={hostState.gameName}
                onChange={(e) => setHostState(prev => ({ ...prev, gameName: e.target.value }))}
              />
            </div>

            {/* Game Format */}
            <div className="space-y-2">
              <Label htmlFor="format">Format *</Label>
              <Select
                value={hostState.gameFormat}
                onValueChange={(value: typeof hostState.gameFormat) =>
                  setHostState(prev => ({ ...prev, gameFormat: value }))
                }
              >
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

            <Separator />

            {/* Additional Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Allow Spectators</Label>
                  <p className="text-xs text-muted-foreground">
                    Let others watch your game
                  </p>
                </div>
                <Switch
                  checked={hostState.allowSpectators}
                  onCheckedChange={(checked) => setHostState(prev => ({ ...prev, allowSpectators: checked }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Timer</Label>
                  <p className="text-xs text-muted-foreground">
                    Add a turn timer for competitive play
                  </p>
                </div>
                <Switch
                  checked={hostState.timerEnabled}
                  onCheckedChange={(checked) => setHostState(prev => ({ ...prev, timerEnabled: checked }))}
                />
              </div>

              {hostState.timerEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="timer-minutes">Turn Timer (minutes)</Label>
                  <Input
                    id="timer-minutes"
                    type="number"
                    min={1}
                    max={60}
                    value={hostState.timerMinutes}
                    onChange={(e) =>
                      setHostState(prev => ({ ...prev, timerMinutes: parseInt(e.target.value) || 30 }))
                    }
                  />
                </div>
              )}
            </div>

            {signaling.error && (
              <Alert variant="destructive">
                <AlertDescription>{signaling.error.message}</AlertDescription>
              </Alert>
            )}

            <Button
              onClick={handleSetupComplete}
              disabled={!hostState.playerName.trim() || !hostState.gameName.trim() || signaling.connectionState === 'connecting'}
              className="w-full"
              size="lg"
            >
              {signaling.connectionState === 'connecting' ? 'Creating...' : 'Create Lobby'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Signaling Step
  if (hostState.step === 'signaling') {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => {
            signaling.reset();
            setHostState(prev => ({ ...prev, step: 'setup' }));
          }}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
                {hostState.gameName}
                <Badge variant="secondary">{formatDisplayNames[hostState.gameFormat]}</Badge>
              </h1>
              <p className="text-muted-foreground mt-1">
                Waiting for opponent to connect...
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-yellow-500" />
              <span className="text-sm font-medium">Host</span>
            </div>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* QR Code */}
          {signaling.qrCode && (
            <QRCodeDisplay
              qrCode={signaling.qrCode}
              gameCode={signaling.gameCode}
              connectionInfo={{
                hostName: hostState.playerName,
                timestamp: Date.now(),
              }}
            />
          )}

          {/* Signaling Exchange */}
          <SignalingExchange
            mode="host"
            step={signaling.handshakeStep}
            localData={signaling.localOffer}
            onReceiveData={handleReceiveAnswer}
            onGenerateData={signaling.startHostConnection}
          />
        </div>

        {/* Game Info */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Game Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Format</div>
                <div className="font-semibold">{formatDisplayNames[hostState.gameFormat]}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  Host
                </div>
                <div className="font-semibold">{hostState.playerName}</div>
              </div>
              {hostState.timerEnabled && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Timer
                  </div>
                  <div className="font-semibold">{hostState.timerMinutes} min turns</div>
                </div>
              )}
              {hostState.allowSpectators && (
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Spectators
                  </div>
                  <div className="font-semibold">Allowed</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground mt-6 text-center">
          Share the QR code or offer data with your opponent to establish a P2P connection.
        </p>
      </div>
    );
  }

  // Connected Step
  if (hostState.step === 'connected') {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="font-headline text-3xl font-bold">Connected!</h1>
          <p className="text-muted-foreground mt-1">
            Your opponent has connected. Ready to play!
          </p>
        </header>

        <Card className="text-center py-12">
          <CardContent>
            <div className="text-green-500 text-6xl mb-4">✓</div>
            <h2 className="text-2xl font-bold mb-2">Connection Established</h2>
            <p className="text-muted-foreground mb-6">
              You are now connected with your opponent via P2P.
            </p>

            <div className="space-y-2 mb-6 p-4 bg-muted rounded-lg">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Game:</span>
                <span className="font-medium">{hostState.gameName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Format:</span>
                <span className="font-medium">{formatDisplayNames[hostState.gameFormat]}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connection:</span>
                <span className="font-medium text-green-600">Active</span>
              </div>
            </div>

            <Button onClick={handleStartGame} size="lg" className="w-full max-w-md">
              <Play className="w-4 h-4 mr-2" />
              Start Game
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
