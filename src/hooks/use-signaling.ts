/**
 * useSignaling Hook
 * Issue #285: Implement signaling server for WebRTC handshake
 * 
 * React hook for managing WebRTC signaling through the signaling server.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SignalingClient,
  SignalingSessionInfo,
  SignalingClientOptions,
  createSignalingClient,
} from '@/lib/signaling-client';

/**
 * Connection state for the signaling process
 */
export type SignalingState = 
  | 'idle'
  | 'creating-session'
  | 'joining-session'
  | 'waiting-for-peer'
  | 'exchanging-signaling'
  | 'connected'
  | 'failed';

/**
 * Hook return type
 */
export interface UseSignalingReturn {
  /** Current signaling state */
  state: SignalingState;
  /** Current session info */
  session: SignalingSessionInfo | null;
  /** Game code for sharing */
  gameCode: string | null;
  /** Error if any */
  error: Error | null;
  /** Create a new session as host */
  createSession: (playerId: string, playerName: string) => Promise<void>;
  /** Join an existing session */
  joinSession: (gameCode: string, playerId: string, playerName: string) => Promise<void>;
  /** Get WebRTC offer from host */
  getOffer: () => RTCSessionDescriptionInit | null;
  /** Get WebRTC answer from client */
  getAnswer: () => RTCSessionDescriptionInit | null;
  /** Get ICE candidates for the peer */
  getPeerCandidates: () => RTCIceCandidateInit[];
  /** Send offer (host) */
  sendOffer: (offer: RTCSessionDescriptionInit) => Promise<void>;
  /** Send answer (client) */
  sendAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  /** Send ICE candidate */
  sendIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>;
  /** Close the session */
  closeSession: () => Promise<void>;
  /** Check if this is the host */
  isHost: boolean;
}

/**
 * Hook options
 */
export interface UseSignalingOptions extends SignalingClientOptions {
  /** Auto-connect on mount */
  autoCreateSession?: boolean;
  /** Player ID for auto-create */
  playerId?: string;
  /** Player name for auto-create */
  playerName?: string;
}

/**
 * React hook for managing WebRTC signaling
 */
export function useSignaling(options: UseSignalingOptions = {}): UseSignalingReturn {
  const [state, setState] = useState<SignalingState>('idle');
  const [session, setSession] = useState<SignalingSessionInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<SignalingClient | null>(null);

  // Create client on mount
  useEffect(() => {
    clientRef.current = createSignalingClient({
      ...options,
      onSessionUpdate: (updatedSession) => {
        setSession(updatedSession);
        
        // Update state based on session
        if (updatedSession.answer && clientRef.current?.getIsHost()) {
          setState('connected');
        } else if (updatedSession.clientId && clientRef.current?.getIsHost()) {
          setState('exchanging-signaling');
        } else if (updatedSession.offer && !clientRef.current?.getIsHost()) {
          setState('exchanging-signaling');
        }
      },
      onError: (err) => {
        setError(err);
        setState('failed');
      },
    });

    return () => {
      clientRef.current?.destroy();
    };
  }, [options]);

  // Auto-create session if requested
  useEffect(() => {
    if (options.autoCreateSession && options.playerId && options.playerName && clientRef.current) {
      createSession(options.playerId, options.playerName);
    }
  }, [options.autoCreateSession, options.playerId, options.playerName]);

  /**
   * Create a new session as host
   */
  const createSession = useCallback(async (playerId: string, playerName: string) => {
    if (!clientRef.current) return;

    setState('creating-session');
    setError(null);

    try {
      const newSession = await clientRef.current.createSession(playerId, playerName);
      setSession(newSession);
      setState('waiting-for-peer');
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState('failed');
    }
  }, [options]);

  /**
   * Join an existing session
   */
  const joinSession = useCallback(async (gameCode: string, playerId: string, playerName: string) => {
    if (!clientRef.current) return;

    setState('joining-session');
    setError(null);

    try {
      const existingSession = await clientRef.current.joinSession(gameCode, playerId, playerName);
      setSession(existingSession);
      setState(existingSession.offer ? 'exchanging-signaling' : 'waiting-for-peer');
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setState('failed');
    }
  }, [options]);

  /**
   * Get the WebRTC offer (for client)
   */
  const getOffer = useCallback((): RTCSessionDescriptionInit | null => {
    return session?.offer || null;
  }, [session]);

  /**
   * Get the WebRTC answer (for host)
   */
  const getAnswer = useCallback((): RTCSessionDescriptionInit | null => {
    return session?.answer || null;
  }, [session]);

  /**
   * Get ICE candidates for the peer
   */
  const getPeerCandidates = useCallback((): RTCIceCandidateInit[] => {
    if (!session) return [];
    
    // Host gets client candidates, client gets host candidates
    return clientRef.current?.getIsHost() 
      ? (session.clientCandidates || [])
      : (session.hostCandidates || []);
  }, [session]);

  /**
   * Send offer (host)
   */
  const sendOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    if (!clientRef.current) return;
    await clientRef.current.sendOffer(offer);
  }, [options]);

  /**
   * Send answer (client)
   */
  const sendAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!clientRef.current) return;
    await clientRef.current.sendAnswer(answer);
  }, [options]);

  /**
   * Send ICE candidate
   */
  const sendIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!clientRef.current) return;
    await clientRef.current.sendIceCandidate(candidate);
  }, [options]);

  /**
   * Close the session
   */
  const closeSession = useCallback(async () => {
    if (!clientRef.current) return;
    await clientRef.current.closeSession();
    setSession(null);
    setState('idle');
  }, [options]);

  return {
    state,
    session,
    gameCode: session?.gameCode || null,
    error,
    createSession,
    joinSession,
    getOffer,
    getAnswer,
    getPeerCandidates,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    closeSession,
    isHost: clientRef.current?.getIsHost() || false,
  };
}

export default useSignaling;