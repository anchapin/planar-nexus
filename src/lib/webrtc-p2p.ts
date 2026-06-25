/**
 * WebRTC P2P Connection Manager
 * Issue #57: Phase 4.1: Implement WebRTC for peer-to-peer connections
 * Issue #286: Add NAT traversal and STUN/TURN server support
 *
 * This module provides WebRTC support for direct player-to-player connections,
 * enabling multiplayer games without a central server.
 */

import {
  serializeGameState,
  deserializeGameState,
  engineToAIState,
  aiToEngineState,
  type SerializedGameState,
} from "./game-state/serialization";
import type { GameState, Phase, PlayerId } from "./game-state/types";
import {
  computeStateDelta,
  applyDelta,
  shouldUseFullSync,
  estimateDeltaSize,
  type PeerSyncState,
  type GameStateDelta,
} from "./game-state/delta-sync";
import {
  ICEConfigurationManager,
  ICEConnectionMonitor,
  ICECandidateFilter,
  type ICEConfigOptions,
  getGlobalICEManager,
} from "./ice-config";

/**
 * WebRTC configuration with STUN/TURN servers
 * @deprecated Use ICEConfigurationManager instead
 */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

/**
 * Connection state
 */
export type P2PConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

/**
 * Message types for P2P communication
 */
export type P2PMessageType =
  | "game-state-sync"
  | "game-action"
  | "player-action"
  | "chat"
  | "emote"
  | "ping"
  | "pong"
  | "connection-request"
  | "connection-accept"
  | "error";

/**
 * Base P2P message
 */
export interface P2PMessage {
  type: P2PMessageType;
  senderId: string;
  timestamp: number;
  payload: unknown;
}

/**
 * Game state sync message
 */
export interface GameStateSyncMessage extends P2PMessage {
  type: "game-state-sync";
  payload: {
    gameState: SerializedGameState;
    isFullSync: boolean;
  };
}

/**
 * Player action message
 */
export interface PlayerActionMessage extends P2PMessage {
  type: "player-action";
  payload: {
    action: string;
    data: unknown;
  };
}

/**
 * Chat message
 */
export interface ChatMessage extends P2PMessage {
  type: "chat";
  payload: {
    text: string;
  };
}

/**
 * Emote message
 */
export interface EmoteMessage extends P2PMessage {
  type: "emote";
  payload: {
    emote: string;
  };
}

/**
 * Connection request message
 */
export interface ConnectionRequestMessage extends P2PMessage {
  type: "connection-request";
  payload: {
    playerName: string;
    gameCode: string;
    isHost: boolean;
  };
}

/**
 * Connection accept message
 */
export interface ConnectionAcceptMessage extends P2PMessage {
  type: "connection-accept";
  payload: {
    playerName: string;
    playerId: string;
  };
}

/**
 * Error message
 */
export interface ErrorMessage extends P2PMessage {
  type: "error";
  payload: {
    code: string;
    message: string;
  };
}

/**
 * P2P Peer connection info
 */
export interface PeerInfo {
  peerId: string;
  playerId: string;
  playerName: string;
  connectionState: P2PConnectionState;
  connectedAt?: number;
  lastMessageAt?: number;
  lastSyncVersion?: number;
  lastSyncChecksum?: string;
}

/**
 * P2P Connection events
 */
export interface P2PEvents {
  onConnectionStateChange: (state: P2PConnectionState, peerId: string) => void;
  onMessage: (message: P2PMessage, peerId: string) => void;
  onGameStateSync: (gameState: GameState, peerId: string) => void;
  onPlayerAction: (action: string, data: unknown, peerId: string) => void;
  onChat: (text: string, peerId: string) => void;
  onEmote: (emote: string, peerId: string) => void;
  onError: (error: Error, peerId: string) => void;
  onPeerConnected: (peerInfo: PeerInfo) => void;
  onPeerDisconnected: (peerId: string) => void;
  /**
   * Emitted when a reconnection ICE restart produces a new offer that the
   * signaling layer must forward to the remote peer so renegotiation can
   * complete. Optional — only the offerer (host) emits this.
   */
  onReconnectOffer?: (offer: RTCSessionDescriptionInit, peerId: string) => void;
}

/**
 * P2P Connection options
 */
export interface P2PConnectionOptions {
  playerId: string;
  playerName: string;
  isHost: boolean;
  rtcConfig?: RTCConfiguration;
  gameCode?: string;
  events?: Partial<P2PEvents>;
  /** ICE configuration options for NAT traversal */
  iceConfig?: ICEConfigOptions;
  /** Enable ICE connection monitoring */
  enableICEMonitoring?: boolean;
  /** Fallback to relay on connection failure */
  fallbackToRelay?: boolean;
  /**
   * Maximum number of reconnection attempts before transitioning to the
   * terminal "failed" state. Defaults to 3.
   */
  maxReconnectAttempts?: number;
  /** Base delay (ms) for exponential backoff between reconnection attempts. */
  reconnectBaseDelayMs?: number;
  /** Upper bound (ms) for the exponential backoff delay. */
  reconnectMaxDelayMs?: number;
  /** Time (ms) to wait for recovery after each ICE restart attempt. */
  reconnectAttemptTimeoutMs?: number;
  /**
   * Defer ping cadence to an external driver (e.g. a connection pool that
   * consolidates pings into a single sweep). When true the connection never
   * starts its own ping interval; callers must invoke {@link ping} instead.
   * Issue #1021.
   */
  externalPing?: boolean;
}

/**
 * Compute a simple checksum for state validation
 */
function computeChecksum(state: ReturnType<typeof engineToAIState>): string {
  const data = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * WebRTC P2P Connection Manager
 */
export class WebRTCConnection {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localPlayerId: string;
  private localPlayerName: string;
  private isHost: boolean;
  private gameCode: string | undefined;
  private rtcConfig: RTCConfiguration;
  private peers: Map<string, PeerInfo> = new Map();
  private peerSyncStates: Map<string, PeerSyncState> = new Map();
  private connectionState: P2PConnectionState = "disconnected";
  private events: P2PEvents;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectBaseDelayMs = 1000;
  private reconnectMaxDelayMs = 16000;
  private reconnectAttemptTimeoutMs = 15000;
  /** Guards against overlapping reconnection cycles. */
  private isReconnecting = false;
  /** Pending timer for the inter-attempt backoff sleep. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resolvers waiting for a recovery verdict during a reconnect attempt. */
  private recoveryWaiters: Array<(recovered: boolean) => void> = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private iceManager: ICEConfigurationManager;
  private iceMonitor: ICEConnectionMonitor | null = null;
  private iceCandidateFilter: ICECandidateFilter;
  private enableICEMonitoring: boolean;
  private fallbackToRelay: boolean;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /**
   * When true the connection relies on an external driver for ping health
   * checks instead of its own interval. Issue #1021.
   */
  private externalPing: boolean;

  constructor(options: P2PConnectionOptions) {
    this.localPlayerId = options.playerId;
    this.localPlayerName = options.playerName;
    this.isHost = options.isHost;
    this.gameCode = options.gameCode;
    this.enableICEMonitoring = options.enableICEMonitoring ?? true;
    this.fallbackToRelay = options.fallbackToRelay ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 16000;
    this.reconnectAttemptTimeoutMs = options.reconnectAttemptTimeoutMs ?? 15000;
    this.externalPing = options.externalPing ?? false;

    // Initialize ICE configuration
    if (options.iceConfig) {
      this.iceManager = new ICEConfigurationManager(options.iceConfig);
    } else {
      this.iceManager = getGlobalICEManager();
    }

    // Use provided rtcConfig or get from ICE manager
    this.rtcConfig = options.rtcConfig || this.iceManager.getRTCConfiguration();

    // Initialize candidate filter
    this.iceCandidateFilter = new ICECandidateFilter({
      allowIPv6: options.iceConfig?.enableIPv6 ?? true,
      allowLoopback: false,
      allowLinkLocal: false,
    });

    // Set default event handlers

    const defaultEvents: P2PEvents = {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onConnectionStateChange: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onMessage: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onGameStateSync: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onPlayerAction: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onChat: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onEmote: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onError: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onPeerConnected: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      onPeerDisconnected: () => {},
    };

    this.events = options.events
      ? { ...defaultEvents, ...options.events }
      : defaultEvents;
  }

  /**
   * Initialize the peer connection
   */
  async initialize(): Promise<void> {
    try {
      this.updateConnectionState("connecting");

      this.peerConnection = new RTCPeerConnection(this.rtcConfig);

      // Set up ICE candidate handling with filtering
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          // Filter candidate based on configuration
          const filteredCandidate = this.iceCandidateFilter.filter(
            event.candidate,
          );
          if (filteredCandidate) {
            this.handleICECandidate(filteredCandidate);
          }
        }
      };

      // Set up connection state change handler
      this.peerConnection.onconnectionstatechange = () => {
        this.handleConnectionStateChange();
      };

      // Set up ICE connection state change
      this.peerConnection.oniceconnectionstatechange = () => {
        this.handleICEConnectionStateChange();
      };

      // Set up ICE monitoring if enabled
      if (this.enableICEMonitoring) {
        this.iceMonitor = new ICEConnectionMonitor({
          onStateChange: (state) => {
            // ICE monitor state changed
          },
          onFailed: () => {
            this.handleICEFailure();
          },
          onConnected: () => {
            // Connection established
          },
          onDisconnected: () => {
            // Connection lost, attempting recovery
          },
          failureTimeoutMs: 30000,
        });
        this.iceMonitor.attach(this.peerConnection);
      }

      // If host, create data channel for receiving
      if (this.isHost) {
        this.setupDataChannel();
      }
    } catch (error) {
      console.error("[WebRTC] Failed to initialize:", error);
      this.updateConnectionState("failed");
      throw error;
    }
  }

  /**
   * Handle ICE connection failure with optional fallback
   */
  private handleICEFailure(): void {
    // If fallback to relay is enabled and TURN servers are available
    if (this.fallbackToRelay && this.iceManager.hasTurnServers()) {
      this.attemptRelayFallback();
    } else {
      this.handleConnectionFailure();
    }
  }

  /**
   * Attempt to reconnect using TURN relay only
   */
  private async attemptRelayFallback(): Promise<void> {
    try {
      // Close current connection
      if (this.peerConnection) {
        this.peerConnection.close();
      }

      // Create new configuration with relay-only mode
      const relayConfig = this.iceManager.getRTCConfiguration();
      relayConfig.iceTransportPolicy = "relay";

      // Create new peer connection with relay config
      this.peerConnection = new RTCPeerConnection(relayConfig);

      // Re-attach event handlers
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.handleICECandidate(event.candidate);
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        this.handleConnectionStateChange();
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        this.handleICEConnectionStateChange();
      };

      if (this.iceMonitor && this.peerConnection) {
        this.iceMonitor.attach(this.peerConnection);
      }

      if (this.isHost) {
        this.setupDataChannel();
      }

      // Notify that reconnection is being attempted
      this.updateConnectionState("reconnecting");
    } catch (error) {
      console.error("[WebRTC] Relay fallback failed:", error);
      this.handleConnectionFailure();
    }
  }

  /**
   * Create an offer for the host to send to a joining player
   * Wraps WebRTC offer creation in try/catch to surface errors via onError callback
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      return offer;
    } catch (error) {
      console.error("[WebRTC] Failed to create offer:", error);
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to create offer"),
        "",
      );
      throw error;
    }
  }

  /**
   * Handle an incoming offer from a joining player
   * Wraps WebRTC offer handling in try/catch to surface errors via onError callback
   */
  async handleOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer),
      );
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      return answer;
    } catch (error) {
      console.error("[WebRTC] Failed to handle offer:", error);
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to handle offer"),
        "",
      );
      throw error;
    }
  }

  /**
   * Handle an incoming answer from the host
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer),
    );
  }

  /**
   * Add an ICE candidate from the remote peer
   * Wraps ICE candidate addition in try/catch to prevent candidate errors from breaking connection
   */
  async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!this.peerConnection || !candidate) {
      return;
    }

    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("[WebRTC] Failed to add ICE candidate:", error);
      // Don't throw - candidate errors shouldn't break the connection
      // but log for debugging purposes
    }
  }

  /**
   * Handle ICE candidate (send to remote peer via signaling)
   */
  private handleICECandidate(candidate: RTCIceCandidate): void {
    // In a full implementation, this would send the candidate via a signaling server
    // or via an alternative channel (like QR code or manual paste)
  }

  /**
   * Set up the data channel
   */
  private setupDataChannel(): void {
    if (!this.peerConnection) return;

    // If host, create a data channel to listen for incoming connections
    if (this.isHost) {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannelEvents();
      };
    }
  }

  /**
   * Connect to a peer as a client (non-host)
   * Wraps data channel creation in try/catch to surface errors via onError callback
   */
  async connectToPeer(): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    try {
      // Create data channel for sending
      this.dataChannel = this.peerConnection.createDataChannel("game", {
        ordered: true,
      });

      this.setupDataChannelEvents();
    } catch (error) {
      console.error("[WebRTC] Failed to connect to peer:", error);
      this.events.onError(
        error instanceof Error ? error : new Error("Failed to connect to peer"),
        "",
      );
      throw error;
    }
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannelEvents(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
       this.updateConnectionState("connected");
       if (!this.externalPing) {
         this.startPingInterval();
       }
     };

    this.dataChannel.onclose = () => {
      this.handleDisconnection();
    };

    this.dataChannel.onerror = (event) => {
      console.error("[WebRTC] Data channel error:", event);

      let errorToReport: Error;

      const underlyingError =
        (event as ErrorEvent).error ?? (event as { error?: Error })?.error;

      if (underlyingError instanceof Error) {
        errorToReport = underlyingError;
      } else if (underlyingError !== undefined) {
        // Preserve non-Error details as the cause where supported
        errorToReport = new Error("Data channel error", {
          cause: underlyingError,
        });
      } else if (event instanceof Error) {
        errorToReport = event;
      } else {
        errorToReport = new Error("Data channel error", { cause: event });
      }

      this.events.onError(errorToReport, "");
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data !== "string") {
        console.warn("[WebRTC] Received non-string message, ignoring");
        return;
      }
      this.handleMessage(event.data);
    };
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: string): void {
    try {
      const message: P2PMessage = JSON.parse(data);

      switch (message.type) {
        case "game-state-sync":
          this.handleGameStateSync(message as GameStateSyncMessage);
          break;
        case "player-action":
          this.handlePlayerAction(message as PlayerActionMessage);
          break;
        case "chat":
          this.handleChat(message as ChatMessage);
          break;
        case "emote":
          this.handleEmote(message as EmoteMessage);
          break;
        case "ping":
          this.sendPong();
          break;
        case "pong":
          // Connection is alive
          break;
        case "connection-request":
          this.handleConnectionRequest(message as ConnectionRequestMessage);
          break;
        case "connection-accept":
          this.handleConnectionAccept(message as ConnectionAcceptMessage);
          break;
        case "error":
          this.handleErrorMessage(message as ErrorMessage);
          break;
      }

      this.events.onMessage(message, "");
    } catch (error) {
      console.error("[WebRTC] Failed to parse message:", error);
    }
  }

  /**
   * Handle game state sync message - supports both full and delta sync
   */
  private handleGameStateSync(message: GameStateSyncMessage): void {
    const baseState = this.createBaseEngineState();

    if (message.payload.isFullSync) {
      const gameState = deserializeGameState(
        message.payload.gameState,
        baseState,
      );
      this.events.onGameStateSync(gameState, "");
    } else {
      const delta = message.payload.gameState as unknown as GameStateDelta;
      const peerId = message.senderId;
      const peerState = this.peerSyncStates.get(peerId);

      if (peerState?.lastState) {
        const updatedAIState = applyDelta(peerState.lastState, delta);
        const gameState = aiToEngineState(updatedAIState, baseState);
        this.peerSyncStates.set(peerId, {
          ...peerState,
          lastState: updatedAIState,
          lastVersion: delta.version,
          lastChecksum: delta.checksum,
        });
        this.events.onGameStateSync(gameState, "");
      } else {
        const gameState = deserializeGameState(
          message.payload.gameState,
          baseState,
        );
        this.events.onGameStateSync(gameState, "");
      }
    }
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
   * Handle player action message
   */
  private handlePlayerAction(message: PlayerActionMessage): void {
    this.events.onPlayerAction(
      message.payload.action,
      message.payload.data,
      message.senderId,
    );
  }

  /**
   * Handle chat message
   */
  private handleChat(message: ChatMessage): void {
    this.events.onChat(message.payload.text, message.senderId);
  }

  /**
   * Handle emote message
   */
  private handleEmote(message: EmoteMessage): void {
    this.events.onEmote(message.payload.emote, message.senderId);
  }

  /**
   * Handle connection request
   */
  private handleConnectionRequest(message: ConnectionRequestMessage): void {
    // In a full implementation, host would validate the game code
    // and accept/reject the connection
  }

  /**
   * Handle connection accept
   */
  private handleConnectionAccept(message: ConnectionAcceptMessage): void {
    this.updateConnectionState("connected");
  }

  /**
   * Handle error message
   */
  private handleErrorMessage(message: ErrorMessage): void {
    this.events.onError(new Error(message.payload.message), message.senderId);
  }

  /**
   * Handle connection state changes
   */
  private handleConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.connectionState;

    switch (state) {
      case "connected":
        this.updateConnectionState("connected");
        this.reconnectAttempts = 0;
        if (!this.externalPing) {
          this.startPingInterval();
        }
        break;
      case "disconnected":
        this.handleDisconnection();
        break;
      case "failed":
        this.handleConnectionFailure();
        break;
      case "new":
      case "connecting":
        this.updateConnectionState("connecting");
        break;
    }
  }

  /**
   * Handle ICE connection state changes
   */
  private handleICEConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.iceConnectionState;

    if (state === "disconnected" || state === "failed") {
      this.handleDisconnection();
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    if (this.connectionState === "failed") return;

    this.updateConnectionState("disconnected");
    this.stopPingInterval();

    // Kick off (or re-enter) the bounded reconnection cycle. attemptReconnection
    // is idempotent for concurrent invocations via the isReconnecting guard and
    // self-limits to maxReconnectAttempts.
    void this.attemptReconnection();
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    this.updateConnectionState("failed");
    this.stopPingInterval();
    this.events.onError(
      new Error(
        "P2P connection failed: reconnection attempts exhausted. The peer may be unreachable.",
      ),
      "",
    );
  }

  /**
   * Attempt to recover the connection after a transient ICE disconnect.
   *
   * Strategy: perform an ICE restart (host/offerer generates a restart offer and
   * emits it so the signaling layer can forward it to the remote peer) and wait
   * for recovery, retrying with exponential backoff up to maxReconnectAttempts.
   * On success the state transitions back to "connected"; once retries are
   * exhausted the state transitions to the terminal "failed" state with an
   * actionable error instead of stranding the game in "reconnecting" forever.
   */
  private async attemptReconnection(): Promise<void> {
    // Never strand: a closed connection (peerConnection === null) is terminal.
    if (this.isReconnecting) return;
    if (!this.peerConnection || this.getConnectionState() === "failed") return;

    this.isReconnecting = true;
    this.updateConnectionState("reconnecting");

    try {
      while (this.reconnectAttempts < this.maxReconnectAttempts) {
        // Bail out if the connection was closed or already recovered. State is
        // read via getConnectionState() to avoid TS narrowing the field across
        // the awaited backoff/recovery steps below.
        if (!this.peerConnection || this.getConnectionState() === "failed")
          return;
        if (this.getConnectionState() === "connected") {
          this.reconnectAttempts = 0;
          return;
        }

        this.reconnectAttempts++;

        // Exponential backoff before this attempt (no delay on the first
        // attempt so transient blips recover immediately).
        await this.sleepReconnect(
          this.getReconnectDelay(this.reconnectAttempts),
        );
        if (!this.peerConnection || this.getConnectionState() === "failed")
          return;
        if (this.getConnectionState() === "connected") {
          this.reconnectAttempts = 0;
          return;
        }

        try {
          const recovered = await this.runReconnectAttempt();
          if (recovered) {
            this.reconnectAttempts = 0;
            return;
          }
        } catch (error) {
          this.events.onError(
            error instanceof Error
              ? error
              : new Error("Reconnection attempt failed"),
            "",
          );
        }
      }

      // Retries exhausted → terminal failure with an actionable error.
      if (this.getConnectionState() !== "connected") {
        this.handleConnectionFailure();
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Run a single reconnection attempt: the host (offerer) initiates an ICE
   * restart and emits the resulting offer; the answerer refreshes its ICE
   * configuration and waits for the host's restart offer to arrive via
   * signaling. Both sides then wait for recovery within the attempt timeout.
   */
  private async runReconnectAttempt(): Promise<boolean> {
    const pc = this.peerConnection;
    if (!pc) return false;

    if (this.isHost) {
      // The offerer drives the restart to avoid signaling glare.
      await this.performIceRestart();
    } else {
      // The answerer refreshes ICE servers and waits for the remote restart.
      try {
        pc.setConfiguration(this.rtcConfig);
      } catch {
        // setConfiguration can throw if the connection is mid-negotiation;
        // treat as best-effort and still wait for recovery.
      }
    }

    return this.waitForRecovery(this.reconnectAttemptTimeoutMs);
  }

  /**
   * Perform an ICE restart: refresh the ICE configuration, generate a new offer
   * with the iceRestart flag, apply it locally, and emit the offer so the
   * signaling layer can forward it to the remote peer for renegotiation.
   */
  private async performIceRestart(): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) return;

    pc.setConfiguration(this.rtcConfig);
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);

    this.events.onReconnectOffer?.(offer, "");
  }

  /**
   * Exponential backoff delay for the nth reconnection attempt. The first
   * attempt has no delay; subsequent attempts back off exponentially up to the
   * configured maximum.
   */
  private getReconnectDelay(attempt: number): number {
    if (attempt <= 1) return 0;
    const exp = this.reconnectBaseDelayMs * 2 ** (attempt - 2);
    return Math.min(exp, this.reconnectMaxDelayMs);
  }

  /**
   * Promise-based sleep used for inter-attempt backoff. Tracks the timer so it
   * can be cancelled when the connection is closed.
   */
  private sleepReconnect(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        resolve();
      }, ms);
    });
  }

  /**
   * Wait for the connection to recover to "connected" within the given timeout.
   * Resolves true on recovery, false on timeout or terminal failure.
   */
  private waitForRecovery(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (this.connectionState === "connected") {
        resolve(true);
        return;
      }

      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.recoveryWaiters = this.recoveryWaiters.filter(
          (w) => w !== resolveWaiter,
        );
        resolve(result);
      };
      // resolveWaiter is invoked by updateConnectionState() when the state
      // transitions to "connected" or "failed".
      const resolveWaiter = finish;
      this.recoveryWaiters.push(resolveWaiter);
      const timer = setTimeout(
        () => finish(this.connectionState === "connected"),
        timeoutMs,
      );
    });
  }

  /**
   * Resolve any pending recovery waiters with the given verdict.
   */
  private notifyRecoveryWaiters(recovered: boolean): void {
    const waiters = this.recoveryWaiters;
    this.recoveryWaiters = [];
    waiters.forEach((w) => w(recovered));
  }

  /**
   * Update connection state
   */
  private updateConnectionState(state: P2PConnectionState): void {
    this.connectionState = state;
    this.events.onConnectionStateChange(state, "");

    if (state === "connected") {
      this.notifyRecoveryWaiters(true);
    } else if (state === "failed") {
      this.notifyRecoveryWaiters(false);
    }
  }

  /**
   * Start ping interval for connection health checks
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
   * Send a single ping on demand. Used by external ping drivers such as a
   * connection pool that consolidates health checks for many connections into
   * one interval. Issue #1021.
   */
  ping(): void {
    this.sendPing();
  }

  /**
   * Cancel any in-flight reconnection cycle: clear the backoff timer and fail
   * any pending recovery waiters so the reconnection promise settles.
   */
  private cancelReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.notifyRecoveryWaiters(false);
  }

  /**
   * Send ping to check connection health
   */
  private sendPing(): void {
    this.send({
      type: "ping",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: null,
    });
  }

  /**
   * Send pong response
   */
  private sendPong(): void {
    this.send({
      type: "pong",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: null,
    });
  }

  /**
   * Send a message through the data channel
   */
  send(message: P2PMessage): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.warn("[WebRTC] Data channel not ready");
      return;
    }

    this.dataChannel.send(JSON.stringify(message));
  }

  /**
   * Send game state to peers with delta compression
   * Uses incremental delta sync for typical updates, full sync only on reconnection
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): void {
    for (const [peerId, peerInfo] of this.peers) {
      const peerState = this.peerSyncStates.get(peerId);
      const lastSyncedAI = peerState?.lastState ?? null;

      if (isFullSync || shouldUseFullSync(gameState, lastSyncedAI)) {
        this.sendFullSync(gameState, peerId);
      } else {
        this.sendDeltaSync(gameState, peerId, lastSyncedAI);
      }
    }
  }

  /**
   * Send full state sync to a specific peer
   */
  private sendFullSync(gameState: GameState, peerId: string): void {
    const serializedState = serializeGameState(gameState);
    const aiState = engineToAIState(gameState);

    const syncState: PeerSyncState = {
      lastVersion: (gameState.turn as unknown as { turnNumber?: number }).turnNumber ?? 0,
      lastChecksum: computeChecksum(aiState),
      lastState: aiState,
      lastSerializedState: JSON.stringify(serializedState),
    };
    this.peerSyncStates.set(peerId, syncState);

    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId)!;
      peer.lastSyncVersion = syncState.lastVersion;
      peer.lastSyncChecksum = syncState.lastChecksum;
    }

    this.send({
      type: "game-state-sync",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        gameState: serializedState,
        isFullSync: true,
      },
    });
  }

  /**
   * Send delta sync to a specific peer
   */
  private sendDeltaSync(
    gameState: GameState,
    peerId: string,
    lastSyncedAI: ReturnType<typeof engineToAIState> | null
  ): void {
    const delta = computeStateDelta(gameState, lastSyncedAI);
    const deltaSize = estimateDeltaSize(delta);

    if (deltaSize >= 10 * 1024) {
      this.sendFullSync(gameState, peerId);
      return;
    }

    const aiState = engineToAIState(gameState);
    const syncState: PeerSyncState = {
      lastVersion: delta.version,
      lastChecksum: delta.checksum,
      lastState: aiState,
      lastSerializedState: JSON.stringify(delta),
    };
    this.peerSyncStates.set(peerId, syncState);

    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId)!;
      peer.lastSyncVersion = syncState.lastVersion;
      peer.lastSyncChecksum = syncState.lastChecksum;
    }

    this.send({
      type: "game-state-sync",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        gameState: delta,
        isFullSync: false,
      },
    });
  }

  /**
   * Send a player action to peers
   */
  sendPlayerAction(action: string, data: unknown): void {
    this.send({
      type: "player-action",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        action,
        data,
      },
    });
  }

  /**
   * Send a chat message
   */
  sendChat(text: string): void {
    this.send({
      type: "chat",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        text,
      },
    });
  }

  /**
   * Send an emote
   */
  sendEmote(emote: string): void {
    this.send({
      type: "emote",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        emote,
      },
    });
  }

  /**
   * Send connection request
   */
  sendConnectionRequest(gameCode: string): void {
    this.send({
      type: "connection-request",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        playerName: this.localPlayerName,
        gameCode,
        isHost: this.isHost,
      },
    });
  }

  /**
   * Send connection accept
   */
  sendConnectionAccept(playerId: string): void {
    this.send({
      type: "connection-accept",
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        playerName: this.localPlayerName,
        playerId,
      },
    });
  }

  /**
   * Get current connection state
   */
  getConnectionState(): P2PConnectionState {
    return this.connectionState;
  }

  /**
   * Get connected peers
   */
  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  /**
   * Close the connection
   */
  close(): void {
    this.stopPingInterval();
    this.cancelReconnection();

    // Clean up ICE monitor
    if (this.iceMonitor) {
      this.iceMonitor.detach();
      this.iceMonitor = null;
    }

    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.peers.clear();
    this.pendingCandidates = [];
    this.updateConnectionState("disconnected");
  }

  /**
   * Get ICE connection statistics
   */
  async getICEStats(): Promise<RTCStatsReport | null> {
    if (!this.peerConnection) {
      return null;
    }

    try {
      return await this.peerConnection.getStats();
    } catch (error) {
      console.error("[WebRTC] Failed to get stats:", error);
      return null;
    }
  }

  /**
   * Get the current ICE connection state
   */
  getICEConnectionState(): RTCIceConnectionState | null {
    return this.peerConnection?.iceConnectionState || null;
  }

  /**
   * Get the ICE configuration manager
   */
  getICEManager(): ICEConfigurationManager {
    return this.iceManager;
  }

  /**
   * Check if TURN servers are configured
   */
  hasTurnServers(): boolean {
    return this.iceManager.hasTurnServers();
  }
}

/**
 * Generate a short game code for P2P connection
 */
export function generateGameCode(length: number = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excluding confusing characters
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}

/**
 * Create a new P2P connection
 */
export function createP2PConnection(
  options: P2PConnectionOptions,
): WebRTCConnection {
  return new WebRTCConnection(options);
}
