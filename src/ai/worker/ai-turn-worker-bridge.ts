/**
 * @fileoverview AI-turn worker bridge (planar-nexus issue #2417, slice 2).
 *
 * This module is the single seam that routes an AI turn through the
 * AI-opponent Web Worker when it is available, and falls back to the
 * identical main-thread turn loop when it is not — so the AI keeps
 * functioning even if the worker fails to initialize or errors mid-turn.
 *
 * It mirrors the repo's other worker bridges (`game-state-evaluator-worker-bridge.ts`,
 * `trigger-chain-worker-bridge.ts`) and slice 1's engine worker client:
 *
 * - the real client is loaded through a dynamic `import()` wrapped in
 *   try/catch, because the browser-only factory captures `import.meta.url`
 *   at module top-level (unparseable under ts-jest CommonJS),
 * - the client resolver is injectable (`_setAITurnWorkerClientResolver`) so
 *   the worker path and the fallback path can be unit-tested without a
 *   real `Worker` global (jsdom does not provide one),
 * - the fallback never throws because of worker unavailability: any
 *   resolver/client error is swallowed and the turn runs on the main
 *   thread.
 *
 * Two things are **not** transferable and therefore keep the turn on the
 * main thread (the bridge reports "no worker" for them):
 *
 *   - a state that carries a seeded RNG (`state.random` is a function and
 *     cannot cross a worker boundary — running the turn in a worker would
 *     silently change the game's random outcomes),
 *   - a config that carries a swing tracker (`BoardSwingTracker` is a class
 *     instance; a structured clone would drop its prototype).
 */

import type { GameState, PlayerId } from "@/lib/game-state";

import type { AITurnConfig, AITurnResult } from "../ai-turn-loop";

/**
 * Minimal shape of the AI-turn worker client this bridge needs. Declared
 * locally (rather than importing the real client type) so tests can inject
 * a plain stub and stay decoupled from the transport.
 */
export interface AITurnWorkerClientLike {
  runTurn(
    state: GameState,
    aiPlayerId: PlayerId,
    config: AITurnConfig,
    options?: { onCommentary?: (text: string) => void },
  ): Promise<AITurnResult>;
}

export type AITurnWorkerClientResolver = () => Promise<
  AITurnWorkerClientLike | null
>;

let fallbackWarningLogged = false;

/**
 * Default resolver: lazily dynamic-import the real client (browser /
 * Next.js). The dynamic import keeps this module Jest-safe — the client's
 * factory module captures `import.meta.url`.
 */
const defaultResolver: AITurnWorkerClientResolver = async () => {
  try {
    const mod = await import("./ai-turn-worker-client");
    return mod.aiTurnWorkerClient as unknown as AITurnWorkerClientLike;
  } catch {
    return null;
  }
};

let clientResolver: AITurnWorkerClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a
 * stub worker client and exercise both the worker path and the fallback.
 */
export function _setAITurnWorkerClientResolver(
  resolver: AITurnWorkerClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default client resolver and reset the one-shot fallback
 * warning. @internal — call this in `afterEach` of tests that use the
 * setter.
 */
export function _resetAITurnWorkerClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Whether this turn can cross the worker boundary without changing the
 * game's behaviour.
 *
 * A seeded RNG and a swing tracker are the two blockers (see the file
 * overview). Everything else in {@link AITurnConfig} is plain data.
 */
export function isAITurnWorkerTransferable(
  state: GameState,
  config: AITurnConfig,
): boolean {
  if (typeof state.random === "function") {
    return false;
  }
  if (config.swingTracker) {
    return false;
  }
  return true;
}

/**
 * Play an AI turn off the main thread when the AI worker is available;
 * otherwise report "not available" so the caller can run the synchronous
 * turn loop.
 *
 * Guarantees:
 * - the returned result is value-identical to a direct `runAITurn()` call
 *   (the worker runs the very same turn loop),
 * - never throws because of worker unavailability: any resolver/client
 *   error is swallowed and reported as "not available".
 */
export async function runAITurnViaWorker(
  state: GameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<AITurnResult | null> {
  if (!isAITurnWorkerTransferable(state, config)) {
    return null;
  }

  let client: AITurnWorkerClientLike | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (!client) {
    return null;
  }

  try {
    const result = await client.runTurn(state, aiPlayerId, config, {
      onCommentary: config.onCommentary,
    });
    return result ?? null;
  } catch (error) {
    // Worker present but errored: fall through to the main-thread turn.
    // Warn once to avoid log spam on tight loops.
    if (!fallbackWarningLogged) {
      console.warn(
        "[ai-turn-worker] AI turn worker failed; falling back to the main thread:",
        error,
      );
      fallbackWarningLogged = true;
    }
    return null;
  }
}
