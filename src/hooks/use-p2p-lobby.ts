/**
 * P2P Lobby Hook
 * Issue #185: Integrates WebRTC P2P signaling with the lobby system
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { P2PSignalingService, createHostSignaling, createClientSignaling } from '@/lib/p2p-signaling';
import { P2PMessage, P2PConnectionState } from '@/lib/webrtc-p2p';
import { GameLobby, Player, HostGameConfig, PlayerStatus } from '@/lib/multiplayer-types';
import { generateGameCode, generatePlayerId } from '@/lib/game-code-generator';
import { lobbyManager } from '@/lib/lobby-manager';

export interface P2PLobbyState {
  lobby: GameLobby | null;
  isHost: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  connectionState: P2PConnectionState;
  error: string | null;
  connectedPeers: string[];
}

/**
 * P2P Lobby Hook
 * Manages P2P multiplayer connections using WebRTC
 */
export function useP2PLobby() {
  const router = useRouter();
  const signalingRef = useRef<P2PSignalingService | null>(null);
  
  // State
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<P2PConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [playerId] = useState(() => generatePlayerId());

  // Get player name from localStorage
  const getPlayerName = useCallback(() => {
    return typeof window !== 'undefined' 
      ? localStorage.getItem('planar_nexus_player_name') || 'Player'
      : 'Player';
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((message: P2PMessage, peerId: string) => {
    console.log('[P2P] Received message:', message.type, 'from:', peerId);
    
    switch (message.type) {
      case 'connection-request':
        // Handle player joining
        const payload = message.payload as { playerName: string; gameCode: string; isHost: boolean };
        
        if (isHost && lobby) {
          // Add player to lobby
          const newPlayer: Player = {
            id: message.senderId,
            name: payload.playerName,
            status: 'not-ready',
            joinedAt: Date.now(),
          };
          
          // Update local lobby state
          setLobby(prev => prev ? {
            ...prev,
            players: [...prev.players, newPlayer],
          } : null);
          
          // Send acceptance
          signalingRef.current?.sendTo(peerId, {
            type: 'connection-accept',
            senderId: playerId,
            timestamp: Date.now(),
            payload: {
              playerName: getPlayerName(),
              playerId,
            },
          });
        }
        break;
        
      case 'connection-accept':
        // Host accepted our connection
        if (!isHost) {
          // We've joined successfully
          console.log('[P2P] Connected to game as', message.payload.playerName);
        }
        break;
        
      case 'game-state-sync':
        // Handle game state sync (for clients receiving state from host)
        console.log('[P2P] Received game state sync');
        break;
        
      case 'player-action':
        // Handle player actions
        console.log('[P2P] Received player action');
        break;
        
      case 'chat':
        // Handle chat messages
        const chatPayload = message.payload as { text: string };
        console.log('[P2P] Chat:', chatPayload.text);
        break;
        
      case 'emote':
        // Handle emotes
        console.log('[P2P] Emote received');
        break;
        
      case 'error':
        // Handle error messages
        const errorPayload = message.payload as { code: string; message: string };
        setError(errorPayload.message);
        break;
    }
  }, [isHost, lobby, playerId, getPlayerName]);

  // Create host lobby
  const createHostLobby = useCallback(async (config: HostGameConfig) => {
    setIsConnecting(true);
    setError(null);
    
    try {
      // Generate game code
      const gameCode = generateGameCode(6);
      const hostName = localStorage.getItem('planar_nexus_player_name') || 'Host';
      
      // Create local lobby
      const newLobby = lobbyManager.createLobby(config, hostName);
      setLobby(newLobby);
      setIsHost(true);
      
      // Initialize signaling as host
      const signaling = createHostSignaling(hostName, {
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          setIsConnected(state === 'connected');
        },
        onMessage: handleMessage,
        onPeerConnected: (peerId) => {
          console.log('[P2P] Peer connected:', peerId);
          setConnectedPeers(prev => [...prev, peerId]);
        },
        onPeerDisconnected: (peerId) => {
          console.log('[P2P] Peer disconnected:', peerId);
          setConnectedPeers(prev => prev.filter(id => id !== peerId));
          
          // Remove player from lobby
          if (lobby) {
            setLobby(prev => prev ? {
              ...prev,
              players: prev.players.filter(p => p.id !== peerId),
            } : null);
          }
        },
        onError: (err) => {
          console.error('[P2P] Error:', err);
          setError(err.message);
        },
      });
      
      signalingRef.current = signaling;
      
      // Initialize with game code
      await signaling.initialize(gameCode);
      
      console.log('[P2P] Host lobby created with code:', gameCode);
      
    } catch (err) {
      console.error('[P2P] Failed to create host lobby:', err);
      setError(err instanceof Error ? err.message : 'Failed to create lobby');
    } finally {
      setIsConnecting(false);
    }
  }, [handleMessage, lobby]);

  // Join a game
  const joinGame = useCallback(async (gameCode: string) => {
    setIsConnecting(true);
    setError(null);
    
    try {
      const playerName = localStorage.getItem('planar_nexus_player_name') || 'Player';
      
      // Initialize signaling as client
      const signaling = createClientSignaling(playerName, {
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          setIsConnected(state === 'connected');
        },
        onMessage: handleMessage,
        onPeerConnected: (peerId) => {
          console.log('[P2P] Connected to host:', peerId);
          setConnectedPeers([peerId]);
        },
        onPeerDisconnected: (peerId) => {
          console.log('[P2P] Disconnected from host:', peerId);
          setConnectedPeers([]);
        },
        onError: (err) => {
          console.error('[P2P] Error:', err);
          setError(err.message);
        },
      });
      
      signalingRef.current = signaling;
      
      // Initialize and connect
      await signaling.initialize();
      await signaling.connectToGame(gameCode);
      
      console.log('[P2P] Joined game:', gameCode);
      setIsHost(false);
      
    } catch (err) {
      console.error('[P2P] Failed to join game:', err);
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsConnecting(false);
    }
  }, [handleMessage]);

  // Leave/disconnect
  const leaveGame = useCallback(() => {
    if (signalingRef.current) {
      signalingRef.current.destroy();
      signalingRef.current = null;
    }
    
    if (lobby && isHost) {
      lobbyManager.closeLobby();
    }
    
    setLobby(null);
    setIsHost(false);
    setIsConnected(false);
    setConnectionState('disconnected');
    setConnectedPeers([]);
    setError(null);
  }, [lobby, isHost]);

  // Send chat message
  const sendChat = useCallback((text: string) => {
    if (!signalingRef.current || !isConnected) return;
    
    signalingRef.current.broadcast({
      type: 'chat',
      senderId: playerId,
      timestamp: Date.now(),
      payload: { text },
    });
  }, [isConnected, playerId]);

  // Send emote
  const sendEmote = useCallback((emote: string) => {
    if (!signalingRef.current || !isConnected) return;
    
    signalingRef.current.broadcast({
      type: 'emote',
      senderId: playerId,
      timestamp: Date.now(),
      payload: { emote },
    });
  }, [isConnected, playerId]);

  // Send player action
  const sendPlayerAction = useCallback((action: string, data: unknown) => {
    if (!signalingRef.current || !isConnected) return;
    
    signalingRef.current.broadcast({
      type: 'player-action',
      senderId: playerId,
      timestamp: Date.now(),
      payload: { action, data },
    });
  }, [isConnected, playerId]);

  // Start game (host only)
  const startGame = useCallback(() => {
    if (!isHost || !lobby) return;
    
    // Notify all peers that game is starting
    signalingRef.current?.broadcast({
      type: 'player-action',
      senderId: playerId,
      timestamp: Date.now(),
      payload: { 
        action: 'start-game', 
        data: { lobby } 
      },
    });
    
    // Navigate to game board
    router.push('/game-board');
  }, [isHost, lobby, playerId, router]);

  // Get game code from signaling
  const getGameCode = useCallback((): string | null => {
    return signalingRef.current?.getGameCode() || lobby?.gameCode || null;
  }, [lobby]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (signalingRef.current) {
        signalingRef.current.destroy();
      }
    };
  }, []);

  return {
    lobby,
    isHost,
    isConnecting,
    isConnected,
    connectionState,
    error,
    connectedPeers,
    playerId,
    createHostLobby,
    joinGame,
    leaveGame,
    sendChat,
    sendEmote,
    sendPlayerAction,
    startGame,
    getGameCode,
  };
}

export default useP2PLobby;
