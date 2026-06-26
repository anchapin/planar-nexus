/**
 * P2P Game Connection Manager
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Manages WebRTC peer-to-peer connections for multiplayer games
 * using client-side signaling without server dependencies.
 */

import type {
  GameState,
  Phase,
  PlayerId,
  GameAction,
} from "./game-state/types";
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
import { ValidationService } from "./game-state/validation-service";
import {
  ICEConfigurationManager,
  getGlobalICEManager,
  type ICEConfigOptions,
} from "./ice-config";
import { safeParseJson, isNonNegativeInteger } from "./p2p-json-validation";
import { P2PRateLimiter, type P2PRateLimitOptions } from "./p2p-rate-limiter";
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
  /**
   * Emitted when the data channel / peer connection recovers AFTER a prior
   * disconnect (e.g. following an ICE-restart reconnect, issue #1086). This
   * is the canonical signal to reconcile authoritative game state: the host
   * pushes a full `game-state-sync` snapshot and the recovering peer adopts
   * it (re-basing its anti-replay counter via the snapshot's `lastSeq`).
   * Distinct from the initial connect. Optional. Issue #1086.
   */
  onReconnect?: () => void;
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
 *
 * `error` is the typed rejection/feedback channel used by the authoritative
 * host to tell a peer one of its `game-action`s was rejected by the rules
 * engine (issue #1089). It is informational — receiving one does NOT fail the
 * connection (unlike a transport-level failure routed through the private
 * `handleError`).
 *
 * `request-state-sync` lets a peer that notices drift (or that just
 * recovered after an ICE-restart reconnect, issue #1086) PULL a fresh
 * authoritative full `game-state-sync` snapshot from the host on demand. The
 * host responds via the {@link P2PGameConnectionOptions.onStateSyncRequest}
 * callback.
 */
export type GameMessageType =
  | "game-state-sync"
  | "game-action"
  | "chat"
  | "player-joined"
  | "player-left"
  | "ping"
  | "pong"
  | "error"
  | "request-state-sync";

/**
 * Base game message.
 *
 * Anti-replay field (issue #1091):
 *   `seq` is a monotonically-increasing sequence number assigned by the SENDER
 *   on every outgoing message (shared across all message types on a single
 *   connection — the underlying data channel is `ordered: true`, so one stream
 *   suffices). The receiver tracks the highest `seq` it has applied per
 *   `senderId` and rejects any message whose `seq` is `<=` that high-water
 *   mark. This drops duplicates (reconnect re-delivery, #943) and replays
 *   (host-migration rebroadcast, #946) before they can corrupt game state.
 *
 *   The `timestamp` field is retained for display/debugging only — it is NOT
 *   used for ordering or replay protection.
 */
export interface GameMessage {
  type: GameMessageType;
  senderId: string;
  timestamp: number;
  /**
   * Monotonic per-sender sequence number (starts at 0). Required on every
   * message; {@link isGameMessage} rejects messages missing it. See the class
   * header doc for the anti-replay policy. Issue #1091.
   */
  seq: number;
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
  "error",
  "request-state-sync",
]);

/**
 * Type guard validating the shape of an untrusted {@link GameMessage}.
 * Data-channel messages come directly from peers and must be validated before
 * use. Rejects valid JSON that does not match the expected schema.
 *
 * As of issue #1091 the `seq` field is REQUIRED and must be a non-negative
 * finite integer (validated via {@link isNonNegativeInteger}); messages
 * without it are rejected so the anti-replay check in {@link handleMessage}
 * can rely on the field being present and well-formed.
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
    typeof v.timestamp === "number" &&
    isNonNegativeInteger(v.seq)
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
 * Result of validating a peer-originated game-action against the rules engine
 * on the authoritative host. Issue #1089.
 */
export interface PeerActionValidationResult {
  isValid: boolean;
  /** Machine-readable reason the action was rejected (when `isValid` is false). */
  reason?: string;
}

/**
 * Wire payload of a `game-action` message — an action name plus its
 * action-specific data. Mirrors what {@link P2PGameConnection.sendGameAction}
 * puts on the wire. Issue #1089.
 */
export interface PeerGameActionPayload {
  action: string;
  data: unknown;
}

/**
 * Validator the authoritative host supplies to check a peer-originated
 * `game-action` against the rules engine using the host's OWN authoritative
 * state. The transport layer never owns or trusts peer-supplied state — it
 * delegates the legality decision to this callback.
 *
 * `peerAction` is the parsed `{ action, data }` payload of the `game-action`
 * message; `senderId` is the originating peer (the actor). Hosts typically
 * wire this to the rules engine via {@link createRulesEngineValidator}.
 * Issue #1089.
 */
export type PeerActionValidator = (
  peerAction: PeerGameActionPayload,
  senderId: string,
) => PeerActionValidationResult;

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
  /**
   * Authoritative-host game-action validation. When `true`, every incoming
   * peer `game-action` is run through {@link validatePeerAction} against the
   * host's authoritative state BEFORE it is emitted for application; illegal
   * actions are rejected (not applied) and the originating peer is notified
   * with an `error` message. Defaults to `false` so single-player/AI and
   * non-host paths are unaffected. Issue #1089.
   */
  validatePeerActions?: boolean;
  /**
   * Rules-engine validator invoked for each peer `game-action` when
   * {@link validatePeerActions} is enabled. Must validate against the host's
   * OWN authoritative state — never peer-supplied state. Use
   * {@link createRulesEngineValidator} to wire it to the rules engine.
   * Issue #1089.
   */
  validatePeerAction?: PeerActionValidator;
  /**
   * Host-side callback invoked when a peer sends a `request-state-sync`
   * message (issue #1086) — typically after that peer recovered from an
   * ICE-restart reconnect and wants to pull a fresh authoritative snapshot.
   * The host returns its authoritative {@link GameState}; the connection
   * serializes and pushes it as a full `game-state-sync` (`isFullSync: true`,
   * carrying `lastSeq`). Returning `null`/`undefined` is a no-op (e.g. the
   * host has no state yet). The transport never owns game state — it
   * delegates to this callback.
   */
  onStateSyncRequest?: () => GameState | null | undefined;
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
  /**
   * Monotonic outgoing sequence counter. Incremented for every message sent on
   * this connection (all types share one stream since the data channel is
   * `ordered: true`). Issue #1091.
   */
  private outgoingSeq: number = 0;
  /**
   * Highest sequence number applied per remote `senderId`. The anti-replay
   * high-water mark: any incoming message with `seq <=` the stored value is
   * dropped as a duplicate/replay BEFORE it touches game state. Issue #1091.
   *
   * Reset/advanced on a full `game-state-sync` (the reconciliation snapshot)
   * via the `lastSeq` field carried by the snapshot — see
   * {@link handleGameStateSync} and the host-migration policy in
   * `p2p-host-migration.ts`.
   */
  private lastAppliedSeqByPeer: Map<string, number> = new Map();
  /**
   * Authoritative-host game-action validation gate (issue #1089). When true,
   * incoming peer `game-action`s are validated by {@link validatePeerAction}
   * against the host's authoritative state before being applied.
   */
  private readonly validatePeerActions: boolean;
  /**
   * Rules-engine legality check for peer game-actions (issue #1089). Supplied
   * by the host; validates against the host's OWN state.
   */
  private readonly validatePeerAction: PeerActionValidator | null;
  /**
   * Host callback returning the authoritative state to push when a peer
   * requests a state sync (issue #1086). Null on non-hosts / when unwired.
   */
  private readonly onStateSyncRequest: (() => GameState | null | undefined) | null;
  /**
   * True once the connection has reached "connected" at least once. Used to
   * distinguish a RECONNECT (recovery after a drop) from the initial connect
   * so {@link P2PGameConnectionEvents.onReconnect} fires only on recovery.
   * Issue #1086.
   */
  private hadConnectedOnce = false;
  /**
   * True while the connection is in a disconnected/reconnecting state
   * following a prior connect. The next transition back to "connected" fires
   * {@link P2PGameConnectionEvents.onReconnect}. Issue #1086.
   */
  private wasDisconnected = false;

  constructor(options: P2PGameConnectionOptions) {
    this.playerId = options.playerId;
    this.playerName = options.playerName;
    this.connectionState = "disconnected";

    // Per-connection rate limiter guards the parse/validate path against
    // flooding peers. Issue #1111.
    this.rateLimiter = new P2PRateLimiter(options.rateLimit);

    // Authoritative-host action validation (issue #1089). Opt-in; disabled by
    // default so single-player/AI paths are unaffected.
    this.validatePeerActions = options.validatePeerActions === true;
    this.validatePeerAction = options.validatePeerAction ?? null;
    // Host-side state-sync request handler (issue #1086). Null on non-hosts
    // or when unwired; the transport never owns game state.
    this.onStateSyncRequest = options.onStateSyncRequest ?? null;

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
   * Send a game message.
   *
   * Stamps the monotonic outgoing `seq` (issue #1091) before transmission so
   * the receiver can reject duplicates and replays. The caller does not need
   * to supply `seq`; the few internal helpers below call
   * {@link nextOutgoingSeq} when constructing the message.
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
   * Allocate the next outgoing sequence number. Centralised so every send
   * path shares one monotonic counter. Issue #1091.
   */
  private nextOutgoingSeq(): number {
    return this.outgoingSeq++;
  }

  /**
   * Send game state to remote peer.
   *
   * `lastSeq` is carried only on a full sync (the reconciliation snapshot) so
   * the receiver can advance its per-sender anti-replay high-water mark —
   * see {@link handleGameStateSync}. Issue #1091.
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): boolean {
    const serialized = serializeGameState(gameState);

    return this.send({
      type: "game-state-sync",
      senderId: this.playerId,
      timestamp: Date.now(),
      seq: this.nextOutgoingSeq(),
      data: {
        gameState: serialized,
        isFullSync,
        // On a full reconciliation snapshot, carry the high-water mark of
        // applied seqs so the receiver can advance its anti-replay tracker
        // (and reject re-emitted/queued actions post host-migration #946).
        lastSeq: isFullSync ? this.outgoingSeq - 1 : undefined,
      },
    });
  }

  /**
   * Request a fresh authoritative full `game-state-sync` from the host.
   *
   * Sent by a peer that notices drift or that just recovered after an
   * ICE-restart reconnect (issue #1086). The host responds by pushing its
   * authoritative state via the {@link P2PGameConnectionOptions.onStateSyncRequest}
   * callback (see {@link handleRequestStateSync}). The request itself carries
   * no payload; it is a one-bit "please re-sync me" signal.
   */
  requestStateSync(): boolean {
    return this.send({
      type: "request-state-sync",
      senderId: this.playerId,
      timestamp: Date.now(),
      seq: this.nextOutgoingSeq(),
      data: null,
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
      seq: this.nextOutgoingSeq(),
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
      seq: this.nextOutgoingSeq(),
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
      seq: this.nextOutgoingSeq(),
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
      seq: this.nextOutgoingSeq(),
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
   *   3. Shape validation via {@link isGameMessage} (including the required
   *      `seq` field added in #1091).
   *   4. Anti-replay check: a message with `seq <=` the highest seq already
   *      applied from this `senderId` is dropped as a duplicate/replay BEFORE
   *      it can be applied to game state (issue #1091).
   *   5. Rules-engine legality (issue #1089): on the authoritative host, a
   *      `game-action` is validated against the host's own state; illegal
   *      actions are rejected (peer notified via an `error` message) BEFORE
   *      they are applied.
   *
   * The legality stage (#5) runs strictly AFTER anti-replay (#4) and
   * structural/shape checks (#2/#3) and strictly BEFORE the action is emitted
   * for application, so an illegal action can never touch host game state.
   *
   * Malformed, oversize, rate-limited, replayed, or illegal messages are
   * rejected gracefully without breaking the connection.
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

      // Anti-replay (issue #1091): drop duplicates and replays BEFORE the
      // message can touch game state. This runs after shape validation so
      // `message.seq` is guaranteed to be a non-negative integer.
      if (this.isReplay(message)) {
        console.warn(
          "[P2PGameConnection] Dropping duplicate/replay message",
          redactSensitive({ senderId: message.senderId, seq: message.seq }),
        );
        return;
      }
      this.markApplied(message);

      // Update remote player info
      if (this.remotePlayerId === null) {
        this.remotePlayerId = message.senderId;
      }

      switch (message.type) {
        case "game-state-sync":
          this.handleGameStateSync(message);
          break;
        case "game-action": {
          // Rules-engine legality (issue #1089). Runs AFTER anti-replay
          // (#1091) and structural/shape checks, and BEFORE the action is
          // emitted for application — so an illegal action can never touch
          // host game state. Only the authoritative host opts in. Fail-closed:
          // if the gate is on but no validator is wired, actions are rejected
          // rather than applied unvalidated (trust-boundary default).
          if (this.validatePeerActions) {
            const result = this.validatePeerGameAction(message);
            if (!result.isValid) {
              this.sendActionRejection(message, result.reason);
              // Do NOT fall through to onMessage: the illegal action is not
              // applied. `return` skips the post-switch emission too.
              return;
            }
          }
          // Legal (or validation disabled): forward to onMessage below.
          break;
        }
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
        case "error": {
          // A peer (typically the host) is signalling a rejection/error.
          // Surface it WITHOUT failing the connection (the private
          // handleError sets state=failed — we must not call it here). The
          // message also flows to onMessage below for app-level handling.
          // Issue #1089.
          const errorData = message.data as { reason?: string };
          this.events.onError(
            new Error(
              typeof errorData?.reason === "string"
                ? errorData.reason
                : "Received error message from peer",
            ),
          );
          break;
        }
        case "request-state-sync":
          // A peer (typically one that just recovered from an ICE-restart
          // reconnect, #1086) wants a fresh authoritative snapshot. Only the
          // host can answer; non-hosts ignore the request.
          this.handleRequestStateSync(message);
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
   * Anti-replay check (issue #1091). Returns true when `message.seq` has
   * already been applied (or is older than the last applied) for this
   * `senderId`, indicating a duplicate or replay that must be dropped.
   */
  private isReplay(message: GameMessage): boolean {
    const last = this.lastAppliedSeqByPeer.get(message.senderId);
    if (last === undefined) {
      // First message observed from this sender — accept.
      return false;
    }
    return message.seq <= last;
  }

  /**
   * Record the high-water mark for `message.senderId` as `message.seq`.
   * Used on every accepted message so the stream stays monotonic. Issue #1091.
   */
  private markApplied(message: GameMessage): void {
    const last = this.lastAppliedSeqByPeer.get(message.senderId) ?? -1;
    if (message.seq > last) {
      this.lastAppliedSeqByPeer.set(message.senderId, message.seq);
    }
  }

  /**
   * The highest outgoing seq this connection has stamped so far. Exposed so a
   * newly-promoted host (issue #946) can ship it as the `lastSeq` high-water
   * mark in the post-migration reconciliation snapshot. Issue #1091.
   */
  getOutgoingSeq(): number {
    return this.outgoingSeq;
  }

  /**
   * Advance the outgoing seq counter to at least `seq` (no-op if already past
   * it). A newly-promoted host calls this after host migration (#946) so its
   * post-migration messages continue monotonically from the authoritative
   * high-water mark, letting followers reject any queued/re-emitted actions
   * they already saw from the previous host. Issue #1091.
   */
  adoptOutgoingSeq(seq: number): void {
    if (Number.isFinite(seq) && seq >= 0 && seq > this.outgoingSeq) {
      this.outgoingSeq = seq;
    }
  }

  /**
   * Highest seq applied from `senderId`, or `null` if no message has been seen
   * from that sender. Exposed for diagnostics and tests. Issue #1091.
   */
  getLastAppliedSeq(senderId: string): number | null {
    const v = this.lastAppliedSeqByPeer.get(senderId);
    return v === undefined ? null : v;
  }

  /**
   * Reset the anti-replay high-water mark for a sender (e.g. when starting a
   * fresh session or recovering from a known-clean state). Issue #1091.
   */
  resetIncomingSeq(senderId: string): void {
    this.lastAppliedSeqByPeer.delete(senderId);
  }

  /**
   * Validate a peer-originated `game-action` against the rules engine using
   * the host's authoritative state (via {@link validatePeerAction}). Defensive
   * against malformed payloads and throwing validators: anything that cannot
   * be confirmed legal is treated as illegal (fail-closed) so it can never be
   * applied to host state. Issue #1089.
   */
  private validatePeerGameAction(
    message: GameMessage,
  ): PeerActionValidationResult {
    const payload = message.data;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { action?: unknown }).action !== "string"
    ) {
      return { isValid: false, reason: "Malformed game action" };
    }
    const peerAction = payload as PeerGameActionPayload;
    if (!this.validatePeerAction) {
      // Gate enabled without a validator — fail-closed.
      return { isValid: false, reason: "No action validator configured" };
    }
    try {
      const result = this.validatePeerAction(peerAction, message.senderId);
      if (
        result &&
        typeof result === "object" &&
        typeof result.isValid === "boolean"
      ) {
        return result;
      }
      return { isValid: false, reason: "Invalid validator result" };
    } catch (error) {
      // A throwing validator is treated as a rejection — never apply.
      return {
        isValid: false,
        reason:
          error instanceof Error ? error.message : "Action validation error",
      };
    }
  }

  /**
   * Notify the originating peer that its `game-action` was rejected by the
   * authoritative host. Reuses the typed message channel (an `error` message)
   * rather than introducing a new protocol. Issue #1089.
   */
  private sendActionRejection(
    message: GameMessage,
    reason: string | undefined,
  ): void {
    const payload = message.data as { action?: unknown };
    this.send({
      type: "error",
      senderId: this.playerId,
      timestamp: Date.now(),
      seq: this.nextOutgoingSeq(),
      data: {
        code: "action_rejected",
        action:
          typeof payload?.action === "string" ? payload.action : undefined,
        reason: reason ?? "Action rejected by host",
        // Echo the rejected message's seq so the peer can correlate.
        rejectedSeq: message.seq,
      },
    });
  }

  /**
   * Handle game state sync.
   *
   * On a FULL sync (the reconciliation snapshot, e.g. post host-migration
   * #946 or after an ICE-restart reconnect #1086), the sender carries
   * `lastSeq` — the high-water mark of applied sequence numbers baked into
   * this state. The receiver advances its per-sender anti-replay tracker to
   * that mark so any queued / re-emitted action with `seq <= lastSeq` is
   * rejected as a replay (issue #1091). `max(current, lastSeq)` is used so a
   * duplicate delivery of the snapshot itself is still rejected by the
   * earlier {@link isReplay} check.
   *
   * The full-sync adoption is the receiving half of authoritative-state
   * reconciliation (#1086): the recovering peer discards its diverged local
   * state and adopts the host's authoritative snapshot as the single source
   * of truth (see `p2p-reconciliation.ts` for the pending-action policy).
   *
   * The seq advancement runs BEFORE state deserialization so a malformed
   * payload cannot leave the anti-replay tracker stuck at a stale value.
   */
  private handleGameStateSync(message: GameMessage): void {
    const data = message.data as {
      gameState: SerializedGameState;
      isFullSync: boolean;
      lastSeq?: number;
    };

    // Advance the anti-replay high-water mark first (transport-level concern,
    // independent of whether the payload deserializes).
    if (data.isFullSync && isNonNegativeInteger(data.lastSeq)) {
      const current = this.lastAppliedSeqByPeer.get(message.senderId) ?? -1;
      this.lastAppliedSeqByPeer.set(
        message.senderId,
        Math.max(current, data.lastSeq),
      );
    }

    const baseState = this.createBaseEngineState();
    const gameState = deserializeGameState(data.gameState, baseState);
    this.events.onGameStateSync(gameState);
  }

  /**
   * Handle a `request-state-sync` from a peer (issue #1086). Only the
   * authoritative host can answer: it asks the host-side
   * {@link onStateSyncRequest} callback for its authoritative state and
   * pushes it back as a full `game-state-sync` (`isFullSync: true`, carrying
   * `lastSeq`). Non-hosts, or hosts with no state / no callback wired, do
   * nothing (fail-open: a missing snapshot leaves the peer to retry or rely
   * on the reconnect-driven push). The transport never owns game state.
   */
  private handleRequestStateSync(message: GameMessage): void {
    void message; // senderId available if per-peer throttling is ever needed.
    if (!this.onStateSyncRequest) return;
    let state: GameState | null | undefined;
    try {
      state = this.onStateSyncRequest();
    } catch (error) {
      // #982: redact — a throwing host callback may reference game state.
      console.error(
        "[P2PGameConnection] onStateSyncRequest threw:",
        redactSensitive(error),
      );
      return;
    }
    if (state) {
      this.sendGameState(state, true);
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
   * Update connection state.
   *
   * On a transition INTO "connected" that follows a prior disconnect (i.e. a
   * reconnect, e.g. after an ICE-restart recovery), fires
   * {@link P2PGameConnectionEvents.onReconnect} exactly once so the
   * integration layer can reconcile authoritative game state. Never fires on
   * the initial connect. Issue #1086.
   */
  private updateConnectionState(state: P2PConnectionState): void {
    const previous = this.connectionState;
    this.connectionState = state;
    this.events.onConnectionStateChange(state);

    if (state === "connected") {
      if (!this.hadConnectedOnce) {
        this.hadConnectedOnce = true;
      } else if (previous !== "connected" && this.wasDisconnected) {
        // Reconnect after a drop — signal authoritative-state reconciliation.
        this.wasDisconnected = false;
        this.events.onReconnect?.();
      }
    } else if (
      state === "disconnected" ||
      state === "reconnecting" ||
      state === "failed"
    ) {
      if (this.hadConnectedOnce) {
        this.wasDisconnected = true;
      }
    }
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
    // Drop anti-replay tracking so a fresh session isn't poisoned by stale
    // high-water marks from the previous peer. Issue #1091.
    this.lastAppliedSeqByPeer.clear();
    // Reset the reconnect-edge detectors so a fresh session's initial
    // connect never fires a spurious onReconnect. Issue #1086.
    this.hadConnectedOnce = false;
    this.wasDisconnected = false;
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

/**
 * Build a {@link PeerActionValidator} that delegates to the rules engine
 * (`ValidationService.validateAction`) against the host's authoritative state.
 *
 * The host supplies `getState`, which must return its OWN authoritative
 * {@link GameState} at call time — never a state claimed by the peer. The wire
 * payload (`{ action, data }`) plus the originating `senderId` are mapped to
 * the engine's {@link GameAction} and validated in place; the action is NOT
 * applied (this only decides legality). Issue #1089.
 *
 * Example (authoritative host):
 * ```ts
 * createP2PGameConnection({
 *   // ...
 *   validatePeerActions: true,
 *   validatePeerAction: createRulesEngineValidator(
 *     () => authoritativeGameStateRef.current,
 *   ),
 * });
 * ```
 *
 * This wrapper only delegates — it does not reimplement rules. Unknown action
 * types therefore fall through to `ValidationService.validateAction`'s default
 * handling.
 */
export function createRulesEngineValidator(
  getState: () => GameState,
  modeId?: string,
): PeerActionValidator {
  return (peerAction, senderId) => {
    const state = getState();
    const gameAction = {
      type: peerAction.action,
      playerId: senderId as PlayerId,
      timestamp: Date.now(),
      data: peerAction.data,
    } as unknown as GameAction;
    const result = ValidationService.validateAction(state, gameAction, modeId);
    return { isValid: result.isValid, reason: result.reason };
  };
}
