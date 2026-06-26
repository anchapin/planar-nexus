/**
 * P2P Game Connection Manager
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Manages WebRTC peer-to-peer connections for multiplayer games
 * using client-side signaling without server dependencies.
 */

import type { GameState, Phase, PlayerId } from "./game-state/types";
import {
  LocalSignalingClient,
  createLocalSignalingClient,
  type LocalSignalingClientOptions,
  type LocalSignalingState,
  ConnectionPhase,
  SignalingRole,
} from "./local-signaling-client";
import {
  serializeGameState,
  deserializeGameState,
  type SerializedGameState,
} from "./game-state/serialization";
import {
  ICEConfigurationManager,
  getGlobalICEManager,
  type ICEConfigOptions,
} from "./ice-config";
import { safeParseJson } from "./p2p-json-validation";
import {
  P2PRateLimiter,
  type P2PRateLimitOptions,
} from "./p2p-rate-limiter";
import {
  classifyConnectionFailure,
  hasTurnServer,
  type ConnectionFailureContext,
  type ConnectionFailureDiagnostic,
} from "./p2p-failure-diagnostics";
import { redactSensitive } from "./p2p-log-redact";

/**
 * P2P connection events
 */
export interface P2PGameConnectionEvents {
  onConnectionStateChange: (state: P2PConnectionState) => void;
  onSignalingStateChange: (signalingState: LocalSignalingState) => void;
  onMessage: (message: GameMessage) => void;
  onGameStateSync: (gameState: GameState) => void;
  onChat: (message: ChatMessage) => void;
  onError: (error: Error) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
}

/**
 * P2P connection state
 */
export type P2PConnectionState =
  | "disconnected"
  | "signaling"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * Re-export SignalingRole for convenience
 */
export type { SignalingRole };

/**
 * Game message types
 */
export type GameMessageType =
  | "game-state-sync"
  | "game-action"
  | "chat"
  | "player-joined"
  | "player-left"
  | "ping"
  | "pong";

/**
 * Base game message
 */
export interface GameMessage {
  type: GameMessageType;
  senderId: string;
  timestamp: number;
  data: unknown;
}

const GAME_MESSAGE_TYPES: ReadonlySet<GameMessageType> = new Set([
  "game-state-sync",
  "game-action",
  "chat",
  "player-joined",
  "player-left",
  "ping",
  "pong",
]);

/**
 * Type guard validating the shape of an untrusted {@link GameMessage}.
 * Data-channel messages come directly from peers and must be validated before
 * use. Rejects valid JSON that does not match the expected schema.
 */
export function isGameMessage(value: unknown): value is GameMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    GAME_MESSAGE_TYPES.has(v.type as GameMessageType) &&
    typeof v.senderId === "string" &&
    typeof v.timestamp === "number"
    // `data` is intentionally `unknown`; handlers validate it as needed.
  );
}

/**
 * Chat message
 */
export interface ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

/**
 * P2P Game Connection options
 */
export interface P2PGameConnectionOptions {
  playerId: string;
  playerName: string;
  role: SignalingRole;
  gameCode?: string;
  iceConfig?: ICEConfigOptions;
  events?: Partial<P2PGameConnectionEvents>;
  /**
   * Per-connection rate limit for incoming data-channel messages. Defaults to
   * {@link DEFAULT_P2P_RATE_LIMIT} (100 msgs / 1s). Messages exceeding the
   * limit are dropped before parsing to prevent CPU/memory exhaustion from a
   * flooding peer. Issue #1111.
   */
  rateLimit?: Partial<P2PRateLimitOptions>;
}

/**
 * P2P Game Connection Manager
 *
 * Combines WebRTC peer connection with local signaling for
 * serverless peer-to-peer game connections.
 */
export class P2PGameConnection {
  private playerId: string;
  private playerName: string;
  private connectionState: P2PConnectionState;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingClient: LocalSignalingClient;
  private events: P2PGameConnectionEvents;
  private iceManager: ICEConfigurationManager;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private remotePlayerId: string | null = null;
  private remotePlayerName: string | null = null;
  private lastFailureDiagnostic: ConnectionFailureDiagnostic | null = null;
  /**
   * Per-connection sliding-window rate limiter for incoming messages. Caps how
   * many messages per second a single peer can push through the parse +
   * validation path. Issue #1111.
   */
  private rateLimiter: P2PRateLimiter;

  constructor(options: P2PGameConnectionOptions) {
    this.playerId = options.playerId;
    this.playerName = options.playerName;
    this.connectionState = "disconnected";

    // Per-connection rate limiter guards the parse/validate path against
    // flooding peers. Issue #1111.
    this.rateLimiter = new P2PRateLimiter(options.rateLimit);

    // Initialize ICE manager
    if (options.iceConfig) {
      this.iceManager = new ICEConfigurationManager(options.iceConfig);
    } else {
      this.iceManager = getGlobalICEManager();
    }

    // Create signaling client
    this.signalingClient = createLocalSignalingClient({
      role: options.role,
      gameCode: options.gameCode,
      events: {
        onStateChange: this.handleSignalingStateChange.bind(this),
        onError: this.handleSignalingError.bind(this),
        onConnected: this.handleSignalingConnected.bind(this),
        onOfferCreated: this.handleOfferCreated.bind(this),
        onAnswerCreated: this.handleAnswerCreated.bind(this),
        onIceCandidate: this.handleIceCandidate.bind(this),
      },
    });

    // Set default event handlers
    const defaultEvents: P2PGameConnectionEvents = {
      onConnectionStateChange: () => {},
      onSignalingStateChange: () => {},
      onMessage: () => {},
      onGameStateSync: () => {},
      onChat: () => {},
      onError: () => {},
      onPlayerJoined: () => {},
      onPlayerLeft: () => {},
    };

    this.events = options.events
      ? { ...defaultEvents, ...options.events }
      : defaultEvents;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): P2PConnectionState {
    return this.connectionState;
  }

  /**
   * Get signaling state
   */
  getSignalingState(): LocalSignalingState {
    return this.signalingClient.getState();
  }

  /**
   * Get signaling client for manual data exchange
   */
  getSignalingClient(): LocalSignalingClient {
    return this.signalingClient;
  }

  /**
   * Get the last failure diagnostic with actionable reason and remediation.
   * Returns null when the connection is not in a failed state.
   */
  getLastFailureDiagnostic(): ConnectionFailureDiagnostic | null {
    return this.lastFailureDiagnostic;
  }

  /**
   * Get the RTCConfiguration for diagnostic classification.
   */
  private getRTCConfig(): RTCConfiguration | null {
    return this.peerConnection
      ? {
          iceServers: this.iceManager.getRTCConfiguration().iceServers,
        }
      : null;
  }

  /**
   * Initialize connection as host
   */
  async initializeAsHost(): Promise<void> {
    if (this.connectionState !== "disconnected") {
      throw new Error("Connection already initialized");
    }

    this.updateConnectionState("signaling");

    try {
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceManager.getRTCConfiguration().iceServers,
      });

      // Set up ICE candidate handling
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.signalingClient.addLocalIceCandidate(event.candidate);
        }
      };

      // Set up connection state handlers
      this.peerConnection.onconnectionstatechange = () => {
        this.handlePeerConnectionStateChange();
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        this.handleICEConnectionStateChange();
      };

      // Host creates data channel
      this.dataChannel = this.peerConnection.createDataChannel("game", {
        ordered: true,
      });
      this.setupDataChannelEvents();

      // Create offer through signaling
      await this.signalingClient.initializeAsHost(this.peerConnection);
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Failed to initialize host"),
      );
      throw error;
    }
  }

  /**
   * Initialize connection as joiner
   */
  async initializeAsJoiner(offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.connectionState !== "disconnected") {
      throw new Error("Connection already initialized");
    }

    this.updateConnectionState("signaling");

    try {
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceManager.getRTCConfiguration().iceServers,
      });

      // Set up ICE candidate handling
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.signalingClient.addLocalIceCandidate(event.candidate);
        }
      };

      // Set up connection state handlers
      this.peerConnection.onconnectionstatechange = () => {
        this.handlePeerConnectionStateChange();
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        this.handleICEConnectionStateChange();
      };

      // Wait for data channel from host
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannelEvents();
      };

      // Create answer through signaling
      await this.signalingClient.initializeAsJoiner(this.peerConnection, offer);
    } catch (error) {
      this.handleError(
        error instanceof Error
          ? error
          : new Error("Failed to initialize joiner"),
      );
      throw error;
    }
  }

  /**
   * Process an answer received by the host
   */
  async processAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      await this.signalingClient.handleAnswer(answer);
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : new Error("Failed to process answer"),
      );
      throw error;
    }
  }

  /**
   * Process ICE candidates received from remote peer
   */
  async processIceCandidates(candidates: RTCIceCandidateInit[]): Promise<void> {
    try {
      await this.signalingClient.addRemoteIceCandidates(candidates);
    } catch (error) {
      // #982: redact — candidate errors may embed ICE candidate blobs.
      console.error(
        "[P2PGameConnection] Failed to process ICE candidates:",
        redactSensitive(error),
      );
    }
  }

  /**
   * Send a game message
   */
  send(message: GameMessage): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.warn("[P2PGameConnection] Data channel not ready");
      return false;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      // #982: redact — send errors may reference the message payload.
      console.error(
        "[P2PGameConnection] Failed to send message:",
        redactSensitive(error),
      );
      return false;
    }
  }

  /**
   * Send game state to remote peer
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): boolean {
    const serialized = serializeGameState(gameState);

    return this.send({
      type: "game-state-sync",
      senderId: this.playerId,
      timestamp: Date.now(),
      data: {
        gameState: serialized,
        isFullSync,
      },
    });
  }

  /**
   * Send a game action
   */
  sendGameAction(action: string, data: unknown): boolean {
    return this.send({
      type: "game-action",
      senderId: this.playerId,
      timestamp: Date.now(),
      data: {
        action,
        data,
      },
    });
  }

  /**
   * Send a chat message
   */
  sendChat(text: string): boolean {
    return this.send({
      type: "chat",
      senderId: this.playerId,
      timestamp: Date.now(),
      data: {
        senderName: this.playerName,
        text,
      },
    });
  }

  /**
   * Send ping
   */
  private sendPing(): void {
    this.send({
      type: "ping",
      senderId: this.playerId,
      timestamp: Date.now(),
      data: null,
    });
  }

  /**
   * Send pong
   */
  private sendPong(): void {
    this.send({
      type: "pong",
      senderId: this.playerId,
      timestamp: Date.now(),
      data: null,
    });
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannelEvents(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.updateConnectionState("connected");
      this.signalingClient.markConnected();
      this.startPingInterval();
    };

    this.dataChannel.onclose = () => {
      this.handleDisconnection();
    };

    this.dataChannel.onerror = (event) => {
      // #982: redact — data channel error events may embed diagnostic info.
      console.error(
        "[P2PGameConnection] Data channel error:",
        redactSensitive(event),
      );
      this.handleError(
        event instanceof Error ? event : new Error("Data channel error"),
      );
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data !== "string") {
        console.warn("[P2PGameConnection] Received non-string message");
        return;
      }
      this.handleMessage(event.data);
    };
  }

  /**
   * Handle incoming message
   *
   * Enforces, in order:
   *   1. Per-connection rate limit — a flooding peer is dropped before any
   *      parsing work is done (issue #1111).
   *   2. Safe parse + structural limits (size/depth/key-count) via
   *      {@link safeParseJson}.
   *   3. Shape validation via {@link isGameMessage}.
   *
   * Malformed, oversize, or rate-limited messages are rejected gracefully
   * without breaking the connection.
   */
  private handleMessage(data: string): void {
    try {
      // Rate-limit first: never do parse/validation work for a flooding peer.
      if (!this.rateLimiter.tryAcquire()) {
        console.warn(
          "[P2PGameConnection] Rate limit exceeded; dropping peer message",
        );
        return;
      }

      const message = safeParseJson<GameMessage>(data, isGameMessage);
      if (!message) {
        // Malformed JSON or wrong shape — reject without breaking the channel.
        console.error("[P2PGameConnection] Rejected malformed peer message");
        return;
      }

      // Update remote player info
      if (this.remotePlayerId === null) {
        this.remotePlayerId = message.senderId;
      }

      switch (message.type) {
        case "game-state-sync":
          this.handleGameStateSync(message);
          break;
        case "game-action":
          this.events.onMessage(message);
          break;
        case "chat":
          this.handleChat(message);
          break;
        case "player-joined":
          this.handlePlayerJoined(message);
          break;
        case "player-left":
          this.handlePlayerLeft(message);
          break;
        case "ping":
          this.sendPong();
          break;
        case "pong":
          // Connection is alive
          break;
      }

      this.events.onMessage(message);
    } catch (error) {
      // #982: redact — handler errors may reference the peer message payload.
      console.error(
        "[P2PGameConnection] Failed to handle message:",
        redactSensitive(error),
      );
      // Don't break connection for handler errors, just log them
    }
  }

  /**
   * Handle game state sync
   */
  private handleGameStateSync(message: GameMessage): void {
    const data = message.data as {
      gameState: SerializedGameState;
      isFullSync: boolean;
    };
    const baseState = this.createBaseEngineState();
    const gameState = deserializeGameState(data.gameState, baseState);
    this.events.onGameStateSync(gameState);
  }

  /**
   * Create a minimal base engine state for deserialization
   */
  private createBaseEngineState(): any {
    return {
      gameId: "",
      players: new Map(),
      cards: new Map(),
      zones: new Map(),
      stack: [],
      turn: {
        activePlayerId: "" as PlayerId,
        currentPhase: "precombat_main" as Phase,
        turnNumber: 1,
        extraTurns: 0,
        isFirstTurn: true,
        startedAt: Date.now(),
      },
      combat: { attacking: [], blocking: [] },
      waitingChoice: null,
      priorityPlayerId: null,
      consecutivePasses: 0,
      status: "not_started",
      winners: [],
      endReason: null,
      format: "commander",
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    };
  }

  /**
   * Handle chat message
   */
  private handleChat(message: GameMessage): void {
    const data = message.data as { senderName: string; text: string };
    const chatMessage: ChatMessage = {
      senderId: message.senderId,
      senderName: data.senderName,
      text: data.text,
      timestamp: message.timestamp,
    };
    this.events.onChat(chatMessage);
  }

  /**
   * Handle player joined
   */
  private handlePlayerJoined(message: GameMessage): void {
    const data = message.data as { playerId: string; playerName: string };
    this.events.onPlayerJoined(data.playerId, data.playerName);
  }

  /**
   * Handle player left
   */
  private handlePlayerLeft(message: GameMessage): void {
    const data = message.data as { playerId: string };
    this.events.onPlayerLeft(data.playerId);
  }

  /**
   * Handle peer connection state change
   */
  private handlePeerConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.connectionState;

    switch (state) {
      case "connected":
        this.updateConnectionState("connected");
        break;
      case "disconnected":
        this.handleDisconnection();
        break;
      case "failed":
        this.lastFailureDiagnostic = classifyConnectionFailure({
          rtcConfig: this.getRTCConfig(),
          failureContext: "ice" as ConnectionFailureContext,
          cause: `connectionState=${state}`,
        });
        this.handleError(new Error("Peer connection failed"));
        break;
    }
  }

  /**
   * Handle ICE connection state change
   */
  private handleICEConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.iceConnectionState;

    if (state === "disconnected" || state === "failed") {
      if (state === "failed") {
        this.lastFailureDiagnostic = classifyConnectionFailure({
          rtcConfig: this.getRTCConfig(),
          failureContext: "ice" as ConnectionFailureContext,
          cause: `iceConnectionState=${state}`,
        });
      }
      this.handleDisconnection();
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    this.updateConnectionState("disconnected");
    this.stopPingInterval();
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    // #982: redact — error.message may embed session metadata propagated up
    // from lower layers.
    console.error("[P2PGameConnection] Error:", redactSensitive(error));
    if (!this.lastFailureDiagnostic) {
      this.lastFailureDiagnostic = classifyConnectionFailure({
        rtcConfig: this.getRTCConfig(),
        failureContext: "generic",
        cause: error.message,
      });
    }
    this.updateConnectionState("failed");
    this.stopPingInterval();
    this.events.onError(error);
  }

  /**
   * Handle signaling state change
   */
  private handleSignalingStateChange(
    signalingState: LocalSignalingState,
  ): void {
    this.events.onSignalingStateChange(signalingState);
  }

  /**
   * Handle signaling error
   */
  private handleSignalingError(error: Error): void {
    this.handleError(error);
  }

  /**
   * Handle signaling connected
   */
  private handleSignalingConnected(): void {
    // Handled by data channel onopen
  }

  /**
   * Handle offer created
   */
  private handleOfferCreated(offer: RTCSessionDescriptionInit): void {}

  /**
   * Handle answer created
   */
  private handleAnswerCreated(answer: RTCSessionDescriptionInit): void {}

  /**
   * Handle ICE candidate
   */
  private handleIceCandidate(candidate: RTCIceCandidateInit): void {}

  /**
   * Update connection state
   */
  private updateConnectionState(state: P2PConnectionState): void {
    this.connectionState = state;
    this.events.onConnectionStateChange(state);
  }

  /**
   * Start ping interval
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 5000);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Close connection
   */
  close(): void {
    this.stopPingInterval();

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.rateLimiter.reset();
    this.updateConnectionState("disconnected");
  }

  /**
   * Get connection statistics
   */
  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.peerConnection) {
      return null;
    }

    try {
      return await this.peerConnection.getStats();
    } catch (error) {
      // #982: redact — getStats errors may reference ICE candidates.
      console.error(
        "[P2PGameConnection] Failed to get stats:",
        redactSensitive(error),
      );
      return null;
    }
  }
}

/**
 * Create a P2P game connection
 */
export function createP2PGameConnection(
  options: P2PGameConnectionOptions,
): P2PGameConnection {
  return new P2PGameConnection(options);
}
