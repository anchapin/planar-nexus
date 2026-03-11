/**
 * React hook for managing P2P game connections
 * Unit 10: Client-Side Multiplayer Signaling
 * 
 * Enhanced with handshake protocol and conflict resolution
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
import {
  HandshakeSession,
  type HandshakeState,
} from '@/lib/p2p-handshake';
import {
  ConflictResolutionManager,
  type TimestampedAction,
} from '@/lib/p2p-conflict-resolution';
import { useConnectionHealth, type ConnectionHealth } from '@/hooks/use-connection-health';

export interface UseP2PConnectionOptions {
  playerId: string;
  playerName: string;
  role: SignalingRole;
  gameCode?: string;
  enableHandshake?: boolean;
  enableConflictResolution?: boolean;
  conflictResolutionStrategy?: 'host-wins' | 'timestamp-based' | 'priority-based' | 'round-robin';
}

export interface UseP2PConnectionReturn {
  connectionState: P2PConnectionState;
  signalingState: LocalSignalingState | null;
  isConnected: boolean;
  error: string | null;
  handshakeState: HandshakeState;
  connectionHealth: ConnectionHealth;
  initializeAsHost: () => Promise<RTCSessionDescriptionInit>;
  initializeAsJoiner: (offer: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit>;
  processAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  processIceCandidates: (candidates: RTCIceCandidateInit[]) => Promise<void>;
  sendGameState: (gameState: GameState, isFullSync?: boolean) => boolean;
  sendGameAction: (action: string, data: unknown) => { success: boolean; action?: TimestampedAction; queued?: boolean };
  sendChat: (text: string) => boolean;
  closeConnection: () => void;
  getConnection: () => P2PGameConnection | null;
  getConflictQueueSize: () => number;
}

export function useP2PConnection(options: UseP2PConnectionOptions): UseP2PConnectionReturn {
  const { 
    playerId, 
    playerName, 
    role, 
    gameCode,
    enableHandshake = true,
    enableConflictResolution = true,
    conflictResolutionStrategy = 'host-wins',
  } = options;

  const [connectionState, setConnectionState] = useState<P2PConnectionState>('disconnected');
  const [signalingState, setSignalingState] = useState<LocalSignalingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handshakeState, setHandshakeState] = useState<HandshakeState>('idle');
  const connectionRef = useRef<P2PGameConnection | null>(null);
  const handshakeSessionRef = useRef<HandshakeSession | null>(null);
  const conflictManagerRef = useRef<ConflictResolutionManager | null>(null);

  // Initialize conflict resolution manager
  useEffect(() => {
    if (enableConflictResolution && !conflictManagerRef.current) {
      conflictManagerRef.current = new ConflictResolutionManager({
        strategy: conflictResolutionStrategy,
        hostId: role === 'host' ? playerId : '',
      });
    }
  }, [enableConflictResolution, conflictResolutionStrategy, role, playerId]);

  // Initialize handshake session when connection is established
  useEffect(() => {
    if (enableHandshake && connectionState === 'connected' && !handshakeSessionRef.current) {
      handshakeSessionRef.current = new HandshakeSession(
        playerId,
        (state) => setHandshakeState(state),
        (success, errorReason) => {
          if (!success) {
            setError(`Handshake failed: ${errorReason}`);
          }
        }
      );
    }
  }, [enableHandshake, connectionState, playerId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        connectionRef.current.close();
      }
      if (handshakeSessionRef.current) {
        handshakeSessionRef.current.cleanup();
      }
      if (conflictManagerRef.current) {
        conflictManagerRef.current.reset();
      }
    };
  }, []);

  // Connection health monitoring
  const connectionHealth = useConnectionHealth({
    getConnectionState: () => connectionState,
    getReconnectAttempts: () => {
      const conn = connectionRef.current as any;
      return conn?.['reconnectAttempts'] || 0;
    },
    getMaxReconnectAttempts: () => {
      const conn = connectionRef.current as any;
      return conn?.['maxReconnectAttempts'] || 3;
    },
    enableMonitoring: true,
  });

  // Initialize connection as host
  const initializeAsHost = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    try {
      setError(null);
      setHandshakeState('idle');

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
            
            // Handle handshake messages if enabled
            if (enableHandshake && handshakeSessionRef.current) {
              // Handshake message handling would go here
              // For now, we just log them
            }
          },
          onGameStateSync: (gameState) => {
            console.log('[useP2PConnection] Received game state sync');
            
            // Verify checksum if handshake completed
            if (handshakeState === 'completed' && handshakeSessionRef.current) {
              const remoteChecksum = handshakeSessionRef.current.getRemoteChecksum();
              if (remoteChecksum) {
                const isValid = verifyChecksum(gameState, remoteChecksum);
                if (!isValid) {
                  console.warn('[useP2PConnection] State checksum mismatch!');
                }
              }
            }
          },
          onChat: (chatMessage) => {
            console.log('[useP2PConnection] Received chat:', chatMessage.text);
          },
          onError: (err) => {
            setError(err.message);
          },
          onPlayerJoined: (playerId, playerName) => {
            console.log('[useP2PConnection] Player joined:', playerName);
            
            // Start handshake with new player
            if (enableHandshake && handshakeSessionRef.current) {
              const initMessage = handshakeSessionRef.current.start(playerId);
              // Send init message to peer
              connectionRef.current?.sendGameAction('handshake-init', initMessage);
            }
          },
          onPlayerLeft: (playerId) => {
            console.log('[useP2PConnection] Player left:', playerId);
            
            // Cleanup handshake
            if (handshakeSessionRef.current) {
              handshakeSessionRef.current.cleanup();
              setHandshakeState('idle');
            }
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
  }, [playerId, playerName, role, gameCode, enableHandshake, handshakeState]);

  // Initialize connection as joiner
  const initializeAsJoiner = useCallback(
    async (offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> => {
      try {
        setError(null);
        setHandshakeState('idle');

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
              
              // Cleanup handshake
              if (handshakeSessionRef.current) {
                handshakeSessionRef.current.cleanup();
                setHandshakeState('idle');
              }
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

  // Send game action with conflict resolution
  const sendGameAction = useCallback((action: string, data: unknown): { success: boolean; action?: TimestampedAction; queued?: boolean } => {
    if (!connectionRef.current) {
      return { success: false };
    }

    // Apply conflict resolution if enabled
    if (enableConflictResolution && conflictManagerRef.current) {
      const result = conflictManagerRef.current.processAction(
        action,
        data,
        playerId,
        playerName
      );

      if (result.shouldQueue) {
        return { 
          success: false, 
          action: result.action,
          queued: true 
        };
      }

      if (result.shouldProcess && result.action) {
        const success = connectionRef.current.sendGameAction(action, data);
        return { 
          success, 
          action: result.action,
          queued: false 
        };
      }
    }

    // No conflict resolution, send directly
    const success = connectionRef.current.sendGameAction(action, data);
    return { success };
  }, [playerId, playerName, enableConflictResolution]);

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
    if (handshakeSessionRef.current) {
      handshakeSessionRef.current.cleanup();
    }
    setConnectionState('disconnected');
    setSignalingState(null);
    setHandshakeState('idle');
    setError(null);
  }, []);

  // Get connection instance
  const getConnection = useCallback(() => {
    return connectionRef.current;
  }, []);

  // Get conflict queue size
  const getConflictQueueSize = useCallback(() => {
    if (!conflictManagerRef.current) {
      return 0;
    }
    return conflictManagerRef.current.getQueueSize();
  }, []);

  return {
    connectionState,
    signalingState,
    isConnected: connectionState === 'connected',
    error,
    handshakeState,
    connectionHealth,
    initializeAsHost,
    initializeAsJoiner,
    processAnswer,
    processIceCandidates,
    sendGameState,
    sendGameAction,
    sendChat,
    closeConnection,
    getConnection,
    getConflictQueueSize,
  };
}

// Import handshake verification for use in the hook
function verifyChecksum(gameState: GameState, checksum: string): boolean {
  // Simple checksum verification - in production use the full implementation
  const data = JSON.stringify(gameState);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const computedChecksum = (hash >>> 0).toString(16);
  return computedChecksum === checksum;
}
