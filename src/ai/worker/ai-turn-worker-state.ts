/**
 * @fileoverview Transfer codec for the AI-opponent Web Worker
 * (planar-nexus issue #2417, slice 2).
 *
 * The AI worker receives the engine's `GameState` and returns the state the
 * turn ended in, so the state has to cross the worker boundary twice per
 * turn. `GameState` is *almost* structured-clone safe — the players /
 * cards / zones Maps clone fine — but three fields do not survive a
 * structured clone:
 *
 *   - `replacementEffectManager` (`ReplacementEffectManager` instance)
 *   - `layerSystem` (`LayerSystem` instance)
 *   - `random` (an optional RNG *function* — `DataCloneError`)
 *
 * A structured clone copies class instances as plain objects, so the clone
 * would keep the data but lose the prototype and every method the engine
 * calls on it. This module therefore projects a `GameState` down to
 * {@link AITurnStateSnapshot} before it is posted, and re-creates the two
 * manager instances when the snapshot is decoded again.
 *
 * This mirrors slice 1's `engine-worker-state.ts`; the duplication is
 * deliberate: the rules engine is self-contained (issue #1724), so
 * `src/lib/game-state/engine-worker-state` cannot be imported from
 * `src/ai/**` (issue #1710 forbids deep engine imports from outside the
 * engine, and the engine may not import application code either).
 *
 * `random` is *not* re-created: an RNG function cannot cross a worker
 * boundary. A state that carries a seeded RNG is therefore not transferable
 * — the turn bridge detects that and keeps the turn on the main thread so
 * seeded games stay deterministic (see `ai-turn-worker-bridge.ts`).
 */

import {
  LayerSystem,
  ReplacementEffectManager,
  mapReplacer,
  mapReviver,
  type GameState,
} from "@/lib/game-state";

import type { AITurnStateSnapshot } from "./ai-turn-worker-types";

/**
 * Project a live `GameState` onto its transferable snapshot.
 *
 * The returned object shares the live Maps with the source state — it is a
 * *projection*, not a copy. Use {@link cloneAITurnStateSnapshot} when an
 * independent copy is required (the in-process fallback path).
 */
export function toAITurnStateSnapshot(
  state: GameState,
): AITurnStateSnapshot {
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
 * stack), not game data, and they cannot be transferred. This is the same
 * trade-off slice 1 made for the rules-engine worker.
 */
export function fromAITurnStateSnapshot(
  snapshot: AITurnStateSnapshot,
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
 * Deep-copy a snapshot so the caller cannot mutate the worker's copy by
 * accident (the in-process fallback shares one JavaScript heap, unlike a
 * real worker where `postMessage` copies for us).
 *
 * `structuredClone` is used when the runtime provides a Map-preserving
 * implementation (browsers, Node 17+); otherwise the repo's own JSON
 * serializer helpers (`mapReplacer` / `mapReviver`) provide the Map-aware
 * copy. Neither path can see a function because the snapshot has none.
 */
export function cloneAITurnStateSnapshot(
  snapshot: AITurnStateSnapshot,
): AITurnStateSnapshot {
  if (canUseStructuredClone()) {
    return structuredClone(snapshot);
  }

  return JSON.parse(
    JSON.stringify(snapshot, mapReplacer),
    mapReviver,
  ) as AITurnStateSnapshot;
}
