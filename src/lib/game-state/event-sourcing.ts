/**
 * Event Sourcing System for Multiplayer Sync
 * Issue #753: Architecture - Integrate event sourcing as source of truth for multiplayer sync
 *
 * This module provides an event-sourcing architecture that serves as the source of truth
 * for multiplayer synchronization. Every game action flows through an event log with
 * deterministic state hash verification.
 *
 * Key features:
 * - Event log as source of truth (not resulting state)
 * - Pending vs confirmed action distinction
 * - State hash verification on every step
 * - Rollback support for desync recovery
 * - Late-joining player state reconstruction
 */

import type { GameState, GameAction, PlayerId } from "./types";
import { computeStateHash, type HashDiscrepancy } from "./state-hash";

// Re-export types for external use
export type { HashDiscrepancy };

/**
 * Sequence number for event ordering
 */
export type EventIndex = number;

/**
 * Unique identifier for a game session
 */
export type GameSessionId = string;

/**
 * Types of game events in the event log
 */
export type GameEventType =
  | "ACTION" // Player action (cast spell, declare attackers, etc.)
  | "STATE_SYNC" // Periodic state checkpoint for late-join recovery
  | "ROLLBACK" // Rollback to a previous state due to desync
  | "PLAYER_JOIN" // Player joined the game
  | "PLAYER_LEAVE" // Player left the game
  | "GAME_START" // Game started
  | "GAME_END"; // Game ended

/**
 * An action event - represents a player action that modified state
 */
export interface ActionEvent {
  type: "ACTION";
  /** Event index in the log */
  index: EventIndex;
  /** The game action that was performed */
  action: GameAction;
  /** Hash of the state BEFORE this action was applied (prevents race conditions) */
  previousStateHash: string;
  /** Hash of the state AFTER this action was applied */
  resultingStateHash: string;
  /** Player who initiated this action */
  initiatorId: PlayerId;
  /** Timestamp when event was created */
  timestamp: number;
  /** Whether this event has been confirmed by all peers */
  confirmed: boolean;
  /** IDs of peers who have confirmed this event */
  confirmedBy: PlayerId[];
}

/**
 * A state sync event - periodic checkpoint for late-join recovery
 */
export interface StateSyncEvent {
  type: "STATE_SYNC";
  /** Event index in the log */
  index: EventIndex;
  /** Full game state at this checkpoint */
  state: GameState;
  /** State hash at this checkpoint */
  stateHash: string;
  /** Timestamp when checkpoint was created */
  timestamp: number;
}

/**
 * A rollback event - indicates rollback to a previous state
 */
export interface RollbackEvent {
  type: "ROLLBACK";
  /** Event index in the log */
  index: EventIndex;
  /** Index to rollback to */
  targetIndex: EventIndex;
  /** Reason for rollback (e.g., "desync detected") */
  reason: string;
  /** Hash of the state at rollback point */
  stateHash: string;
  /** Timestamp when rollback occurred */
  timestamp: number;
}

/**
 * Player joined event
 */
export interface PlayerJoinEvent {
  type: "PLAYER_JOIN";
  /** Event index in the log */
  index: EventIndex;
  /** ID of player who joined */
  playerId: PlayerId;
  /** Name of the player */
  playerName: string;
  /** State at time of join */
  stateHash: string;
  /** Timestamp when player joined */
  timestamp: number;
}

/**
 * Player left event
 */
export interface PlayerLeaveEvent {
  type: "PLAYER_LEAVE";
  /** Event index in the log */
  index: EventIndex;
  /** ID of player who left */
  playerId: PlayerId;
  /** Reason for leaving */
  reason: string;
  /** Timestamp when player left */
  timestamp: number;
}

/**
 * Game started event
 */
export interface GameStartEvent {
  type: "GAME_START";
  /** Event index in the log */
  index: EventIndex;
  /** Initial game state */
  state: GameState;
  /** Hash of initial state */
  stateHash: string;
  /** Players in the game */
  playerIds: PlayerId[];
  /** Timestamp when game started */
  timestamp: number;
}

/**
 * Game ended event
 */
export interface GameEndEvent {
  type: "GAME_END";
  /** Event index in the log */
  index: EventIndex;
  /** Final game state */
  state: GameState;
  /** Hash of final state */
  stateHash: string;
  /** Winner(s) of the game */
  winners: PlayerId[];
  /** Reason for game end */
  endReason: string;
  /** Timestamp when game ended */
  timestamp: number;
}

/**
 * Union of all game event types
 */
export type GameEvent =
  | ActionEvent
  | StateSyncEvent
  | RollbackEvent
  | PlayerJoinEvent
  | PlayerLeaveEvent
  | GameStartEvent
  | GameEndEvent;

/**
 * Complete event log with metadata
 */
export interface GameEventLog {
  /** All events in chronological order */
  events: GameEvent[];
  /** Index of the last confirmed event (all events before this are finalized) */
  lastConfirmedIndex: EventIndex;
  /** Events that are pending confirmation from peers */
  pendingEvents: GameEvent[];
  /** Session ID for this game */
  sessionId: GameSessionId;
  /** Timestamp when event log was created */
  createdAt: number;
  /** Timestamp when event log was last modified */
  lastModifiedAt: number;
}

/**
 * Result of applying an event
 */
export interface ApplyEventResult {
  success: boolean;
  state: GameState;
  error?: string;
}

/**
 * Desync detection result
 */
export interface DesyncDetectionResult {
  /** Whether a desync was detected */
  isDesync: boolean;
  /** Local state hash */
  localHash: string;
  /** Expected state hash from event log */
  expectedHash: string;
  /** Discrepancies found (if any) */
  discrepancies: HashDiscrepancy[];
  /** Event index where desync was detected */
  atEventIndex: EventIndex;
}

/**
 * Event sourcing game state wrapper
 * This wraps a GameState and logs all mutations to the event log
 */
/**
 * Deep clone a GameState while preserving Map and Set objects
 * Uses structuredClone which properly handles Maps and Sets in modern JS
 */
function deepCloneGameState(state: GameState): GameState {
  function cloneValue(value: unknown): unknown {
    if (value instanceof Map) {
      const m = new Map();
      for (const [k, v] of value.entries()) {
        m.set(k, cloneValue(v));
      }
      return m;
    }
    if (value instanceof Set) {
      const s = new Set();
      for (const v of value.values()) {
        s.add(cloneValue(v));
      }
      return s;
    }
    if (Array.isArray(value)) {
      return value.map(cloneValue);
    }
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>)) {
        result[k] = cloneValue((value as Record<string, unknown>)[k]);
      }
      return result;
    }
    return value;
  }

  return cloneValue(state) as GameState;
}

/**
 * Revive Maps and Sets from the special JSON format used in deepCloneGameState
 */
function reviveGameState(state: any): any {
  if (state === null || state === undefined) {
    return state;
  }
  if (Array.isArray(state)) {
    return state.map(reviveGameState);
  }
  if (typeof state === "object") {
    if (state.__type === "Map") {
      return new Map(
        state.data.map(([k, v]: [any, any]) => [k, reviveGameState(v)]),
      );
    }
    if (state.__type === "Set") {
      return new Set(state.data.map((v: any) => reviveGameState(v)));
    }
    const result: any = {};
    for (const key of Object.keys(state)) {
      result[key] = reviveGameState(state[key]);
    }
    return result;
  }
  return state;
}

/**
 * Reviver function for JSON.parse to restore Maps and Sets
 */
function mapSetReviver(key: string, value: any): any {
  if (value instanceof Map) {
    return { __type: "Map", data: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { __type: "Set", data: Array.from(value.entries()) };
  }
  return value;
}

/**
 * Reviver function for JSON.parse to restore Maps and Sets from serialized format
 */
function mapSetReviverFromSerialized(key: string, value: any): any {
  if (value && value.__type === "Map") {
    return new Map(
      value.data.map(([k, v]: [any, any]) => [
        k,
        mapSetReviverFromSerialized(k, v),
      ]),
    );
  }
  if (value && value.__type === "Set") {
    return new Set(
      value.data.map((v: any) => mapSetReviverFromSerialized("", v)),
    );
  }
  if (Array.isArray(value)) {
    return value.map((v: any) => mapSetReviverFromSerialized("", v));
  }
  if (typeof value === "object" && value !== null) {
    const result: any = {};
    for (const k of Object.keys(value)) {
      result[k] = mapSetReviverFromSerialized(k, value[k]);
    }
    return result;
  }
  return value;
}

/**
 * Create a properly deep-cloned GameState that preserves Map/Set types
 */
function cloneGameState(state: GameState): GameState {
  // Use a recursive approach to properly serialize Maps and Sets
  function replacer(key: string, value: any): any {
    if (value instanceof Map) {
      return { __type: "Map", data: Array.from(value.entries()) };
    }
    if (value instanceof Set) {
      return { __type: "Set", data: Array.from(value.entries()) };
    }
    return value;
  }

  function reviver(key: string, value: any): any {
    if (value && value.__type === "Map") {
      return new Map(
        value.data.map(([k, v]: [any, any]) => [k, reviver(k, v)]),
      );
    }
    if (value && value.__type === "Set") {
      return new Set(value.data.map((v: any) => reviver("", v)));
    }
    if (Array.isArray(value)) {
      return value.map((v: any) => reviver("", v));
    }
    if (typeof value === "object" && value !== null) {
      const result: any = {};
      for (const k of Object.keys(value)) {
        result[k] = reviver(k, value[k]);
      }
      return result;
    }
    return value;
  }

  const serialized = JSON.stringify(state, replacer);
  const cloned = JSON.parse(serialized, reviver);
  return cloned;
}

export class EventSourcingGameState {
  private state: GameState;
  private eventLog: GameEventLog;
  private eventIndexCounter: EventIndex = 0;
  private localPlayerId: PlayerId;
  private onDesync?: (result: DesyncDetectionResult) => void;
  private onRollback?: (targetIndex: EventIndex, reason: string) => void;
  private onEventConfirmed?: (eventIndex: EventIndex) => void;

  constructor(
    initialState: GameState,
    sessionId: GameSessionId,
    localPlayerId: PlayerId,
  ) {
    // Deep clone to preserve Map/Set types
    this.state = deepCloneGameState(initialState);
    this.localPlayerId = localPlayerId;
    this.eventIndexCounter = 0;

    // Initialize event log
    this.eventLog = {
      events: [],
      lastConfirmedIndex: 0,
      pendingEvents: [],
      sessionId,
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    };

    // Emit initial game start event
    this.emitGameStart();
  }

  /**
   * Get the current game state
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * Get the current event log
   */
  getEventLog(): GameEventLog {
    return this.eventLog;
  }

  /**
   * Get the current state hash
   */
  getStateHash(): string {
    return computeStateHash(this.state);
  }

  /**
   * Get the last confirmed event index
   */
  getLastConfirmedIndex(): EventIndex {
    return this.eventLog.lastConfirmedIndex;
  }

  /**
   * Set desync detection handler
   */
  setDesyncHandler(handler: (result: DesyncDetectionResult) => void): void {
    this.onDesync = handler;
  }

  /**
   * Set rollback handler
   */
  setRollbackHandler(
    handler: (targetIndex: EventIndex, reason: string) => void,
  ): void {
    this.onRollback = handler;
  }

  /**
   * Set event confirmation handler
   */
  setEventConfirmationHandler(handler: (eventIndex: EventIndex) => void): void {
    this.onEventConfirmed = handler;
  }

  /**
   * Emit a game start event
   */
  private emitGameStart(): void {
    const playerIds = Array.from(this.state.players.keys());
    const event: GameStartEvent = {
      type: "GAME_START",
      index: ++this.eventIndexCounter,
      state: cloneGameState(this.state),
      stateHash: this.getStateHash(),
      playerIds,
      timestamp: Date.now(),
    };
    this.addEvent(event);
  }

  /**
   * Emit an action event BEFORE state mutation
   * This is the core of event sourcing - events are emitted before changes
   */
  emitAction(action: GameAction, previousStateHash: string): ActionEvent {
    const resultingHash = computeStateHash(this.state);

    const event: ActionEvent = {
      type: "ACTION",
      index: ++this.eventIndexCounter,
      action,
      previousStateHash,
      resultingStateHash: resultingHash,
      initiatorId: action.playerId,
      timestamp: Date.now(),
      confirmed: action.playerId === this.localPlayerId, // Auto-confirm own actions
      confirmedBy:
        action.playerId === this.localPlayerId ? [this.localPlayerId] : [],
    };

    this.addEvent(event);
    return event;
  }

  /**
   * Add a state sync checkpoint
   */
  addStateSyncCheckpoint(): StateSyncEvent {
    const event: StateSyncEvent = {
      type: "STATE_SYNC",
      index: ++this.eventIndexCounter,
      state: cloneGameState(this.state),
      stateHash: this.getStateHash(),
      timestamp: Date.now(),
    };
    this.addEvent(event);
    return event;
  }

  /**
   * Add a rollback event and perform rollback
   */
  performRollback(targetIndex: EventIndex, reason: string): boolean {
    // Find the state at targetIndex
    const targetEvent = this.eventLog.events.find(
      (e) => e.index === targetIndex,
    );
    if (!targetEvent) {
      return false;
    }

    let stateHash: string | undefined;
    if (targetEvent.type === "STATE_SYNC") {
      stateHash = (targetEvent as StateSyncEvent).stateHash;
    } else if (targetEvent.type === "ACTION") {
      stateHash = (targetEvent as ActionEvent).resultingStateHash;
    } else if (targetEvent.type === "GAME_START") {
      stateHash = (targetEvent as GameStartEvent).stateHash;
    } else {
      for (let i = this.eventLog.events.length - 1; i >= 0; i--) {
        const e = this.eventLog.events[i];
        if (e.type === "STATE_SYNC" || e.type === "GAME_START") {
          stateHash =
            e.type === "STATE_SYNC"
              ? (e as StateSyncEvent).stateHash
              : (e as GameStartEvent).stateHash;
          break;
        }
      }
      stateHash = stateHash || this.getStateHash();
    }

    const event: RollbackEvent = {
      type: "ROLLBACK",
      index: ++this.eventIndexCounter,
      targetIndex,
      reason,
      stateHash,
      timestamp: Date.now(),
    };

    this.addEvent(event);

    // Find the state to restore
    const stateToRestore = this.findStateAtIndex(targetIndex);
    if (stateToRestore) {
      this.state = cloneGameState(stateToRestore);
    }

    // Call rollback handler
    if (this.onRollback) {
      this.onRollback(targetIndex, reason);
    }

    return true;
  }

  /**
   * Find the state at a specific event index
   * Returns the closest STATE_SYNC or GAME_START checkpoint at or before the target index.
   * Returns null if no checkpoint exists at or before the target index.
   */
  private findStateAtIndex(targetIndex: EventIndex): GameState | null {
    // Find the closest STATE_SYNC or GAME_START at or before targetIndex
    // Iterate backwards to find the most recent checkpoint
    for (let i = this.eventLog.events.length - 1; i >= 0; i--) {
      const e = this.eventLog.events[i];
      if (e.index <= targetIndex) {
        if (e.type === "STATE_SYNC") {
          return cloneGameState((e as StateSyncEvent).state);
        }
        if (e.type === "GAME_START") {
          return cloneGameState((e as GameStartEvent).state);
        }
        // Skip ACTION events - keep searching for a checkpoint
      }
    }
    return null;
  }

  /**
   * Add event to the log
   */
  private addEvent(event: GameEvent): void {
    this.eventLog.events.push(event);
    this.eventLog.lastModifiedAt = Date.now();

    if (event.type === "ACTION") {
      const actionEvent = event as ActionEvent;
      if (!actionEvent.confirmed) {
        this.eventLog.pendingEvents.push(event);
      }
    }
  }

  /**
   * Update the state directly (for remote actions or replay)
   * Does NOT emit an event - used internally
   */
  applyState(newState: GameState): void {
    this.state = cloneGameState(newState);
  }

  /**
   * Replace the current state and emit an action event
   * Use this when the state has been mutated and you want to log it
   */
  replaceStateWithAction(
    action: GameAction,
    previousState: GameState,
  ): GameState {
    const previousHash = computeStateHash(previousState);
    this.state = cloneGameState(this.state);

    // Emit action event with previous state hash
    this.emitAction(action, previousHash);

    return this.state;
  }

  /**
   * Verify local state against expected hash
   */
  verifyState(expectedHash: string): DesyncDetectionResult {
    const localHash = this.getStateHash();
    const isDesync = localHash !== expectedHash;

    return {
      isDesync,
      localHash,
      expectedHash,
      discrepancies: [], // Would need analyzeHashDiscrepancy for detailed info
      atEventIndex: this.eventLog.lastConfirmedIndex,
    };
  }

  /**
   * Check for desync by comparing state hashes
   */
  checkDesync(localHash: string): DesyncDetectionResult {
    const expectedHash = this.getStateHash();
    const isDesync = localHash !== expectedHash;

    if (isDesync && this.onDesync) {
      this.onDesync({
        isDesync: true,
        localHash,
        expectedHash,
        discrepancies: [],
        atEventIndex: this.eventLog.lastConfirmedIndex,
      });
    }

    return {
      isDesync,
      localHash,
      expectedHash,
      discrepancies: [],
      atEventIndex: this.eventLog.lastConfirmedIndex,
    };
  }

  /**
   * Confirm a pending event (for multiplayer sync)
   */
  confirmEvent(eventIndex: EventIndex, confirmingPlayerId: PlayerId): void {
    const event = this.eventLog.events.find((e) => e.index === eventIndex);
    if (event && event.type === "ACTION") {
      const actionEvent = event as ActionEvent;
      if (!actionEvent.confirmedBy.includes(confirmingPlayerId)) {
        actionEvent.confirmedBy.push(confirmingPlayerId);

        // Check if all players have confirmed (simplified - all known players)
        const allPlayers = Array.from(this.state.players.keys());
        if (actionEvent.confirmedBy.length >= allPlayers.length) {
          actionEvent.confirmed = true;
          // Remove from pending
          this.eventLog.pendingEvents = this.eventLog.pendingEvents.filter(
            (e) => e.index !== eventIndex,
          );
          this.eventLog.lastConfirmedIndex = eventIndex;

          if (this.onEventConfirmed) {
            this.onEventConfirmed(eventIndex);
          }
        }
      }
    }
  }

  /**
   * Get events since a specific index (for late-join recovery)
   */
  getEventsSince(fromIndex: EventIndex): GameEvent[] {
    return this.eventLog.events.filter((e) => e.index > fromIndex);
  }

  /**
   * Get the full state at a specific event index (replays events)
   * Used for late-joining players to reconstruct state
   */
  getStateAtIndex(targetIndex: EventIndex): GameState | null {
    // Find the closest state sync at or before targetIndex
    let baseState: GameState | null = null;
    let baseIndex = 0;

    for (const event of this.eventLog.events) {
      if (event.index > targetIndex) break;
      if (event.type === "STATE_SYNC" || event.type === "GAME_START") {
        baseState =
          event.type === "STATE_SYNC"
            ? (event as StateSyncEvent).state
            : (event as GameStartEvent).state;
        baseIndex = event.index;
      }
    }

    if (!baseState) {
      return null;
    }

    // For now, return the base state
    // Full implementation would replay actions between baseIndex and targetIndex
    return baseState;
  }

  /**
   * Get events for replay (compatible with ReplaySystem)
   */
  getReplayEvents(): Array<{ action: GameAction; resultingState: GameState }> {
    return this.eventLog.events
      .filter((e): e is ActionEvent => e.type === "ACTION")
      .map((event) => ({
        action: event.action,
        resultingState: this.getStateAtIndex(event.index) || this.state,
      }));
  }

  /**
   * Emit game end event
   */
  emitGameEnd(winners: PlayerId[], endReason: string): void {
    const event: GameEndEvent = {
      type: "GAME_END",
      index: ++this.eventIndexCounter,
      state: cloneGameState(this.state),
      stateHash: this.getStateHash(),
      winners,
      endReason,
      timestamp: Date.now(),
    };
    this.addEvent(event);
  }

  /**
   * Get current event index
   */
  getCurrentEventIndex(): EventIndex {
    return this.eventIndexCounter;
  }
}

/**
 * Create an event sourcing game state
 */
export function createEventSourcedState(
  initialState: GameState,
  sessionId: GameSessionId,
  localPlayerId: PlayerId,
): EventSourcingGameState {
  return new EventSourcingGameState(initialState, sessionId, localPlayerId);
}

/**
 * Event emission helper for state-changing functions
 * Returns the action event with previous state hash for verification
 */
export interface StateMutationContext {
  previousState: GameState;
  previousStateHash: string;
  event: ActionEvent;
}

/**
 * Wrap a state mutation function to emit events before execution
 */
export function withEventEmission<T extends GameState>(
  esState: EventSourcingGameState,
  mutationFn: (state: GameState) => T,
  action: GameAction,
): { result: T; context: StateMutationContext } {
  const previousState = esState.getState();
  const previousStateHash = computeStateHash(previousState);

  // Apply mutation
  const result = mutationFn(previousState);

  // Update esState with new state
  esState.applyState(result);

  // Emit the action event with previous state hash
  const event = esState.emitAction(action, previousStateHash);

  return {
    result,
    context: {
      previousState,
      previousStateHash,
      event,
    },
  };
}

/**
 * Integration with ReplaySystem
 * Converts event log to replay format
 */
export function eventLogToReplay(
  eventLog: GameEventLog,
  format: string,
  playerNames: string[],
  startingLife: number = 20,
  isCommander: boolean = false,
): {
  id: string;
  metadata: {
    format: string;
    playerNames: string[];
    startingLife: number;
    isCommander: boolean;
    gameStartDate: number;
    gameEndDate?: number;
    endReason?: string;
    winners?: string[];
  };
  actions: Array<{
    sequenceNumber: number;
    action: GameAction;
    resultingState: GameState;
    description: string;
    recordedAt: number;
  }>;
} {
  const gameStartEvent = eventLog.events.find(
    (e): e is GameStartEvent => e.type === "GAME_START",
  );
  const gameEndEvent = eventLog.events.find(
    (e): e is GameEndEvent => e.type === "GAME_END",
  );

  const actions = eventLog.events
    .filter((e): e is ActionEvent => e.type === "ACTION")
    .map((event, idx) => {
      // Find the resulting state (next STATE_SYNC or end state)
      let resultingState = eventLog.events[eventLog.events.length - 1];
      if (resultingState.type === "ACTION") {
        resultingState = gameEndEvent || gameStartEvent || resultingState;
      }
      const state =
        resultingState.type === "STATE_SYNC"
          ? (resultingState as StateSyncEvent).state
          : resultingState.type === "GAME_END"
            ? (resultingState as GameEndEvent).state
            : (resultingState as GameStartEvent).state;

      return {
        sequenceNumber: idx + 1,
        action: event.action,
        resultingState: state,
        description: describeGameAction(event.action),
        recordedAt: event.timestamp,
      };
    });

  return {
    id: eventLog.sessionId,
    metadata: {
      format,
      playerNames,
      startingLife,
      isCommander,
      gameStartDate: eventLog.createdAt,
      gameEndDate: gameEndEvent?.timestamp,
      endReason: gameEndEvent?.endReason,
      winners: gameEndEvent?.winners,
    },
    actions,
  };
}

/**
 * Human-readable description of a game action
 */
function describeGameAction(action: GameAction): string {
  const { type, data } = action;
  const actionData = data as Record<string, unknown>;

  switch (type) {
    case "cast_spell":
      return `Player cast ${(actionData.cardName as string) || "a spell"}`;
    case "activate_ability":
      return `Player activated ${(actionData.abilityName as string) || "an ability"}`;
    case "play_land":
      return "Player played a land";
    case "declare_attackers":
      return "Player declared attackers";
    case "declare_blockers":
      return "Player declared blockers";
    case "draw_card":
      return "Player drew a card";
    case "discard_card":
      return `Player discarded ${(actionData.cardName as string) || "a card"}`;
    case "tap_card":
      return `Player tapped ${(actionData.cardName as string) || "a card"}`;
    case "untap_card":
      return `Player untapped ${(actionData.cardName as string) || "a card"}`;
    case "gain_life":
      return `Player gained ${(actionData.amount as number) || 0} life`;
    case "lose_life":
      return `Player lost ${(actionData.amount as number) || 0} life`;
    case "deal_damage":
      return `Player dealt ${(actionData.amount as number) || 0} damage`;
    case "mulligan":
      return "Player took a mulligan";
    case "concede":
      return "Player conceded";
    default:
      return `Player performed action: ${type}`;
  }
}

/**
 * Factory for creating action events with proper typing
 */
export function createActionEvent(
  action: GameAction,
  previousStateHash: string,
  resultingStateHash: string,
  initiatorId: PlayerId,
): ActionEvent {
  return {
    type: "ACTION",
    index: 0, // Will be set by EventSourcingGameState
    action,
    previousStateHash,
    resultingStateHash,
    initiatorId,
    timestamp: Date.now(),
    confirmed: initiatorId === "local", // Adjust as needed
    confirmedBy: [initiatorId],
  };
}
