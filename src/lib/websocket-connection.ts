/**
 * WebSocket Connection Manager
 * Issue #304: Add WebSocket fallback for non-P2P scenarios
 * 
 * This module provides WebSocket-based communication as a fallback
 * when WebRTC P2P connections cannot be established.
 */

import type { P2PMessage, P2PConnectionState } from './webrtc-p2p';
import { serializeGameState, deserializeGameState, type SerializedGameState } from './game-state/serialization';
import type { GameState } from './game-state/types';

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  /** WebSocket server URL */
  serverUrl: string;
  /** Reconnection interval in milliseconds */
  reconnectInterval?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Enable automatic reconnection */
  autoReconnect?: boolean;
}

/**
 * WebSocket connection state
 */
export type WebSocketConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * WebSocket connection events
 */
export interface WebSocketEvents {
  onConnectionStateChange: (state: WebSocketConnectionState) => void;
  onMessage: (message: P2PMessage) => void;
  onGameStateSync: (gameState: GameState) => void;
  onError: (error: Error) => void;
  onPlayerJoined: (playerId: string, playerName: string) => void;
  onPlayerLeft: (playerId: string) => void;
}

/**
 * WebSocket room info
 */
export interface WebSocketRoom {
  roomId: string;
  gameCode: string;
  hostId: string;
  hostName: string;
  players: Array<{ id: string; name: string }>;
  createdAt: number;
}

/**
 * WebSocket Connection Manager
 * Provides fallback communication when WebRTC is not available
 */
export class WebSocketConnection {
  private socket: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private events: WebSocketEvents;
  private connectionState: WebSocketConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private messageQueue: P2PMessage[] = [];
  private playerId: string = '';
  private playerName: string = '';
  private roomId: string | null = null;
  private isHost: boolean = false;

  constructor(config: WebSocketConfig, events: WebSocketEvents) {
    this.config = {
      serverUrl: config.serverUrl,
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      connectionTimeout: config.connectionTimeout ?? 10000,
      autoReconnect: config.autoReconnect ?? true,
    };
    this.events = events;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.updateConnectionState('connecting');
        
        this.socket = new WebSocket(this.config.serverUrl);
        
        // Connection timeout
        this.connectionTimer = setTimeout(() => {
          if (this.socket?.readyState !== WebSocket.OPEN) {
            this.socket?.close();
            reject(new Error('Connection timeout'));
          }
        }, this.config.connectionTimeout);

        this.socket.onopen = () => {
          clearTimeout(this.connectionTimer!);
          this.updateConnectionState('connected');
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.flushMessageQueue();
          resolve();
        };

        this.socket.onclose = (event) => {
          clearTimeout(this.connectionTimer!);
          this.handleDisconnection(event);
        };

        this.socket.onerror = (error) => {
          clearTimeout(this.connectionTimer!);
          this.events.onError(new Error('WebSocket error'));
          reject(new Error('WebSocket connection failed'));
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.updateConnectionState('failed');
        reject(error);
      }
    });
  }

  /**
   * Create a new game room as host
   */
  async createRoom(
    hostId: string,
    hostName: string,
    gameCode?: string
  ): Promise<WebSocketRoom> {
    this.playerId = hostId;
    this.playerName = hostName;
    this.isHost = true;

    const message: P2PMessage = {
      type: 'connection-request',
      senderId: hostId,
      timestamp: Date.now(),
      payload: {
        playerName: hostName,
        gameCode: gameCode || this.generateGameCode(),
        isHost: true,
      },
    };

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.type === 'room-created' && response.payload?.hostId === hostId) {
            this.socket?.removeEventListener('message', handler);
            this.roomId = response.payload.roomId;
            resolve(response.payload);
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      this.socket?.addEventListener('message', handler);
      this.send(message);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.removeEventListener('message', handler as EventListener);
        reject(new Error('Room creation timeout'));
      }, 10000);
    });
  }

  /**
   * Join an existing game room
   */
  async joinRoom(
    gameCode: string,
    playerId: string,
    playerName: string
  ): Promise<WebSocketRoom> {
    this.playerId = playerId;
    this.playerName = playerName;
    this.isHost = false;

    const message: P2PMessage = {
      type: 'connection-request',
      senderId: playerId,
      timestamp: Date.now(),
      payload: {
        playerName,
        gameCode,
        isHost: false,
      },
    };

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.type === 'room-joined' && response.payload?.clientId === playerId) {
            this.socket?.removeEventListener('message', handler);
            this.roomId = response.payload.roomId;
            resolve(response.payload);
          } else if (response.type === 'error' && response.payload?.code === 'ROOM_NOT_FOUND') {
            this.socket?.removeEventListener('message', handler);
            reject(new Error('Game not found'));
          }
        } catch (error) {
          // Ignore parse errors
        }
      };

      this.socket?.addEventListener('message', handler);
      this.send(message);

      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket?.removeEventListener('message', handler as EventListener);
        reject(new Error('Join room timeout'));
      }, 10000);
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: P2PMessage = JSON.parse(data);
      
      const messageType = message.type as string;
      
      switch (messageType) {
        case 'game-state-sync':
          this.handleGameStateSync(message);
          break;
        case 'player-action':
          this.events.onMessage(message);
          break;
        case 'chat':
          this.events.onMessage(message);
          break;
        case 'emote':
          this.events.onMessage(message);
          break;
        case 'player-joined':
          this.events.onPlayerJoined(
            (message.payload as { playerId: string; playerName: string }).playerId,
            (message.payload as { playerId: string; playerName: string }).playerName
          );
          break;
        case 'player-left':
          this.events.onPlayerLeft((message.payload as { playerId: string }).playerId);
          break;
        case 'pong':
          // Connection is alive
          break;
        default:
          this.events.onMessage(message);
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error);
    }
  }

  /**
   * Handle game state sync message
   */
  private handleGameStateSync(message: P2PMessage): void {
    const payload = message.payload as { gameState: SerializedGameState };
    const gameState = deserializeGameState(payload.gameState);
    this.events.onGameStateSync(gameState);
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(event: CloseEvent): void {
    this.stopPingInterval();
    
    if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.updateConnectionState('reconnecting');
      this.reconnectAttempts++;
      
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch(() => {
          // Reconnection failed, will try again
        });
      }, this.config.reconnectInterval);
    } else {
      this.updateConnectionState('disconnected');
    }
  }

  /**
   * Update connection state
   */
  private updateConnectionState(state: WebSocketConnectionState): void {
    this.connectionState = state;
    this.events.onConnectionStateChange(state);
  }

  /**
   * Start ping interval for connection health
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.send({
        type: 'ping',
        senderId: this.playerId,
        timestamp: Date.now(),
        payload: null,
      });
    }, 30000);
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
   * Send a message through WebSocket
   */
  send(message: P2PMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      // Queue message for when connection is established
      this.messageQueue.push(message);
    }
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  /**
   * Send game state to other players
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): void {
    const serializedState = serializeGameState(gameState, isFullSync ? 'Full sync' : 'Delta sync');
    
    this.send({
      type: 'game-state-sync',
      senderId: this.playerId,
      timestamp: Date.now(),
      payload: {
        gameState: serializedState,
        isFullSync,
      },
    });
  }

  /**
   * Send a player action
   */
  sendPlayerAction(action: string, data: unknown): void {
    this.send({
      type: 'player-action',
      senderId: this.playerId,
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
      type: 'chat',
      senderId: this.playerId,
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
      type: 'emote',
      senderId: this.playerId,
      timestamp: Date.now(),
      payload: {
        emote,
      },
    });
  }

  /**
   * Generate a short game code
   */
  private generateGameCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): WebSocketConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Get room ID
   */
  getRoomId(): string | null {
    return this.roomId;
  }

  /**
   * Leave the current room
   */
  async leaveRoom(): Promise<void> {
    if (!this.roomId) return;

    this.send({
      type: 'connection-request',
      senderId: this.playerId,
      timestamp: Date.now(),
      payload: {
        action: 'leave',
        roomId: this.roomId,
      },
    });

    this.roomId = null;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.stopPingInterval();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.messageQueue = [];
    this.updateConnectionState('disconnected');
  }

  /**
   * Destroy the connection
   */
  destroy(): void {
    this.disconnect();
  }
}

/**
 * Create a WebSocket connection
 */
export function createWebSocketConnection(
  config: WebSocketConfig,
  events: WebSocketEvents
): WebSocketConnection {
  return new WebSocketConnection(config, events);
}

/**
 * Check if WebSocket is available
 */
export function isWebSocketAvailable(): boolean {
  return typeof WebSocket !== 'undefined';
}
