/**
 * @fileoverview Synergy worker bridge (issue #1079)
 *
 * Synergy detection (`synergy-detector.ts`) scores card-to-card synergy across
 * an entire deck and is CPU-heavy. It previously ran synchronously on the main
 * thread during deck-coach analysis, causing jank on 60+ card decks.
 *
 * This module is the single seam that routes that detection through the AI
 * Web Worker when it is available, and falls back to identical main-thread
 * computation when it is not — so the coach keeps functioning even if the
 * worker fails to initialize or errors mid-call.
 *
 * It deliberately mirrors `trigger-chain-worker-bridge.ts` (#1080), which is
 * the established convention for offloading CPU-heavy AI compute to the worker:
 *
 * Design notes:
 * - The real worker client (`ai-worker-client.ts`) resolves its worker URL with
 *   `import.meta.url`, which cannot be statically `require()`d under ts-jest /
 *   Node CommonJS (`SyntaxError: Cannot use 'import.meta' outside a module`).
 *   To keep this module (and every caller, e.g. `coach-deck-analysis.ts`,
 *   `coach-context-prefetch.ts`) Jest-safe, the client is loaded with a dynamic
 *   `import()` wrapped in try/catch — any failure simply activates the
 *   main-thread fallback.
 * - The client resolver is injectable (`_setSynergyClientResolver`) so the
 *   worker path and the fallback path can be unit-tested without a real
 *   `Worker` global (jsdom does not provide one).
 * - Synergy results are order-sensitive (sorted by score descending). Callers
 *   `await` the full result before proceeding, so ordering is preserved
 *   end-to-end.
 */

import { detectSynergies as detectSynergiesOnMain } from "../synergy-detector";
import type { SynergyResult } from "../synergy-detector";
import type { DeckCard } from "@/app/actions";

/**
 * Minimal shape of the AI worker client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests can
 * inject a plain stub and stay decoupled from the import.meta-based client.
 */
export interface SynergyWorkerClient {
  detectSynergies(
    deck: DeckCard[],
    minScore?: number,
    maxResults?: number,
  ): Promise<SynergyResult[] | null>;
}

export type SynergyClientResolver = () => Promise<SynergyWorkerClient | null>;

let fallbackWarningLogged = false;

/**
 * Default resolver: lazily dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview.
 */
const defaultResolver: SynergyClientResolver = async () => {
  try {
    const mod = await import("./ai-worker-client");
    return mod.aiWorkerClient as unknown as SynergyWorkerClient;
  } catch {
    return null;
  }
};

let clientResolver: SynergyClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a stub
 * worker client and exercise both the worker path and the fallback path.
 */
export function _setSynergyClientResolver(
  resolver: SynergyClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default client resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetSynergyClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Detect synergies off the main thread when the AI worker is available;
 * otherwise compute on the main thread with identical results.
 *
 * Guarantees:
 * - The returned `SynergyResult[]` is value-identical to a direct
 *   `detectSynergies()` call (worker path forwards the same result).
 * - Order-sensitive: the full, score-sorted result list is resolved before
 *   this resolves, so callers that `await` preserve ordering.
 * - Never throws due to worker unavailability: any resolver/client error is
 *   swallowed and routed to the main-thread fallback.
 */
export async function detectSynergiesAsync(
  deck: DeckCard[],
  minScore?: number,
  maxResults?: number,
): Promise<SynergyResult[]> {
  let client: SynergyWorkerClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (client) {
    try {
      const result = await client.detectSynergies(deck, minScore, maxResults);
      if (result) {
        return result;
      }
    } catch (error) {
      // Worker present but errored (or returned nothing usable): fall through
      // to main-thread compute. Warn once to avoid log spam on tight loops.
      if (!fallbackWarningLogged) {
        console.warn(
          "[synergy] AI worker detection failed; falling back to main thread:",
          error,
        );
        fallbackWarningLogged = true;
      }
    }
  }

  return detectSynergiesOnMain(deck, minScore, maxResults);
}
