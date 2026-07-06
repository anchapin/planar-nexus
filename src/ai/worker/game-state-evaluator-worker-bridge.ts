/**
 * @fileoverview Game-state-evaluator worker bridge (issue #1244)
 *
 * `evaluateGameState` and `quickScore` (in `game-state-evaluator.ts`) are the
 * heuristic backbone of every AI decision: a "medium" difficulty turn loop
 * computes 5–10 board evaluations per turn, and the stack-interaction lane
 * (`stack-interaction-ai.ts`) calls `evaluateGameState` six times per response
 * decision. On a 10-permanent board each evaluation can freeze the UI for
 * 20–80 ms — well over the 50 ms Long-Task budget — so Phase 32 of the
 * roadmap calls for these heuristics to move off the main thread.
 *
 * This module is the single seam that routes `evaluateGameState` /
 * `quickScore` through the AI Web Worker when it is available, and falls back
 * to identical main-thread computation when it is not — so the AI keeps
 * functioning even if the worker fails to initialize or errors mid-call.
 *
 * Design notes (mirroring `trigger-chain-worker-bridge.ts`):
 *
 * - The real worker client (`ai-worker-client.ts`) resolves its worker URL
 *   with `import.meta.url`, which cannot be statically `require()`d under
 *   ts-jest / Node CommonJS (`SyntaxError: Cannot use 'import.meta' outside
 *   a module`). To keep this module (and every caller) Jest-safe, the client
 *   is loaded with a dynamic `import()` wrapped in try/catch — any failure
 *   simply activates the main-thread fallback.
 * - The client resolver is injectable (`_setEvaluatorClientResolver`) so the
 *   worker path and the fallback path can be unit-tested without a real
 *   `Worker` global (jsdom does not provide one).
 * - The worker's `evaluateGameState` is value-identical to the main-thread
 *   function for the same `(gameState, playerId, difficulty, archetype)`
 *   arguments — the bridge forwards all four so offloading changes nothing
 *   about the resulting decision.
 */

import {
  evaluateGameState as evaluateGameStateOnMain,
  quickScore as quickScoreOnMain,
  type GameState,
  type DetailedEvaluation,
  type DeckArchetype,
  type DifficultyTier,
} from "../game-state-evaluator";

/**
 * Minimal shape of the AI worker client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests can
 * inject a plain stub and stay decoupled from the import.meta-based client.
 */
export interface GameStateEvaluatorWorkerClient {
  analyzeGameState(
    gameState: GameState,
    playerId: string,
    difficulty?: DifficultyTier,
    archetype?: DeckArchetype,
  ): Promise<DetailedEvaluation | null>;
  quickScore(
    gameState: GameState,
    playerId: string,
    difficulty?: DifficultyTier,
    archetype?: DeckArchetype,
  ): Promise<number | null>;
}

export type GameStateEvaluatorClientResolver = () => Promise<
  GameStateEvaluatorWorkerClient | null
>;

let fallbackWarningLogged = false;

/**
 * Default resolver: lazily dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview.
 */
const defaultResolver: GameStateEvaluatorClientResolver = async () => {
  try {
    const mod = await import("./ai-worker-client");
    // Cast: the real client's `analyzeGameState` / `quickScore` already match
    // the minimal shape above (both accept the same args and return a Promise
    // of the same type). The shared `aiWorkerClient` is a singleton — calling
    // it triggers lazy `Worker` initialization on first use (#1244).
    return mod.aiWorkerClient as unknown as GameStateEvaluatorWorkerClient;
  } catch {
    return null;
  }
};

let clientResolver: GameStateEvaluatorClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a stub
 * worker client and exercise both the worker path and the fallback path.
 */
export function _setEvaluatorClientResolver(
  resolver: GameStateEvaluatorClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default client resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetEvaluatorClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Evaluate a game state off the main thread when the AI worker is available;
 * otherwise compute on the main thread with identical results.
 *
 * Guarantees:
 * - The returned `DetailedEvaluation` is value-identical to a direct
 *   `evaluateGameState()` call (worker path forwards the same result).
 * - Never throws due to worker unavailability: any resolver/client error is
 *   swallowed and routed to the main-thread fallback.
 */
export async function evaluateGameStateAsync(
  gameState: GameState,
  playerId: string,
  difficulty: DifficultyTier = "medium",
  archetype?: DeckArchetype,
): Promise<DetailedEvaluation> {
  let client: GameStateEvaluatorWorkerClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (client) {
    try {
      const result = await client.analyzeGameState(
        gameState,
        playerId,
        difficulty,
        archetype,
      );
      if (result) {
        return result;
      }
    } catch (error) {
      // Worker present but errored (or returned nothing usable): fall through
      // to main-thread compute. Warn once to avoid log spam on tight loops.
      if (!fallbackWarningLogged) {
        console.warn(
          "[game-state-evaluator] AI worker evaluation failed; falling back to main thread:",
          error,
        );
        fallbackWarningLogged = true;
      }
    }
  }

  return evaluateGameStateOnMain(gameState, playerId, difficulty, archetype);
}

/**
 * Compute a quick scalar advantage score off the main thread when the AI
 * worker is available; otherwise compute on the main thread with identical
 * results. See {@link evaluateGameStateAsync} for the fallback contract.
 */
export async function quickScoreAsync(
  gameState: GameState,
  playerId: string,
  difficulty: DifficultyTier = "medium",
  archetype?: DeckArchetype,
): Promise<number> {
  let client: GameStateEvaluatorWorkerClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (client) {
    try {
      const result = await client.quickScore(
        gameState,
        playerId,
        difficulty,
        archetype,
      );
      if (typeof result === "number") {
        return result;
      }
    } catch (error) {
      if (!fallbackWarningLogged) {
        console.warn(
          "[game-state-evaluator] AI worker quickScore failed; falling back to main thread:",
          error,
        );
        fallbackWarningLogged = true;
      }
    }
  }

  return quickScoreOnMain(gameState, playerId, difficulty, archetype);
}