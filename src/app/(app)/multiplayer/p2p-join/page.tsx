/**
 * P2P Join Page
 * Issue #641: Legal P2P Multiplayer
 *
 * Allows players to join P2P games using QR code scanning or manual code entry
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, QrCode, Type, Users, Play } from 'lucide-react';
import { useP2PSignaling } from '@/hooks/use-p2p-signaling';
import type { P2PMessage } from '@/lib/webrtc-p2p';

export default function P2PJoinPage() {
  const [playerName, setPlayerName] = useState('');
  const [connectionCode, setConnectionCode] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  const signaling = useP2PSignaling({
    onConnected: () => {
      console.log('Connected to host!');
    },
    onMessage: (message: P2PMessage) => {
      console.log('Received message:', message);
    },
    onError: (error) => {
      console.error('Signaling error:', error);
    },
  });

  const handleManualJoin = async () => {
    if (!playerName.trim() || !connectionCode.trim()) {
      return;
    }

    try {
      await signaling.initializeAsClient(playerName);
      const answer = await signaling.startClientConnection(connectionCode);
      console.log('Answer generated, share with host:', answer);
    } catch (error) {
      console.error('Failed to join:', error);
    }
  };

  const handleScanQR = async () => {
    if (!playerName.trim()) {
      return;
    }

    try {
      await signaling.initializeAsClient(playerName);
      // QR scanning would be handled here - for now just show manual entry
      setShowManualEntry(true);
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  };

  const handleStartGame = () => {
    console.log('Starting game...');
    window.location.href = '/game-board';
  };

  // Connected state
  if (signaling.isConnected) {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="font-headline text-3xl font-bold">Connected!</h1>
          <p className="text-muted-foreground mt-1">
            You are now connected with your opponent via P2P.
          </p>
        </header>

        <Card className="text-center py-12">
          <CardContent>
            <div className="text-green-500 text-6xl mb-4">✓</div>
            <h2 className="text-2xl font-bold mb-2">Connection Established</h2>
            <p className="text-muted-foreground mb-6">
              Direct peer-to-peer connection is active.
            </p>

            <div className="space-y-2 mb-6 p-4 bg-muted rounded-lg">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Player:</span>
                <span className="font-medium">{playerName}</span>
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

  return (
    <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
      <Button variant="ghost" onClick={() => window.location.href = '/multiplayer'} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Join P2P Game</h1>
        <p className="text-muted-foreground mt-1">
          Enter your name and the host's connection code to join
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Player Info</CardTitle>
            <CardDescription>Enter your player name</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="player-name">Your Name *</Label>
              <Input
                id="player-name"
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={20}
                disabled={signaling.connectionState === 'connecting'}
              />
            </div>

            <Button
              onClick={handleScanQR}
              disabled={!playerName.trim() || signaling.connectionState === 'connecting'}
              className="w-full"
              size="lg"
            >
              <QrCode className="w-4 h-4 mr-2" />
              {signaling.connectionState === 'connecting' ? 'Connecting...' : 'Scan QR Code'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual Entry</CardTitle>
            <CardDescription>Paste the host's connection code</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connection-code">Connection Code *</Label>
              <Input
                id="connection-code"
                placeholder="Paste host's connection code here..."
                value={connectionCode}
                onChange={(e) => setConnectionCode(e.target.value)}
                disabled={signaling.connectionState === 'connecting'}
              />
            </div>

            <Button
              onClick={handleManualJoin}
              disabled={!playerName.trim() || !connectionCode.trim() || signaling.connectionState === 'connecting'}
              variant={showManualEntry ? 'default' : 'outline'}
              className="w-full"
              size="lg"
            >
              <Type className="w-4 h-4 mr-2" />
              {signaling.connectionState === 'connecting' ? 'Connecting...' : 'Join Game'}
            </Button>

            <div className="text-xs text-muted-foreground text-center">
              Connection codes are shared by the host via QR code, Discord, or any messaging app.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            How to Get a Connection Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">1</div>
            <div>
              <h4 className="font-medium text-sm">Ask your opponent to host a game</h4>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">2</div>
            <div>
              <h4 className="font-medium text-sm">They will generate a connection code</h4>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">3</div>
            <div>
              <h4 className="font-medium text-sm">Share the code with you (scan QR or paste)</h4>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-bold">4</div>
            <div>
              <h4 className="font-medium text-sm">Paste the code above and connect!</h4>
            </div>
          </div>
        </CardContent>
      </Card>

      {signaling.error && (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{signaling.error.message}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-muted-foreground mt-6 text-center">
        Planar Nexus uses direct peer-to-peer connections (WebRTC) for multiplayer.
        No server is required - your data stays between you and your opponent.
      </p>
    </div>
  );
}
