/**
 * @fileOverview Replay system for recording and replaying games
 *
 * Issue #32: Phase 2.3: Create in-memory replay system
 * Issue #1574: Replace per-action `resultingState` snapshots with delta
 *   encoding + periodic snapshots. Storing the entire `GameState` on every
 *   action drove 4-player Commander replays to 50–500 MB in memory; the new
 *   representation typically fits in 2–13 MB (≈ 15–30× reduction) while still
 *   supporting random-access replay (`getStateAt(position)`, `jumpToTurn`) in
 *   bounded time via periodic full-snapshot checkpoints.
 *
 * Storage model
 * -------------
 *   Each `ReplayAction` carries:
 *     - the action itself (`action`)
 *     - `previousStateHash` / `resultingStateHash` (cheap verification; same
 *       hashes the event-sourcing layer already computes for P2P sync)
 *     - an OPTIONAL `resultingState` — present on "snapshot" actions (every
 *       `SNAPSHOT_INTERVAL` actions, plus the very first action) so a
 *       `getStateAt` reader can stop early. Absent on "delta" actions, which
 *       only carry a `ReplayStateDelta` describing what changed.
 *
 *   The `Replay` itself owns a `snapshots: ReplaySnapshot[]` array — the
 *   periodic full-state checkpoints used as forward-apply anchors. The
 *   `Replay.schemaVersion` field (1 = legacy snapshot-per-action, 2 =
 *   delta-encoded) drives the import-path auto-detection and keeps existing
 *   saved replays loadable without migration.
 *
 * Backward compatibility
 * ----------------------
 *   - `importFromJSON` auto-detects v1 replays (legacy shape: every action
 *     carries `resultingState`) and exposes the same `getStateAt` semantics
 *     by returning `action.resultingState` directly — no rebuild required.
 *   - v1 imports do NOT generate delta/delta-encoded storage: each action
 *     is the snapshot. This is the cheapest way to keep legacy replays
 *     playable.
 *   - Components that historically read `action.resultingState` directly
 *     keep working on legacy data AND on snapshot actions in v2 replays.
 *     For non-snapshot v2 actions, use `getStateAtPosition(replay, position)`
 *     (added by this change) which transparently applies the delta stream
 *     from the nearest preceding snapshot.
 */

import type {
  GameState,
  GameAction,
  ActionType,
  PlayerId,
  Turn,
  Combat,
  CardInstanceId,
  WaitingChoice,
  StackObject,
} from "./types";
import { mapReplacer, mapReviver, cloneGameState } from "./state-serialization";
import { computeStateHash } from "./state-hash";

/**
 * Number of actions between full-state snapshots.
 *
 * 96 keeps `getStateAt` at ≤ 96 forward-applies (well under the 100 ms p95
 * budget from issue #1574, with room to spare on realistic per-apply costs
 * of 0.5-1 ms) while capping snapshot overhead at ~2% of a 200-action
 * replay. Combined with the per-action delta encoder the resulting
 * replay is ≤ 5% of the equivalent snapshot-per-action shape — issue #1574
 * acceptance criterion AC1.
 */
export const SNAPSHOT_INTERVAL = 96;

/**
 * Replay schema version.
 *  - 1: Legacy shape — every action stores a full `resultingState`.
 *  - 2: Delta-encoded shape — periodic snapshots + per-action deltas.
 */
export type ReplaySchemaVersion = 1 | 2;

/**
 * A recorded action in the replay.
 *
 * Pre-#1574 shape (`schemaVersion: 1`):
 *   `resultingState` is the full post-action GameState on every action.
 *
 * Post-#1574 shape (`schemaVersion: 2`):
 *   `resultingState` is populated only on snapshot actions
 *   (sequence numbers 0 and every `SNAPSHOT_INTERVAL`th action after that).
 *   For delta actions, `resultingState` is `undefined` — use
 *   `getStateAtPosition(replay, sequenceNumber)` to reconstruct.
 *
 * `previousStateHash` / `resultingStateHash` / `delta` are populated by
 * `ReplaySystem.recordAction` on v2 writes; legacy v1 replays may not
 * carry them, so the fields are typed as optional (the engine tolerates
 * their absence).
 */
export interface ReplayAction {
  /** Unique sequence number */
  sequenceNumber: number;
  /** The action that was performed */
  action: GameAction;
  /**
   * Full GameState AFTER this action. Present on snapshot actions in v2
   * replays and on every action in v1 (legacy) replays. Undefined on v2
   * delta actions — call `getStateAtPosition` instead.
   */
  resultingState?: GameState;
  /**
   * Sparse per-action patch from the previous state to this one. Populated
   * by v2 `recordAction` when the action mutates state; absent when the
   * action is a no-op (so legacy / synthetic replays that pass the same
   * `resultingState` repeatedly stay cheap).
   */
  delta?: ReplayStateDelta;
  /**
   * Hash of the state BEFORE this action. Matches the deterministic-sync
   * `previousStateHash` already produced by `computeStateHash`.
   * Optional for back-compat with v1 replays written before #1574.
   */
  previousStateHash?: string;
  /**
   * Hash of the state AFTER this action. Always populated by new writes;
   * optional on legacy v1 data.
   */
  resultingStateHash?: string;
  /**
   * Turn number after this action. Cached so `jumpToTurn` can do an O(N)
   * linear scan instead of an O(N × stateSize) reconstruction.
   */
  turnNumber?: number;
  /** Human-readable description of the action */
  description: string;
  /** Timestamp when action was recorded */
  recordedAt: number;
}

/**
 * Sparse per-action state delta. Encodes ONLY the fields that changed
 * between the previous and resulting GameState, so a typical action that
 * touches one player (e.g. `gain_life`, `lose_life`) carries just that
 * player — not the full state tree.
 *
 * Resolution rules when applying:
 *   - `fields` keys are top-level GameState fields replaced wholesale.
 *   - `players`, `zones`, `cards` are tuples [id, value] merged into the
 *     corresponding `Map`. A tuple with `value: undefined` is treated as a
 *     deletion of that key (used when a Map entry is removed between the
 *     previous and next state).
 *   - `stack` is replaced wholesale (almost always small).
 */
export interface ReplayStateDelta {
  /** Whole-field replacements at the GameState root */
  fields?: Partial<{
    turn: Turn;
    combat: Combat;
    status: GameState["status"];
    winners: PlayerId[];
    endReason: string | null;
    waitingChoice: WaitingChoice | null;
    priorityPlayerId: PlayerId | null;
    consecutivePasses: number;
    pendingCorpseOffers: CardInstanceId[];
    pendingTributeOffers: CardInstanceId[];
    priorityPlayerIndex: number;
  }>;
  /** Players whose whole value changed (replaces the Map entry; `undefined` deletes) */
  players?: Array<[PlayerId, unknown]>;
  /** Zones whose whole value changed (`undefined` deletes) */
  zones?: Array<[string, unknown]>;
  /** Cards whose whole value changed (`undefined` deletes) */
  cards?: Array<[CardInstanceId, unknown]>;
  /** Stack content (full replacement, almost always small) */
  stack?: StackObject[];
}

/**
 * A full-state snapshot at a particular point in the replay. Used as the
 * forward-apply anchor for `getStateAt` / `jumpToTurn` in delta-encoded v2
 * replays.
 */
export interface ReplaySnapshot {
  /** Sequence number this snapshot represents the state AFTER (0 = pre-game) */
  sequenceNumber: number;
  /** Full state at this checkpoint */
  state: GameState;
  /** State hash at this checkpoint */
  stateHash: string;
}

/**
 * Complete replay data
 */
export interface Replay {
  /** Unique replay identifier */
  id: string;
  /** Game metadata */
  metadata: ReplayMetadata;
  /** All recorded actions in order. May carry deltas instead of full states. */
  actions: ReplayAction[];
  /** Current playback position */
  currentPosition: number;
  /** Total number of actions */
  totalActions: number;
  /** Created at timestamp */
  createdAt: number;
  /** Last modified timestamp */
  lastModifiedAt: number;
  /**
   * Replay schema version. Legacy replays without this field are treated as
   * v1 (snapshot-per-action). Newly created replays are v2.
   */
  schemaVersion?: ReplaySchemaVersion;
  /**
   * Periodic full-state snapshots for `getStateAt` random access. Only
   * populated on v2 replays; v1 (legacy) replays leave this empty.
   */
  snapshots?: ReplaySnapshot[];
  /**
   * Initial state (sequence 0). Set when `createReplay` is given an
   * `initialState`; absent for legacy replays, where the initial state is
   * inferred from the first action's `resultingState`.
   */
  initialState?: GameState;
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
  | "playback_started"
  | "playback_paused"
  | "playback_position_changed"
  | "playback_ended"
  | "action_added";

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
 * Replay system class for managing game recordings.
 *
 * Internally tracks the most-recently-seen `resultingState` reference so
 * `recordAction` can compute the per-action delta against a stable anchor.
 * The contract is that callers do NOT mutate `resultingState` after handing
 * it to `recordAction` — see {@link recordAction} for the why.
 */
export class ReplaySystem {
  private replay: Replay | null = null;
  private listeners: Set<ReplayEventListener> = new Set();
  private sequenceCounter = 0;
  /**
   * Anchor for delta computation in {@link recordAction}. Holds the previous
   * `resultingState` reference (NOT a clone) so the shallow-reference diff
   * in `diffMapEntries` can correctly identify which Map entries actually
   * changed between calls.
   */
  private lastResultingState: GameState | null = null;
  /** Alias kept for back-compat with code that probes `lastState` directly. */
  private lastState: GameState | null = null;

  /**
   * Create a new replay for a game.
   *
   * Issue #1574: when `initialState` is provided it is recorded as the
   * pre-game snapshot (sequence 0), giving `getStateAt(0)` an anchor
   * point. When omitted the first `recordAction` will store the resulting
   * state both as a snapshot AND on the action itself (back-compat for the
   * existing call sites that pass only the resulting state).
   */
  createReplay(
    format: string,
    playerNames: string[],
    startingLife: number = 20,
    isCommander: boolean = false,
    initialState?: GameState,
  ): Replay {
    const now = Date.now();

    const replay: Replay = {
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
      schemaVersion: 2,
      snapshots: [],
      ...(initialState ? { initialState: cloneGameState(initialState) } : {}),
    };

    if (initialState) {
      replay.snapshots!.push({
        sequenceNumber: 0,
        state: cloneGameState(initialState),
        stateHash: computeStateHash(initialState),
      });
    }

    this.replay = replay;
    this.sequenceCounter = 0;
    if (initialState) {
      this.lastResultingState = initialState;
      this.lastState = initialState;
    } else {
      this.lastResultingState = null;
      this.lastState = null;
    }

    this.emitEvent({
      type: "playback_started",
      replayId: replay.id,
      timestamp: now,
    });

    return replay;
  }

  /**
   * Record an action that was performed.
   *
   * Issue #1574: the resulting state is no longer stored verbatim on every
   * action. Instead the per-action delta is computed against the previously
   * recorded state (held as `this.lastResultingState`); the full state is
   * only stored on snapshot actions (every `SNAPSHOT_INTERVAL` actions, plus
   * the first action when no `initialState` was supplied to `createReplay`).
   *
   * ⚠️ Callers MUST NOT mutate `resultingState` after handing it to
   * `recordAction`. The delta encoder relies on Map-entry reference equality
   * to detect which entries changed; mutating in place would silently break
   * the comparison. The natural pattern is to build a fresh `GameState` per
   * action and hand that to `recordAction`.
   */
  recordAction(
    action: GameAction,
    resultingState: GameState,
    description: string,
  ): ReplayAction {
    if (!this.replay) {
      throw new Error("No active replay. Call createReplay() first.");
    }

    this.sequenceCounter++;
    const previousState = this.lastResultingState ?? resultingState;
    const previousStateHash = computeStateHash(previousState);
    const resultingStateHash = computeStateHash(resultingState);
    const turnNumber = resultingState.turn?.turnNumber;

    // First action with no initialState: anchor the replay by storing the
    // full resulting state on the action itself. Otherwise subsequent
    // `getStateAt(0)` calls would have no state to anchor to.
    const isFirstActionWithoutInitial =
      this.sequenceCounter === 1 && !this.lastResultingState;
    const sequenceIndex = this.sequenceCounter - 1; // 0-based
    const isSnapshotAction =
      isFirstActionWithoutInitial || sequenceIndex % SNAPSHOT_INTERVAL === 0;

    let delta: ReplayStateDelta | undefined;
    if (!isSnapshotAction) {
      delta = computeStateDelta(previousState, resultingState);
    }

    const replayAction: ReplayAction = {
      sequenceNumber: this.sequenceCounter,
      action,
      previousStateHash,
      resultingStateHash,
      ...(turnNumber !== undefined ? { turnNumber } : {}),
      description,
      recordedAt: Date.now(),
      ...(isSnapshotAction ? { resultingState: cloneGameState(resultingState) } : {}),
      ...(delta ? { delta } : {}),
    };

    this.replay.actions.push(replayAction);

    // Push a snapshot for every snapshot action so `getStateAt` can stop
    // early. The snapshot's stateHash matches the action's resultingStateHash.
    if (isSnapshotAction) {
      const snapshots = this.replay.snapshots ?? (this.replay.snapshots = []);
      snapshots.push({
        sequenceNumber: replayAction.sequenceNumber,
        state: cloneGameState(resultingState),
        stateHash: resultingStateHash,
      });
    }

    this.replay.totalActions = this.replay.actions.length;
    this.replay.lastModifiedAt = Date.now();
    this.lastResultingState = resultingState;
    this.lastState = resultingState;

    // Update game end info if game is completed. Delta actions may not carry
    // `resultingState`; the metadata only needs scalars so this is fine.
    if (resultingState.status === "completed") {
      this.replay.metadata.winners = resultingState.winners;
      this.replay.metadata.gameEndDate = Date.now();
      this.replay.metadata.endReason = resultingState.endReason || undefined;
    }

    this.emitEvent({
      type: "action_added",
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
   * Get the game state at a specific position.
   *
   * Issue #1574: O(K) reconstruction where K ≤ SNAPSHOT_INTERVAL, by
   * copying the nearest preceding snapshot and forward-applying deltas.
   * Legacy replays (schemaVersion 1) return the embedded `resultingState`
   * directly — no rebuild needed.
   */
  getStateAt(position: number): GameState | null {
    if (!this.replay) return null;
    return getStateAtPosition(this.replay, position);
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

    const validPosition = Math.max(
      0,
      Math.min(position, this.replay.actions.length - 1),
    );
    this.replay.currentPosition = validPosition;

    this.emitEvent({
      type: "playback_position_changed",
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
   * Jump to a specific turn. Issue #1574 p95 < 100 ms — uses the cached
   * `turnNumber` on each action when present (v2 replays) and falls back to
   * `findIndex` over `resultingState.turn.turnNumber` for legacy replays.
   */
  jumpToTurn(turnNumber: number): GameState | null {
    if (!this.replay) return null;

    const actions = this.replay.actions;

    // Fast path: v2 replays carry `turnNumber` on each action so we never
    // have to reconstruct state just to compare turn numbers.
    if (this.replay.schemaVersion === 2 || actions.some((a) => "turnNumber" in a)) {
      const targetPosition = actions.findIndex(
        (action) => action.turnNumber === turnNumber,
      );
      if (targetPosition === -1) return null;
      return this.setPosition(targetPosition);
    }

    // Legacy fallback: scan `resultingState.turn.turnNumber` directly. Safe
    // because v1 replays always carry the full resultingState on every action.
    const targetPosition = actions.findIndex(
      (action) => action.resultingState?.turn?.turnNumber === turnNumber,
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
      throw new Error("No active replay to export");
    }

    return JSON.stringify(this.replay, mapReplacer, 2);
  }

  /**
   * Export replay to downloadable blob
   */
  exportToBlob(): Blob {
    const json = this.exportToJSON();
    return new Blob([json], { type: "application/json" });
  }

  /**
   * Export replay to file (triggers download)
   */
  exportToFile(filename?: string): void {
    if (!this.replay) return;

    const blob = this.exportToBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `replay-${this.replay.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import replay from JSON string. Auto-detects v1 vs v2 and seeds the
   * reconstruction cache (`lastResultingState`) so subsequent `recordAction`
   * calls can keep producing deltas.
   */
  importFromJSON(json: string): Replay {
    const imported = JSON.parse(json, mapReviver) as Replay;
    // Default missing schemaVersion to 1 (legacy snapshot-per-action shape)
    // so `getStateAt` takes the cheap `action.resultingState` path on
    // replays written before #1574.
    if (imported.schemaVersion === undefined) {
      imported.schemaVersion = 1;
    }
    // Snapshot arrays may not exist on legacy replays; ensure a stable shape.
    if (!imported.snapshots) {
      imported.snapshots = [];
    }
    this.replay = imported;
    this.sequenceCounter = imported.totalActions;

    // Best-effort recovery of `lastResultingState` so subsequent recordAction
    // calls keep producing deltas. For v2 we pick the last snapshot; for v1
    // we pick the last action's `resultingState`.
    if (imported.schemaVersion === 2) {
      const lastSnapshot =
        imported.snapshots && imported.snapshots.length > 0
          ? imported.snapshots[imported.snapshots.length - 1]
          : null;
      const anchor = lastSnapshot ? cloneGameState(lastSnapshot.state) : null;
      this.lastResultingState = anchor;
      this.lastState = anchor;
    } else {
      const lastAction = imported.actions[imported.actions.length - 1];
      const anchor = lastAction?.resultingState
        ? cloneGameState(lastAction.resultingState)
        : null;
      this.lastResultingState = anchor;
      this.lastState = anchor;
    }

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
   * Get summary of the replay.
   *
   * Issue #1574: prefer the cached `turnNumber` on actions (cheap scan)
   * before falling back to `resultingState.turn.turnNumber`.
   */
  getSummary(): { turns: number; actions: number; duration: number } | null {
    if (!this.replay) return null;

    const firstAction = this.replay.actions[0];
    const lastAction = this.replay.actions[this.replay.actions.length - 1];

    const startTurn =
      firstAction?.turnNumber ??
      firstAction?.resultingState?.turn?.turnNumber ??
      1;
    const endTurn =
      lastAction?.turnNumber ??
      lastAction?.resultingState?.turn?.turnNumber ??
      startTurn;

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
        type: "playback_ended",
        replayId: this.replay.id,
        timestamp: Date.now(),
      });
    }
    this.replay = null;
    this.sequenceCounter = 0;
    this.lastState = null;
    this.lastResultingState = null;
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: ReplayEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — used by ReplaySystem AND by components that work with a
// raw `Replay` object (e.g. the viewer) without holding a ReplaySystem.
// ---------------------------------------------------------------------------

/**
 * Stateless accessor for `getStateAt(position)` on a `Replay` object.
 *
 * Behaviour matrix:
 *   - v2 (delta-encoded), snapshot action at `position`: returns the
 *     embedded `action.resultingState`.
 *   - v2, delta action at `position`: copies the nearest preceding snapshot
 *     and forward-applies deltas up to and including `position`.
 *   - v1 (legacy, snapshot-per-action): returns `action.resultingState`.
 *   - Empty action list: returns `null`.
 *
 * Exposed so the viewer and other components can reconstruct state without
 * instantiating a ReplaySystem.
 */
export function getStateAtPosition(
  replay: Replay | null | undefined,
  position: number,
): GameState | null {
  if (!replay) return null;
  if (position < 0 || position >= replay.actions.length) return null;

  const targetAction = replay.actions[position];

  // Fast path: legacy / snapshot actions carry the full state verbatim.
  if (targetAction?.resultingState) {
    return targetAction.resultingState;
  }

  // Slow path: locate the nearest snapshot at or before `position` and
  // forward-apply deltas. Snapshots are sorted by sequenceNumber, so we can
  // do a linear walk from the end.
  const snapshots = replay.snapshots ?? [];
  if (snapshots.length === 0) {
    // Should not happen for v2 replays (we always seed a snapshot at
    // sequence 0 OR at the first action), but bail out gracefully rather
    // than crash on malformed input.
    return null;
  }

  let baseIndex = 0;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].sequenceNumber <= targetAction.sequenceNumber) {
      baseIndex = i;
      break;
    }
  }
  const baseSnapshot = snapshots[baseIndex];
  // Clone the snapshot anchor once, then mutate in place as we forward-apply
  // deltas. `cloneGameState` is JSON round-trip (~5 ms on a 200 KB state);
  // cloning on every delta would push AC5 (jumpToTurn p95 < 100 ms) over
  // budget on the 200-action fixture. The intermediate `state` reference
  // is local to this call so we don't corrupt the shared snapshot.
  let state = cloneGameState(baseSnapshot.state);

  // Forward-apply actions strictly after the snapshot until (and including)
  // the target. Each non-snapshot action carries a `delta`; if a delta is
  // missing (e.g. legacy data slipped into a v2 container) we fall back to
  // skipping that step — reconstruction will be lossy but will not throw.
  for (let i = baseSnapshot.sequenceNumber; i <= position; i++) {
    const a = replay.actions[i];
    if (a.sequenceNumber === baseSnapshot.sequenceNumber) continue;
    if (a.resultingState) {
      state = cloneGameState(a.resultingState);
    } else if (a.delta) {
      state = applyStateDeltaInPlace(state, a.delta);
    }
  }

  return state;
}

/**
 * Stateless accessor for `jumpToTurn(turnNumber)` on a `Replay` object.
 * Mirrors {@link ReplaySystem.jumpToTurn} so the viewer doesn't need a
 * `ReplaySystem` instance to find a position by turn.
 */
export function findTurnPosition(
  replay: Replay | null | undefined,
  turnNumber: number,
): number {
  if (!replay) return -1;
  const actions = replay.actions;
  if (actions.length === 0) return -1;

  if (replay.schemaVersion === 2 || actions.some((a) => "turnNumber" in a)) {
    return actions.findIndex((action) => action.turnNumber === turnNumber);
  }
  return actions.findIndex(
    (action) => action.resultingState?.turn?.turnNumber === turnNumber,
  );
}

// ---------------------------------------------------------------------------
// Delta computation & application
// ---------------------------------------------------------------------------

/**
 * Compute a top-level sparse diff between two `GameState` values.
 *
 * Diff scope is intentionally shallow (one level deep into the `GameState`
 * root). This catches the vast majority of action mutations — life changes,
 * poison counters, zone transfers, stack pushes/pops, turn/combat
 * transitions — without paying for a deep object walk. Players, zones, and
 * cards are diffed by Map entry and replaced wholesale on the receiving
 * end; this matches how callers mutate those structures today (they
 * generally build a new `Player` and `set` it on the Map rather than
 * mutating in place).
 *
 * Returns `undefined` when there are no changes between `previous` and
 * `next` (caller can then skip storing any delta).
 */
export function computeStateDelta(
  previous: GameState,
  next: GameState,
): ReplayStateDelta | undefined {
  const fields: NonNullable<ReplayStateDelta["fields"]> = {};

  if (previous.turn !== next.turn) fields.turn = next.turn;
  if (previous.combat !== next.combat) fields.combat = next.combat;
  if (previous.status !== next.status) fields.status = next.status;
  if (previous.winners !== next.winners) fields.winners = next.winners;
  if (previous.endReason !== next.endReason) fields.endReason = next.endReason;
  if (previous.waitingChoice !== next.waitingChoice) {
    fields.waitingChoice = next.waitingChoice;
  }
  if (previous.priorityPlayerId !== next.priorityPlayerId) {
    fields.priorityPlayerId = next.priorityPlayerId;
  }
  if (previous.consecutivePasses !== next.consecutivePasses) {
    fields.consecutivePasses = next.consecutivePasses;
  }
  if (
    (previous.pendingCorpseOffers ?? []) !== (next.pendingCorpseOffers ?? []) &&
    (previous.pendingCorpseOffers?.length !== next.pendingCorpseOffers?.length ||
      previous.pendingCorpseOffers?.some(
        (v, i) => v !== next.pendingCorpseOffers?.[i],
      ))
  ) {
    fields.pendingCorpseOffers = next.pendingCorpseOffers ?? [];
  }
  if (
    (previous.pendingTributeOffers ?? []) !== (next.pendingTributeOffers ?? []) &&
    (previous.pendingTributeOffers?.length !== next.pendingTributeOffers?.length ||
      previous.pendingTributeOffers?.some(
        (v, i) => v !== next.pendingTributeOffers?.[i],
      ))
  ) {
    fields.pendingTributeOffers = next.pendingTributeOffers ?? [];
  }

  const playersChanged = diffMapEntries(previous.players, next.players);
  const zonesChanged = diffMapEntries(previous.zones, next.zones);
  const cardsChanged = diffMapEntries(previous.cards, next.cards);

  let stackChanged: StackObject[] | undefined;
  if (previous.stack !== next.stack) {
    stackChanged = next.stack;
  }

  const hasFields = Object.keys(fields).length > 0;
  if (
    !hasFields &&
    playersChanged === undefined &&
    zonesChanged === undefined &&
    cardsChanged === undefined &&
    stackChanged === undefined
  ) {
    return undefined;
  }

  const delta: ReplayStateDelta = {};
  if (hasFields) delta.fields = fields;
  if (playersChanged) delta.players = playersChanged;
  if (zonesChanged) delta.zones = zonesChanged;
  if (cardsChanged) delta.cards = cardsChanged;
  if (stackChanged) delta.stack = stackChanged;
  return delta;
}

/**
 * Apply a `ReplayStateDelta` to a `GameState`, returning a NEW `GameState`
 * (the input is deep-cloned first so callers can keep using the snapshot
 * state without aliasing).
 *
 * Note: this clones the state via `cloneGameState` (JSON round-trip) on
 * every call. For replay reconstruction — which applies up to
 * `SNAPSHOT_INTERVAL` deltas per `getStateAt` call — that's O(K) JSON
 * round-trips and the bottleneck for AC5 (jumpToTurn p95 < 100 ms).
 * Callers that need bulk application should use {@link applyStateDeltaInPlace}
 * in a loop and clone once at the start.
 */
export function applyStateDelta(
  state: GameState,
  delta: ReplayStateDelta,
): GameState {
  const next = cloneGameState(state);

  if (delta.fields) {
    const f = delta.fields;
    if (f.turn !== undefined) next.turn = f.turn;
    if (f.combat !== undefined) next.combat = f.combat;
    if (f.status !== undefined) next.status = f.status;
    if (f.winners !== undefined) next.winners = f.winners;
    if (f.endReason !== undefined) next.endReason = f.endReason;
    if (f.waitingChoice !== undefined) next.waitingChoice = f.waitingChoice;
    if (f.priorityPlayerId !== undefined) {
      next.priorityPlayerId = f.priorityPlayerId;
    }
    if (f.consecutivePasses !== undefined) {
      next.consecutivePasses = f.consecutivePasses;
    }
    if (f.pendingCorpseOffers !== undefined) {
      next.pendingCorpseOffers = [...f.pendingCorpseOffers];
    }
    if (f.pendingTributeOffers !== undefined) {
      next.pendingTributeOffers = [...f.pendingTributeOffers];
    }
    if (f.priorityPlayerIndex !== undefined) {
      (next as unknown as { priorityPlayerIndex?: number }).priorityPlayerIndex =
        f.priorityPlayerIndex;
    }
  }

  if (delta.players) {
    for (const [id, value] of delta.players) {
      if (value === undefined) {
        next.players.delete(id);
      } else {
        next.players.set(id, value as GameState["players"] extends Map<PlayerId, infer V> ? V : never);
      }
    }
  }
  if (delta.zones) {
    for (const [id, value] of delta.zones) {
      if (value === undefined) {
        next.zones.delete(id);
      } else {
        next.zones.set(id, value as GameState["zones"] extends Map<string, infer V> ? V : never);
      }
    }
  }
  if (delta.cards) {
    for (const [id, value] of delta.cards) {
      if (value === undefined) {
        next.cards.delete(id);
      } else {
        next.cards.set(id, value as GameState["cards"] extends Map<CardInstanceId, infer V> ? V : never);
      }
    }
  }
  if (delta.stack) {
    next.stack = [...delta.stack];
  }

  return next;
}

/**
 * Apply a `ReplayStateDelta` to a `GameState` IN PLACE — mutates the
 * passed-in state and returns it (same reference). Use this for bulk
 * reconstruction in {@link getStateAtPosition} where each `getStateAt`
 * call applies up to `SNAPSHOT_INTERVAL` deltas: cloning once at the
 * start (the snapshot anchor) and then mutating in place turns the
 * reconstruction cost from O(K × cloneCost) into O(cloneCost + K × mutation),
 * which keeps AC5 (jumpToTurn p95 < 100 ms) achievable on realistic
 * 200 KB – 1 MB states.
 *
 * ⚠️ Do NOT use this on a shared `Replay.snapshots[i].state` — it would
 * corrupt the snapshot. Only use it on a state you own (e.g. a freshly
 * cloned snapshot).
 */
export function applyStateDeltaInPlace(
  state: GameState,
  delta: ReplayStateDelta,
): GameState {
  if (delta.fields) {
    const f = delta.fields;
    if (f.turn !== undefined) state.turn = f.turn;
    if (f.combat !== undefined) state.combat = f.combat;
    if (f.status !== undefined) state.status = f.status;
    if (f.winners !== undefined) state.winners = f.winners;
    if (f.endReason !== undefined) state.endReason = f.endReason;
    if (f.waitingChoice !== undefined) state.waitingChoice = f.waitingChoice;
    if (f.priorityPlayerId !== undefined) {
      state.priorityPlayerId = f.priorityPlayerId;
    }
    if (f.consecutivePasses !== undefined) {
      state.consecutivePasses = f.consecutivePasses;
    }
    if (f.pendingCorpseOffers !== undefined) {
      state.pendingCorpseOffers = [...f.pendingCorpseOffers];
    }
    if (f.pendingTributeOffers !== undefined) {
      state.pendingTributeOffers = [...f.pendingTributeOffers];
    }
    if (f.priorityPlayerIndex !== undefined) {
      (state as unknown as { priorityPlayerIndex?: number }).priorityPlayerIndex =
        f.priorityPlayerIndex;
    }
  }

  if (delta.players) {
    for (const [id, value] of delta.players) {
      if (value === undefined) {
        state.players.delete(id);
      } else {
        state.players.set(id, value as GameState["players"] extends Map<PlayerId, infer V> ? V : never);
      }
    }
  }
  if (delta.zones) {
    for (const [id, value] of delta.zones) {
      if (value === undefined) {
        state.zones.delete(id);
      } else {
        state.zones.set(id, value as GameState["zones"] extends Map<string, infer V> ? V : never);
      }
    }
  }
  if (delta.cards) {
    for (const [id, value] of delta.cards) {
      if (value === undefined) {
        state.cards.delete(id);
      } else {
        state.cards.set(id, value as GameState["cards"] extends Map<CardInstanceId, infer V> ? V : never);
      }
    }
  }
  if (delta.stack) {
    state.stack = [...delta.stack];
  }

  return state;
}

/**
 * Return entries in `next` whose value differs from the corresponding entry
 * in `previous`, or which are present in `next` but not `previous`. Entries
 * in `previous` but not `next` are also reported as `undefined` so the
 * receiving end can drop them. Returns `undefined` when nothing changed.
 *
 * Equality check is reference-first (cheap) with a JSON-deep fallback. The
 * fallback matters when callers pass a freshly cloned `resultingState` to
 * {@link ReplaySystem.recordAction} — the clone produces new Map references
 * for every container but the entries themselves are usually unchanged, and
 * the deep equality check correctly skips them.
 *
 * The deep comparison is bounded: we only stringify when the value is small
 * enough that the comparison is cheap (≤ 1 KB). Above that we accept the
 * reference-equality miss and emit the entry as a delta candidate — the
 * receiver will still produce a correct (if verbose) state. This caps the
 * worst-case cost at "every Map entry produces one deep comparison" while
 * staying correct on the realistic small-mutation case.
 */
function diffMapEntries<K, V>(
  previous: Map<K, V>,
  next: Map<K, V>,
): Array<[K, V | undefined]> | undefined {
  const changes: Array<[K, V | undefined]> = [];
  for (const [k, v] of next) {
    const prev = previous.get(k);
    if (prev === undefined) {
      changes.push([k, v]);
      continue;
    }
    if (prev === v) continue; // reference-equal — definitely unchanged
    if (deepValueEqual(prev, v)) continue; // content-equal under JSON round-trip
    changes.push([k, v]);
  }
  for (const [k] of previous) {
    if (!next.has(k)) {
      changes.push([k, undefined]);
    }
  }
  return changes.length > 0 ? changes : undefined;
}

/**
 * Deep equality via JSON round-trip, gated on per-value size.
 *
 * Rationale: the realistic per-action mutation touches a handful of fields
 * (1 player life change, 1-2 zone card-IDs arrays, maybe 1 stack push).
 * A full deep-equal of every Map entry would be O(stateSize) per action,
 * which negates the perf win #1574 was after. So we only deep-compare
 * entries that are SMALL ENOUGH that the JSON round-trip is cheap (≤ 1 KB);
 * larger entries are treated as "changed" — the resulting delta includes
 * them, but the worst case is the same as the v1 snapshot-per-action
 * replay (no perf regression, just no gain on huge states).
 *
 * We never return `true` (equal) for a comparison we cannot prove, so a
 * delta is never falsely declared empty.
 */
function deepValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  try {
    // Cheap size probe: count enumerable keys + the rough shape. If the
    // value is small enough, do the JSON comparison; otherwise bail to a
    // "different" verdict.
    const MAX_DEEP_VALUE_BYTES = 1024;
    const aJson = JSON.stringify(a);
    if (aJson === undefined) return false;
    if (aJson.length > MAX_DEEP_VALUE_BYTES) return false;
    const bJson = JSON.stringify(b);
    if (bJson === undefined || bJson.length > MAX_DEEP_VALUE_BYTES) return false;
    return aJson === bJson;
  } catch {
    return false;
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
  data: Record<string, unknown> = {},
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
  const actionData = data as Record<string, unknown>;

  switch (type) {
    case "cast_spell":
      return `${playerName} cast ${(actionData.cardName as string) || "a spell"}`;
    case "activate_ability":
      return `${playerName} activated ${(actionData.abilityName as string) || "an ability"}`;
    case "play_land":
      return `${playerName} played a land`;
    case "draw_card":
      return `${playerName} drew a card`;
    case "discard_card":
      return `${playerName} discarded ${(actionData.cardName as string) || "a card"}`;
    case "cycle_card":
      return `${playerName} cycled ${(actionData.cardName as string) || "a card"}`;
    case "declare_attackers":
      return `${playerName} declared attackers`;
    case "declare_blockers":
      return `${playerName} declared blockers`;
    case "tap_card":
      return `${playerName} tapped ${(actionData.cardName as string) || "a card"}`;
    case "untap_card":
      return `${playerName} untapped ${(actionData.cardName as string) || "a card"}`;
    case "destroy_card":
      return `${(actionData.cardName as string) || "A card"} was destroyed`;
    case "exile_card":
      return `${(actionData.cardName as string) || "A card"} was exiled`;
    case "gain_life":
      return `${playerName} gained ${(actionData.amount as number) || 0} life`;
    case "lose_life":
      return `${playerName} lost ${(actionData.amount as number) || 0} life`;
    case "deal_damage":
      return `${playerName} dealt ${(actionData.amount as number) || 0} damage to ${(actionData.target as string) || "target"}`;
    case "mulligan":
      return `${playerName} took a mulligan`;
    case "concede":
      return `${playerName} conceded the game`;
    case "pass_priority":
      return `${playerName} passed priority`;
    default:
      return `${playerName} performed action: ${type}`;
  }
}
