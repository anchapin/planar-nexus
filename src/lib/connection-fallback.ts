/**
 * Connection Fallback Manager
 * Issue #304: Add WebSocket fallback for non-P2P scenarios
 * Issue #985: Comprehensive error handling for async methods
 *
 * This module provides automatic fallback from WebRTC P2P to WebSocket
 * when direct peer-to-peer connections cannot be established.
 *
 * #985 — Every async method is wrapped in try/catch, failures are surfaced
 * to the host application via the `onError` event callback, and structured
 * {@link ConnectionError} instances (carrying a stable {@link ConnectionErrorCode})
 * are thrown so callers can branch on failure mode. Transient WebRTC failures
 * are retried with exponential backoff. The redaction added by #982 is
 * preserved on every diagnostic log call.
 */

import { WebRTCConnection, type P2PConnectionState, type P2PMessage, type P2PEvents } from './webrtc-p2p';
import {
  WebSocketConnection,
  type WebSocketConnectionState,
  type WebSocketEvents,
  type WebSocketConfig,
  isWebSocketAvailable,
} from './websocket-connection';
import type { GameState } from './game-state/types';
import { TIMEOUTS } from './config/timeouts';
import { redactSensitive } from './p2p-log-redact';

/**
 * Connection type
 */
export type ConnectionType = 'webrtc' | 'websocket' | 'none';

/**
 * Structured failure codes for the connection state machine (#985).
 *
 * Callers can `instanceof ConnectionError` + switch on `code` to react to
 * distinct failure modes (retry WebRTC, surface a "network down" banner,
 * disable the join button, etc.).
 */
export enum ConnectionErrorCode {
  /** ICE negotiation failed or the peer connection never opened. */
  ICE_FAILED = 'ICE_FAILED',
  /** WebRTC connection failed (initialization, data channel, or retries exhausted). */
  WEBRTC_FAILED = 'WEBRTC_FAILED',
  /** WebRTC is not available in this environment (e.g. no `RTCPeerConnection`). */
  WEBRTC_UNAVAILABLE = 'WEBRTC_UNAVAILABLE',
  /** The WebSocket transport failed (`new WebSocket(...)` or `connect()` rejected). */
  WEBSOCKET_FAILED = 'WEBSOCKET_FAILED',
  /** No `websocketUrl` was configured or `isWebSocketAvailable()` returned false. */
  WEBSOCKET_UNAVAILABLE = 'WEBSOCKET_UNAVAILABLE',
  /** A connection attempt exceeded its configured timeout. */
  TIMEOUT = 'TIMEOUT',
  /** Neither WebRTC nor WebSocket is available. */
  NO_CONNECTION_METHOD = 'NO_CONNECTION_METHOD',
  /** Both WebRTC and WebSocket were tried and neither connected. */
  BOTH_FAILED = 'BOTH_FAILED',
  /** The retry budget for a transient failure was exhausted. */
  RETRY_EXHAUSTED = 'RETRY_EXHAUSTED',
  /** A `send*` call could not be delivered because the active transport threw. */
  SEND_FAILED = 'SEND_FAILED',
}

/**
 * Typed connection error. Carries a stable {@link ConnectionErrorCode} and,
 * when chained from an underlying transport error, the original `cause`
 * (preserved verbatim — never reaches `console.*` without going through
 * {@link redactSensitive} first).
 */
export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  readonly cause?: Error;

  constructor(code: ConnectionErrorCode, message: string, cause?: Error) {
    super(message);
    this.name = 'ConnectionError';
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
    // Restore prototype chain across transpilation targets — required for
    // `instanceof ConnectionError` to work on ES5 targets.
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Connection fallback state
 */
export interface ConnectionFallbackState {
  preferredConnection: ConnectionType;
  activeConnection: ConnectionType;
  webrtcState: P2PConnectionState | null;
  websocketState: WebSocketConnectionState | null;
  fallbackAttempted: boolean;
  lastError: string | null;
}

/**
 * Connection fallback events
 */
export interface ConnectionFallbackEvents {
  onConnectionStateChange: (state: ConnectionFallbackState) => void;
  onConnectionTypeChange: (type: ConnectionType) => void;
  onMessage: (message: P2PMessage, peerId: string) => void;
  onGameStateSync: (gameState: GameState) => void;
  onError: (error: Error) => void;
  onPeerConnected: (peerId: string, peerName?: string) => void;
  onPeerDisconnected: (peerId: string) => void;
}

/**
 * Connection fallback options
 */
export interface ConnectionFallbackOptions {
  playerId: string;
  playerName: string;
  isHost: boolean;
  gameCode?: string;
  websocketUrl?: string;
  webrtcConfig?: RTCConfiguration;
  events: ConnectionFallbackEvents;
  /** Timeout before falling back to WebSocket (ms) */
  fallbackTimeout?: number;
  /** Enable WebSocket fallback */
  enableFallback?: boolean;
  /** Prefer WebSocket over WebRTC */
  preferWebSocket?: boolean;
  /**
   * Maximum number of WebRTC retry attempts after the initial failure
   * before bubbling the error up (#985). Defaults to 0 to preserve the
   * pre-#985 single-attempt behaviour; set to ≥1 to enable retry/backoff.
   */
  maxRetries?: number;
  /**
   * Base delay (ms) for exponential backoff between WebRTC retries
   * (#985). Actual delay is `retryBaseDelayMs * 2^attempt`. Defaults
   * to 1000ms; tests usually set this to a small value to run fast.
   */
  retryBaseDelayMs?: number;
}

/** Default backoff base delay for {@link ConnectionFallbackOptions.retryBaseDelayMs}. */
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

/**
 * Connection Fallback Manager
 * Manages automatic fallback between WebRTC and WebSocket connections
 */
export class ConnectionFallbackManager {
  private webrtcConnection: WebRTCConnection | null = null;
  private websocketConnection: WebSocketConnection | null = null;
  private options: Required<Omit<ConnectionFallbackOptions, 'events'>> & { events: ConnectionFallbackEvents };
  private state: ConnectionFallbackState;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionAttempts = 0;
  private maxConnectionAttempts = 3;

  constructor(options: ConnectionFallbackOptions) {
    this.options = {
      ...options,
      gameCode: options.gameCode ?? '',
      webrtcConfig: options.webrtcConfig ?? {},
      websocketUrl: options.websocketUrl || process.env.NEXT_PUBLIC_WEBSOCKET_URL || '',
      fallbackTimeout: options.fallbackTimeout ?? TIMEOUTS.P2P_FALLBACK_TIMEOUT_MS,
      enableFallback: options.enableFallback ?? true,
      preferWebSocket: options.preferWebSocket ?? false,
      maxRetries: options.maxRetries ?? 0,
      retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    };

    this.state = {
      preferredConnection: options.preferWebSocket ? 'websocket' : 'webrtc',
      activeConnection: 'none',
      webrtcState: null,
      websocketState: null,
      fallbackAttempted: false,
      lastError: null,
    };
  }

  /**
   * Initialize the connection with automatic fallback.
   *
   * #985: every branch is wrapped in try/catch; failures surface to the
   * caller as {@link ConnectionError} and to the host via `onError`.
   */
  async initialize(): Promise<ConnectionType> {
    try {
      // If WebSocket is preferred or WebRTC is not available, start with WebSocket
      if (this.options.preferWebSocket || !this.isWebRTCAvailable()) {
        if (isWebSocketAvailable() && this.options.websocketUrl) {
          return await this.connectWebSocket();
        }
        const err = new ConnectionError(
          ConnectionErrorCode.NO_CONNECTION_METHOD,
          'No connection method available',
        );
        this.recordError(err);
        throw err;
      }

      // Try WebRTC first with fallback to WebSocket
      try {
        return await this.connectWithFallback();
      } catch (error) {
        if (error instanceof ConnectionError) {
          throw error;
        }
        const wrapped = new ConnectionError(
          ConnectionErrorCode.WEBRTC_FAILED,
          `Failed to establish connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error instanceof Error ? error : undefined,
        );
        this.recordError(wrapped);
        throw wrapped;
      }
    } catch (error) {
      // Top-level safety net: never let an unexpected exception escape
      // untyped or unobserved. Already-typed ConnectionErrors pass through.
      if (error instanceof ConnectionError) {
        throw error;
      }
      const wrapped = new ConnectionError(
        ConnectionErrorCode.WEBRTC_FAILED,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
      );
      this.recordError(wrapped);
      throw wrapped;
    }
  }

  /**
   * Connect with automatic fallback (#985).
   *
   * Refactored to guarantee:
   *   - the fallback timer is always cleared on settle (no leaked timers);
   *   - exactly one of resolve/reject is invoked (no double-settle);
   *   - unhandled promise rejections cannot escape — every `.then` has a
   *     paired `.catch` that feeds the central settle path;
   *   - both-failed cases reject with {@link ConnectionErrorCode.BOTH_FAILED}.
   */
  private connectWithFallback(): Promise<ConnectionType> {
    // Single-shot race; every async branch terminates via the shared settle
    // helpers below. Promise executor is synchronous — the inner async work
    // is kicked off and resolved/rejected through settle{Resolve,Reject}.
    return new Promise<ConnectionType>((resolve, reject) => {
      let settled = false;

      const settleResolve = (type: ConnectionType): void => {
        if (settled) return;
        settled = true;
        this.clearFallbackTimer();
        resolve(type);
      };

      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        this.clearFallbackTimer();
        reject(err);
      };

      // Try the WebSocket fallback now (or after a delay). Cleans up the
      // pending WebRTC attempt first to avoid overlapping transports.
      // Precondition: fallback is enabled & WS is available — callers
      // (catch handler / fallback timer) check this before invoking.
      const attemptFallback = (reason: string): void => {
        if (settled) return;
        this.clearFallbackTimer();
        // Mark fallbackAttempted so a late WebRTC failure doesn't retrigger.
        this.state.fallbackAttempted = true;
        this.connectWebSocket()
          .then(settleResolve)
          .catch((wsError) => {
            const wrapped =
              wsError instanceof ConnectionError
                ? wsError
                : new ConnectionError(
                    ConnectionErrorCode.WEBSOCKET_FAILED,
                    wsError instanceof Error ? wsError.message : String(wsError),
                    wsError instanceof Error ? wsError : undefined,
                  );
            settleReject(
              new ConnectionError(
                ConnectionErrorCode.BOTH_FAILED,
                `WebRTC and WebSocket both failed: ${reason}`,
                wrapped,
              ),
            );
          });
      };

      // Set up fallback timer (only when a fallback is possible)
      if (this.options.enableFallback && isWebSocketAvailable() && this.options.websocketUrl) {
        this.fallbackTimer = setTimeout(() => {
          if (settled || this.state.activeConnection === 'webrtc') return;
          console.info('[ConnectionFallback] WebRTC connection timeout, falling back to WebSocket');
          attemptFallback('WebRTC connection timed out');
        }, this.options.fallbackTimeout);
      }

      // Try WebRTC connection. Any rejection is logged with #982 redaction
      // and surfaced to the host via onError, then routed through the
      // fallback decision above.
      this.connectWebRTC()
        .then(settleResolve)
        .catch((error) => {
          // #982: redact — WebRTC connection errors may embed SDP / ICE config.
          console.error('[ConnectionFallback] WebRTC connection failed:', redactSensitive(error));
          this.state.lastError = error instanceof Error ? error.message : 'WebRTC connection failed';
          this.options.events.onError(error instanceof Error ? error : new Error(String(error)));

          // If no fallback is possible, bubble the original (already-typed)
          // error verbatim — this preserves RETRY_EXHAUSTED / WEBRTC_FAILED
          // for the caller instead of masking it.
          if (
            !this.options.enableFallback ||
            !isWebSocketAvailable() ||
            !this.options.websocketUrl
          ) {
            settleReject(
              error instanceof Error
                ? error
                : new ConnectionError(
                    ConnectionErrorCode.WEBRTC_FAILED,
                    String(error),
                  ),
            );
            return;
          }

          attemptFallback(
            error instanceof Error ? error.message : 'WebRTC connection failed',
          );
        });
    });
  }

  /**
   * Connect using WebRTC (#985).
   *
   * Wraps the underlying `establishWebRTC` in a retry loop with exponential
   * backoff for transient failures. After {@link ConnectionFallbackOptions.maxRetries}
   * retries, throws a typed {@link ConnectionError} with code
   * {@link ConnectionErrorCode.WEBRTC_FAILED}.
   */
  private async connectWebRTC(): Promise<ConnectionType> {
    const maxAttempts = 1 + this.options.maxRetries; // initial attempt + retries
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.establishWebRTC();
      } catch (error) {
        lastError = error;
        // Record the failure so the host can observe intermediate retries.
        const msg = error instanceof Error ? error.message : String(error);
        this.state.lastError = msg;
        // Surface each attempt failure to UI, but keep retrying.
        this.options.events.onError(
          new ConnectionError(
            ConnectionErrorCode.WEBRTC_FAILED,
            `WebRTC attempt ${attempt + 1}/${maxAttempts} failed: ${msg}`,
            error instanceof Error ? error : undefined,
          ),
        );

        if (attempt < maxAttempts - 1) {
          // Exponential backoff: base * 2^attempt
          const delay = this.options.retryBaseDelayMs * Math.pow(2, attempt);
          try {
            await this.sleep(delay);
          } catch {
            // sleep does not throw in practice; ignore.
          }
          continue;
        }
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : 'Unknown error';
    throw new ConnectionError(
      this.options.maxRetries > 0
        ? ConnectionErrorCode.RETRY_EXHAUSTED
        : ConnectionErrorCode.WEBRTC_FAILED,
      `WebRTC connection failed after ${maxAttempts} attempt(s): ${message}`,
      lastError instanceof Error ? lastError : undefined,
    );
  }

  /**
   * Establish a fresh WebRTC connection (single attempt). Throws on any
   * failure; {@link connectWebRTC} handles retry/backoff.
   */
  private async establishWebRTC(): Promise<ConnectionType> {
    const events: P2PEvents = {
      onConnectionStateChange: (state, _peerId) => {
        this.state.webrtcState = state;
        this.notifyStateChange();

        if (state === 'failed' && this.options.enableFallback && !this.state.fallbackAttempted) {
          this.attemptFallback().catch((err) => {
            // Already logged inside attemptFallback; suppress unhandled rejection.
            console.error(
              '[ConnectionFallback] Unhandled error in auto-fallback:',
              redactSensitive(err),
            );
          });
        }
      },
      onMessage: (message, _peerId) => {
        this.options.events.onMessage(message, _peerId);
      },
      onGameStateSync: (gameState, _peerId) => {
        this.options.events.onGameStateSync(gameState);
      },
      onPlayerAction: (action, data, _peerId) => {
        this.options.events.onMessage({
          type: 'player-action',
          senderId: _peerId,
          timestamp: Date.now(),
          payload: { action, data },
        }, _peerId);
      },
      onChat: (text, _peerId) => {
        this.options.events.onMessage({
          type: 'chat',
          senderId: _peerId,
          timestamp: Date.now(),
          payload: { text },
        }, _peerId);
      },
      onEmote: (emote, _peerId) => {
        this.options.events.onMessage({
          type: 'emote',
          senderId: _peerId,
          timestamp: Date.now(),
          payload: { emote },
        }, _peerId);
      },
      onError: (error, _peerId) => {
        this.state.lastError = error.message;
        this.notifyStateChange();
        this.options.events.onError(error);
      },
      onPeerConnected: (peerInfo) => {
        this.options.events.onPeerConnected(peerInfo.peerId, peerInfo.playerName);
      },
      onPeerDisconnected: (peerId) => {
        this.options.events.onPeerDisconnected(peerId);
      },
    };

    try {
      this.webrtcConnection = new WebRTCConnection({
        playerId: this.options.playerId,
        playerName: this.options.playerName,
        isHost: this.options.isHost,
        gameCode: this.options.gameCode,
        rtcConfig: this.options.webrtcConfig,
        events,
      });

      await this.webrtcConnection.initialize();
      this.state.activeConnection = 'webrtc';
      this.notifyStateChange();
      this.options.events.onConnectionTypeChange('webrtc');

      return 'webrtc';
    } catch (error) {
      // Clean up partially-initialised connection so a retry starts clean.
      this.cleanupWebRTC();
      // #982: redact — underlying errors may embed SDP / ICE config.
      console.error(
        '[ConnectionFallback] WebRTC establishment failed:',
        redactSensitive(error),
      );
      throw error instanceof Error
        ? error
        : new Error(String(error));
    }
  }

  /**
   * Connect using WebSocket (#985).
   *
   * Surfaces connect failures as {@link ConnectionError} with codes
   * {@link ConnectionErrorCode.WEBSOCKET_UNAVAILABLE} or
   * {@link ConnectionErrorCode.WEBSOCKET_FAILED}.
   */
  private async connectWebSocket(): Promise<ConnectionType> {
    if (!isWebSocketAvailable() || !this.options.websocketUrl) {
      throw new ConnectionError(
        ConnectionErrorCode.WEBSOCKET_UNAVAILABLE,
        'WebSocket is not available',
      );
    }

    const events: WebSocketEvents = {
      onConnectionStateChange: (state) => {
        this.state.websocketState = state;
        this.notifyStateChange();

        if (state === 'failed') {
          this.recordError(new Error('WebSocket connection failed'));
        }
      },
      onMessage: (message) => {
        this.options.events.onMessage(message, message.senderId);
      },
      onGameStateSync: (gameState) => {
        this.options.events.onGameStateSync(gameState);
      },
      onError: (error) => {
        this.recordError(error);
      },
      onPlayerJoined: (playerId, playerName) => {
        this.options.events.onPeerConnected(playerId, playerName);
      },
      onPlayerLeft: (playerId) => {
        this.options.events.onPeerDisconnected(playerId);
      },
    };

    const config: WebSocketConfig = {
      serverUrl: this.options.websocketUrl,
      autoReconnect: true,
    };

    try {
      this.websocketConnection = new WebSocketConnection(config, events);
      await this.websocketConnection.connect();
    } catch (error) {
      // Tear down the half-constructed socket so callers can retry cleanly.
      this.cleanupWebSocket();
      // #982: redact — WS fallback errors may embed server URLs carrying session tokens.
      console.error(
        '[ConnectionFallback] WebSocket connection failed:',
        redactSensitive(error),
      );
      const wrapped = new ConnectionError(
        ConnectionErrorCode.WEBSOCKET_FAILED,
        `WebSocket connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
      );
      this.recordError(wrapped);
      throw wrapped;
    }

    this.state.activeConnection = 'websocket';
    this.state.fallbackAttempted = true;
    this.notifyStateChange();
    this.options.events.onConnectionTypeChange('websocket');

    return 'websocket';
  }

  /**
   * Attempt fallback to WebSocket (#985).
   *
   * Surfaces failures via `onError`. Never throws to the caller of an
   * auto-fallback (it's invoked from event handlers); explicit
   * {@link forceFallback} surfaces the typed error.
   */
  private async attemptFallback(): Promise<void> {
    if (this.state.fallbackAttempted) {
      return;
    }

    console.info('[ConnectionFallback] Attempting fallback to WebSocket');
    this.state.fallbackAttempted = true;

    // Clean up WebRTC connection
    this.cleanupWebRTC();

    try {
      await this.connectWebSocket();
    } catch (error) {
      // #982: redact — fallback errors may embed WS URLs / session tokens.
      console.error('[ConnectionFallback] Fallback to WebSocket failed:', redactSensitive(error));
      const wrapped =
        error instanceof ConnectionError
          ? error
          : new ConnectionError(
              ConnectionErrorCode.WEBSOCKET_FAILED,
              error instanceof Error ? error.message : String(error),
              error instanceof Error ? error : undefined,
            );
      this.recordError(wrapped);
    }
  }

  /**
   * Check if WebRTC is available
   */
  private isWebRTCAvailable(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  /**
   * Notify state change
   */
  private notifyStateChange(): void {
    this.options.events.onConnectionStateChange({ ...this.state });
  }

  /**
   * Record an error in the shared state and notify the host (#985).
   * Centralises the "set lastError + onError" pattern.
   */
  private recordError(error: Error): void {
    this.state.lastError = error.message;
    this.notifyStateChange();
    this.options.events.onError(error);
  }

  /** Clear the fallback timer if it is pending. */
  private clearFallbackTimer(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /** Tear down a WebRTC connection (if any), ignoring close() failures. */
  private cleanupWebRTC(): void {
    if (!this.webrtcConnection) return;
    try {
      this.webrtcConnection.close();
    } catch (err) {
      console.warn(
        '[ConnectionFallback] Error closing WebRTC connection during cleanup:',
        redactSensitive(err),
      );
    }
    this.webrtcConnection = null;
  }

  /** Tear down a WebSocket connection (if any), ignoring disconnect() failures. */
  private cleanupWebSocket(): void {
    if (!this.websocketConnection) return;
    try {
      this.websocketConnection.disconnect();
    } catch (err) {
      console.warn(
        '[ConnectionFallback] Error closing WebSocket connection during cleanup:',
        redactSensitive(err),
      );
    }
    this.websocketConnection = null;
  }

  /**
   * Promise-based delay used for exponential backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Send a message through the active connection (#985).
   *
   * Synchronous transports can still throw (e.g. data channel in CLOSED
   * state). We catch, surface via onError, and never re-throw — the state
   * machine must not crash on a single dropped message.
   */
  send(message: P2PMessage): void {
    try {
      if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
        this.webrtcConnection.send(message);
      } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
        this.websocketConnection.send(message);
      } else {
        console.warn('[ConnectionFallback] No active connection to send message');
      }
    } catch (error) {
      this.recordSendError('send', error);
    }
  }

  /**
   * Send game state through the active connection (#985).
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): void {
    try {
      if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
        this.webrtcConnection.sendGameState(gameState, isFullSync);
      } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
        this.websocketConnection.sendGameState(gameState, isFullSync);
      } else {
        console.warn('[ConnectionFallback] No active connection to send game state');
      }
    } catch (error) {
      this.recordSendError('sendGameState', error);
    }
  }

  /**
   * Send a player action through the active connection (#985).
   */
  sendPlayerAction(action: string, data: unknown): void {
    try {
      if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
        this.webrtcConnection.sendPlayerAction(action, data);
      } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
        this.websocketConnection.sendPlayerAction(action, data);
      }
    } catch (error) {
      this.recordSendError('sendPlayerAction', error);
    }
  }

  /**
   * Send a chat message through the active connection (#985).
   */
  sendChat(text: string): void {
    try {
      if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
        this.webrtcConnection.sendChat(text);
      } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
        this.websocketConnection.sendChat(text);
      }
    } catch (error) {
      this.recordSendError('sendChat', error);
    }
  }

  /**
   * Send an emote through the active connection (#985).
   */
  sendEmote(emote: string): void {
    try {
      if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
        this.webrtcConnection.sendEmote(emote);
      } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
        this.websocketConnection.sendEmote(emote);
      }
    } catch (error) {
      this.recordSendError('sendEmote', error);
    }
  }

  /**
   * Centralised handler for transport throws during `send*` calls.
   * Always reports a typed {@link ConnectionError} to the host; never throws.
   */
  private recordSendError(method: string, error: unknown): void {
    // #982: redact — transport errors can carry player/session metadata.
    console.error(
      `[ConnectionFallback] ${method} failed:`,
      redactSensitive(error),
    );
    this.recordError(
      new ConnectionError(
        ConnectionErrorCode.SEND_FAILED,
        `${method} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined,
      ),
    );
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionFallbackState {
    return { ...this.state };
  }

  /**
   * Get active connection type
   */
  getActiveConnection(): ConnectionType {
    return this.state.activeConnection;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    try {
      if (this.state.activeConnection === 'webrtc') {
        return this.webrtcConnection?.isConnected() ?? false;
      } else if (this.state.activeConnection === 'websocket') {
        return this.websocketConnection?.isConnected() ?? false;
      }
      return false;
    } catch (error) {
      // isConnected is a status check — never let it crash callers.
      console.warn(
        '[ConnectionFallback] isConnected() threw:',
        redactSensitive(error),
      );
      return false;
    }
  }

  /**
   * Get WebRTC connection (if active)
   */
  getWebRTCConnection(): WebRTCConnection | null {
    return this.webrtcConnection;
  }

  /**
   * Get WebSocket connection (if active)
   */
  getWebSocketConnection(): WebSocketConnection | null {
    return this.websocketConnection;
  }

  /**
   * Force fallback to WebSocket (#985).
   *
   * Throws a typed {@link ConnectionError} if the fallback fails — unlike
   * the auto-fallback path, the caller asked explicitly.
   */
  async forceFallback(): Promise<void> {
    if (this.state.activeConnection === 'websocket') {
      return;
    }

    try {
      // Reset fallbackAttempted so attemptFallback actually runs.
      this.state.fallbackAttempted = false;
      this.cleanupWebRTC();
      await this.connectWebSocket();
    } catch (error) {
      const wrapped =
        error instanceof ConnectionError
          ? error
          : new ConnectionError(
              ConnectionErrorCode.WEBSOCKET_FAILED,
              `forceFallback failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
              error instanceof Error ? error : undefined,
            );
      this.recordError(wrapped);
      throw wrapped;
    }
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    this.clearFallbackTimer();
    this.cleanupWebRTC();
    this.cleanupWebSocket();

    this.state.activeConnection = 'none';
    this.state.webrtcState = null;
    this.state.websocketState = null;
    this.notifyStateChange();
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    this.disconnect();
  }
}

/**
 * Create a connection fallback manager
 */
export function createConnectionFallbackManager(
  options: ConnectionFallbackOptions
): ConnectionFallbackManager {
  return new ConnectionFallbackManager(options);
}

/**
 * Check if any connection method is available
 */
export function isConnectionAvailable(): boolean {
  return typeof RTCPeerConnection !== 'undefined' || isWebSocketAvailable();
}
