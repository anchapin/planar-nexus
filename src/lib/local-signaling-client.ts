/**
 * Local Signaling Client
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Provides client-side signaling for WebRTC connections without server dependencies.
 * Players can manually exchange connection information (offer/answer/ICE candidates)
 * via QR code, copy-paste, or other out-of-band methods.
 */

import type { RTCSessionDescriptionInit, RTCIceCandidateInit } from 'react-native-webrtc';

/**
 * Connection phase in the signaling process
 */
export type ConnectionPhase =
  | 'idle'
  | 'creating-offer'
  | 'waiting-for-answer'
  | 'creating-answer'
  | 'exchanging-ice'
  | 'connecting'
  | 'connected'
  | 'failed';

/**
 * Signaling role (host or joiner)
 */
export type SignalingRole = 'host' | 'joiner';

/**
 * Local signaling state
 */
export interface LocalSignalingState {
  phase: ConnectionPhase;
  role: SignalingRole;
  localOffer?: RTCSessionDescriptionInit;
  remoteOffer?: RTCSessionDescriptionInit;
  localAnswer?: RTCSessionDescriptionInit;
  remoteAnswer?: RTCSessionDescriptionInit;
  localIceCandidates: RTCIceCandidateInit[];
  remoteIceCandidates: RTCIceCandidateInit[];
  gameCode?: string;
  error?: string;
}

/**
 * Local signaling events
 */
export interface LocalSignalingEvents {
  onStateChange: (state: LocalSignalingState) => void;
  onError: (error: Error) => void;
  onConnected: () => void;
  onOfferCreated: (offer: RTCSessionDescriptionInit) => void;
  onAnswerCreated: (answer: RTCSessionDescriptionInit) => void;
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
}

/**
 * Local Signaling Client options
 */
export interface LocalSignalingClientOptions {
  role: SignalingRole;
  gameCode?: string;
  events?: Partial<LocalSignalingEvents>;
}

/**
 * Local Signaling Client
 *
 * Manages WebRTC signaling without a server by allowing manual exchange
 * of connection information between players.
 */
export class LocalSignalingClient {
  private state: LocalSignalingState;
  private events: LocalSignalingEvents;
  private peerConnection: RTCPeerConnection | null = null;

  constructor(options: LocalSignalingClientOptions) {
    this.state = {
      phase: 'idle',
      role: options.role,
      localIceCandidates: [],
      remoteIceCandidates: [],
      gameCode: options.gameCode,
    };

    // Set default event handlers
    const defaultEvents: LocalSignalingEvents = {
      onStateChange: () => {},
      onError: () => {},
      onConnected: () => {},
      onOfferCreated: () => {},
      onAnswerCreated: () => {},
      onIceCandidate: () => {},
    };

    this.events = options.events ? { ...defaultEvents, ...options.events } : defaultEvents;
  }

  /**
   * Get current state
   */
  getState(): LocalSignalingState {
    return { ...this.state };
  }

  /**
   * Initialize the connection process as host
   */
  async initializeAsHost(peerConnection: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
    if (this.state.role !== 'host') {
      throw new Error('Cannot initialize as host when role is joiner');
    }

    this.peerConnection = peerConnection;
    this.updatePhase('creating-offer');

    try {
      // Create offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      this.state.localOffer = offer;
      this.updatePhase('waiting-for-answer');

      this.events.onOfferCreated(offer);
      return offer;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to create offer'));
      throw error;
    }
  }

  /**
   * Initialize the connection process as joiner
   */
  async initializeAsJoiner(
    peerConnection: RTCPeerConnection,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    if (this.state.role !== 'joiner') {
      throw new Error('Cannot initialize as joiner when role is host');
    }

    this.peerConnection = peerConnection;
    this.state.remoteOffer = offer;
    this.updatePhase('creating-answer');

    try {
      // Set remote offer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      // Create answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.state.localAnswer = answer;
      this.updatePhase('exchanging-ice');

      this.events.onAnswerCreated(answer);
      return answer;
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to create answer'));
      throw error;
    }
  }

  /**
   * Handle an answer received by the host
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (this.state.role !== 'host') {
      throw new Error('Only host can handle answer');
    }

    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      this.state.remoteAnswer = answer;
      this.updatePhase('exchanging-ice');
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to handle answer'));
      throw error;
    }
  }

  /**
   * Add a local ICE candidate
   */
  addLocalIceCandidate(candidate: RTCIceCandidateInit): void {
    this.state.localIceCandidates.push(candidate);
    this.events.onIceCandidate(candidate);
  }

  /**
   * Add a remote ICE candidate
   */
  async addRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      // Queue candidates for later
      this.state.remoteIceCandidates.push(candidate);
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      this.state.remoteIceCandidates.push(candidate);
    } catch (error) {
      console.error('[LocalSignalingClient] Failed to add ICE candidate:', error);
      // Don't throw - some candidates may fail silently
    }
  }

  /**
   * Set multiple remote ICE candidates at once
   */
  async addRemoteIceCandidates(candidates: RTCIceCandidateInit[]): Promise<void> {
    for (const candidate of candidates) {
      await this.addRemoteIceCandidate(candidate);
    }
  }

  /**
   * Get connection string for sharing
   * This can be encoded as a QR code or copied to clipboard
   */
  getConnectionString(): string {
    const data = {
      type: this.state.role === 'host' ? 'offer' : 'answer',
      phase: this.state.phase,
      offer: this.state.localOffer,
      answer: this.state.localAnswer,
      ice: this.state.localIceCandidates,
    };

    return JSON.stringify(data);
  }

  /**
   * Parse a connection string received from the other player
   */
  static parseConnectionString(connectionString: string): {
    type: 'offer' | 'answer';
    phase: ConnectionPhase;
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    ice: RTCIceCandidateInit[];
  } | null {
    try {
      return JSON.parse(connectionString);
    } catch {
      return null;
    }
  }

  /**
   * Generate a short game code for manual sharing
   */
  static generateGameCode(length: number = 6): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing characters
    let code = '';

    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
  }

  /**
   * Mark connection as successful
   */
  markConnected(): void {
    this.updatePhase('connected');
    this.events.onConnected();
  }

  /**
   * Reset the client for a new connection
   */
  reset(): void {
    this.state = {
      phase: 'idle',
      role: this.state.role,
      localIceCandidates: [],
      remoteIceCandidates: [],
      gameCode: this.state.gameCode,
    };
    this.events.onStateChange(this.state);
  }

  /**
   * Update connection phase and notify listeners
   */
  private updatePhase(phase: ConnectionPhase): void {
    this.state.phase = phase;
    this.events.onStateChange(this.state);
  }

  /**
   * Handle an error
   */
  private handleError(error: Error): void {
    this.state.phase = 'failed';
    this.state.error = error.message;
    this.events.onStateChange(this.state);
    this.events.onError(error);
  }
}

/**
 * Create a local signaling client
 */
export function createLocalSignalingClient(
  options: LocalSignalingClientOptions
): LocalSignalingClient {
  return new LocalSignalingClient(options);
}

/**
 * Signaling Data Transfer Format
 * This is used for sharing connection information
 */
export interface SignalingDataTransfer {
  version: string;
  type: 'offer' | 'answer' | 'ice-candidates';
  data: RTCSessionDescriptionInit | RTCIceCandidateInit | RTCIceCandidateInit[];
  timestamp: number;
}

/**
 * Create a transfer object for sharing signaling data
 */
export function createSignalingDataTransfer(
  type: 'offer' | 'answer' | 'ice-candidates',
  data: RTCSessionDescriptionInit | RTCIceCandidateInit | RTCIceCandidateInit[]
): SignalingDataTransfer {
  return {
    version: '1.0',
    type,
    data,
    timestamp: Date.now(),
  };
}

/**
 * Serialize signaling data for QR code generation
 * Returns a base64-encoded JSON string
 */
export function serializeForQRCode(data: SignalingDataTransfer): string {
  const json = JSON.stringify(data);
  return btoa(json);
}

/**
 * Deserialize signaling data from QR code
 */
export function deserializeFromQRCode(encoded: string): SignalingDataTransfer | null {
  try {
    const json = atob(encoded);
    return JSON.parse(json) as SignalingDataTransfer;
  } catch {
    return null;
  }
}

/**
 * Check if data string is too large for QR code
 */
export function isDataTooLargeForQRCode(data: string, version: number = 40): boolean {
  // QR code version 40 supports up to 2953 bytes (numeric mode)
  // We'll use a more conservative estimate for alphanumeric mode
  const maxBytes = 2000;
  const byteLength = new Blob([data]).size;
  return byteLength > maxBytes;
}

/**
 * Chunk large data for multi-step QR code sharing
 */
export function chunkDataForQRCode(data: string, maxChunkSize: number = 1800): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += maxChunkSize) {
    chunks.push(data.slice(i, i + maxChunkSize));
  }
  return chunks;
}

/**
 * Reassemble chunks into original data
 */
export function assembleChunks(chunks: string[]): string {
  return chunks.join('');
}
