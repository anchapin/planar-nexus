/**
 * @fileoverview Trigger-chain worker bridge (issue #1080)
 *
 * Trigger-chain evaluation (`trigger-chain-evaluator.ts`) recursively expands
 * cascade / ETB / "whenever you cast" chains across the full board and is
 * CPU-heavy. It previously ran synchronously on the main thread during AI
 * priority decisions, causing jank.
 *
 * This module is the single seam that routes that evaluation through the AI
 * Web Worker when it is available, and falls back to identical main-thread
 * computation when it is not — so the AI keeps functioning even if the worker
 * fails to initialize or errors mid-call.
 *
 * Design notes:
 * - The real worker client (`ai-worker-client.ts`) resolves its worker URL with
 *   `import.meta.url`, which cannot be statically `require()`d under ts-jest /
 *   Node CommonJS (`SyntaxError: Cannot use 'import.meta' outside a module`).
 *   To keep this module (and every caller, e.g. `stack-interaction-ai.ts`)
 *   Jest-safe, the client is loaded with a dynamic `import()` wrapped in
 *   try/catch — any failure simply activates the main-thread fallback.
 * - The client resolver is injectable (`_setTriggerChainClientResolver`) so the
 *   worker path and the fallback path can be unit-tested without a real
 *   `Worker` global (jsdom does not provide one).
 * - Trigger chains are order-sensitive (sorted by totalValue). Callers `await`
 *   the full result before proceeding, so ordering is preserved end-to-end.
 */

import { evaluateTriggerChain as evaluateTriggerChainOnMain } from "../trigger-chain-evaluator";
import type {
  CascadeContext,
  BoardPermanent,
  TriggerChain,
} from "../trigger-chain-evaluator";

/**
 * Minimal shape of the AI worker client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests can
 * inject a plain stub and stay decoupled from the import.meta-based client.
 */
export interface TriggerChainWorkerClient {
  evaluateTriggerChain(
    stackItem: CascadeContext["stackItem"],
    battlefield: BoardPermanent[],
    maxDepth?: number,
  ): Promise<TriggerChain[] | null>;
}

export type TriggerChainClientResolver =
  () => Promise<TriggerChainWorkerClient | null>;

let fallbackWarningLogged = false;

/**
 * Default resolver: lazily dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview.
 */
const defaultResolver: TriggerChainClientResolver = async () => {
  try {
    const mod = await import("./ai-worker-client");
    return mod.aiWorkerClient as unknown as TriggerChainWorkerClient;
  } catch {
    return null;
  }
};

let clientResolver: TriggerChainClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a stub
 * worker client and exercise both the worker path and the fallback path.
 */
export function _setTriggerChainClientResolver(
  resolver: TriggerChainClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default client resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetTriggerChainClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Evaluate trigger chains off the main thread when the AI worker is available;
 * otherwise compute on the main thread with identical results.
 *
 * Guarantees:
 * - The returned `TriggerChain[]` is value-identical to a direct
 *   `evaluateTriggerChain()` call (worker path forwards the same result).
 * - Order-sensitive: the full, sorted chain list is resolved before this
 *   resolves, so callers that `await` preserve evaluation order.
 * - Never throws due to worker unavailability: any resolver/client error is
 *   swallowed and routed to the main-thread fallback.
 */
export async function evaluateTriggerChainAsync(
  stackItem: CascadeContext["stackItem"],
  battlefield: BoardPermanent[],
  maxDepth?: number,
): Promise<TriggerChain[]> {
  let client: TriggerChainWorkerClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (client) {
    try {
      const result = await client.evaluateTriggerChain(
        stackItem,
        battlefield,
        maxDepth,
      );
      if (result) {
        return result;
      }
    } catch (error) {
      // Worker present but errored (or returned nothing usable): fall through
      // to main-thread compute. Warn once to avoid log spam on tight loops.
      if (!fallbackWarningLogged) {
        console.warn(
          "[trigger-chain] AI worker evaluation failed; falling back to main thread:",
          error,
        );
        fallbackWarningLogged = true;
      }
    }
  }

  return evaluateTriggerChainOnMain(stackItem, battlefield, maxDepth);
}
