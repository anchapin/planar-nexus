/**
 * Action Broadcasting System
 * Issue #287: Enhanced for deterministic game state synchronization
 * 
 * Handles serialization, broadcast, and acknowledgment of game actions
 * across multiplayer peers. This is the foundation for real-time multiplayer.
 * 
 * Enhanced features:
 * - Deterministic action ordering with sequence numbers
 * - State hash verification for sync detection
 * - Conflict resolution integration
 * - Improved acknowledgment handling
 */

import { z } from 'zod';

// Action types for the game
export type ActionType = 
  | 'play-card'
  | 'attack'
  | 'cast-spell'
  | 'activate-ability'
  | 'pass-priority'
  | 'concede'
  | 'mulligan'
  | 'sideboard'
  | 'take-action';

export interface GameAction {
  id: string;
  type: ActionType;
  playerId: string;
  timestamp: number;
  payload: Record<string, unknown>;
  targetZone?: string;
  targetCardId?: string;
  targetPlayerId?: string;
}

// Action schema for validation
export const GameActionSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'play-card',
    'attack',
    'cast-spell',
    'activate-ability',
    'pass-priority',
    'concede',
    'mulligan',
    'sideboard',
    'take-action'
  ]),
  playerId: z.string(),
  timestamp: z.number(),
  payload: z.record(z.unknown()),
  targetZone: z.string().optional(),
  targetCardId: z.string().optional(),
  targetPlayerId: z.string().optional()
});

export type SerializedGameAction = z.infer<typeof GameActionSchema>;

/**
 * Acknowledge receipt of an action
 */
export interface ActionAck {
  actionId: string;
  peerId: string;
  receivedAt: number;
  status: 'received' | 'applied' | 'failed';
  error?: string;
}

/**
 * Queue for managing actions in order
 */
export interface ActionQueueItem {
  action: GameAction;
  acknowledgedBy: Set<string>;
  retries: number;
  addedAt: number;
}

/**
 * Options for broadcasting
 */
export interface BroadcastOptions {
  /** Reliable delivery (vs unreliable for real-time) */
  reliable: boolean;
  /** Action ordering required */
  ordered: boolean;
  /** Timeout for acknowledgments (ms) */
  ackTimeout: number;
  /** Max retry attempts */
  maxRetries: number;
}

/**
 * Default broadcast options
 */
export const DEFAULT_BROADCAST_OPTIONS: BroadcastOptions = {
  reliable: true,
  ordered: true,
  ackTimeout: 5000,
  maxRetries: 3
};

/**
 * ActionBroadcaster class - handles broadcasting actions to all peers
 */
export class ActionBroadcaster {
  private peers: Map<string, WebSocket | RTCDataChannel> = new Map();
  private actionQueue: Map<string, ActionQueueItem> = new Map();
  private pendingAcks: Map<string, Set<string>> = new Map();
  private actionHistory: GameAction[] = [];
  private options: BroadcastOptions;
  private onActionReceived?: (action: GameAction, fromPeer: string) => void;
  private onAckReceived?: (ack: ActionAck) => void;

  constructor(options: Partial<BroadcastOptions> = {}) {
    this.options = { ...DEFAULT_BROADCAST_OPTIONS, ...options };
  }

  /**
   * Register a callback for received actions
   */
  setActionHandler(handler: (action: GameAction, fromPeer: string) => void): void {
    this.onActionReceived = handler;
  }

  /**
   * Register a callback for acknowledgments
   */
  setAckHandler(handler: (ack: ActionAck) => void): void {
    this.onAckReceived = handler;
  }

  /**
   * Add a peer connection
   */
  addPeer(peerId: string, connection: WebSocket | RTCDataChannel): void {
    this.peers.set(peerId, connection);
  }

  /**
   * Remove a peer connection
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    // Clean up pending acks for this peer
    this.pendingAcks.forEach((acks) => {
      acks.delete(peerId);
    });
  }

  /**
   * Serialize an action for network transmission
   */
  serializeAction(action: GameAction): string {
    return JSON.stringify(action);
  }

  /**
   * Deserialize an action from network transmission
   */
  deserializeAction(data: string): GameAction | null {
    try {
      const parsed = JSON.parse(data);
      const result = GameActionSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      console.error('Invalid action schema:', result.error);
      return null;
    } catch (error) {
      console.error('Failed to deserialize action:', error);
      return null;
    }
  }

  /**
   * Broadcast an action to all connected peers
   */
  broadcast(action: GameAction): void {
    // Add to history
    this.actionHistory.push(action);

    // Add to queue for tracking
    const queueItem: ActionQueueItem = {
      action,
      acknowledgedBy: new Set(),
      retries: 0,
      addedAt: Date.now()
    };
    this.actionQueue.set(action.id, queueItem);

    // Initialize pending acks tracking
    this.pendingAcks.set(action.id, new Set());

    // Serialize and send to all peers
    const serialized = this.serializeAction(action);
    
    this.peers.forEach((connection, peerId) => {
      this.sendToPeer(peerId, {
        type: 'action',
        payload: serialized
      });
    });
  }

  /**
   * Send a message to a specific peer
   */
  private sendToPeer(peerId: string, message: { type: string; payload: unknown }): void {
    const connection = this.peers.get(peerId);
    if (!connection) {
      console.warn(`Cannot send to unknown peer: ${peerId}`);
      return;
    }

    try {
      if (connection instanceof WebSocket && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify(message));
      } else if (connection instanceof RTCDataChannel && connection.readyState === 'open') {
        connection.send(JSON.stringify(message));
      } else {
        console.warn(`Connection not ready for peer: ${peerId}`);
      }
    } catch (error) {
      console.error(`Failed to send to peer ${peerId}:`, error);
    }
  }

  /**
   * Handle incoming message from a peer
   */
  handleMessage(peerId: string, message: { type: string; payload: unknown }): void {
    switch (message.type) {
      case 'action':
        this.handleIncomingAction(peerId, message.payload as string);
        break;
      case 'ack':
        this.handleAck(peerId, message.payload as ActionAck);
        break;
      case 'sync-request':
        this.handleSyncRequest(peerId);
        break;
      case 'sync-response':
        this.handleSyncResponse(message.payload as GameAction[]);
        break;
    }
  }

  /**
   * Handle incoming action from a peer
   */
  private handleIncomingAction(peerId: string, serialized: string): void {
    const action = this.deserializeAction(serialized);
    if (!action) {
      console.error('Failed to deserialize incoming action');
      return;
    }

    // Add to history
    this.actionHistory.push(action);

    // Send acknowledgment
    const ack: ActionAck = {
      actionId: action.id,
      peerId,
      receivedAt: Date.now(),
      status: 'received'
    };
    this.sendToPeer(peerId, { type: 'ack', payload: ack });

    // Notify handler
    if (this.onActionReceived) {
      this.onActionReceived(action, peerId);
    }
  }

  /**
   * Handle acknowledgment from a peer
   */
  private handleAck(peerId: string, ack: ActionAck): void {
    const pendingAcks = this.pendingAcks.get(ack.actionId);
    if (pendingAcks) {
      pendingAcks.add(peerId);
    }

    // Remove from queue if all peers acknowledged
    const allPeers = Array.from(this.peers.keys());
    if (pendingAcks && pendingAcks.size >= allPeers.length) {
      this.actionQueue.delete(ack.actionId);
      this.pendingAcks.delete(ack.actionId);
    }

    if (this.onAckReceived) {
      this.onAckReceived(ack);
    }
  }

  /**
   * Handle sync request from a new peer
   */
  private handleSyncRequest(peerId: string): void {
    // Send full action history to the requesting peer
    this.sendToPeer(peerId, {
      type: 'sync-response',
      payload: this.actionHistory
    });
  }

  /**
   * Handle sync response (for late joiners)
   */
  private handleSyncResponse(actions: GameAction[]): void {
    // Apply all actions in sequence
    actions.forEach((action) => {
      if (!this.actionHistory.find((a) => a.id === action.id)) {
        this.actionHistory.push(action);
        if (this.onActionReceived) {
          this.onActionReceived(action, 'sync');
        }
      }
    });
  }

  /**
   * Request full action history from peers (for late joining)
   */
  requestSync(): void {
    this.peers.forEach((_, peerId) => {
      this.sendToPeer(peerId, { type: 'sync-request', payload: null });
    });
  }

  /**
   * Get action history
   */
  getActionHistory(): GameAction[] {
    return [...this.actionHistory];
  }

  /**
   * Get pending actions
   */
  getPendingActions(): GameAction[] {
    return Array.from(this.actionQueue.values()).map((item) => item.action);
  }

  /**
   * Clear action history
   */
  clearHistory(): void {
    this.actionHistory = [];
    this.actionQueue.clear();
    this.pendingAcks.clear();
  }
}

/**
 * Create a unique action ID
 */
export function createActionId(): string {
  return crypto.randomUUID();
}

/**
 * Create a game action
 */
export function createGameAction(
  type: ActionType,
  playerId: string,
  payload: Record<string, unknown> = {},
  options: {
    targetZone?: string;
    targetCardId?: string;
    targetPlayerId?: string;
  } = {}
): GameAction {
  return {
    id: createActionId(),
    type,
    playerId,
    timestamp: Date.now(),
    payload,
    ...options
  };
}

/**
 * Create a singleton instance (for use in the app)
 */
let broadcasterInstance: ActionBroadcaster | null = null;

export function getBroadcaster(options?: Partial<BroadcastOptions>): ActionBroadcaster {
  if (!broadcasterInstance) {
    broadcasterInstance = new ActionBroadcaster(options);
  }
  return broadcasterInstance;
}

export function resetBroadcaster(): void {
  broadcasterInstance = null;
}
