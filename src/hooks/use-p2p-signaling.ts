/**
 * React hook for P2P signaling
 * Issue #444: Unit 10: Client-Side Multiplayer Signaling
 *
 * This hook provides a convenient interface for managing P2P signaling
 * with QR code generation and manual code entry.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  P2PSignalingClient,
  createHostSignalingClient,
  createClientSignalingClient,
  ConnectionInfo,
  SignalingData,
  HandshakeStep,
  SignalingEvents,
  parseConnectionInfo,
  serializeSignalingData,
  deserializeSignalingData,
} from '@/lib/p2p-signaling-client';
import type { P2PMessage, P2PConnectionState } from '@/lib/webrtc-p2p';
import { logger } from '@/lib/logger';

const signalingLogger = logger.child('P2PSignaling');

/**
 * Hook state
 */
export interface UseP2PSignalingState {
  /** Current connection state */
  connectionState: P2PConnectionState;
  /** Current handshake step */
  handshakeStep: HandshakeStep;
  /** QR code data URL */
  qrCode: string | null;
  /** Game code */
  gameCode: string;
  /** Connection info for QR code */
  connectionInfo: ConnectionInfo | null;
  /** Last error */
  error: Error | null;
  /** Whether connected */
  isConnected: boolean;
  /** Local offer (for host) */
  localOffer: string | null;
  /** Local answer (for client) */
  localAnswer: string | null;
  /** Remote offer (for client) */
  remoteOffer: string | null;
  /** Remote answer (for host) */
  remoteAnswer: string | null;
}

/**
 * Hook return value
 */
export interface UseP2PSignalingReturn extends UseP2PSignalingState {
  /** Initialize as host */
  initializeAsHost: (playerName: string) => Promise<void>;
  /** Initialize as client */
  initializeAsClient: (playerName: string) => Promise<void>;
  /** Start host connection (create offer) */
  startHostConnection: () => Promise<string>;
  /** Start client connection (handle offer) */
  startClientConnection: (offer: string) => Promise<string>;
  /** Handle answer (host side) */
  handleAnswer: (answer: string) => Promise<void>;
  /** Add ICE candidate */
  addIceCandidate: (candidate: string) => Promise<void>;
  /** Parse and validate connection info */
  parseConnectionInfo: (data: string) => ConnectionInfo | null;
  /** Send message */
  sendMessage: (message: P2PMessage) => void;
  /** Close connection */
  close: () => Promise<void>;
  /** Reset state */
  reset: () => void;
}

/**
 * Hook options
 */
export interface UseP2PSignalingOptions {
  /** Callback when connection is established */
  onConnected?: () => void;
  /** Callback when receiving a message */
  onMessage?: (message: P2PMessage) => void;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
}

/**
 * P2P Signaling Hook
 *
 * @example
 * ```tsx
 * const signaling = useP2PSignaling({
 *   onConnected: () => console.log('Connected!'),
 *   onMessage: (msg) => console.log('Received:', msg),
 * });
 *
 * // Host flow
 * await signaling.initializeAsHost('Player1');
 * const offer = await signaling.startHostConnection();
 * // Share offer with client
 * const answer = await signaling.handleAnswer(clientAnswer);
 *
 * // Client flow
 * await signaling.initializeAsClient('Player2');
 * const answer = await signaling.startClientConnection(hostOffer);
 * // Share answer with host
 * ```
 */
export function useP2PSignaling(
  options: UseP2PSignalingOptions = {}
): UseP2PSignalingReturn {
  const {
    onConnected: onConnectedCallback,
    onMessage: onMessageCallback,
    onError: onErrorCallback,
  } = options;

  // State
  const [connectionState, setConnectionState] = useState<P2PConnectionState>('disconnected');
  const [handshakeStep, setHandshakeStep] = useState<HandshakeStep>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [gameCode, setGameCode] = useState<string>('');
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [localOffer, setLocalOffer] = useState<string | null>(null);
  const [localAnswer, setLocalAnswer] = useState<string | null>(null);
  const [remoteOffer, setRemoteOffer] = useState<string | null>(null);
  const [remoteAnswer, setRemoteAnswer] = useState<string | null>(null);

  // Refs to avoid stale closures
  const signalingClientRef = useRef<P2PSignalingClient | null>(null);
  const callbacksRef = useRef(options);

  // Update refs when options change
  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  // Connection state derived from state
  const isConnected = connectionState === 'connected';

  /**
   * Initialize as host
   */
  const initializeAsHost = useCallback(async (playerName: string) => {
    try {
      setError(null);
      setQrCode(null);
      setLocalOffer(null);
      setLocalAnswer(null);

      // Create signaling client
      const events: SignalingEvents = {
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          if (state === 'connected') {
            callbacksRef.current.onConnected?.();
          }
        },
        onMessage: (message) => {
          callbacksRef.current.onMessage?.(message);
        },
        onConnected: () => {
          callbacksRef.current.onConnected?.();
        },
        onError: (err) => {
          setError(err);
          callbacksRef.current.onError?.(err);
        },
        onHandshakeStepChange: setHandshakeStep,
      };

      const client = createHostSignalingClient(playerName, events);
      await client.initialize();

      signalingClientRef.current = client;
      setGameCode(client.getGameCode());
      setConnectionInfo(client.getConnectionInfo());

      // Generate QR code
      const qrDataUrl = await client.generateQRCode();
      setQrCode(qrDataUrl);

      signalingLogger.debug('Initialized as host:', client.getGameCode());
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize as host');
      setError(error);
      onErrorCallback?.(error);
      throw error;
    }
  }, [onErrorCallback]);

  /**
   * Initialize as client
   */
  const initializeAsClient = useCallback(async (playerName: string) => {
    try {
      setError(null);
      setQrCode(null);
      setLocalOffer(null);
      setLocalAnswer(null);

      // Create signaling client
      const events: SignalingEvents = {
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          if (state === 'connected') {
            callbacksRef.current.onConnected?.();
          }
        },
        onMessage: (message) => {
          callbacksRef.current.onMessage?.(message);
        },
        onConnected: () => {
          callbacksRef.current.onConnected?.();
        },
        onError: (err) => {
          setError(err);
          callbacksRef.current.onError?.(err);
        },
        onHandshakeStepChange: setHandshakeStep,
      };

      const client = createClientSignalingClient(playerName, events);
      await client.initialize();

      signalingClientRef.current = client;
      setGameCode(client.getGameCode());

      signalingLogger.debug('Initialized as client:', client.getGameCode());
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize as client');
      setError(error);
      onErrorCallback?.(error);
      throw error;
    }
  }, [onErrorCallback]);

  /**
   * Start host connection (create offer)
   */
  const startHostConnection = useCallback(async (): Promise<string> => {
    const client = signalingClientRef.current;
    if (!client) {
      throw new Error('Signaling client not initialized');
    }

    try {
      const offer = await client.startHostConnection();
      const serialized = serializeSignalingData({
        type: 'offer',
        data: offer,
        senderCode: gameCode,
      });
      setLocalOffer(serialized);
      return serialized;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start host connection');
      setError(error);
      onErrorCallback?.(error);
      throw error;
    }
  }, [gameCode, onErrorCallback]);

  /**
   * Start client connection (handle offer)
   */
  const startClientConnection = useCallback(
    async (offer: string): Promise<string> => {
      const client = signalingClientRef.current;
      if (!client) {
        throw new Error('Signaling client not initialized');
      }

      try {
        // Deserialize offer
        const signalingData = deserializeSignalingData(offer);
        if (!signalingData || signalingData.type !== 'offer') {
          throw new Error('Invalid offer data');
        }

        setRemoteOffer(offer);

        // Handle offer and create answer
        const answer = await client.startClientConnection(signalingData.data as RTCSessionDescriptionInit);
        const serialized = serializeSignalingData({
          type: 'answer',
          data: answer,
          senderCode: gameCode,
        });
        setLocalAnswer(serialized);
        return serialized;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to start client connection');
        setError(error);
        onErrorCallback?.(error);
        throw error;
      }
    },
    [gameCode, onErrorCallback]
  );

  /**
   * Handle answer (host side)
   */
  const handleAnswer = useCallback(
    async (answer: string): Promise<void> => {
      const client = signalingClientRef.current;
      if (!client) {
        throw new Error('Signaling client not initialized');
      }

      try {
        // Deserialize answer
        const signalingData = deserializeSignalingData(answer);
        if (!signalingData || signalingData.type !== 'answer') {
          throw new Error('Invalid answer data');
        }

        setRemoteAnswer(answer);
        await client.handleAnswer(signalingData.data as RTCSessionDescriptionInit);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to handle answer');
        setError(error);
        onErrorCallback?.(error);
        throw error;
      }
    },
    [onErrorCallback]
  );

  /**
   * Add ICE candidate
   */
  const addIceCandidate = useCallback(
    async (candidate: string): Promise<void> => {
      const client = signalingClientRef.current;
      if (!client) {
        throw new Error('Signaling client not initialized');
      }

      try {
        // Deserialize candidate
        const signalingData = deserializeSignalingData(candidate);
        if (!signalingData || signalingData.type !== 'ice-candidate') {
          throw new Error('Invalid ICE candidate data');
        }

        await client.addIceCandidate(signalingData.data as RTCIceCandidateInit);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to add ICE candidate');
        setError(error);
        onErrorCallback?.(error);
        throw error;
      }
    },
    [onErrorCallback]
  );

  /**
   * Parse and validate connection info
   */
  const parseConnectionInfoCallback = useCallback((data: string): ConnectionInfo | null => {
    return parseConnectionInfo(data);
  }, []);

  /**
   * Send message
   */
  const sendMessage = useCallback(
    (message: P2PMessage): void => {
      const client = signalingClientRef.current;
      if (!client) {
        signalingLogger.warn('Cannot send message: client not initialized');
        return;
      }

      client.sendMessage(message);
    },
    []
  );

  /**
   * Close connection
   */
  const close = useCallback(async (): Promise<void> => {
    const client = signalingClientRef.current;
    if (client) {
      await client.close();
      signalingClientRef.current = null;
    }

    // Reset state
    setConnectionState('disconnected');
    setHandshakeStep('idle');
    setQrCode(null);
    setConnectionInfo(null);
    setLocalOffer(null);
    setLocalAnswer(null);
    setRemoteOffer(null);
    setRemoteAnswer(null);
    setError(null);
  }, []);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setConnectionState('disconnected');
    setHandshakeStep('idle');
    setQrCode(null);
    setConnectionInfo(null);
    setError(null);
    setLocalOffer(null);
    setLocalAnswer(null);
    setRemoteOffer(null);
    setRemoteAnswer(null);
  }, []);

  return {
    connectionState,
    handshakeStep,
    qrCode,
    gameCode,
    connectionInfo,
    error,
    isConnected,
    localOffer,
    localAnswer,
    remoteOffer,
    remoteAnswer,
    initializeAsHost,
    initializeAsClient,
    startHostConnection,
    startClientConnection,
    handleAnswer,
    addIceCandidate,
    parseConnectionInfo: parseConnectionInfoCallback,
    sendMessage,
    close,
    reset,
  };
}
