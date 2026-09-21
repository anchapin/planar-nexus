/**
 * Engine error types for error containment (#1900).
 *
 * When oracle-text-parser, createCardInstance, or ability resolution throws an
 * uncaught exception, the engine wraps it in an EngineUncaughtException rather
 * than letting it propagate and crash the session. The UI can render this as a
 * recoverable error toast.
 */

import type { GameState, CardInstanceId } from "./types";
import { computeStateHash } from "./state-hash";

/**
 * An uncaught exception from within the rules engine that has been captured
 * and typed for UI recovery.
 */
export interface EngineUncaughtException {
  readonly type: "EngineUncaughtException";
  readonly message: string;
  readonly stack?: string;
  /** The card instance ID involved in the failing operation, if known. */
  readonly cardId?: CardInstanceId;
  /** A short label for the failing entry point (e.g. "castSpell", "resolveTopOfStack"). */
  readonly entryPoint: string;
  /**
   * State hash captured BEFORE the failing operation executed.
   * Used for replay/debugging to reconstruct the pre-failure state.
   */
  readonly stateHashBefore: string;
  /**
   * The original error that was caught.
   */
  readonly cause: unknown;
}

/**
 * Create an EngineUncaughtException from a caught error.
 */
export function createEngineUncaughtException(
  error: unknown,
  entryPoint: string,
  state: GameState,
  cardId?: CardInstanceId,
): EngineUncaughtException {
  return {
    type: "EngineUncaughtException",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    cardId,
    entryPoint,
    stateHashBefore: safeComputeStateHash(state),
    cause: error,
  };
}

/**
 * Compute state hash safely — never throws.
 * If hashing fails, returns a placeholder string.
 */
function safeComputeStateHash(state: GameState): string {
  try {
    return computeStateHash(state);
  } catch {
    return "<hash unavailable>";
  }
}
