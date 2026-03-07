/**
 * P2P Game Connection Manager
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Manages WebRTC peer-to-peer connections for multiplayer games
 * using client-side signaling without server dependencies.
 */

import type { GameState } from './game-state/types';
import {
  LocalSignalingClient,
  createLocalSignalingClient,
  type LocalSignalingClientOptions,
  type LocalSignalingState,
  ConnectionPhase,
  SignalingRole,
} from './local-signaling-client';
import {
  serializeGameState,
  deserializeGameState,
  type SerializedGameState,
} from './game-state/serialization';
import {
  ICEConfigurationManager,
  getGlobalICEManager,
  type ICEConfigOptions,
} from './ice-config';

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
  | 'disconnected'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * Game message types
 */
export type GameMessageType =
  | 'game-state-sync'
  | 'game-action'
  | 'chat'
  | 'player-joined'
  | 'player-left'
  | 'ping'
  | 'pong';

/**
 * Base game message
 */
export interface GameMessage {
  type: GameMessageType;
  senderId: string;
  timestamp: number;
  data: unknown;
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

  constructor(options: P2PGameConnectionOptions) {
    this.playerId = options.playerId;
    this.playerName = options.playerName;
    this.connectionState = 'disconnected';

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

    this.events = options.events ? { ...defaultEvents, ...options.events } : defaultEvents;
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
   * Initialize connection as host
   */
  async initializeAsHost(): Promise<void> {
    if (this.connectionState !== 'disconnected') {
      throw new Error('Connection already initialized');
    }

    this.updateConnectionState('signaling');

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
      this.dataChannel = this.peerConnection.createDataChannel('game', {
        ordered: true,
      });
      this.setupDataChannelEvents();

      // Create offer through signaling
      await this.signalingClient.initializeAsHost(this.peerConnection);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to initialize host'));
      throw error;
    }
  }

  /**
   * Initialize connection as joiner
   */
  async initializeAsJoiner(offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.connectionState !== 'disconnected') {
      throw new Error('Connection already initialized');
    }

    this.updateConnectionState('signaling');

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
      this.handleError(error instanceof Error ? error : new Error('Failed to initialize joiner'));
      throw error;
    }
  }

  /**
   * Process an answer received by the host
   */
  async processAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized');
    }

    try {
      await this.signalingClient.handleAnswer(answer);
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error('Failed to process answer'));
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
      console.error('[P2PGameConnection] Failed to process ICE candidates:', error);
    }
  }

  /**
   * Send a game message
   */
  send(message: GameMessage): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('[P2PGameConnection] Data channel not ready');
      return false;
    }

    try {
      this.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[P2PGameConnection] Failed to send message:', error);
      return false;
    }
  }

  /**
   * Send game state to remote peer
   */
  sendGameState(gameState: GameState, isFullSync: boolean = false): boolean {
    const serialized = serializeGameState(gameState, isFullSync ? 'Full sync' : 'Delta sync');

    return this.send({
      type: 'game-state-sync',
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
      type: 'game-action',
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
      type: 'chat',
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
      type: 'ping',
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
      type: 'pong',
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
      console.log('[P2PGameConnection] Data channel opened');
      this.updateConnectionState('connected');
      this.signalingClient.markConnected();
      this.startPingInterval();
    };

    this.dataChannel.onclose = () => {
      console.log('[P2PGameConnection] Data channel closed');
      this.handleDisconnection();
    };

    this.dataChannel.onerror = (event) => {
      console.error('[P2PGameConnection] Data channel error:', event);
      this.handleError(
        event instanceof Error ? event : new Error('Data channel error')
      );
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        console.warn('[P2PGameConnection] Received non-string message');
        return;
      }
      this.handleMessage(event.data);
    };
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message: GameMessage = JSON.parse(data);

      // Update remote player info
      if (this.remotePlayerId === null) {
        this.remotePlayerId = message.senderId;
      }

      switch (message.type) {
        case 'game-state-sync':
          this.handleGameStateSync(message);
          break;
        case 'game-action':
          this.events.onMessage(message);
          break;
        case 'chat':
          this.handleChat(message);
          break;
        case 'player-joined':
          this.handlePlayerJoined(message);
          break;
        case 'player-left':
          this.handlePlayerLeft(message);
          break;
        case 'ping':
          this.sendPong();
          break;
        case 'pong':
          // Connection is alive
          break;
      }

      this.events.onMessage(message);
    } catch (error) {
      console.error('[P2PGameConnection] Failed to parse message:', error);
    }
  }

  /**
   * Handle game state sync
   */
  private handleGameStateSync(message: GameMessage): void {
    const data = message.data as { gameState: SerializedGameState; isFullSync: boolean };
    const gameState = deserializeGameState(data.gameState);
    this.events.onGameStateSync(gameState);
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
    console.log('[P2PGameConnection] Peer connection state:', state);

    switch (state) {
      case 'connected':
        this.updateConnectionState('connected');
        break;
      case 'disconnected':
        this.handleDisconnection();
        break;
      case 'failed':
        this.handleError(new Error('Peer connection failed'));
        break;
    }
  }

  /**
   * Handle ICE connection state change
   */
  private handleICEConnectionStateChange(): void {
    if (!this.peerConnection) return;

    const state = this.peerConnection.iceConnectionState;
    console.log('[P2PGameConnection] ICE connection state:', state);

    if (state === 'disconnected' || state === 'failed') {
      this.handleDisconnection();
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    console.log('[P2PGameConnection] Disconnected');
    this.updateConnectionState('disconnected');
    this.stopPingInterval();
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    console.error('[P2PGameConnection] Error:', error);
    this.updateConnectionState('failed');
    this.stopPingInterval();
    this.events.onError(error);
  }

  /**
   * Handle signaling state change
   */
  private handleSignalingStateChange(signalingState: LocalSignalingState): void {
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
  private handleOfferCreated(offer: RTCSessionDescriptionInit): void {
    console.log('[P2PGameConnection] Offer created');
  }

  /**
   * Handle answer created
   */
  private handleAnswerCreated(answer: RTCSessionDescriptionInit): void {
    console.log('[P2PGameConnection] Answer created');
  }

  /**
   * Handle ICE candidate
   */
  private handleIceCandidate(candidate: RTCIceCandidateInit): void {
    console.log('[P2PGameConnection] ICE candidate generated');
  }

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
    return this.connectionState === 'connected';
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

    this.updateConnectionState('disconnected');
    console.log('[P2PGameConnection] Connection closed');
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
      console.error('[P2PGameConnection] Failed to get stats:', error);
      return null;
    }
  }
}

/**
 * Create a P2P game connection
 */
export function createP2PGameConnection(
  options: P2PGameConnectionOptions
): P2PGameConnection {
  return new P2PGameConnection(options);
}
