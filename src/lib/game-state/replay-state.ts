/**
 * @fileOverview Replay state reconstruction — the stateless accessors that
 * rebuild the full `GameState` at a given replay position (issue #2975).
 *
 * `getStateAtPosition` and `applyStateDeltaInPlace` used to live in
 * `src/lib/game-state/replay.ts`, which is part of the heavy rules engine.
 * The /saved-games route (URL sharing) needs the same reconstruction, but
 * it must not pull the engine into its module graph — it reaches the engine
 * only through the sanctioned leaf entry point "@/lib/game-state/lite".
 *
 * This module is the engine-side home of both helpers: a LEAF module (its
 * only runtime dependency is "./state-serialization", itself a leaf), so
 * `lite.ts` can re-export it without dragging the engine in. The
 * implementations were moved VERBATIM from `replay.ts` — same behaviour,
 * same fast/slow paths, same in-place delta application.
 *
 * `replay.ts` re-exports both functions, so every existing consumer
 * (including the "@/lib/game-state" barrel) keeps working unchanged.
 */

import type { CardInstanceId, GameState, PlayerId } from "./types";
import type { Replay, ReplayStateDelta } from "./replay";
import { cloneGameState } from "./state-serialization";

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
      (
        state as unknown as { priorityPlayerIndex?: number }
      ).priorityPlayerIndex = f.priorityPlayerIndex;
    }
  }

  if (delta.players) {
    for (const [id, value] of delta.players) {
      if (value === undefined) {
        state.players.delete(id);
      } else {
        state.players.set(
          id,
          value as GameState["players"] extends Map<PlayerId, infer V>
            ? V
            : never,
        );
      }
    }
  }
  if (delta.zones) {
    for (const [id, value] of delta.zones) {
      if (value === undefined) {
        state.zones.delete(id);
      } else {
        state.zones.set(
          id,
          value as GameState["zones"] extends Map<string, infer V> ? V : never,
        );
      }
    }
  }
  if (delta.cards) {
    for (const [id, value] of delta.cards) {
      if (value === undefined) {
        state.cards.delete(id);
      } else {
        state.cards.set(
          id,
          value as GameState["cards"] extends Map<CardInstanceId, infer V>
            ? V
            : never,
        );
      }
    }
  }
  if (delta.stack) {
    state.stack = [...delta.stack];
  }

  return state;
}
