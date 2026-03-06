/**
 * Client-Side P2P Signaling Service
 * Issue #444: Implement QR code/manual connection handshake for P2P multiplayer
 *
 * This module provides signaling functionality using QR codes and manual code entry,
 * enabling WebRTC connections between players without any external signaling server.
 */

import { P2PConnectionState } from './webrtc-p2p';

/**
 * Connection data that can be encoded in QR code or shared manually
 */
export interface ConnectionData {
  type: 'offer' | 'answer';
  sessionId: string;
  sdp: string; // SDP (Session Description Protocol)
  iceCandidates: RTCIceCandidateInit[];
  timestamp: number;
}

/**
 * Signaling callbacks
 */
export interface ClientSignalingCallbacks {
  onConnectionStateChange: (state: P2PConnectionState) => void;
  onConnectionDataReceived: (data: ConnectionData) => void;
  onError: (error: Error) => void;
}

/**
 * Client-Side Signaling Service
 * Uses QR codes and manual code entry for WebRTC signaling
 */
export class ClientSignalingService {
  private sessionId: string;
  private isHost: boolean;
  private callbacks: ClientSignalingCallbacks;
  private localConnectionData: ConnectionData | null = null;
  private remoteConnectionData: ConnectionData | null = null;
  private iceCandidates: RTCIceCandidateInit[] = [];
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Create a new Client-Side Signaling Service
   */
  constructor(isHost: boolean, callbacks: ClientSignalingCallbacks) {
    this.isHost = isHost;
    this.callbacks = callbacks;
    this.sessionId = this.generateSessionId();
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Create connection data for host (offer)
   */
  async createOfferData(offer: RTCSessionDescriptionInit): Promise<ConnectionData> {
    const connectionData: ConnectionData = {
      type: 'offer',
      sessionId: this.sessionId,
      sdp: JSON.stringify(offer),
      iceCandidates: [],
      timestamp: Date.now(),
    };

    this.localConnectionData = connectionData;
    return connectionData;
  }

  /**
   * Create connection data for client (answer)
   */
  async createAnswerData(answer: RTCSessionDescriptionInit): Promise<ConnectionData> {
    const connectionData: ConnectionData = {
      type: 'answer',
      sessionId: this.sessionId,
      sdp: JSON.stringify(answer),
      iceCandidates: this.iceCandidates,
      timestamp: Date.now(),
    };

    this.localConnectionData = connectionData;
    return connectionData;
  }

  /**
   * Add ICE candidate to connection data
   */
  addIceCandidate(candidate: RTCIceCandidateInit): void {
    this.iceCandidates.push(candidate);
  }

  /**
   * Process received connection data (from QR code or manual entry)
   */
  processConnectionData(data: ConnectionData): void {
    try {
      // Validate data
      if (!this.validateConnectionData(data)) {
        throw new Error('Invalid connection data');
      }

      // Check if data matches expected type
      if (this.isHost && data.type !== 'answer') {
        throw new Error('Host expected answer data');
      }
      if (!this.isHost && data.type !== 'offer') {
        throw new Error('Client expected offer data');
      }

      // Store remote connection data
      this.remoteConnectionData = data;

      // Notify callback
      this.callbacks.onConnectionDataReceived(data);

      // Start connection timeout
      this.startConnectionTimeout();

      console.log('[ClientSignaling] Received connection data:', data.type);
    } catch (error) {
      this.callbacks.onError(error instanceof Error ? error : new Error('Failed to process connection data'));
    }
  }

  /**
   * Validate connection data
   */
  private validateConnectionData(data: unknown): data is ConnectionData {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const connectionData = data as Partial<ConnectionData>;

    return (
      typeof connectionData.type === 'string' &&
      (connectionData.type === 'offer' || connectionData.type === 'answer') &&
      typeof connectionData.sessionId === 'string' &&
      typeof connectionData.sdp === 'string' &&
      Array.isArray(connectionData.iceCandidates) &&
      typeof connectionData.timestamp === 'number'
    );
  }

  /**
   * Get SDP from connection data
   */
  getSDPFromData(data: ConnectionData): RTCSessionDescriptionInit {
    try {
      return JSON.parse(data.sdp) as RTCSessionDescriptionInit;
    } catch (error) {
      throw new Error('Failed to parse SDP data');
    }
  }

  /**
   * Get ICE candidates from remote connection data
   */
  getRemoteICECandidates(): RTCIceCandidateInit[] {
    if (!this.remoteConnectionData) {
      return [];
    }
    return this.remoteConnectionData.iceCandidates;
  }

  /**
   * Get local connection data for sharing (QR code or manual copy)
   */
  getLocalConnectionData(): ConnectionData | null {
    return this.localConnectionData;
  }

  /**
   * Start connection timeout
   */
  private startConnectionTimeout(): void {
    this.clearConnectionTimeout();

    this.connectionTimeout = setTimeout(() => {
      this.callbacks.onError(new Error('Connection timeout'));
      this.callbacks.onConnectionStateChange('failed');
    }, 30000); // 30 second timeout
  }

  /**
   * Clear connection timeout
   */
  clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  /**
   * Get current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if this is host
   */
  getIsHost(): boolean {
    return this.isHost;
  }

  /**
   * Check if connection data is ready
   */
  isConnectionDataReady(): boolean {
    return this.localConnectionData !== null;
  }

  /**
   * Reset the signaling service for reconnection
   */
  reset(): void {
    this.localConnectionData = null;
    this.remoteConnectionData = null;
    this.iceCandidates = [];
    this.clearConnectionTimeout();
    this.sessionId = this.generateSessionId();
  }

  /**
   * Destroy the service and clean up
   */
  destroy(): void {
    this.clearConnectionTimeout();
    this.localConnectionData = null;
    this.remoteConnectionData = null;
    this.iceCandidates = [];
    console.log('[ClientSignaling] Signaling service destroyed');
  }
}

/**
 * Create a host signaling service
 */
export function createHostSignaling(callbacks: ClientSignalingCallbacks): ClientSignalingService {
  return new ClientSignalingService(true, callbacks);
}

/**
 * Create a client signaling service
 */
export function createClientSignaling(callbacks: ClientSignalingCallbacks): ClientSignalingService {
  return new ClientSignalingService(false, callbacks);
}

/**
 * Encode connection data to base64 for QR code encoding
 */
export function encodeConnectionData(data: ConnectionData): string {
  const jsonString = JSON.stringify(data);
  return Buffer.from(jsonString).toString('base64');
}

/**
 * Decode connection data from base64 (from QR code or manual entry)
 */
export function decodeConnectionData(encoded: string): ConnectionData {
  try {
    const jsonString = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(jsonString) as ConnectionData;
  } catch (error) {
    throw new Error('Failed to decode connection data');
  }
}

/**
 * Validate connection data string
 */
export function isValidConnectionDataString(str: string): boolean {
  try {
    const data = decodeConnectionData(str);
    return (
      typeof data.type === 'string' &&
      (data.type === 'offer' || data.type === 'answer') &&
      typeof data.sessionId === 'string' &&
      typeof data.sdp === 'string'
    );
  } catch {
    return false;
  }
}
