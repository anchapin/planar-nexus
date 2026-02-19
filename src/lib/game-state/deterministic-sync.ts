/**
 * Deterministic Game State Synchronization Module
 * Issue #287: Implement deterministic game state synchronization
 * 
 * This module provides a deterministic game state engine for multiplayer
 * synchronization with conflict resolution.
 * 
 * Key features:
 * - Deterministic game state engine
 * - State hash verification for sync detection
 * - Conflict resolution for desync
 * - Action broadcasting system improvements
 */

import type { GameState, GameAction, PlayerId, CardInstanceId } from "./types";
import { computeStateHash, compareStateHashes, analyzeHashDiscrepancy, type HashComparisonResult, type HashDiscrepancy } from "./state-hash";

// Re-export types needed by other modules
export type { HashComparisonResult, HashDiscrepancy };

/**
 * Sequence number for action ordering
 */
export type SequenceNumber = number;

/**
 * Unique identifier for a game session
 */
export type SessionId = string;

/**
 * Unique identifier for a peer
 */
export type PeerId = string;

/**
 * Deterministic action with sequence number
 */
export interface DeterministicAction {
  /** Unique sequence number for ordering */
  sequenceNumber: SequenceNumber;
  /** The game action */
  action: GameAction;
  /** Hash of the state before this action was applied */
  previousStateHash: string;
  /** Hash of the state after this action was applied */
  resultingStateHash: string;
  /** ID of the peer who initiated this action */
  initiatorId: PeerId;
  /** Timestamp when action was created */
  timestamp: number;
  /** Signature for verification (optional) */
  signature?: string;
}

/**
 * Synchronization state for a peer
 */
export interface PeerSyncState {
  /** Peer ID */
  peerId: PeerId;
  /** Last sequence number acknowledged by this peer */
  lastAcknowledgedSeq: SequenceNumber;
  /** Last known state hash from this peer */
  lastKnownStateHash: string;
  /** Whether this peer is in sync */
  isInSync: boolean;
  /** Last sync check timestamp */
  lastSyncCheck: number;
  /** Number of consecutive desyncs */
  consecutiveDesyncs: number;
}

/**
 * Conflict resolution result
 */
export interface ConflictResolution {
  /** Whether the conflict was resolved */
  resolved: boolean;
  /** Resolution strategy used */
  strategy: "rollback" | "forward" | "merge" | "authoritative";
  /** Actions to apply to resolve the conflict */
  resolutionActions: DeterministicAction[];
  /** Description of the conflict */
  conflictDescription: string;
  /** State to restore to (for rollback) */
  rollbackState?: GameState;
  /** Sequence number to rollback to (for rollback) */
  rollbackSequence?: SequenceNumber;
}

/**
 * Sync verification result
 */
export interface SyncVerificationResult {
  /** Whether peers are in sync */
  isInSync: boolean;
  /** Local state hash */
  localHash: string;
  /** Remote state hashes by peer ID */
  remoteHashes: Map<PeerId, string>;
  /** Any detected discrepancies */
  discrepancies: Map<PeerId, HashDiscrepancy[]>;
  /** Timestamp of verification */
  timestamp: number;
}

/**
 * Game state snapshot for rollback
 */
export interface StateSnapshot {
  /** Sequence number at this snapshot */
  sequenceNumber: SequenceNumber;
  /** The game state */
  state: GameState;
  /** State hash */
  hash: string;
  /** Timestamp when snapshot was taken */
  timestamp: number;
}

/**
 * Deterministic Game State Engine
 * 
 * This class manages deterministic game state transitions and synchronization.
 */
export class DeterministicGameStateEngine {
  private currentSequence: SequenceNumber = 0;
  private actionHistory: DeterministicAction[] = [];
  private stateSnapshots: StateSnapshot[] = [];
  private peerStates: Map<PeerId, PeerSyncState> = new Map();
  private maxSnapshotHistory = 100;
  private maxActionHistory = 1000;
  private localPeerId: PeerId;
  private onDesyncDetected?: (result: SyncVerificationResult) => void;
  private onConflictResolved?: (resolution: ConflictResolution) => void;

  constructor(localPeerId: PeerId) {
    this.localPeerId = localPeerId;
  }

  /**
   * Set callback for desync detection
   */
  setDesyncHandler(handler: (result: SyncVerificationResult) => void): void {
    this.onDesyncDetected = handler;
  }

  /**
   * Set callback for conflict resolution
   */
  setConflictHandler(handler: (resolution: ConflictResolution) => void): void {
    this.onConflictResolved = handler;
  }

  /**
   * Get the current sequence number
   */
  getCurrentSequence(): SequenceNumber {
    return this.currentSequence;
  }

  /**
   * Create a deterministic action from a game action
   */
  createAction(
    action: GameAction,
    previousState: GameState,
    resultingState: GameState
  ): DeterministicAction {
    const previousHash = computeStateHash(previousState);
    const resultingHash = computeStateHash(resultingState);

    const deterministicAction: DeterministicAction = {
      sequenceNumber: ++this.currentSequence,
      action,
      previousStateHash: previousHash,
      resultingStateHash: resultingHash,
      initiatorId: this.localPeerId,
      timestamp: Date.now(),
    };

    // Add to history
    this.actionHistory.push(deterministicAction);
    this.trimHistory();

    // Take snapshot periodically
    if (this.currentSequence % 10 === 0) {
      this.takeSnapshot(resultingState);
    }

    return deterministicAction;
  }

  /**
   * Validate an incoming action from a remote peer
   */
  validateAction(
    deterministicAction: DeterministicAction,
    currentState: GameState
  ): { valid: boolean; error?: string } {
    // Check sequence number
    if (deterministicAction.sequenceNumber <= this.currentSequence) {
      // This could be a duplicate or out-of-order action
      const existingAction = this.actionHistory.find(
        a => a.sequenceNumber === deterministicAction.sequenceNumber
      );
      
      if (existingAction) {
        // Check if it's the same action
        if (this.actionsMatch(existingAction, deterministicAction)) {
          return { valid: true }; // Duplicate, but valid
        }
        return { valid: false, error: "Conflicting action with same sequence number" };
      }
    }

    // Verify previous state hash matches
    const currentHash = computeStateHash(currentState);
    if (deterministicAction.previousStateHash !== currentHash) {
      return { 
        valid: false, 
        error: `State hash mismatch: expected ${currentHash}, got ${deterministicAction.previousStateHash}` 
      };
    }

    return { valid: true };
  }

  /**
   * Apply a remote action after validation
   */
  applyRemoteAction(
    deterministicAction: DeterministicAction,
    resultingState: GameState
  ): void {
    // Update sequence number
    if (deterministicAction.sequenceNumber > this.currentSequence) {
      this.currentSequence = deterministicAction.sequenceNumber;
    }

    // Add to history
    this.actionHistory.push(deterministicAction);
    this.trimHistory();
  }

  /**
   * Register a peer
   */
  registerPeer(peerId: PeerId): void {
    this.peerStates.set(peerId, {
      peerId,
      lastAcknowledgedSeq: 0,
      lastKnownStateHash: "",
      isInSync: true,
      lastSyncCheck: Date.now(),
      consecutiveDesyncs: 0,
    });
  }

  /**
   * Unregister a peer
   */
  unregisterPeer(peerId: PeerId): void {
    this.peerStates.delete(peerId);
  }

  /**
   * Update peer sync state
   */
  updatePeerState(
    peerId: PeerId,
    acknowledgedSeq: SequenceNumber,
    stateHash: string
  ): void {
    const peerState = this.peerStates.get(peerId);
    if (!peerState) return;

    peerState.lastAcknowledgedSeq = acknowledgedSeq;
    peerState.lastKnownStateHash = stateHash;
    peerState.lastSyncCheck = Date.now();

    // Check if peer is in sync
    const localHash = this.actionHistory.length > 0
      ? this.actionHistory[this.actionHistory.length - 1].resultingStateHash
      : "";

    peerState.isInSync = stateHash === localHash;
    
    if (!peerState.isInSync) {
      peerState.consecutiveDesyncs++;
    } else {
      peerState.consecutiveDesyncs = 0;
    }
  }

  /**
   * Verify sync with all peers
   */
  verifySync(localState: GameState): SyncVerificationResult {
    const localHash = computeStateHash(localState);
    const remoteHashes = new Map<PeerId, string>();
    const discrepancies = new Map<PeerId, HashDiscrepancy[]>();

    this.peerStates.forEach((peerState, peerId) => {
      remoteHashes.set(peerId, peerState.lastKnownStateHash);

      if (peerState.lastKnownStateHash && peerState.lastKnownStateHash !== localHash) {
        // Desync detected - we'd need the remote state to analyze discrepancies
        // For now, mark as having discrepancies
        discrepancies.set(peerId, [{
          category: "unknown",
          description: "State hash mismatch - full state comparison needed",
          localValue: localHash,
          remoteValue: peerState.lastKnownStateHash,
        }]);
      }
    });

    const result: SyncVerificationResult = {
      isInSync: discrepancies.size === 0,
      localHash,
      remoteHashes,
      discrepancies,
      timestamp: Date.now(),
    };

    if (!result.isInSync && this.onDesyncDetected) {
      this.onDesyncDetected(result);
    }

    return result;
  }

  /**
   * Resolve a conflict between peers
   */
  resolveConflict(
    localState: GameState,
    remoteState: GameState,
    remotePeerId: PeerId,
    conflictSeq: SequenceNumber
  ): ConflictResolution {
    const discrepancies = analyzeHashDiscrepancy(localState, remoteState);

    // Determine resolution strategy based on conflict type
    if (discrepancies.length === 0) {
      // No actual discrepancy - hashes might have been computed differently
      return {
        resolved: true,
        strategy: "forward",
        resolutionActions: [],
        conflictDescription: "False positive - states are equivalent",
      };
    }

    // Check if we can merge (simple conflicts)
    const canMerge = discrepancies.every(d => 
      d.category === "player" && d.description.includes("Life total")
    );

    if (canMerge) {
      // Use authoritative resolution based on action history
      return this.authoritativeResolution(localState, remoteState, remotePeerId, conflictSeq);
    }

    // Check if rollback is possible
    const snapshot = this.findSnapshotBefore(conflictSeq);
    if (snapshot) {
      return {
        resolved: true,
        strategy: "rollback",
        resolutionActions: [],
        conflictDescription: `Rolling back to sequence ${snapshot.sequenceNumber}`,
        rollbackState: snapshot.state,
        rollbackSequence: snapshot.sequenceNumber,
      };
    }

    // Fall back to authoritative resolution
    return this.authoritativeResolution(localState, remoteState, remotePeerId, conflictSeq);
  }

  /**
   * Authoritative resolution - use action history as source of truth
   */
  private authoritativeResolution(
    localState: GameState,
    remoteState: GameState,
    remotePeerId: PeerId,
    conflictSeq: SequenceNumber
  ): ConflictResolution {
    // Find all actions after the conflict point
    const actionsAfterConflict = this.actionHistory.filter(
      a => a.sequenceNumber >= conflictSeq
    );

    // Determine which peer has the most complete action history
    const localActions = actionsAfterConflict.filter(
      a => a.initiatorId === this.localPeerId
    );
    const remoteActions = actionsAfterConflict.filter(
      a => a.initiatorId === remotePeerId
    );

    // Use the peer with more actions as authoritative
    // In a real implementation, this would use a more sophisticated consensus algorithm
    const resolutionActions = localActions.length >= remoteActions.length
      ? localActions
      : remoteActions;

    return {
      resolved: true,
      strategy: "authoritative",
      resolutionActions,
      conflictDescription: `Using authoritative action history (${resolutionActions.length} actions)`,
    };
  }

  /**
   * Take a state snapshot
   */
  takeSnapshot(state: GameState): void {
    const snapshot: StateSnapshot = {
      sequenceNumber: this.currentSequence,
      state: JSON.parse(JSON.stringify(state)), // Deep copy
      hash: computeStateHash(state),
      timestamp: Date.now(),
    };

    this.stateSnapshots.push(snapshot);

    // Trim old snapshots
    if (this.stateSnapshots.length > this.maxSnapshotHistory) {
      this.stateSnapshots.shift();
    }
  }

  /**
   * Find a snapshot before a given sequence number
   */
  findSnapshotBefore(seq: SequenceNumber): StateSnapshot | null {
    for (let i = this.stateSnapshots.length - 1; i >= 0; i--) {
      if (this.stateSnapshots[i].sequenceNumber < seq) {
        return this.stateSnapshots[i];
      }
    }
    return null;
  }

  /**
   * Get action history since a given sequence number
   */
  getActionsSince(seq: SequenceNumber): DeterministicAction[] {
    return this.actionHistory.filter(a => a.sequenceNumber > seq);
  }

  /**
   * Get full action history
   */
  getActionHistory(): DeterministicAction[] {
    return [...this.actionHistory];
  }

  /**
   * Get peer states
   */
  getPeerStates(): Map<PeerId, PeerSyncState> {
    return new Map(this.peerStates);
  }

  /**
   * Check if two actions match
   */
  private actionsMatch(a1: DeterministicAction, a2: DeterministicAction): boolean {
    return (
      a1.sequenceNumber === a2.sequenceNumber &&
      a1.initiatorId === a2.initiatorId &&
      a1.previousStateHash === a2.previousStateHash &&
      a1.resultingStateHash === a2.resultingStateHash &&
      JSON.stringify(a1.action) === JSON.stringify(a2.action)
    );
  }

  /**
   * Trim history to prevent memory issues
   */
  private trimHistory(): void {
    if (this.actionHistory.length > this.maxActionHistory) {
      // Keep the most recent actions
      this.actionHistory = this.actionHistory.slice(-this.maxActionHistory);
    }
  }

  /**
   * Reset the engine
   */
  reset(): void {
    this.currentSequence = 0;
    this.actionHistory = [];
    this.stateSnapshots = [];
    this.peerStates.clear();
  }
}

/**
 * Create a deterministic game state engine
 */
export function createDeterministicEngine(localPeerId: PeerId): DeterministicGameStateEngine {
  return new DeterministicGameStateEngine(localPeerId);
}

/**
 * Synchronization message types
 */
export type SyncMessageType =
  | "action"
  | "ack"
  | "sync-request"
  | "sync-response"
  | "state-hash"
  | "desync-alert"
  | "conflict-resolution";

/**
 * Base synchronization message
 */
export interface SyncMessage {
  type: SyncMessageType;
  senderId: PeerId;
  timestamp: number;
  sequenceNumber: SequenceNumber;
}

/**
 * Action message
 */
export interface ActionMessage extends SyncMessage {
  type: "action";
  action: DeterministicAction;
}

/**
 * Acknowledgment message
 */
export interface AckMessage extends SyncMessage {
  type: "ack";
  acknowledgedSeq: SequenceNumber;
  stateHash: string;
}

/**
 * Sync request message
 */
export interface SyncRequestMessage extends SyncMessage {
  type: "sync-request";
  fromSequence: SequenceNumber;
}

/**
 * Sync response message
 */
export interface SyncResponseMessage extends SyncMessage {
  type: "sync-response";
  actions: DeterministicAction[];
  currentStateHash: string;
}

/**
 * State hash message
 */
export interface StateHashMessage extends SyncMessage {
  type: "state-hash";
  stateHash: string;
}

/**
 * Desync alert message
 */
export interface DesyncAlertMessage extends SyncMessage {
  type: "desync-alert";
  localHash: string;
  remoteHash: string;
  conflictSeq: SequenceNumber;
}

/**
 * Conflict resolution message
 */
export interface ConflictResolutionMessage extends SyncMessage {
  type: "conflict-resolution";
  resolution: ConflictResolution;
}

/**
 * Union type of all sync messages
 */
export type GameSyncMessage =
  | ActionMessage
  | AckMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | StateHashMessage
  | DesyncAlertMessage
  | ConflictResolutionMessage;

/**
 * Serialize a sync message for transmission
 */
export function serializeSyncMessage(message: GameSyncMessage): string {
  return JSON.stringify(message);
}

/**
 * Deserialize a sync message
 */
export function deserializeSyncMessage(data: string): GameSyncMessage | null {
  try {
    const message = JSON.parse(data) as GameSyncMessage;
    
    // Validate message structure
    if (!message.type || !message.senderId || !message.timestamp) {
      return null;
    }

    return message;
  } catch {
    return null;
  }
}

/**
 * Create an action message
 */
export function createActionMessage(
  action: DeterministicAction,
  senderId: PeerId
): ActionMessage {
  return {
    type: "action",
    senderId,
    timestamp: Date.now(),
    sequenceNumber: action.sequenceNumber,
    action,
  };
}

/**
 * Create an acknowledgment message
 */
export function createAckMessage(
  acknowledgedSeq: SequenceNumber,
  stateHash: string,
  senderId: PeerId
): AckMessage {
  return {
    type: "ack",
    senderId,
    timestamp: Date.now(),
    sequenceNumber: acknowledgedSeq,
    acknowledgedSeq,
    stateHash,
  };
}

/**
 * Create a sync request message
 */
export function createSyncRequestMessage(
  fromSequence: SequenceNumber,
  senderId: PeerId
): SyncRequestMessage {
  return {
    type: "sync-request",
    senderId,
    timestamp: Date.now(),
    sequenceNumber: fromSequence,
    fromSequence,
  };
}

/**
 * Create a state hash message
 */
export function createStateHashMessage(
  stateHash: string,
  sequenceNumber: SequenceNumber,
  senderId: PeerId
): StateHashMessage {
  return {
    type: "state-hash",
    senderId,
    timestamp: Date.now(),
    sequenceNumber,
    stateHash,
  };
}

/**
 * Create a desync alert message
 */
export function createDesyncAlertMessage(
  localHash: string,
  remoteHash: string,
  conflictSeq: SequenceNumber,
  senderId: PeerId
): DesyncAlertMessage {
  return {
    type: "desync-alert",
    senderId,
    timestamp: Date.now(),
    sequenceNumber: conflictSeq,
    localHash,
    remoteHash,
    conflictSeq,
  };
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG = {
  /** Interval between sync checks (ms) */
  syncCheckInterval: 5000,
  /** Number of consecutive desyncs before alert */
  desyncThreshold: 3,
  /** Maximum time to wait for acknowledgment (ms) */
  ackTimeout: 10000,
  /** Maximum number of retry attempts */
  maxRetries: 3,
  /** Whether to auto-resolve conflicts */
  autoResolveConflicts: true,
  /** Snapshot interval (in actions) */
  snapshotInterval: 10,
};