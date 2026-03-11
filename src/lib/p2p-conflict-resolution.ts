/**
 * P2P Conflict Resolution for Simultaneous Actions
 * 
 * This module handles conflict resolution when multiple players
 * perform actions simultaneously in P2P mode.
 */

/**
 * Action priority levels for conflict resolution
 */
export type ActionPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy =
  | 'host-wins'        // Host's action takes priority
  | 'timestamp-based'  // Earlier timestamp wins
  | 'priority-based'   // Higher priority action wins
  | 'round-robin'      // Alternate between players
  | 'consensus'        // Require agreement from all peers;

/**
 * Action wrapper with metadata for conflict resolution
 */
export interface TimestampedAction {
  actionId: string;
  playerId: string;
  playerName: string;
  actionType: string;
  actionData: unknown;
  timestamp: number;
  priority: ActionPriority;
  sequenceNumber: number;
  receivedAt: number;
}

/**
 * Conflict between two simultaneous actions
 */
export interface ActionConflict {
  action1: TimestampedAction;
  action2: TimestampedAction;
  resolution: 'action1-wins' | 'action2-wins' | 'merge' | 'queue';
  reason: string;
  resolvedAt: number;
}

/**
 * Action queue entry
 */
export interface QueuedAction {
  action: TimestampedAction;
  queuedAt: number;
  processAfter?: string; // Action ID to wait for
}

/**
 * Conflict resolution configuration
 */
export interface ConflictResolutionConfig {
  strategy: ConflictStrategy;
  actionWindow: number; // Time window in ms for considering actions simultaneous
  hostId: string;
  enablePriority: boolean;
  enableSequenceNumbers: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ConflictResolutionConfig = {
  strategy: 'host-wins',
  actionWindow: 100, // 100ms window
  hostId: '',
  enablePriority: true,
  enableSequenceNumbers: true,
};

/**
 * Priority mapping for action types
 */
const ACTION_PRIORITY_MAP: Record<string, ActionPriority> = {
  // Critical actions that must be processed immediately
  'game-end': 'critical',
  'player-eliminated': 'critical',
  'state-correction': 'critical',
  
  // High priority actions
  'combat-declare': 'high',
  'spell-cast': 'high',
  'ability-activate': 'high',
  
  // Normal game actions
  'play-card': 'normal',
  'attack': 'normal',
  'block': 'normal',
  'tap': 'normal',
  'untap': 'normal',
  
  // Low priority actions
  'chat': 'low',
  'emote': 'low',
  'surrender': 'low',
};

/**
 * Conflict resolution manager
 */
export class ConflictResolutionManager {
  private config: ConflictResolutionConfig;
  private actionQueue: Map<string, QueuedAction> = new Map();
  private processedActions: Map<string, TimestampedAction> = new Map();
  private pendingConflicts: Map<string, ActionConflict> = new Map();
  private sequenceNumbers: Map<string, number> = new Map(); // Per-player sequence numbers
  private lastProcessedTimestamp: number = 0;
  private roundRobinOrder: string[] = [];
  private currentRoundRobinIndex: number = 0;

  constructor(config: Partial<ConflictResolutionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConflictResolutionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Process an incoming action, handling conflicts if necessary
   * @returns Object with action to process and any conflict info
   */
  processAction(
    actionType: string,
    actionData: unknown,
    playerId: string,
    playerName: string
  ): {
    shouldProcess: boolean;
    action?: TimestampedAction;
    conflict?: ActionConflict;
    shouldQueue: boolean;
    queueReason?: string;
  } {
    const now = Date.now();
    
    // Create timestamped action
    const sequenceNumber = this.getNextSequenceNumber(playerId);
    const action: TimestampedAction = {
      actionId: this.generateActionId(playerId, sequenceNumber),
      playerId,
      playerName,
      actionType,
      actionData,
      timestamp: now,
      priority: this.getActionPriority(actionType),
      sequenceNumber,
      receivedAt: now,
    };

    // Check for conflicts with recent actions
    const recentActions = this.getRecentActions(this.config.actionWindow);
    const conflictingAction = this.findConflict(action, recentActions);

    if (conflictingAction) {
      // Resolve the conflict
      const conflict = this.resolveConflict(action, conflictingAction);
      this.pendingConflicts.set(conflict.action1.actionId, conflict);

      if (conflict.resolution === 'queue') {
        return {
          shouldProcess: false,
          shouldQueue: true,
          queueReason: 'Conflicting action being processed',
          conflict,
        };
      }

      if (conflict.resolution === 'action2-wins') {
        // Other action wins, queue this one
        this.queueAction(action);
        return {
          shouldProcess: false,
          shouldQueue: true,
          queueReason: 'Lower priority in conflict resolution',
          conflict,
        };
      }
    }

    // No conflict or this action wins
    this.processedActions.set(action.actionId, action);
    this.lastProcessedTimestamp = action.timestamp;

    return {
      shouldProcess: true,
      action,
      shouldQueue: false,
    };
  }

  /**
   * Find conflicting action within the time window
   */
  private findConflict(
    newAction: TimestampedAction,
    recentActions: TimestampedAction[]
  ): TimestampedAction | null {
    // Only check for conflicts if there are recent actions from other players
    const otherPlayerActions = recentActions.filter(
      a => a.playerId !== newAction.playerId
    );

    if (otherPlayerActions.length === 0) {
      return null;
    }

    // Find the most recent action from another player
    const mostRecent = otherPlayerActions.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    );

    // Check if within the action window
    const timeDiff = Math.abs(newAction.timestamp - mostRecent.timestamp);
    if (timeDiff <= this.config.actionWindow) {
      return mostRecent;
    }

    return null;
  }

  /**
   * Resolve a conflict between two actions
   */
  private resolveConflict(
    action1: TimestampedAction,
    action2: TimestampedAction
  ): ActionConflict {
    const now = Date.now();
    let resolution: 'action1-wins' | 'action2-wins' | 'merge' | 'queue';
    let reason: string;

    switch (this.config.strategy) {
      case 'host-wins':
        if (action1.playerId === this.config.hostId) {
          resolution = 'action1-wins';
          reason = 'Host action takes priority';
        } else if (action2.playerId === this.config.hostId) {
          resolution = 'action2-wins';
          reason = 'Host action takes priority';
        } else {
          // Neither is host, fall back to timestamp
          resolution = action1.timestamp < action2.timestamp ? 'action1-wins' : 'action2-wins';
          reason = 'Earlier timestamp wins (neither is host)';
        }
        break;

      case 'timestamp-based':
        resolution = action1.timestamp < action2.timestamp ? 'action1-wins' : 'action2-wins';
        reason = 'Earlier timestamp wins';
        break;

      case 'priority-based': {
        const priorityOrder: ActionPriority[] = ['critical', 'high', 'normal', 'low'];
        const action1Priority = priorityOrder.indexOf(action1.priority);
        const action2Priority = priorityOrder.indexOf(action2.priority);

        if (action1Priority < action2Priority) {
          resolution = 'action1-wins';
          reason = 'Higher priority action wins';
        } else if (action2Priority < action1Priority) {
          resolution = 'action2-wins';
          reason = 'Higher priority action wins';
        } else {
          // Same priority, use timestamp
          resolution = action1.timestamp < action2.timestamp ? 'action1-wins' : 'action2-wins';
          reason = 'Same priority, earlier timestamp wins';
        }
        break;
      }

      case 'round-robin': {
        // Track turn order for round-robin
        if (!this.roundRobinOrder.includes(action1.playerId)) {
          this.roundRobinOrder.push(action1.playerId);
        }
        if (!this.roundRobinOrder.includes(action2.playerId)) {
          this.roundRobinOrder.push(action2.playerId);
        }

        // Determine whose turn it is in round-robin order
        const action1Index = this.roundRobinOrder.indexOf(action1.playerId);
        const action2Index = this.roundRobinOrder.indexOf(action2.playerId);

        if (action1Index < action2Index) {
          resolution = 'action1-wins';
          reason = 'Round-robin order';
        } else {
          resolution = 'action2-wins';
          reason = 'Round-robin order';
        }
        break;
      }

      case 'consensus':
        // For consensus, we queue both actions and wait for agreement
        resolution = 'queue';
        reason = 'Waiting for consensus from all peers';
        break;

      default:
        resolution = 'timestamp-based' as any;
        reason = 'Default resolution';
    }

    return {
      action1,
      action2,
      resolution,
      reason,
      resolvedAt: now,
    };
  }

  /**
   * Queue an action for later processing
   */
  private queueAction(action: TimestampedAction): void {
    this.actionQueue.set(action.actionId, {
      action,
      queuedAt: Date.now(),
    });
  }

  /**
   * Get next action from queue
   */
  getNextQueuedAction(): TimestampedAction | null {
    if (this.actionQueue.size === 0) {
      return null;
    }

    // Get the oldest queued action
    const entries = Array.from(this.actionQueue.entries());
    entries.sort((a, b) => a[1].queuedAt - b[1].queuedAt);

    const [actionId, queuedAction] = entries[0];
    
    // Check if dependency is resolved
    if (queuedAction.processAfter) {
      if (!this.processedActions.has(queuedAction.processAfter)) {
        return null; // Dependency not yet processed
      }
    }

    this.actionQueue.delete(actionId);
    return queuedAction.action;
  }

  /**
   * Get recent actions within a time window
   */
  private getRecentActions(windowMs: number): TimestampedAction[] {
    const now = Date.now();
    return Array.from(this.processedActions.values()).filter(
      action => now - action.timestamp <= windowMs
    );
  }

  /**
   * Get action priority based on type
   */
  private getActionPriority(actionType: string): ActionPriority {
    return ACTION_PRIORITY_MAP[actionType] || 'normal';
  }

  /**
   * Get next sequence number for a player
   */
  private getNextSequenceNumber(playerId: string): number {
    const current = this.sequenceNumbers.get(playerId) || 0;
    const next = current + 1;
    this.sequenceNumbers.set(playerId, next);
    return next;
  }

  /**
   * Generate unique action ID
   */
  private generateActionId(playerId: string, sequenceNumber: number): string {
    return `${playerId}-${sequenceNumber}`;
  }

  /**
   * Get pending conflicts
   */
  getPendingConflicts(): ActionConflict[] {
    return Array.from(this.pendingConflicts.values());
  }

  /**
   * Clear a resolved conflict
   */
  clearConflict(actionId: string): void {
    this.pendingConflicts.delete(actionId);
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.actionQueue.size;
  }

  /**
   * Clear old processed actions (keep only recent ones)
   */
  cleanup(maxAge: number = 5000): void {
    const now = Date.now();
    for (const [actionId, action] of this.processedActions.entries()) {
      if (now - action.timestamp > maxAge) {
        this.processedActions.delete(actionId);
      }
    }
  }

  /**
   * Reset state
   */
  reset(): void {
    this.actionQueue.clear();
    this.pendingConflicts.clear();
    this.sequenceNumbers.clear();
    this.lastProcessedTimestamp = 0;
    this.roundRobinOrder = [];
    this.currentRoundRobinIndex = 0;
  }
}

/**
 * Create a conflict resolution manager
 */
export function createConflictResolutionManager(
  config: Partial<ConflictResolutionConfig> = {}
): ConflictResolutionManager {
  return new ConflictResolutionManager(config);
}

/**
 * Merge two compatible actions
 */
export function mergeActions(
  action1: TimestampedAction,
  action2: TimestampedAction
): TimestampedAction | null {
  // Only certain action types can be merged
  const mergeableTypes = ['chat', 'emote', 'surrender'];

  if (!mergeableTypes.includes(action1.actionType) ||
      !mergeableTypes.includes(action2.actionType)) {
    return null;
  }

  // For chat/emote, we can merge by keeping both
  return {
    ...action1,
    timestamp: Math.max(action1.timestamp, action2.timestamp),
    actionData: {
      merged: true,
      actions: [action1.actionData, action2.actionData],
    },
  };
}
