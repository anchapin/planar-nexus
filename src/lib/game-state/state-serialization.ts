/**
 * @fileoverview Robust GameState Serialization
 *
 * Provides functions to serialize and deserialize GameState while preserving
 * Map objects and other complex types.
 */

import type { GameState } from "./types";

/**
 * Replacer function for JSON.stringify to handle Maps
 */
export function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: Array.from(value.entries()),
    };
  }
  return value;
}

/**
 * Reviver function for JSON.parse to handle Maps
 */
export function mapReviver(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null) {
    const val = value as Record<string, unknown>;
    if (val.dataType === "Map" && Array.isArray(val.value)) {
      return new Map(val.value);
    }
  }
  return value;
}

/**
 * Serialize GameState to a compact JSON string.
 *
 * Indentation is intentionally omitted: the serialized payload is used for
 * WebRTC sync messages and IndexedDB storage, where whitespace only inflates
 * size (~30%) without any benefit. Use {@link prettyPrintGameState} when a
 * human-readable representation is required (e.g. debugging).
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state, mapReplacer);
}

/**
 * Serialize GameState to a pretty-printed JSON string for debugging only.
 *
 * This is intentionally NOT used by any persistence or transport path; it
 * exists so logs and dev tooling can render readable state snapshots without
 * regressing the compact serialization used elsewhere.
 */
export function prettyPrintGameState(state: GameState): string {
  return JSON.stringify(state, mapReplacer, 2);
}

/**
 * Deserialize GameState from a JSON string with error handling
 */
export function deserializeGameState(json: string): GameState {
  try {
    return JSON.parse(json, mapReviver) as GameState;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse GameState JSON: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Deep clone a GameState using serialization
 */
export function cloneGameState(state: GameState): GameState {
  return deserializeGameState(serializeGameState(state));
}
