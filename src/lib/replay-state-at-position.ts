/**
 * @fileOverview Engine-free replay state reconstruction (issue #2947).
 *
 * The /saved-games route must not pull the rules engine into its module
 * graph. The engine's only public entry point is the "@/lib/game-state"
 * barrel (#1710), and a *value* import from that barrel drags the whole
 * engine (card scripts, spell casting, the layer system, …) into every
 * route that touches it — the "@/lib/game-state/lite" leaf exists exactly
 * to avoid that, but it deliberately exposes only serialization,
 * compression, hashing and format metadata.
 *
 * The URL-share format needs the full game state at every action position
 * (`minifyReplay` in `replay-share-link.ts`), and the engine's
 * `getStateAtPosition` is only reachable through the heavy barrel. This
 * module is a faithful, engine-free port of that helper so the share path
 * can stay on the leaf entry points:
 *
 *   - `cloneGameState`   → `serializeGameStateString` / `deserializeGameStateString`
 *                          from "@/lib/game-state/lite" (the same
 *                          state-serialization helpers the engine uses).
 *   - `applyStateDeltaInPlace` → ported verbatim from
 *                          `src/lib/game-state/replay.ts`.
 *
 * Behaviour is intentionally identical to the engine's implementation: the
 * fast path (an action that carries `resultingState`) returns it verbatim,
 * the slow path anchors on the nearest snapshot and forward-applies the
 * per-action deltas, and malformed input returns `null` instead of
 * throwing. KEEP IN SYNC with `getStateAtPosition` /
 * `applyStateDeltaInPlace` in `src/lib/game-state/replay.ts`.
 */

import type {
  CardInstanceId,
  GameState,
  PlayerId,
  Replay,
  ReplayStateDelta,
} from "@/lib/game-state";
import {
  serializeGameStateString,
  deserializeGameStateString,
} from "@/lib/game-state/lite";

/**
 * Deep-clone a game state. Mirrors the engine's `cloneGameState`
 * (JSON round-trip through the state-serialization helpers).
 */
function cloneGameState(state: GameState): GameState {
  return deserializeGameStateString(serializeGameStateString(state));
}

/**
 * Apply a `ReplayStateDelta` to a `GameState` IN PLACE — mutates the
 * passed-in state and returns it (same reference).
 *
 * Ported verbatim from the engine's `applyStateDeltaInPlace`
 * (`src/lib/game-state/replay.ts`): the whole-field replacements, the
 * per-entry player/zone/card map patches (`undefined` deletes) and the
 * full stack replacement behave exactly like the engine's version.
 */
function applyStateDeltaInPlace(
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

/**
 * Reconstruct the full game state at `position` of a (possibly
 * delta-encoded) replay.
 *
 * Engine-free port of the engine's `getStateAtPosition`
 * (`src/lib/game-state/replay.ts`) — see the file header for the sync
 * contract.
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
  // deltas. The intermediate `state` reference is local to this call so we
  // don't corrupt the shared snapshot.
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
