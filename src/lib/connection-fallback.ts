/**
 * Connection Fallback Manager
 * Issue #304: Add WebSocket fallback for non-P2P scenarios
 * 
 * This module provides automatic fallback from WebRTC P2P to WebSocket
 * when direct peer-to-peer connections cannot be established.
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

/**
 * Connection type
 */
export type ConnectionType = 'webrtc' | 'websocket' | 'none';

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
}

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
      fallbackTimeout: options.fallbackTimeout ?? 15000,
      enableFallback: options.enableFallback ?? true,
      preferWebSocket: options.preferWebSocket ?? false,
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
   * Initialize the connection with automatic fallback
   */
  async initialize(): Promise<ConnectionType> {
    // If WebSocket is preferred or WebRTC is not available, start with WebSocket
    if (this.options.preferWebSocket || !this.isWebRTCAvailable()) {
      if (isWebSocketAvailable() && this.options.websocketUrl) {
        return this.connectWebSocket();
      }
      throw new Error('No connection method available');
    }

    // Try WebRTC first with fallback to WebSocket
    try {
      return await this.connectWithFallback();
    } catch (error) {
      throw new Error(`Failed to establish connection: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Connect with automatic fallback
   */
  private async connectWithFallback(): Promise<ConnectionType> {
    let resolved = false;
    let rejectFn: ((error: Error) => void) | null = null;
    let resolveFn: ((type: ConnectionType) => void) | null = null;

    const connectionPromise = new Promise<ConnectionType>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    // Set up fallback timer
    if (this.options.enableFallback && isWebSocketAvailable() && this.options.websocketUrl) {
      this.fallbackTimer = setTimeout(() => {
        if (!resolved && this.state.activeConnection !== 'webrtc') {
          console.log('[ConnectionFallback] WebRTC connection timeout, falling back to WebSocket');
          this.connectWebSocket()
            .then((connectionType) => {
              resolved = true;
              resolveFn?.(connectionType);
            })
            .catch((error) => {
              if (!resolved) {
                rejectFn?.(error);
              }
            });
        }
      }, this.options.fallbackTimeout);
    }

    // Try WebRTC connection
    try {
      const connectionType = await this.connectWebRTC();
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      resolved = true;
      resolveFn?.(connectionType);
    } catch (error) {
      console.error('[ConnectionFallback] WebRTC connection failed:', error);
      this.state.lastError = error instanceof Error ? error.message : 'WebRTC connection failed';
      
      // If fallback timer hasn't triggered yet and WebSocket is available
      if (!resolved && this.options.enableFallback && isWebSocketAvailable() && this.options.websocketUrl) {
        // Clear the timer and try WebSocket immediately
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        
        try {
          const connectionType = await this.connectWebSocket();
          resolved = true;
          resolveFn?.(connectionType);
        } catch (_wsError) {
          if (!resolved) {
            rejectFn?.(new Error(`Both WebRTC and WebSocket failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
          }
        }
      } else if (!resolved && !this.options.enableFallback) {
        rejectFn?.(error as Error);
      }
    }

    return connectionPromise;
  }

  /**
   * Connect using WebRTC
   */
  private async connectWebRTC(): Promise<ConnectionType> {
    const events: P2PEvents = {
      onConnectionStateChange: (state, _peerId) => {
        this.state.webrtcState = state;
        this.notifyStateChange();
        
        if (state === 'failed' && this.options.enableFallback && !this.state.fallbackAttempted) {
          this.attemptFallback();
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
  }

  /**
   * Connect using WebSocket
   */
  private async connectWebSocket(): Promise<ConnectionType> {
    if (!isWebSocketAvailable() || !this.options.websocketUrl) {
      throw new Error('WebSocket is not available');
    }

    const events: WebSocketEvents = {
      onConnectionStateChange: (state) => {
        this.state.websocketState = state;
        this.notifyStateChange();
        
        if (state === 'failed') {
          this.options.events.onError(new Error('WebSocket connection failed'));
        }
      },
      onMessage: (message) => {
        this.options.events.onMessage(message, message.senderId);
      },
      onGameStateSync: (gameState) => {
        this.options.events.onGameStateSync(gameState);
      },
      onError: (error) => {
        this.state.lastError = error.message;
        this.notifyStateChange();
        this.options.events.onError(error);
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

    this.websocketConnection = new WebSocketConnection(config, events);
    await this.websocketConnection.connect();

    this.state.activeConnection = 'websocket';
    this.state.fallbackAttempted = true;
    this.notifyStateChange();
    this.options.events.onConnectionTypeChange('websocket');

    return 'websocket';
  }

  /**
   * Attempt fallback to WebSocket
   */
  private async attemptFallback(): Promise<void> {
    if (this.state.fallbackAttempted) {
      return;
    }

    console.log('[ConnectionFallback] Attempting fallback to WebSocket');
    this.state.fallbackAttempted = true;

    // Clean up WebRTC connection
    if (this.webrtcConnection) {
      this.webrtcConnection.close();
      this.webrtcConnection = null;
    }

    try {
      await this.connectWebSocket();
    } catch (error) {
      console.error('[ConnectionFallback] Fallback to WebSocket failed:', error);
      this.state.lastError = error instanceof Error ? error.message : 'Fallback failed';
      this.notifyStateChange();
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
   * Send a message through the active connection
   */
  send(message: P2PMessage): void {
    if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
      this.webrtcConnection.send(message);
    } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
      this.websocketConnection.send(message);
    } else {
      console.warn('[ConnectionFallback] No active connection to send message');
    }
  }

  /**
   * Send game state through the active connection
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): void {
    if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
      this.webrtcConnection.sendGameState(gameState, isFullSync);
    } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
      this.websocketConnection.sendGameState(gameState, isFullSync);
    } else {
      console.warn('[ConnectionFallback] No active connection to send game state');
    }
  }

  /**
   * Send a player action through the active connection
   */
  sendPlayerAction(action: string, data: unknown): void {
    if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
      this.webrtcConnection.sendPlayerAction(action, data);
    } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
      this.websocketConnection.sendPlayerAction(action, data);
    }
  }

  /**
   * Send a chat message through the active connection
   */
  sendChat(text: string): void {
    if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
      this.webrtcConnection.sendChat(text);
    } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
      this.websocketConnection.sendChat(text);
    }
  }

  /**
   * Send an emote through the active connection
   */
  sendEmote(emote: string): void {
    if (this.state.activeConnection === 'webrtc' && this.webrtcConnection) {
      this.webrtcConnection.sendEmote(emote);
    } else if (this.state.activeConnection === 'websocket' && this.websocketConnection) {
      this.websocketConnection.sendEmote(emote);
    }
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
    if (this.state.activeConnection === 'webrtc') {
      return this.webrtcConnection?.isConnected() ?? false;
    } else if (this.state.activeConnection === 'websocket') {
      return this.websocketConnection?.isConnected() ?? false;
    }
    return false;
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
   * Force fallback to WebSocket
   */
  async forceFallback(): Promise<void> {
    if (this.state.activeConnection === 'websocket') {
      return;
    }

    await this.attemptFallback();
  }

  /**
   * Disconnect and clean up
   */
  disconnect(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    if (this.webrtcConnection) {
      this.webrtcConnection.close();
      this.webrtcConnection = null;
    }

    if (this.websocketConnection) {
      this.websocketConnection.disconnect();
      this.websocketConnection = null;
    }

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
