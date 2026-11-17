/**
 * @fileoverview Lightweight engine entry point (issue #2470).
 *
 * The full "@/lib/game-state" barrel re-exports the whole rules engine, so
 * any module that imports even one helper from it drags the engine into that
 * route's client bundle. Settings, the deck builders and the multiplayer
 * lobby only need serialization, compression, hashing and format metadata.
 *
 * This file re-exports exactly those leaf modules and nothing that reaches
 * the rules engine. It is the one sanctioned exception to the barrel-only
 * rule (#1710): non-engine code may import "@/lib/game-state/lite", never
 * any other engine sub-path. Keep it leaf-only: adding a module that imports
 * combat, the stack or effect resolution defeats its purpose.
 *
 * ValidationService is deliberately absent: it reaches the priority and
 * keyword code, which Turbopack bundles into the shared engine chunk. It has
 * its own entry point, "@/lib/game-state/lite-validation".
 *
 * Names match the main barrel, including the `*String` aliases for the
 * JSON string serializers, so a file can switch entry points without
 * renaming anything.
 */
export {
  serializeGameState,
  deserializeGameState,
  engineToAIState,
  aiToEngineState,
} from "./serialization";
export {
  serializeGameState as serializeGameStateString,
  deserializeGameState as deserializeGameStateString,
  mapReplacer,
  mapReviver,
} from "./state-serialization";
export {
  compressGameStateJson,
  decompressGameStateJson,
} from "./game-state-compression";
export { compressReplayJson, decompressReplayJson } from "./replay-compression";
export { computeStateHash, analyzeHashDiscrepancy } from "./state-hash";
// Issue #2975: replay state reconstruction lives in its own leaf module, so
// the light routes (e.g. /saved-games) can rebuild a game state from a
// replay without pulling the rules engine into their module graph.
export {
  getStateAtPosition,
  applyStateDeltaInPlace,
} from "./replay-state";
// format-rules is itself a leaf (constants and lookups only).
export * from "./format-rules";
export { gzipCompress, gzipDecompress, injectGzipComment } from "./native-gzip";

// Type-only re-exports (issue #2472 follow-up — lobby route module graph).
//
// The lobby / P2P path needs engine TYPES (GameState, Phase, PlayerId,
// GameAction, SerializedGameState, ...) but not the engine CODE. Importing
// them from the "@/lib/game-state" barrel re-exports every engine module
// as a VALUE, so the whole rules engine lands in the route's module graph
// and the on-demand `next dev` compile blows past the Playwright
// navigation timeout (issue #2472, #2970).
//
// `export type { ... }` is ERASED at compile time: it adds no runtime
// edge and pulls no engine code into the route. It only lets non-game
// routes name the engine types through the sanctioned leaf entry point
// instead of the barrel — keeping the #1710 barrel-only lint rule intact.
//
// Keep this list to types that live in "./types" (pure type modules) and
// "./serialization" (already re-exported above). Adding a type that lives
// in a module with runtime behaviour is fine ONLY while the re-export
// stays `export type` — a value re-export would defeat this file's
// leaf-only contract.
export type {
  GameState,
  PlayerId,
  Phase,
  GameAction,
  MinimalCard,
  ScryfallCard,
} from "./types";
export type { SerializedGameState } from "./serialization";
