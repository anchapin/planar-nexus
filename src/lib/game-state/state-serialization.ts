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
 * Serialize GameState to a JSON string
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state, mapReplacer, 2);
}

/**
 * Deserialize GameState from a JSON string
 */
export function deserializeGameState(json: string): GameState {
  return JSON.parse(json, mapReviver) as GameState;
}

/**
 * Deep clone a GameState using serialization
 */
export function cloneGameState(state: GameState): GameState {
  return deserializeGameState(serializeGameState(state));
}
