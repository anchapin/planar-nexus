/**
 * @fileOverview Replay system for recording and replaying games
 * 
 * Issue #32: Phase 2.3: Create in-memory replay system
 * 
 * Provides:
 * - Recording game actions
 * - Storing action sequence
 * - Replay from start
 * - Jump to specific point in game
 * - Export replay file
 */

import type { GameState, GameAction, ActionType, PlayerId } from './types';

/**
 * A recorded action in the replay
 */
export interface ReplayAction {
  /** Unique sequence number */
  sequenceNumber: number;
  /** The action that was performed */
  action: GameAction;
  /** The game state after this action was performed */
  resultingState: GameState;
  /** Human-readable description of the action */
  description: string;
  /** Timestamp when action was recorded */
  recordedAt: number;
}

/**
 * Complete replay data
 */
export interface Replay {
  /** Unique replay identifier */
  id: string;
  /** Game metadata */
  metadata: ReplayMetadata;
  /** All recorded actions in order */
  actions: ReplayAction[];
  /** Current playback position */
  currentPosition: number;
  /** Total number of actions */
  totalActions: number;
  /** Created at timestamp */
  createdAt: number;
  /** Last modified timestamp */
  lastModifiedAt: number;
}

/**
 * Metadata about the replay
 */
export interface ReplayMetadata {
  /** Game format (commander, standard, modern, etc.) */
  format: string;
  /** Names of players in order */
  playerNames: string[];
  /** Starting life totals */
  startingLife: number;
  /** Whether this is a commander game */
  isCommander: boolean;
  /** Winner(s) of the game (if completed) */
  winners?: string[];
  /** Date the game started */
  gameStartDate: number;
  /** Date the game ended (if completed) */
  gameEndDate?: number;
  /** Game end reason */
  endReason?: string;
}

/**
 * Replay player state for playback
 */
export interface ReplayPlayer {
  /** Unique player identifier */
  id: string;
  /** Player name */
  name: string;
}

/**
 * Replay events for external listeners
 */
export type ReplayEventType = 
  | 'playback_started'
  | 'playback_paused'
  | 'playback_position_changed'
  | 'playback_ended'
  | 'action_added';

export interface ReplayEvent {
  type: ReplayEventType;
  replayId: string;
  position?: number;
  timestamp: number;
}

/**
 * Replay event listener callback
 */
export type ReplayEventListener = (event: ReplayEvent) => void;

/**
 * Replay system class for managing game recordings
 */
export class ReplaySystem {
  private replay: Replay | null = null;
  private listeners: Set<ReplayEventListener> = new Set();
  private sequenceCounter = 0;

  /**
   * Create a new replay for a game
   */
  createReplay(
    format: string,
    playerNames: string[],
    startingLife: number = 20,
    isCommander: boolean = false
  ): Replay {
    const now = Date.now();
    
    this.replay = {
      id: `replay-${now}-${Math.random().toString(36).substr(2, 9)}`,
      metadata: {
        format,
        playerNames,
        startingLife,
        isCommander,
        gameStartDate: now,
      },
      actions: [],
      currentPosition: 0,
      totalActions: 0,
      createdAt: now,
      lastModifiedAt: now,
    };

    this.sequenceCounter = 0;

    this.emitEvent({
      type: 'playback_started',
      replayId: this.replay.id,
      timestamp: now,
    });

    return this.replay;
  }

  /**
   * Record an action that was performed
   */
  recordAction(
    action: GameAction,
    resultingState: GameState,
    description: string
  ): ReplayAction {
    if (!this.replay) {
      throw new Error('No active replay. Call createReplay() first.');
    }

    this.sequenceCounter++;
    
    const replayAction: ReplayAction = {
      sequenceNumber: this.sequenceCounter,
      action,
      resultingState,
      description,
      recordedAt: Date.now(),
    };

    this.replay.actions.push(replayAction);
    this.replay.totalActions = this.replay.actions.length;
    this.replay.lastModifiedAt = Date.now();

    // Update game end info if game is completed
    if (resultingState.status === 'completed') {
      this.replay.metadata.winners = resultingState.winners;
      this.replay.metadata.gameEndDate = Date.now();
      this.replay.metadata.endReason = resultingState.endReason || undefined;
    }

    this.emitEvent({
      type: 'action_added',
      replayId: this.replay.id,
      position: this.replay.totalActions - 1,
      timestamp: Date.now(),
    });

    return replayAction;
  }

  /**
   * Get the current replay
   */
  getReplay(): Replay | null {
    return this.replay;
  }

  /**
   * Get action at a specific position
   */
  getActionAt(position: number): ReplayAction | null {
    if (!this.replay) return null;
    if (position < 0 || position >= this.replay.actions.length) return null;
    return this.replay.actions[position];
  }

  /**
   * Get the game state at a specific position
   */
  getStateAt(position: number): GameState | null {
    const action = this.getActionAt(position);
    return action?.resultingState || null;
  }

  /**
   * Get current position
   */
  getCurrentPosition(): number {
    return this.replay?.currentPosition || 0;
  }

  /**
   * Set playback position
   */
  setPosition(position: number): GameState | null {
    if (!this.replay) return null;
    
    const validPosition = Math.max(0, Math.min(position, this.replay.actions.length - 1));
    this.replay.currentPosition = validPosition;

    this.emitEvent({
      type: 'playback_position_changed',
      replayId: this.replay.id,
      position: validPosition,
      timestamp: Date.now(),
    });

    return this.getStateAt(validPosition);
  }

  /**
   * Move to next action
   */
  next(): GameState | null {
    if (!this.replay) return null;
    return this.setPosition(this.replay.currentPosition + 1);
  }

  /**
   * Move to previous action
   */
  previous(): GameState | null {
    if (!this.replay) return null;
    return this.setPosition(this.replay.currentPosition - 1);
  }

  /**
   * Jump to start
   */
  jumpToStart(): GameState | null {
    return this.setPosition(0);
  }

  /**
   * Jump to end
   */
  jumpToEnd(): GameState | null {
    if (!this.replay) return null;
    return this.setPosition(this.replay.actions.length - 1);
  }

  /**
   * Jump to a specific turn
   */
  jumpToTurn(turnNumber: number): GameState | null {
    if (!this.replay) return null;
    
    // Find the first action of the specified turn
    const targetPosition = this.replay.actions.findIndex(
      action => action.resultingState.turn.turnNumber === turnNumber
    );

    if (targetPosition === -1) return null;
    return this.setPosition(targetPosition);
  }

  /**
   * Get total number of actions
   */
  getTotalActions(): number {
    return this.replay?.totalActions || 0;
  }

  /**
   * Check if at end of replay
   */
  isAtEnd(): boolean {
    if (!this.replay) return true;
    return this.replay.currentPosition >= this.replay.actions.length - 1;
  }

  /**
   * Check if at start of replay
   */
  isAtStart(): boolean {
    return this.replay?.currentPosition === 0;
  }

  /**
   * Subscribe to replay events
   */
  subscribe(listener: ReplayEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Export replay to JSON string
   */
  exportToJSON(): string {
    if (!this.replay) {
      throw new Error('No active replay to export');
    }

    return JSON.stringify(this.replay, null, 2);
  }

  /**
   * Export replay to downloadable blob
   */
  exportToBlob(): Blob {
    const json = this.exportToJSON();
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * Export replay to file (triggers download)
   */
  exportToFile(filename?: string): void {
    if (!this.replay) return;
    
    const blob = this.exportToBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `replay-${this.replay.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import replay from JSON string
   */
  importFromJSON(json: string): Replay {
    const imported = JSON.parse(json) as Replay;
    this.replay = imported;
    this.sequenceCounter = imported.totalActions;
    return imported;
  }

  /**
   * Import replay from File object
   */
  async importFromFile(file: File): Promise<Replay> {
    const text = await file.text();
    return this.importFromJSON(text);
  }

  /**
   * Get summary of the replay
   */
  getSummary(): { turns: number; actions: number; duration: number } | null {
    if (!this.replay) return null;

    const firstAction = this.replay.actions[0];
    const lastAction = this.replay.actions[this.replay.actions.length - 1];

    const startTurn = firstAction?.resultingState.turn.turnNumber || 1;
    const endTurn = lastAction?.resultingState.turn.turnNumber || startTurn;

    const duration = this.replay.metadata.gameEndDate
      ? this.replay.metadata.gameEndDate - this.replay.metadata.gameStartDate
      : Date.now() - this.replay.metadata.gameStartDate;

    return {
      turns: endTurn - startTurn + 1,
      actions: this.replay.totalActions,
      duration,
    };
  }

  /**
   * Close and reset the replay
   */
  close(): void {
    if (this.replay) {
      this.emitEvent({
        type: 'playback_ended',
        replayId: this.replay.id,
        timestamp: Date.now(),
      });
    }
    this.replay = null;
    this.sequenceCounter = 0;
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ReplayEvent): void {
    this.listeners.forEach(listener => listener(event));
  }
}

// Singleton instance for global access
export const replaySystem = new ReplaySystem();

/**
 * Helper function to create a game action
 */
export function createGameAction(
  type: ActionType,
  playerId: PlayerId,
  data: Record<string, unknown> = {}
): GameAction {
  return {
    type,
    playerId,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Generate human-readable description for an action
 */
export function describeAction(action: GameAction, playerName: string): string {
  const { type, data } = action;

  switch (type) {
    case 'cast_spell':
      return `${playerName} cast ${data.cardName || 'a spell'}`;
    case 'activate_ability':
      return `${playerName} activated ${data.abilityName || 'an ability'}`;
    case 'play_land':
      return `${playerName} played a land`;
    case 'draw_card':
      return `${playerName} drew a card`;
    case 'discard_card':
      return `${playerName} discarded ${data.cardName || 'a card'}`;
    case 'declare_attackers':
      return `${playerName} declared attackers`;
    case 'declare_blockers':
      return `${playerName} declared blockers`;
    case 'tap_card':
      return `${playerName} tapped ${data.cardName || 'a card'}`;
    case 'untap_card':
      return `${playerName} untapped ${data.cardName || 'a card'}`;
    case 'destroy_card':
      return `${data.cardName || 'A card'} was destroyed`;
    case 'exile_card':
      return `${data.cardName || 'A card'} was exiled`;
    case 'gain_life':
      return `${playerName} gained ${data.amount || 0} life`;
    case 'lose_life':
      return `${playerName} lost ${data.amount || 0} life`;
    case 'deal_damage':
      return `${playerName} dealt ${data.amount || 0} damage to ${data.target || 'target'}`;
    case 'mulligan':
      return `${playerName} took a mulligan`;
    case 'concede':
      return `${playerName} conceded the game`;
    case 'pass_priority':
      return `${playerName} passed priority`;
    default:
      return `${playerName} performed action: ${type}`;
  }
}
