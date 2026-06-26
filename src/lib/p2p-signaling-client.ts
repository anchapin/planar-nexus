/**
 * Client-Side P2P Signaling Module
 * Issue #444: Unit 10: Client-Side Multiplayer Signaling
 *
 * This module provides client-side P2P signaling using QR codes and manual code entry,
 * eliminating the need for Firebase or external signaling servers.
 *
 * Connection flow:
 * 1. Host generates a connection code (game code)
 * 2. Host displays QR code containing the connection info
 * 3. Client scans QR code or enters code manually
 * 4. Both peers exchange WebRTC offer/answer via copy-paste
 * 5. Direct P2P connection is established
 */

import QRCode from "qrcode";
import { generateGameCode as generateWebRTCGameCode } from "./webrtc-p2p";
import type {
  P2PMessage,
  P2PConnectionState,
  P2PEvents,
  P2PConnectionOptions,
} from "./webrtc-p2p";
import { WebRTCConnection, createP2PConnection } from "./webrtc-p2p";
import { safeParseJson } from "./p2p-json-validation";
import { redactSensitive } from "./p2p-log-redact";

/**
 * Connection information for P2P handshake
 */
export interface ConnectionInfo {
  /** Game code for identification */
  gameCode: string;
  /** Host player name */
  hostName: string;
  /** Connection timestamp */
  timestamp: number;
  /** ICE server configuration (optional) */
  iceServers?: RTCIceServer[];
}

/**
 * Signaling handshake data
 */
export interface SignalingData {
  /** Type of signaling data */
  type: "offer" | "answer" | "ice-candidate";
  /** The actual WebRTC data */
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
  /** Sender's game code */
  senderCode: string;
}

/**
 * Type guard validating the shape of untrusted {@link ConnectionInfo}.
 * Rejects valid JSON that does not match the expected schema.
 */
export function isConnectionInfo(value: unknown): value is ConnectionInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.gameCode === "string" &&
    typeof v.hostName === "string" &&
    typeof v.timestamp === "number"
  );
}

/**
 * Type guard validating the shape of untrusted {@link SignalingData}.
 * Rejects valid JSON that does not match the expected schema.
 */
export function isSignalingData(value: unknown): value is SignalingData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.type === "offer" || v.type === "answer" || v.type === "ice-candidate") &&
    typeof v.senderCode === "string" &&
    typeof v.data === "object" &&
    v.data !== null
  );
}

/**
 * Connection handshake steps
 */
export type HandshakeStep =
  | "idle"
  | "waiting-for-offer"
  | "waiting-for-answer"
  | "waiting-for-candidates"
  | "completed"
  | "failed";

/**
 * Client-side signaling events
 */
export interface SignalingEvents {
  /** When connection state changes */
  onConnectionStateChange: (state: P2PConnectionState) => void;
  /** When receiving a P2P message */
  onMessage: (message: P2PMessage) => void;
  /** When connection is established */
  onConnected: () => void;
  /** When connection fails */
  onError: (error: Error) => void;
  /** When handshake step changes (for UI updates) */
  onHandshakeStepChange: (step: HandshakeStep) => void;
}

/**
 * Signaling configuration options
 */
export interface SignalingOptions {
  /** Player name */
  playerName: string;
  /** Whether this instance is the host */
  isHost: boolean;
  /** Optional RTC configuration */
  rtcConfig?: RTCConfiguration;
  /** Event callbacks */
  events: SignalingEvents;
}

/**
 * Client-Side P2P Signaling Service
 * Manages the manual signaling process using QR codes and copy-paste
 */
export class P2PSignalingClient {
  private gameCode: string;
  private playerName: string;
  private isHost: boolean;
  private rtcConfig: RTCConfiguration;
  private events: SignalingEvents;
  private connection: WebRTCConnection | null = null;
  private handshakeStep: HandshakeStep = "idle";
  private localOffer: RTCSessionDescriptionInit | null = null;
  private localAnswer: RTCSessionDescriptionInit | null = null;
  private remoteOffer: RTCSessionDescriptionInit | null = null;
  private remoteAnswer: RTCSessionDescriptionInit | null = null;
  private localCandidates: RTCIceCandidateInit[] = [];
  private remoteCandidates: RTCIceCandidateInit[] = [];
  private connectionState: P2PConnectionState = "disconnected";

  constructor(options: SignalingOptions) {
    this.gameCode = generateWebRTCGameCode(6);
    this.playerName = options.playerName;
    this.isHost = options.isHost;
    this.rtcConfig = options.rtcConfig || {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    };
    this.events = options.events;
  }

  /**
   * Initialize the signaling client
   */
  async initialize(): Promise<void> {
    try {
      // Create WebRTC connection
      const connectionOptions: P2PConnectionOptions = {
        playerId: this.isHost ? "host" : "client",
        playerName: this.playerName,
        isHost: this.isHost,
        gameCode: this.gameCode,
        rtcConfig: this.rtcConfig,
        events: {
          onConnectionStateChange: (state) => {
            this.connectionState = state;
            this.events.onConnectionStateChange(state);
          },
          onMessage: (message) => {
            this.events.onMessage(message);
          },
          onGameStateSync: () => {},
          onPlayerAction: () => {},
          onChat: () => {},
          onEmote: () => {},
          onError: (error) => {
            this.events.onError(error);
          },
          onPeerConnected: () => {},
          onPeerDisconnected: () => {},
        },
      };

      this.connection = createP2PConnection(connectionOptions);
      await this.connection.initialize();
    } catch (error) {
      // #982: redact — init errors may embed ICE config / TURN credentials.
      console.error("[Signaling] Failed to initialize:", redactSensitive(error));
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to initialize"),
      );
      this.updateHandshakeStep("failed");
    }
  }

  /**
   * Get connection information for QR code generation
   */
  getConnectionInfo(): ConnectionInfo {
    return {
      gameCode: this.gameCode,
      hostName: this.playerName,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate QR code for the connection information
   * Wraps QR code generation in try/catch to handle canvas/encoding errors
   */
  async generateQRCode(): Promise<string> {
    try {
      const connectionInfo = this.getConnectionInfo();
      const dataUrl = await QRCode.toDataURL(JSON.stringify(connectionInfo), {
        width: 300,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      return dataUrl;
    } catch (error) {
      // #982: redact — QRCode errors may include the serialized connectionInfo
      // (which carries gameCode / hostName).
      console.error(
        "[Signaling] Failed to generate QR code:",
        redactSensitive(error),
      );
      this.events.onError(
        error instanceof Error
          ? error
          : new Error("Failed to generate QR code"),
      );
      throw error;
    }
  }

  /**
   * Get the game code
   */
  getGameCode(): string {
    return this.gameCode;
  }

  /**
   * Start the host side of the connection (creates offer)
   */
  async startHostConnection(): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) {
      throw new Error("Connection not initialized");
    }

    try {
      this.updateHandshakeStep("waiting-for-answer");

      // Create offer
      const offer = await this.connection.createOffer();
      this.localOffer = offer;

      return offer;
    } catch (error) {
      // #982: redact — offer creation errors may embed the local SDP offer.
      console.error(
        "[Signaling] Failed to create offer:",
        redactSensitive(error),
      );
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to create offer"),
      );
      this.updateHandshakeStep("failed");
      throw error;
    }
  }

  /**
   * Start the client side of the connection (handles offer)
   */
  async startClientConnection(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.connection) {
      throw new Error("Connection not initialized");
    }

    try {
      this.updateHandshakeStep("waiting-for-candidates");

      // Store remote offer
      this.remoteOffer = offer;

      // Handle offer and create answer
      const answer = await this.connection.handleOffer(offer);
      this.localAnswer = answer;

      return answer;
    } catch (error) {
      // #982: redact — handle-offer errors may embed the remote SDP offer.
      console.error(
        "[Signaling] Failed to handle offer:",
        redactSensitive(error),
      );
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to handle offer"),
      );
      this.updateHandshakeStep("failed");
      throw error;
    }
  }

  /**
   * Handle an answer from the remote peer (host side)
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.connection) {
      throw new Error("Connection not initialized");
    }

    try {
      // Store remote answer
      this.remoteAnswer = answer;

      // Handle answer
      await this.connection.handleAnswer(answer);
    } catch (error) {
      // #982: redact — handle-answer errors may embed the remote SDP answer.
      console.error(
        "[Signaling] Failed to handle answer:",
        redactSensitive(error),
      );
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to handle answer"),
      );
      this.updateHandshakeStep("failed");
      throw error;
    }
  }

  /**
   * Add ICE candidate from remote peer
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.connection) {
      throw new Error("Connection not initialized");
    }

    try {
      await this.connection.addIceCandidate(candidate);
    } catch (error) {
      // #982: redact — candidate errors may embed the ICE candidate blob.
      console.error(
        "[Signaling] Failed to add ICE candidate:",
        redactSensitive(error),
      );
      // Don't fail the connection for candidate errors
    }
  }

  /**
   * Get the current handshake step
   */
  getHandshakeStep(): HandshakeStep {
    return this.handshakeStep;
  }

  /**
   * Get the local offer (for host to share with client)
   */
  getLocalOffer(): RTCSessionDescriptionInit | null {
    return this.localOffer;
  }

  /**
   * Get the local answer (for client to share with host)
   */
  getLocalAnswer(): RTCSessionDescriptionInit | null {
    return this.localAnswer;
  }

  /**
   * Get the connection state
   */
  getConnectionState(): P2PConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Send a message through the P2P connection
   */
  sendMessage(message: P2PMessage): void {
    if (!this.connection || !this.connection.isConnected()) {
      console.warn("[Signaling] Cannot send message: not connected");
      return;
    }

    this.connection.send(message);
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }

    this.localOffer = null;
    this.localAnswer = null;
    this.remoteOffer = null;
    this.remoteAnswer = null;
    this.localCandidates = [];
    this.remoteCandidates = [];
    this.connectionState = "disconnected";
    this.updateHandshakeStep("idle");
  }

  /**
   * Update handshake step and notify listeners
   */
  private updateHandshakeStep(step: HandshakeStep): void {
    this.handshakeStep = step;
    this.events.onHandshakeStepChange(step);
  }

  /**
   * Get the WebRTC connection (for advanced use cases)
   */
  getWebRTCConnection(): WebRTCConnection | null {
    return this.connection;
  }
}

/**
 * Create a host signaling client
 */
export function createHostSignalingClient(
  playerName: string,
  events: SignalingEvents,
): P2PSignalingClient {
  return new P2PSignalingClient({
    playerName,
    isHost: true,
    events,
  });
}

/**
 * Create a client signaling client
 */
export function createClientSignalingClient(
  playerName: string,
  events: SignalingEvents,
): P2PSignalingClient {
  return new P2PSignalingClient({
    playerName,
    isHost: false,
    events,
  });
}

/**
 * Parse connection info from QR code data
 */
export function parseConnectionInfo(data: string): ConnectionInfo | null {
  const parsed = safeParseJson<ConnectionInfo>(data, isConnectionInfo);
  if (!parsed) {
    console.error(
      "[Signaling] Failed to parse connection info: rejected malformed input",
    );
    return null;
  }
  return parsed;
}

/**
 * Serialize signaling data for copy-paste
 */
export function serializeSignalingData(data: SignalingData): string {
  return JSON.stringify(data);
}

/**
 * Deserialize signaling data from copy-paste
 */
export function deserializeSignalingData(data: string): SignalingData | null {
  const parsed = safeParseJson<SignalingData>(data, isSignalingData);
  if (!parsed) {
    console.error(
      "[Signaling] Failed to deserialize signaling data: rejected malformed input",
    );
    return null;
  }
  return parsed;
}
