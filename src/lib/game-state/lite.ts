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
// format-rules is itself a leaf (constants and lookups only).
export * from "./format-rules";
export { gzipCompress, gzipDecompress, injectGzipComment } from "./native-gzip";
