/**
 * React hook for managing P2P game connections
 * Unit 10: Client-Side Multiplayer Signaling
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState } from '@/lib/game-state/types';
import {
  createP2PGameConnection,
  P2PGameConnection,
  type P2PGameConnectionEvents,
  type P2PConnectionState,
  type ChatMessage,
  type SignalingRole,
} from '@/lib/p2p-game-connection';
import type { LocalSignalingState } from '@/lib/local-signaling-client';
import type { RTCSessionDescriptionInit, RTCIceCandidateInit } from '@/lib/webrtc-types';

export interface UseP2PConnectionOptions {
  playerId: string;
  playerName: string;
  role: SignalingRole;
  gameCode?: string;
}

export interface UseP2PConnectionReturn {
  connectionState: P2PConnectionState;
  signalingState: LocalSignalingState | null;
  isConnected: boolean;
  error: string | null;
  initializeAsHost: () => Promise<RTCSessionDescriptionInit>;
  initializeAsJoiner: (offer: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit>;
  processAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  processIceCandidates: (candidates: RTCIceCandidateInit[]) => Promise<void>;
  sendGameState: (gameState: GameState, isFullSync?: boolean) => boolean;
  sendGameAction: (action: string, data: unknown) => boolean;
  sendChat: (text: string) => boolean;
  closeConnection: () => void;
  getConnection: () => P2PGameConnection | null;
}

export function useP2PConnection(options: UseP2PConnectionOptions): UseP2PConnectionReturn {
  const { playerId, playerName, role, gameCode } = options;

  const [connectionState, setConnectionState] = useState<P2PConnectionState>('disconnected');
  const [signalingState, setSignalingState] = useState<LocalSignalingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionRef = useRef<P2PGameConnection | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.close();
      }
    };
  }, []);

  // Initialize connection as host
  const initializeAsHost = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    try {
      setError(null);

      if (connectionRef.current) {
        connectionRef.current.close();
      }

      // Create connection with event handlers
      const connection = createP2PGameConnection({
        playerId,
        playerName,
        role,
        gameCode,
        events: {
          onConnectionStateChange: setConnectionState,
          onSignalingStateChange: setSignalingState,
          onMessage: (message) => {
            console.log('[useP2PConnection] Received message:', message.type);
          },
          onGameStateSync: (gameState) => {
            console.log('[useP2PConnection] Received game state sync');
          },
          onChat: (chatMessage) => {
            console.log('[useP2PConnection] Received chat:', chatMessage.text);
          },
          onError: (err) => {
            setError(err.message);
          },
          onPlayerJoined: (playerId, playerName) => {
            console.log('[useP2PConnection] Player joined:', playerName);
          },
          onPlayerLeft: (playerId) => {
            console.log('[useP2PConnection] Player left:', playerId);
          },
        },
      });

      connectionRef.current = connection;

      // Initialize as host
      await connection.initializeAsHost();

      // Get initial signaling state
      const signalingState = connection.getSignalingState();
      setSignalingState(signalingState);

      return signalingState.localOffer || ({} as RTCSessionDescriptionInit);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize host';
      setError(errorMessage);
      throw err;
    }
  }, [playerId, playerName, role, gameCode]);

  // Initialize connection as joiner
  const initializeAsJoiner = useCallback(
    async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
      try {
        setError(null);

        if (connectionRef.current) {
          connectionRef.current.close();
        }

        // Create connection with event handlers
        const connection = createP2PGameConnection({
          playerId,
          playerName,
          role,
          gameCode,
          events: {
            onConnectionStateChange: setConnectionState,
            onSignalingStateChange: setSignalingState,
            onMessage: (message) => {
              console.log('[useP2PConnection] Received message:', message.type);
            },
            onGameStateSync: (gameState) => {
              console.log('[useP2PConnection] Received game state sync');
            },
            onChat: (chatMessage) => {
              console.log('[useP2PConnection] Received chat:', chatMessage.text);
            },
            onError: (err) => {
              setError(err.message);
            },
            onPlayerJoined: (playerId, playerName) => {
              console.log('[useP2PConnection] Player joined:', playerName);
            },
            onPlayerLeft: (playerId) => {
              console.log('[useP2PConnection] Player left:', playerId);
            },
          },
        });

        connectionRef.current = connection;

        // Initialize as joiner
        await connection.initializeAsJoiner(offer);

        // Get initial signaling state
        const signalingState = connection.getSignalingState();
        setSignalingState(signalingState);

        return signalingState.localAnswer || ({} as RTCSessionDescriptionInit);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize joiner';
        setError(errorMessage);
        throw err;
      }
    },
    [playerId, playerName, role, gameCode]
  );

  // Process answer (host only)
  const processAnswer = useCallback(async (answer: RTCSessionDescriptionInit): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error('No active connection');
    }

    try {
      setError(null);
      await connectionRef.current.processAnswer(answer);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process answer';
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Process ICE candidates
  const processIceCandidates = useCallback(async (candidates: RTCIceCandidateInit[]): Promise<void> => {
    if (!connectionRef.current) {
      throw new Error('No active connection');
    }

    try {
      setError(null);
      await connectionRef.current.processIceCandidates(candidates);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to process ICE candidates';
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Send game state
  const sendGameState = useCallback(
    (gameState: GameState, isFullSync: boolean = false): boolean => {
      if (!connectionRef.current) {
        return false;
      }

      return connectionRef.current.sendGameState(gameState, isFullSync);
    },
    []
  );

  // Send game action
  const sendGameAction = useCallback((action: string, data: unknown): boolean => {
    if (!connectionRef.current) {
      return false;
    }

    return connectionRef.current.sendGameAction(action, data);
  }, []);

  // Send chat
  const sendChat = useCallback((text: string): boolean => {
    if (!connectionRef.current) {
      return false;
    }

    return connectionRef.current.sendChat(text);
  }, []);

  // Close connection
  const closeConnection = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
    }
    setConnectionState('disconnected');
    setSignalingState(null);
    setError(null);
  }, []);

  // Get connection instance
  const getConnection = useCallback(() => {
    return connectionRef.current;
  }, []);

  return {
    connectionState,
    signalingState,
    isConnected: connectionState === 'connected',
    error,
    initializeAsHost,
    initializeAsJoiner,
    processAnswer,
    processIceCandidates,
    sendGameState,
    sendGameAction,
    sendChat,
    closeConnection,
    getConnection,
  };
}
