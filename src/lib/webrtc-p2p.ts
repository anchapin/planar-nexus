/**
 * WebRTC P2P Connection Manager
 * Issue #57: Phase 4.1: Implement WebRTC for peer-to-peer connections
 * 
 * This module provides WebRTC support for direct player-to-player connections,
 * enabling multiplayer games without a central server.
 */

import { serializeGameState, deserializeGameState, type SerializedGameState } from './game-state/serialization';
import type { GameState } from './game-state/types';

/**
 * WebRTC configuration with STUN/TURN servers
 */
export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

/**
 * Connection state
 */
export type P2PConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * Message types for P2P communication
 */
export type P2PMessageType = 
  | 'game-state-sync'
  | 'game-action'
  | 'player-action'
  | 'chat'
  | 'emote'
  | 'ping'
  | 'pong'
  | 'connection-request'
  | 'connection-accept'
  | 'error';

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
  type: 'game-state-sync';
  payload: {
    gameState: SerializedGameState;
    isFullSync: boolean;
  };
}

/**
 * Player action message
 */
export interface PlayerActionMessage extends P2PMessage {
  type: 'player-action';
  payload: {
    action: string;
    data: unknown;
  };
}

/**
 * Chat message
 */
export interface ChatMessage extends P2PMessage {
  type: 'chat';
  payload: {
    text: string;
  };
}

/**
 * Emote message
 */
export interface EmoteMessage extends P2PMessage {
  type: 'emote';
  payload: {
    emote: string;
  };
}

/**
 * Connection request message
 */
export interface ConnectionRequestMessage extends P2PMessage {
  type: 'connection-request';
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
  type: 'connection-accept';
  payload: {
    playerName: string;
    playerId: string;
  };
}

/**
 * Error message
 */
export interface ErrorMessage extends P2PMessage {
  type: 'error';
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
  private connectionState: P2PConnectionState = 'disconnected';
  private events: P2PEvents;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: P2PConnectionOptions) {
    this.localPlayerId = options.playerId;
    this.localPlayerName = options.playerName;
    this.isHost = options.isHost;
    this.gameCode = options.gameCode;
    this.rtcConfig = options.rtcConfig || DEFAULT_RTC_CONFIG;
    
    // Set default event handlers
    const defaultEvents: P2PEvents = {
      onConnectionStateChange: () => {},
      onMessage: () => {},
      onGameStateSync: () => {},
      onPlayerAction: () => {},
      onChat: () => {},
      onEmote: () => {},
      onError: () => {},
      onPeerConnected: () => {},
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
      this.updateConnectionState('connecting');
      
      this.peerConnection = new RTCPeerConnection(this.rtcConfig);
      
      // Set up ICE candidate handling
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          this.handleICECandidate(event.candidate);
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
      
      // If host, create data channel for receiving
      if (this.isHost) {
        this.setupDataChannel();
      }
      
      console.log('[WebRTC] Initialized as', this.isHost ? 'host' : 'client');
    } catch (error) {
      console.error('[WebRTC] Failed to initialize:', error);
      this.updateConnectionState('failed');
      throw error;
    }
  }

  /**
   * Create an offer for the host to send to a joining player
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    console.log('[WebRTC] Created offer');
    return offer;
  }

  /**
   * Handle an incoming offer from a joining player
   */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    console.log('[WebRTC] Handled offer and created answer');
    return answer;
  }

  /**
   * Handle an incoming answer from the host
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    console.log('[WebRTC] Handled answer');
  }

  /**
   * Add an ICE candidate from the remote peer
   */
  async addIceCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!this.peerConnection || !candidate) {
      return;
    }

    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    console.log('[WebRTC] Added ICE candidate');
  }

  /**
   * Handle ICE candidate (send to remote peer via signaling)
   */
  private handleICECandidate(candidate: RTCIceCandidate): void {
    // In a full implementation, this would send the candidate via a signaling server
    // or via an alternative channel (like QR code or manual paste)
    console.log('[WebRTC] ICE candidate:', candidate.candidate);
  }

  /**
   * Set up the data channel
   */
  private setupDataChannel(): void {
    if (!this.peerConnection) return;

    // If host, create a data channel to listen for incoming connections
    if (this.isHost) {
      this.peerConnection.ondatachannel = (event) => {
        console.log('[WebRTC] Received data channel');
        this.dataChannel = event.channel;
        this.setupDataChannelEvents();
      };
    }
  }

  /**
   * Connect to a peer as a client (non-host)
   */
  async connectToPeer(): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    // Create data channel for sending
    this.dataChannel = this.peerConnection.createDataChannel('game', {
      ordered: true,
    });
    
    this.setupDataChannelEvents();
    console.log('[WebRTC] Created data channel as client');
  }

  /**
   * Set up data channel event handlers
   */
  private setupDataChannelEvents(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('[WebRTC] Data channel opened');
      this.updateConnectionState('connected');
      this.startPingInterval();
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTC] Data channel closed');
      this.handleDisconnection();
    };

    this.dataChannel.onerror = (event) => {
      console.error('[WebRTC] Data channel error:', event);

      let errorToReport: Error;

      const underlyingError =
        (event as ErrorEvent).error ??
        (event as any)?.error;

      if (underlyingError instanceof Error) {
        errorToReport = underlyingError;
      } else if (underlyingError !== undefined) {
        // Preserve non-Error details as the cause where supported
        errorToReport = new Error('Data channel error', { cause: underlyingError });
      } else if (event instanceof Error) {
        errorToReport = event;
      } else {
        errorToReport = new Error('Data channel error', { cause: event });
      }

      this.events.onError(errorToReport, '');
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        console.warn('[WebRTC] Received non-string message, ignoring');
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
        case 'game-state-sync':
          this.handleGameStateSync(message as GameStateSyncMessage);
          break;
        case 'player-action':
          this.handlePlayerAction(message as PlayerActionMessage);
          break;
        case 'chat':
          this.handleChat(message as ChatMessage);
          break;
        case 'emote':
          this.handleEmote(message as EmoteMessage);
          break;
        case 'ping':
          this.sendPong();
          break;
        case 'pong':
          // Connection is alive
          break;
        case 'connection-request':
          this.handleConnectionRequest(message as ConnectionRequestMessage);
          break;
        case 'connection-accept':
          this.handleConnectionAccept(message as ConnectionAcceptMessage);
          break;
        case 'error':
          this.handleErrorMessage(message as ErrorMessage);
          break;
      }
      
      this.events.onMessage(message, '');
    } catch (error) {
      console.error('[WebRTC] Failed to parse message:', error);
    }
  }

  /**
   * Handle game state sync message
   */
  private handleGameStateSync(message: GameStateSyncMessage): void {
    const gameState = deserializeGameState(message.payload.gameState);
    this.events.onGameStateSync(gameState, '');
  }

  /**
   * Handle player action message
   */
  private handlePlayerAction(message: PlayerActionMessage): void {
    this.events.onPlayerAction(message.payload.action, message.payload.data, message.senderId);
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
    console.log('[WebRTC] Connection request from:', message.payload.playerName);
  }

  /**
   * Handle connection accept
   */
  private handleConnectionAccept(message: ConnectionAcceptMessage): void {
    console.log('[WebRTC] Connection accepted:', message.payload.playerName);
    this.updateConnectionState('connected');
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
    console.log('[WebRTC] Connection state:', state);

    switch (state) {
      case 'connected':
        this.updateConnectionState('connected');
        this.reconnectAttempts = 0;
        this.startPingInterval();
        break;
      case 'disconnected':
        this.handleDisconnection();
        break;
      case 'failed':
        this.handleConnectionFailure();
        break;
      case 'new':
      case 'connecting':
        this.updateConnectionState('connecting');
        break;
    }
  }

  /**
   * Handle ICE connection state changes
   */
  private handleICEConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.iceConnectionState;
    console.log('[WebRTC] ICE connection state:', state);

    if (state === 'disconnected' || state === 'failed') {
      this.handleDisconnection();
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    console.log('[WebRTC] Disconnected');
    this.updateConnectionState('disconnected');
    this.stopPingInterval();
    
    // Attempt reconnection if not exceeded max attempts
    if (this.reconnectAttempts < this.maxReconnectAttempts && this.connectionState !== 'failed') {
      this.attemptReconnection();
    }
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    console.log('[WebRTC] Connection failed');
    this.updateConnectionState('failed');
    this.stopPingInterval();
    this.events.onError(new Error('Connection failed'), '');
  }

  /**
   * Attempt to reconnect
   */
  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++;
    this.updateConnectionState('reconnecting');
    console.log(`[WebRTC] Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    // In a full implementation, this would re-establish the connection
    // using stored offer/answer or generating new ones
  }

  /**
   * Update connection state
   */
  private updateConnectionState(state: P2PConnectionState): void {
    this.connectionState = state;
    this.events.onConnectionStateChange(state, '');
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
   * Send ping to check connection health
   */
  private sendPing(): void {
    this.send({
      type: 'ping',
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
      type: 'pong',
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: null,
    });
  }

  /**
   * Send a message through the data channel
   */
  send(message: P2PMessage): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('[WebRTC] Data channel not ready');
      return;
    }

    this.dataChannel.send(JSON.stringify(message));
  }

  /**
   * Send game state to peers
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): void {
    const serializedState = serializeGameState(gameState, isFullSync ? 'Full sync' : 'Delta sync');
    
    this.send({
      type: 'game-state-sync',
      senderId: this.localPlayerId,
      timestamp: Date.now(),
      payload: {
        gameState: serializedState,
        isFullSync,
      },
    });
  }

  /**
   * Send a player action to peers
   */
  sendPlayerAction(action: string, data: unknown): void {
    this.send({
      type: 'player-action',
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
      type: 'chat',
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
      type: 'emote',
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
      type: 'connection-request',
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
      type: 'connection-accept',
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
    return this.connectionState === 'connected';
  }

  /**
   * Close the connection
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
    
    this.peers.clear();
    this.updateConnectionState('disconnected');
    
    console.log('[WebRTC] Connection closed');
  }
}

/**
 * Generate a short game code for P2P connection
 */
export function generateGameCode(length: number = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding confusing characters
  let code = '';
  
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return code;
}

/**
 * Create a new P2P connection
 */
export function createP2PConnection(options: P2PConnectionOptions): WebRTCConnection {
  return new WebRTCConnection(options);
}
