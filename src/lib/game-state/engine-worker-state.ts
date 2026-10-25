/**
 * @fileoverview Transfer codec for the rules-engine Web Worker
 * (issue #2417, slice 1).
 *
 * The worker owns the authoritative `GameState`, so the state has to cross
 * the worker boundary twice: once when the main thread hands over the
 * initial state, and once per action when the worker returns the result.
 *
 * `GameState` is *almost* structured-clone safe — the players / cards /
 * zones Maps clone fine — but three fields do not survive a structured
 * clone:
 *
 *   - `replacementEffectManager` (`ReplacementEffectManager` instance)
 *   - `layerSystem` (`LayerSystem` instance)
 *   - `random` (an optional RNG *function* — `DataCloneError`)
 *
 * A structured clone copies class instances as plain objects, so the clone
 * would keep the data but lose the prototype and every method the engine
 * calls on it. This module therefore projects a `GameState` down to
 * {@link EngineStateSnapshot} before it is posted, and re-creates the two
 * manager instances when the snapshot is decoded again.
 *
 * Slice 1 ships the **full** state per action (see
 * {@link EngineStateSnapshot}): the repo has no patch/diff helper for
 * `GameState` today (`state-serialization.ts` and
 * `game-state-compression.ts` are whole-state formats), so a delta
 * transport is a later optimisation.
 */

import type { GameState } from "@/lib/game-state";

import { LayerSystem } from "./layer-system";
import { ReplacementEffectManager } from "./replacement-effects";
import { mapReplacer, mapReviver } from "./state-serialization";
import type { EngineStateSnapshot } from "./engine-worker-types";

/**
 * Project a live `GameState` onto its transferable snapshot.
 *
 * The returned object shares the live Maps with the source state — it is a
 * *projection*, not a copy. Use {@link cloneEngineStateSnapshot} when an
 * independent copy is required (the in-process fallback path).
 */
export function toEngineStateSnapshot(state: GameState): EngineStateSnapshot {
  const {
    replacementEffectManager: _replacementEffectManager,
    layerSystem: _layerSystem,
    random: _random,
    ...snapshot
  } = state;

  return snapshot;
}

/**
 * Rebuild a live `GameState` from a transferable snapshot.
 *
 * The two engine manager instances are re-created empty: they are engine
 * internals (a replacement-effect registry and the continuous-effect layer
 * stack), not game data, and they cannot be transferred. The worker's held
 * state keeps its own live instances for the whole session, so the
 * authoritative copy never loses them; only the projected copies handed back
 * to the main thread start from an empty registry.
 */
export function fromEngineStateSnapshot(
  snapshot: EngineStateSnapshot,
): GameState {
  return {
    ...snapshot,
    replacementEffectManager: new ReplacementEffectManager(),
    layerSystem: new LayerSystem(),
  };
}

/**
 * Whether this runtime's `structuredClone` preserves `Map`s.
 *
 * Probed once (and cached) rather than assumed from the function's mere
 * existence: jsdom — the environment the in-process fallback runs under in
 * Jest — provides a `structuredClone` that silently clones a `Map` into an
 * empty plain object, which would corrupt the state (the engine calls
 * `players.get(...)` on it). Real browsers and Node clone Maps correctly.
 */
let structuredClonePreservesMaps: boolean | null = null;

function canUseStructuredClone(): boolean {
  if (typeof structuredClone !== "function") {
    return false;
  }
  if (structuredClonePreservesMaps === null) {
    try {
      const probe = structuredClone(new Map([["k", 1]]));
      structuredClonePreservesMaps =
        probe instanceof Map && probe.get("k") === 1;
    } catch {
      structuredClonePreservesMaps = false;
    }
  }
  return structuredClonePreservesMaps;
}

/**
 * Deep-copy a snapshot so the caller cannot mutate the worker's held state
 * by accident (the in-process fallback shares one JavaScript heap, unlike a
 * real worker where `postMessage` copies for us).
 *
 * `structuredClone` is used when the runtime provides a Map-preserving
 * implementation (browsers, Node 17+); otherwise the repo's own JSON
 * serializer helpers (`mapReplacer` / `mapReviver` from
 * `state-serialization.ts` — the same codec `serializeGameState` uses)
 * provide the Map-aware copy. Neither path can see a function because the
 * snapshot has none.
 */
export function cloneEngineStateSnapshot(
  snapshot: EngineStateSnapshot,
): EngineStateSnapshot {
  if (canUseStructuredClone()) {
    return structuredClone(snapshot);
  }

  return JSON.parse(
    JSON.stringify(snapshot, mapReplacer),
    mapReviver,
  ) as EngineStateSnapshot;
}
