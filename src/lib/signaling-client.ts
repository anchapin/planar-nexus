/**
 * Signaling Client
 * Issue #285: Implement signaling server for WebRTC handshake
 *
 * @deprecated This module uses server-dependent signaling and is NOT supported for production use.
 * For legal/serverless P2P multiplayer, use the client-side P2P system instead:
 * - Use `p2p-direct-connection.ts` for QR code/manual code exchange
 * - Use `p2p-signaling-client.ts` for client-side signaling
 * - Use `p2p-game-connection.ts` for full game connections
 *
 * See issue #641 for more information on the migration to serverless P2P.
 *
 * Client-side module for communicating with the signaling server API.
 * Handles session creation, joining, and WebRTC offer/answer/ICE exchange.
 */

/**
 * Signaling session info
 */
export interface SignalingSessionInfo {
  sessionId: string;
  gameCode: string;
  hostId?: string;
  hostName?: string;
  clientId?: string;
  clientName?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  hostCandidates?: RTCIceCandidateInit[];
  clientCandidates?: RTCIceCandidateInit[];
  createdAt: number;
  expiresAt: number;
}

/**
 * Signaling client options
 */
export interface SignalingClientOptions {
  /** API endpoint for signaling server */
  endpoint?: string;
  /** Polling interval in milliseconds */
  pollInterval?: number;
  /** Callback when session state changes */
  onSessionUpdate?: (session: SignalingSessionInfo) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Signaling Client
 * Handles communication with the signaling server for WebRTC handshake
 */
export class SignalingClient {
  private endpoint: string;
  private pollInterval: number;
  private onSessionUpdate?: (session: SignalingSessionInfo) => void;
  private onError?: (error: Error) => void;
  private currentSession: SignalingSessionInfo | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isHost: boolean = false;

  constructor(options: SignalingClientOptions = {}) {
    this.endpoint = options.endpoint || '/api/signaling';
    this.pollInterval = options.pollInterval || 1000;
    this.onSessionUpdate = options.onSessionUpdate;
    this.onError = options.onError;
  }

  /**
   * Create a new signaling session as host
   */
  async createSession(
    hostId: string,
    hostName: string,
    offer?: RTCSessionDescriptionInit
  ): Promise<SignalingSessionInfo> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'create',
          payload: { hostId, hostName, offer },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create session');
      }

      const data = await response.json();
      this.currentSession = {
        sessionId: data.sessionId,
        gameCode: data.gameCode,
        hostId,
        hostName,
        createdAt: Date.now(),
        expiresAt: data.expiresAt,
        hostCandidates: [],
        clientCandidates: [],
      };
      this.isHost = true;

      // Start polling for updates
      this.startPolling();

      return this.currentSession;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(err);
      throw err;
    }
  }

  /**
   * Join an existing session as client
   */
  async joinSession(
    gameCode: string,
    clientId: string,
    clientName: string
  ): Promise<SignalingSessionInfo> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'join',
          payload: { gameCode, clientId, clientName },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to join session');
      }

      const data = await response.json();
      this.currentSession = {
        sessionId: data.sessionId,
        gameCode,
        hostId: data.hostId,
        hostName: data.hostName,
        clientId,
        clientName,
        offer: data.offer,
        hostCandidates: data.hostCandidates || [],
        clientCandidates: [],
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
      };
      this.isHost = false;

      // Start polling for updates
      this.startPolling();

      return this.currentSession;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(err);
      throw err;
    }
  }

  /**
   * Send offer to signaling server (host)
   */
  async sendOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'offer',
        payload: {
          sessionId: this.currentSession.sessionId,
          offer,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send offer');
    }
  }

  /**
   * Send answer to signaling server (client)
   */
  async sendAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'answer',
        payload: {
          sessionId: this.currentSession.sessionId,
          answer,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send answer');
    }
  }

  /**
   * Send ICE candidate to signaling server
   */
  async sendIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ice-candidate',
        payload: {
          sessionId: this.currentSession.sessionId,
          candidate,
          role: this.isHost ? 'host' : 'client',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send ICE candidate');
    }
  }

  /**
   * Poll for session updates
   */
  private async pollForUpdates(): Promise<void> {
    if (!this.currentSession) return;

    try {
      const url = new URL(this.endpoint, window.location.origin);
      url.searchParams.set('sessionId', this.currentSession.sessionId);
      url.searchParams.set('role', this.isHost ? 'host' : 'client');

      const response = await fetch(url.toString());

      if (!response.ok) {
        if (response.status === 404) {
          // Session expired or not found
          this.stopPolling();
          this.onError?.(new Error('Session expired'));
          return;
        }
        return;
      }

      const data = await response.json();
      
      // Update current session with new data
      const session = this.currentSession;
      if (session) {
        this.currentSession = {
          ...session,
          ...data,
        };

        this.onSessionUpdate?.(this.currentSession!);
      }
    } catch (error) {
      console.error('[SignalingClient] Poll error:', error);
    }
  }

  /**
   * Start polling for updates
   */
  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.pollForUpdates();
    }, this.pollInterval);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Get current session
   */
  getSession(): SignalingSessionInfo | null {
    return this.currentSession;
  }

  /**
   * Get game code
   */
  getGameCode(): string | null {
    return this.currentSession?.gameCode || null;
  }

  /**
   * Check if this is the host
   */
  getIsHost(): boolean {
    return this.isHost;
  }

  /**
   * Close the session
   */
  async closeSession(): Promise<void> {
    if (!this.currentSession) return;

    this.stopPolling();

    try {
      const url = new URL(this.endpoint, window.location.origin);
      url.searchParams.set('sessionId', this.currentSession.sessionId);

      await fetch(url.toString(), { method: 'DELETE' });
    } catch (error) {
      console.error('[SignalingClient] Error closing session:', error);
    }

    this.currentSession = null;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopPolling();
    this.currentSession = null;
  }
}

/**
 * Create a signaling client
 */
export function createSignalingClient(
  options?: SignalingClientOptions
): SignalingClient {
  return new SignalingClient(options);
}