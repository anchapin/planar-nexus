/**
 * @fileOverview Direct P2P Connection Manager
 *
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * This module provides serverless P2P connection establishment using QR codes
 * and manual code entry, eliminating Firebase signaling dependency.
 */

import QRCode from 'qrcode';
import { generateGameCode } from './webrtc-p2p';
import type { WebRTCConnection, P2PConnectionOptions } from './webrtc-p2p';

/**
 * Connection data for QR code encoding
 */
export interface ConnectionData {
  type: 'offer' | 'answer';
  sessionId: string;
  timestamp: number;
  sdp: RTCSessionDescriptionInit;
  gameCode: string;
  hostName: string;
  format: string;
}

/**
 * ICE candidate data for exchange
 */
export interface ICECandidateData {
  type: 'ice-candidate';
  sessionId: string;
  candidate: RTCIceCandidateInit;
}

/**
 * Connection state for direct P2P
 */
export type DirectConnectionState =
  | 'idle'
  | 'generating-offer'
  | 'waiting-for-answer'
  | 'exchanging-ice'
  | 'connected'
  | 'failed';

/**
 * Session manager for tracking P2P connections
 */
class P2PSessionManager {
  private sessions: Map<string, {
    connection: WebRTCConnection;
    state: DirectConnectionState;
    connectionData: ConnectionData;
    iceCandidates: RTCIceCandidateInit[];
    timestamp: number;
  }> = new Map();

  /**
   * Create a new P2P session
   */
  createSession(
    sessionId: string,
    connection: WebRTCConnection,
    connectionData: ConnectionData
  ): void {
    this.sessions.set(sessionId, {
      connection,
      state: 'idle',
      connectionData,
      iceCandidates: [],
      timestamp: Date.now(),
    });
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId: string, state: DirectConnectionState): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = state;
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Add ICE candidate to session
   */
  addICECandidate(sessionId: string, candidate: RTCIceCandidateInit): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.iceCandidates.push(candidate);
      this.sessions.set(sessionId, session);
    }
  }

  /**
   * Get ICE candidates for session
   */
  getICECandidates(sessionId: string): RTCIceCandidateInit[] {
    const session = this.sessions.get(sessionId);
    return session?.iceCandidates || [];
  }

  /**
   * Close and remove session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connection.close();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Clean up old sessions (older than 10 minutes)
   */
  cleanupOldSessions(): void {
    const now = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.timestamp > timeout) {
        session.connection.close();
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Array<{ sessionId: string; state: DirectConnectionState }> {
    return Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      state: session.state,
    }));
  }
}

// Singleton session manager
export const sessionManager = new P2PSessionManager();

// Clean up old sessions every minute
if (typeof window !== 'undefined') {
  setInterval(() => {
    sessionManager.cleanupOldSessions();
  }, 60 * 1000);
}

/**
 * Generate QR code data URL for connection
 */
export async function generateConnectionQRCode(
  connectionData: ConnectionData,
  options?: {
    width?: number;
    margin?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }
): Promise<string> {
  const qrOptions = {
    width: options?.width || 300,
    margin: options?.margin || 2,
    color: options?.color || {
      dark: '#000000',
      light: '#FFFFFF',
    },
  };

  try {
    const dataUrl = await QRCode.toDataURL(JSON.stringify(connectionData), qrOptions);
    return dataUrl;
  } catch (error) {
    console.error('[P2P] Failed to generate QR code:', error);
    throw new Error('Failed to generate connection QR code');
  }
}

/**
 * Parse connection data from QR code or manual entry
 */
export function parseConnectionData(input: string): ConnectionData | null {
  try {
    // Try parsing as JSON first (from QR code)
    const parsed = JSON.parse(input);

    // Validate structure
    if (!parsed.type || !parsed.sessionId || !parsed.sdp || !parsed.gameCode) {
      return null;
    }

    return parsed as ConnectionData;
  } catch (error) {
    console.error('[P2P] Failed to parse connection data:', error);
    return null;
  }
}

/**
 * Parse ICE candidate data
 */
export function parseICECandidateData(input: string): ICECandidateData | null {
  try {
    const parsed = JSON.parse(input);

    if (!parsed.type || !parsed.sessionId || !parsed.candidate) {
      return null;
    }

    return parsed as ICECandidateData;
  } catch (error) {
    console.error('[P2P] Failed to parse ICE candidate:', error);
    return null;
  }
}

/**
 * Create host connection with QR code generation
 */
export async function createHostConnection(
  options: P2PConnectionOptions & {
    onQRCodeGenerated?: (qrDataUrl: string, connectionData: ConnectionData) => void;
    onICECandidate?: (candidate: RTCIceCandidateInit) => void;
  }
): Promise<WebRTCConnection> {
  const { playerId, playerName, onQRCodeGenerated, onICECandidate, ...rtcOptions } = options;

  // Create WebRTC connection
  const connection = new (await import('./webrtc-p2p')).createP2PConnection({
    playerId,
    playerName,
    isHost: true,
    ...rtcOptions,
  });

  // Initialize connection
  await connection.initialize();

  // Generate session ID
  const sessionId = `host-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const gameCode = generateGameCode(6);

  // Create offer
  const offer = await connection.createOffer();

  // Create connection data for QR code
  const connectionData: ConnectionData = {
    type: 'offer',
    sessionId,
    timestamp: Date.now(),
    sdp: offer,
    gameCode,
    hostName: playerName,
    format: rtcOptions.gameCode ? 'unknown' : 'commander',
  };

  // Create session
  sessionManager.createSession(sessionId, connection, connectionData);
  sessionManager.updateSessionState(sessionId, 'waiting-for-answer');

  // Generate QR code
  const qrDataUrl = await generateConnectionQRCode(connectionData);
  onQRCodeGenerated?.(qrDataUrl, connectionData);

  // Set up ICE candidate collection
  const originalHandleICECandidate = connection['handleICECandidate'];
  connection['handleICECandidate'] = (candidate: RTCIceCandidate) => {
    // Add to session
    sessionManager.addICECandidate(sessionId, candidate.toJSON());

    // Notify callback
    onICECandidate?.(candidate.toJSON());

    // Call original handler if needed
    originalHandleICECandidate?.call(connection, candidate);
  };

  console.log('[P2P] Host connection created, waiting for answer...');
  console.log('[P2P] Game code:', gameCode);
  console.log('[P2P] Session ID:', sessionId);

  return connection;
}

/**
 * Create client connection from QR code or manual entry
 */
export async function createClientConnection(
  connectionData: ConnectionData,
  options: P2PConnectionOptions & {
    onAnswerGenerated?: (answer: RTCSessionDescriptionInit) => void;
    onICECandidate?: (candidate: RTCIceCandidateInit) => void;
  }
): Promise<WebRTCConnection> {
  const { playerId, playerName, onAnswerGenerated, onICECandidate, ...rtcOptions } = options;

  // Create WebRTC connection
  const connection = new (await import('./webrtc-p2p')).createP2PConnection({
    playerId,
    playerName,
    isHost: false,
    gameCode: connectionData.gameCode,
    ...rtcOptions,
  });

  // Initialize connection
  await connection.initialize();

  // Create session
  sessionManager.createSession(connectionData.sessionId, connection, connectionData);
  sessionManager.updateSessionState(connectionData.sessionId, 'exchanging-ice');

  // Handle offer
  const answer = await connection.handleOffer(connectionData.sdp);

  // Notify callback
  onAnswerGenerated?.(answer);

  console.log('[P2P] Client connection created, answer generated...');

  return connection;
}

/**
 * Handle ICE candidate exchange
 */
export async function handleICEExchange(
  sessionId: string,
  candidate: RTCIceCandidateInit,
  options: P2PConnectionOptions
): Promise<void> {
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Add candidate to connection
  await session.connection.addIceCandidate(candidate);

  console.log('[P2P] ICE candidate added for session:', sessionId);
}

/**
 * Generate connection string for manual entry
 */
export function generateConnectionString(connectionData: ConnectionData): string {
  return JSON.stringify(connectionData);
}

/**
 * Generate ICE candidate string for manual exchange
 */
export function generateICECandidateString(
  sessionId: string,
  candidate: RTCIceCandidateInit
): string {
  const iceData: ICECandidateData = {
    type: 'ice-candidate',
    sessionId,
    candidate,
  };
  return JSON.stringify(iceData);
}

/**
 * Validate connection data
 */
export function validateConnectionData(data: ConnectionData): boolean {
  // Check required fields
  if (!data.type || !data.sessionId || !data.sdp || !data.gameCode) {
    return false;
  }

  // Check type
  if (data.type !== 'offer' && data.type !== 'answer') {
    return false;
  }

  // Check timestamp (not too old, more than 1 hour)
  const age = Date.now() - data.timestamp;
  if (age > 60 * 60 * 1000) {
    return false;
  }

  return true;
}

/**
 * Get connection state for UI
 */
export function getConnectionState(sessionId: string): DirectConnectionState | null {
  const session = sessionManager.getSession(sessionId);
  return session?.state || null;
}

/**
 * Close all P2P sessions
 */
export function closeAllSessions(): void {
  for (const [sessionId] of sessionManager['sessions'].entries()) {
    sessionManager.closeSession(sessionId);
  }
}

/**
 * Export session data for debugging
 */
export function exportSessionData(): Array<{
  sessionId: string;
  state: DirectConnectionState;
  timestamp: number;
  iceCandidates: number;
}> {
  return Array.from(sessionManager['sessions'].entries()).map(([sessionId, session]) => ({
    sessionId,
    state: session.state,
    timestamp: session.timestamp,
    iceCandidates: session.iceCandidates.length,
  }));
}
