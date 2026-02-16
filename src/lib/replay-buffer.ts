/**
 * Replay Buffer System
 * 
 * Handles action buffering for late joiners and replay functionality.
 * Allows players to join mid-game through replay and fast-forward.
 */

import { GameAction } from './action-broadcast';

// Maximum number of actions to buffer
const DEFAULT_MAX_BUFFER_SIZE = 10000;

// Maximum age of game (in milliseconds) before late join is not allowed
const DEFAULT_MAX_GAME_AGE = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Buffered action with metadata
 */
export interface BufferedAction {
  action: GameAction;
  receivedAt: number;
  applied: boolean;
  appliedAt?: number;
}

/**
 * Replay state
 */
export type ReplayState = 'idle' | 'playing' | 'paused' | 'fast-forwarding' | 'completed';

/**
 * Replay speed options
 */
export type ReplaySpeed = 1 | 2 | 4 | 8 | 16;

/**
 * Replay events
 */
export interface ReplayEvent {
  type: 'action-applied' | 'replay-started' | 'replay-paused' | 'replay-resumed' | 'replay-completed' | 'fast-forward-started' | 'fast-forward-ended';
  timestamp: number;
  data?: unknown;
}

/**
 * Catch-up progress
 */
export interface CatchUpProgress {
  totalActions: number;
  appliedActions: number;
  percentage: number;
  estimatedTimeRemaining: number; // milliseconds
}

/**
 * Join validation result
 */
export interface JoinValidationResult {
  canJoin: boolean;
  reason?: string;
  actionCount: number;
  gameAge: number;
  oldestActionTimestamp: number;
}

/**
 * ReplayBuffer class - handles action buffering and replay
 */
export class ReplayBuffer {
  private actions: BufferedAction[] = [];
  private maxBufferSize: number;
  private maxGameAge: number;
  private gameStartTime: number;
  private currentIndex: number = 0;
  private state: ReplayState = 'idle';
  private speed: ReplaySpeed = 1;
  private events: ReplayEvent[] = [];
  private onActionApplied?: (action: GameAction, index: number) => void;
  private onStateChange?: (state: ReplayState) => void;
  private onProgressUpdate?: (progress: CatchUpProgress) => void;
  private playbackInterval?: NodeJS.Timeout;
  private startTimestamp?: number;

  constructor(options?: {
    maxBufferSize?: number;
    maxGameAge?: number;
    gameStartTime?: number;
  }) {
    this.maxBufferSize = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.maxGameAge = options?.maxGameAge ?? DEFAULT_MAX_GAME_AGE;
    this.gameStartTime = options?.gameStartTime ?? Date.now();
  }

  /**
   * Register callback for action applied events
   */
  setActionHandler(handler: (action: GameAction, index: number) => void): void {
    this.onActionApplied = handler;
  }

  /**
   * Register callback for state changes
   */
  setStateChangeHandler(handler: (state: ReplayState) => void): void {
    this.onStateChange = handler;
  }

  /**
   * Register callback for progress updates
   */
  setProgressHandler(handler: (progress: CatchUpProgress) => void): void {
    this.onProgressUpdate = handler;
  }

  /**
   * Set the game start time
   */
  setGameStartTime(timestamp: number): void {
    this.gameStartTime = timestamp;
  }

  /**
   * Add an action to the buffer
   */
  addAction(action: GameAction): void {
    const bufferedAction: BufferedAction = {
      action,
      receivedAt: Date.now(),
      applied: false
    };

    this.actions.push(bufferedAction);

    // Trim buffer if it exceeds max size
    if (this.actions.length > this.maxBufferSize) {
      this.actions.shift();
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    // Emit progress update
    this.emitProgress();
  }

  /**
   * Add multiple actions at once (for sync)
   */
  addActions(actions: GameAction[]): void {
    actions.forEach((action) => {
      // Check if action already exists
      if (!this.actions.find((a) => a.action.id === action.id)) {
        this.addAction(action);
      }
    });
  }

  /**
   * Validate if a player can join late
   */
  validateJoin(): JoinValidationResult {
    const now = Date.now();
    const gameAge = now - this.gameStartTime;
    const actionCount = this.actions.length;
    const oldestAction = this.actions[0];

    if (gameAge > this.maxGameAge) {
      return {
        canJoin: false,
        reason: 'Game is too old to join',
        actionCount,
        gameAge,
        oldestActionTimestamp: oldestAction?.receivedAt ?? this.gameStartTime
      };
    }

    // Check if game is almost over (more than 95% complete)
    // This is a heuristic - could be adjusted based on game state
    if (actionCount > 500) {
      // For now, allow join but warn
      return {
        canJoin: true,
        reason: 'Warning: Late join to advanced game',
        actionCount,
        gameAge,
        oldestActionTimestamp: oldestAction?.receivedAt ?? this.gameStartTime
      };
    }

    return {
      canJoin: true,
      actionCount,
      gameAge,
      oldestActionTimestamp: oldestAction?.receivedAt ?? this.gameStartTime
    };
  }

  /**
   * Start replay from the beginning or current position
   */
  startReplay(fromIndex?: number): void {
    if (this.actions.length === 0) {
      console.warn('No actions to replay');
      return;
    }

    this.currentIndex = fromIndex ?? 0;
    this.state = 'playing';
    this.startTimestamp = Date.now();
    
    this.emitEvent({ type: 'replay-started', timestamp: Date.now() });
    this.onStateChange?.(this.state);

    this.startPlayback();
  }

  /**
   * Pause replay
   */
  pauseReplay(): void {
    if (this.state !== 'playing' && this.state !== 'fast-forwarding') {
      return;
    }

    this.stopPlayback();
    this.state = 'paused';
    
    this.emitEvent({ type: 'replay-paused', timestamp: Date.now() });
    this.onStateChange?.(this.state);
  }

  /**
   * Resume replay
   */
  resumeReplay(): void {
    if (this.state !== 'paused') {
      return;
    }

    this.state = 'playing';
    
    this.emitEvent({ type: 'replay-resumed', timestamp: Date.now() });
    this.onStateChange?.(this.state);

    this.startPlayback();
  }

  /**
   * Set replay speed
   */
  setSpeed(speed: ReplaySpeed): void {
    const wasPlaying = this.state === 'playing' || this.state === 'fast-forwarding';
    
    this.speed = speed;
    
    // Restart playback with new speed if currently playing
    if (wasPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  /**
   * Start fast-forward to catch up
   */
  startFastForward(targetIndex?: number): void {
    const target = targetIndex ?? this.actions.length - 1;
    
    if (target <= this.currentIndex) {
      console.warn('Already at or before target index');
      return;
    }

    this.stopPlayback();
    this.state = 'fast-forwarding';
    
    this.emitEvent({ 
      type: 'fast-forward-started', 
      timestamp: Date.now(),
      data: { targetIndex: target }
    });
    this.onStateChange?.(this.state);

    // Fast-forward with increased speed
    this.speed = 16; // Maximum speed for fast-forward
    this.startPlayback(target);
  }

  /**
   * Stop replay
   */
  stopReplay(): void {
    this.stopPlayback();
    this.state = 'idle';
    this.onStateChange?.(this.state);
  }

  /**
   * Seek to a specific action index
   */
  seekTo(index: number): void {
    if (index < 0 || index >= this.actions.length) {
      console.warn('Invalid seek index');
      return;
    }

    const wasPlaying = this.state === 'playing';
    if (wasPlaying) {
      this.stopPlayback();
    }

    // Mark all actions up to new index as applied
    for (let i = 0; i <= index; i++) {
      if (!this.actions[i].applied) {
        this.actions[i].applied = true;
        this.actions[i].appliedAt = Date.now();
        this.onActionApplied?.(this.actions[i].action, i);
      }
    }

    this.currentIndex = index;
    this.emitProgress();

    if (wasPlaying) {
      this.startPlayback();
    }
  }

  /**
   * Jump to the end (catch up)
   */
  jumpToEnd(): void {
    this.seekTo(this.actions.length - 1);
    this.state = 'completed';
    this.emitEvent({ type: 'replay-completed', timestamp: Date.now() });
    this.onStateChange?.(this.state);
  }

  /**
   * Get current progress
   */
  getProgress(): CatchUpProgress {
    const appliedCount = this.actions.filter((a) => a.applied).length;
    const total = this.actions.length;
    const percentage = total > 0 ? (appliedCount / total) * 100 : 0;
    
    // Estimate time remaining based on average action time
    const appliedActions = this.actions.filter((a) => a.appliedAt);
    let estimatedTimeRemaining = 0;
    
    if (appliedActions.length > 1) {
      const firstApplied = appliedActions[0].appliedAt!;
      const lastApplied = appliedActions[appliedActions.length - 1].appliedAt!;
      const timeSpan = lastApplied - firstApplied;
      const avgTimePerAction = timeSpan / appliedActions.length;
      const remainingActions = total - appliedCount;
      estimatedTimeRemaining = avgTimePerAction * remainingActions;
    }

    return {
      totalActions: total,
      appliedActions: appliedCount,
      percentage,
      estimatedTimeRemaining
    };
  }

  /**
   * Get buffered actions
   */
  getBufferedActions(): BufferedAction[] {
    return [...this.actions];
  }

  /**
   * Get unapplied actions from current position
   */
  getUnappliedActions(): BufferedAction[] {
    return this.actions.slice(this.currentIndex);
  }

  /**
   * Get current state
   */
  getState(): ReplayState {
    return this.state;
  }

  /**
   * Get current index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get total action count
   */
  getActionCount(): number {
    return this.actions.length;
  }

  /**
   * Get events
   */
  getEvents(): ReplayEvent[] {
    return [...this.events];
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.stopPlayback();
    this.actions = [];
    this.currentIndex = 0;
    this.state = 'idle';
    this.events = [];
  }

  /**
   * Start playback loop
   */
  private startPlayback(targetIndex?: number): void {
    const target = targetIndex ?? this.actions.length - 1;
    
    // Calculate delay based on speed (base 100ms per action)
    const baseDelay = 100;
    const delay = baseDelay / this.speed;

    this.playbackInterval = setInterval(() => {
      if (this.currentIndex > target) {
        this.stopPlayback();
        this.state = 'completed';
        this.emitEvent({ type: 'replay-completed', timestamp: Date.now() });
        this.onStateChange?.(this.state);
        return;
      }

      const bufferedAction = this.actions[this.currentIndex];
      if (bufferedAction) {
        bufferedAction.applied = true;
        bufferedAction.appliedAt = Date.now();
        this.onActionApplied?.(bufferedAction.action, this.currentIndex);
      }

      this.currentIndex++;
      this.emitProgress();
    }, delay);
  }

  /**
   * Stop playback loop
   */
  private stopPlayback(): void {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = undefined;
    }
  }

  /**
   * Emit progress update
   */
  private emitProgress(): void {
    this.onProgressUpdate?.(this.getProgress());
  }

  /**
   * Emit event
   */
  private emitEvent(event: ReplayEvent): void {
    this.events.push(event);
    // Keep only last 100 events
    if (this.events.length > 100) {
      this.events.shift();
    }
  }
}

/**
 * Create a singleton instance
 */
let replayBufferInstance: ReplayBuffer | null = null;

export function getReplayBuffer(options?: {
  maxBufferSize?: number;
  maxGameAge?: number;
  gameStartTime?: number;
}): ReplayBuffer {
  if (!replayBufferInstance) {
    replayBufferInstance = new ReplayBuffer(options);
  }
  return replayBufferInstance;
}

export function resetReplayBuffer(): void {
  replayBufferInstance = null;
}

export type { GameAction };
