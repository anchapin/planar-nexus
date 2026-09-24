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
 * Thrown when a serialized GameState fails structural validation during deserialization.
 *
 * Caught by the engine at the session boundary and surfaced to the UI as a
 * recoverable error rather than a crash. Callers receiving this error should
 * treat the deserialization as failed and report the issue to the user.
 *
 * @example
 * try {
 *   const state = deserializeGameState(jsonString);
 * } catch (err) {
 *   if (err instanceof GameStateValidationError) {
 *     console.error("Invalid game state:", err.message);
 *   }
 * }
 */
export class GameStateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameStateValidationError";
  }
}

function validateGameStateStructure(obj: unknown): asserts obj is GameState {
  if (obj === null || obj === undefined) {
    throw new GameStateValidationError("GameState cannot be null or undefined");
  }
  if (typeof obj !== "object") {
    throw new GameStateValidationError("GameState must be an object");
  }

  const state = obj as Record<string, unknown>;

  if (typeof state.gameId !== "string" || !state.gameId) {
    throw new GameStateValidationError(
      "GameState.gameId must be a non-empty string",
    );
  }
  if (typeof state.format !== "string") {
    throw new GameStateValidationError("GameState.format must be a string");
  }
  if (typeof state.status !== "string") {
    throw new GameStateValidationError("GameState.status must be a string");
  }
  const validStatuses = ["not_started", "in_progress", "paused", "completed"];
  if (!validStatuses.includes(state.status)) {
    throw new GameStateValidationError(
      `GameState.status must be one of: ${validStatuses.join(", ")}`,
    );
  }

  if (!(state.players instanceof Map)) {
    throw new GameStateValidationError("GameState.players must be a Map");
  }
  if (!Array.isArray(state.stack)) {
    throw new GameStateValidationError("GameState.stack must be an array");
  }
  if (!state.turn || typeof state.turn !== "object") {
    throw new GameStateValidationError("GameState.turn must be an object");
  }
  if (!state.combat || typeof state.combat !== "object") {
    throw new GameStateValidationError("GameState.combat must be an object");
  }
  if (!Array.isArray(state.winners)) {
    throw new GameStateValidationError("GameState.winners must be an array");
  }
  if (typeof state.lastModifiedAt !== "number") {
    throw new GameStateValidationError(
      "GameState.lastModifiedAt must be a number",
    );
  }
}

export function deserializeGameState(json: string): GameState {
  try {
    const parsed = JSON.parse(json, mapReviver);
    validateGameStateStructure(parsed);
    return parsed;
  } catch (err) {
    if (err instanceof GameStateValidationError) {
      throw err;
    }
    if (err instanceof SyntaxError) {
      throw new GameStateValidationError(
        `Failed to parse GameState JSON: ${err.message}`,
      );
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
