/**
 * P2P Signaling Service using PeerJS
 * Issue #185: Implement peer-to-peer multiplayer via WebRTC
 * 
 * This module provides signaling functionality using PeerJS cloud,
 * enabling WebRTC connections between players without a custom server.
 */

import Peer, { DataConnection } from 'peerjs';
import { P2PMessage, P2PConnectionState } from './webrtc-p2p';

/**
 * PeerJS configuration options
 */
export interface PeerJSConfig {
  debug?: number;
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
}

/**
 * Connection callback types
 */
export interface SignalingCallbacks {
  onConnectionStateChange: (state: P2PConnectionState) => void;
  onMessage: (message: P2PMessage, peerId: string) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onError: (error: Error) => void;
}

/**
 * P2P Signaling Service using PeerJS
 * Simplifies WebRTC connections through PeerJS's cloud signaling server
 */
export class P2PSignalingService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private localPeerId: string | null = null;
  private isHost: boolean = false;
  private callbacks: SignalingCallbacks;
  private gameCode: string | null = null;
  private playerName: string = '';

  /**
   * Create a new P2P Signaling Service
   * @param isHost - Whether this instance is the host
   * @param playerName - Player's display name
   * @param callbacks - Event callbacks
   */
  constructor(
    isHost: boolean,
    playerName: string,
    callbacks: SignalingCallbacks
  ) {
    this.isHost = isHost;
    this.playerName = playerName;
    this.callbacks = callbacks;
  }

  /**
   * Initialize PeerJS and get/create a peer ID
   * @param gameCode - Optional game code for host to use as peer ID
   */
  async initialize(gameCode?: string): Promise<string> {
    // Capture gameCode to avoid closure issues
    const hostGameCode = gameCode;
    
    return new Promise((resolve, reject) => {
      // Use game code as peer ID for hosts (easier to connect)
      if (this.isHost && hostGameCode) {
        const peerId = `planar-nexus-${hostGameCode}`;
        this.peer = new Peer(peerId, { debug: 1 });
      } else {
        this.peer = new Peer({ debug: 1 });
      }

      this.peer.on('open', (id) => {
        console.log('[P2P] Peer connected with ID:', id);
        this.localPeerId = id;
        
        // Extract game code from peer ID if we created one
        if (this.isHost && hostGameCode) {
          this.gameCode = hostGameCode;
        } else if (!this.isHost) {
          this.gameCode = null;
        }
        
        this.callbacks.onConnectionStateChange('connected');
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        console.log('[P2P] Incoming connection from:', conn.peer);
        this.handleConnection(conn);
      });

      this.peer.on('error', (error) => {
        console.error('[P2P] Peer error:', error);
        this.callbacks.onError(new Error(error.message));
        
        if (error.type === 'unavailable-id') {
          reject(new Error('Game code already in use. Please try again.'));
        } else if (error.type === 'peer-unavailable') {
          reject(new Error('Could not find game. Check the code and try again.'));
        } else {
          reject(error);
        }
      });

      this.peer.on('disconnected', () => {
        console.log('[P2P] Peer disconnected');
        this.callbacks.onConnectionStateChange('disconnected');
        
        // Try to reconnect
        if (this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });
    });
  }

  /**
   * Connect to a peer by their game code
   * @param gameCode - The game code to connect to
   */
  async connectToGame(gameCode: string): Promise<void> {
    if (!this.peer) {
      throw new Error('Peer not initialized');
    }

      const hostPeerId = `planar-nexus-${gameCode}` as const;
    console.log('[P2P] Connecting to host:', hostPeerId);

    return new Promise((resolve, reject) => {
      const conn = this.peer!.connect(hostPeerId, {
        reliable: true,
        serialization: 'json',
      });

      conn.on('open', () => {
        console.log('[P2P] Connected to host');
        this.connections.set(hostPeerId, conn);
        this.handleConnection(conn);
        this.callbacks.onPeerConnected(hostPeerId);
        resolve();
      });

      conn.on('error', (error) => {
        console.error('[P2P] Connection error:', error);
        reject(error);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!conn.open) {
          reject(new Error('Connection timeout. Please check the game code.'));
        }
      }, 10000);
    });
  }

  /**
   * Handle a new connection
   * @param conn - The data connection
   */
  private handleConnection(conn: DataConnection): void {
    this.connections.set(conn.peer, conn);

    conn.on('open', () => {
      console.log('[P2P] Connection opened with:', conn.peer);
      this.callbacks.onPeerConnected(conn.peer);
    });

    conn.on('data', (data) => {
      try {
        const message = data as P2PMessage;
        console.log('[P2P] Received message:', message.type);
        this.callbacks.onMessage(message, conn.peer);
      } catch (error) {
        console.error('[P2P] Error parsing message:', error);
      }
    });

    conn.on('close', () => {
      console.log('[P2P] Connection closed with:', conn.peer);
      this.connections.delete(conn.peer);
      this.callbacks.onPeerDisconnected(conn.peer);
    });

    conn.on('error', (error) => {
      console.error('[P2P] Connection error:', error);
      this.callbacks.onError(new Error(error.message));
    });
  }

  /**
   * Send a message to all connected peers
   * @param message - The message to send
   */
  broadcast(message: P2PMessage): void {
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        conn.send(message);
      } else {
        console.warn('[P2P] Cannot send to peer, connection not open:', peerId);
      }
    });
  }

  /**
   * Send a message to a specific peer
   * @param peerId - The peer ID to send to
   * @param message - The message to send
   */
  sendTo(peerId: string, message: P2PMessage): void {
    const conn = this.connections.get(peerId);
    
    if (conn && conn.open) {
      conn.send(message);
    } else {
      console.warn('[P2P] Cannot send to peer, not connected:', peerId);
    }
  }

  /**
   * Get the local peer ID
   */
  getLocalPeerId(): string | null {
    return this.localPeerId;
  }

  /**
   * Get the game code from the peer ID
   */
  getGameCode(): string | null {
    if (this.localPeerId && this.localPeerId.startsWith('planar-nexus-')) {
      return this.localPeerId.replace('planar-nexus-', '');
    }
    return this.gameCode;
  }

  /**
   * Get all connected peer IDs
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Check if connected to any peers
   */
  isConnected(): boolean {
    return this.connections.size > 0;
  }

  /**
   * Disconnect from all peers
   */
  disconnect(): void {
    this.connections.forEach((conn) => {
      conn.close();
    });
    this.connections.clear();
  }

  /**
   * Destroy the peer and clean up
   */
  destroy(): void {
    this.disconnect();
    
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    
    this.localPeerId = null;
    console.log('[P2P] Signaling service destroyed');
  }
}

/**
 * Generate a game code from peer ID
 * @param peerId - The peer ID to extract code from
 */
export function extractGameCodeFromPeerId(peerId: string): string | null {
  if (peerId.startsWith('planar-nexus-')) {
    return peerId.replace('planar-nexus-', '');
  }
  return null;
}

/**
 * Create a host signaling service
 */
export function createHostSignaling(playerName: string, callbacks: SignalingCallbacks): P2PSignalingService {
  return new P2PSignalingService(true, playerName, callbacks);
}

/**
 * Create a client signaling service
 */
export function createClientSignaling(playerName: string, callbacks: SignalingCallbacks): P2PSignalingService {
  return new P2PSignalingService(false, playerName, callbacks);
}
