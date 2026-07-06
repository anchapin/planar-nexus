/**
 * @fileoverview Heuristic deck-coach worker bridge (issue #1243)
 *
 * `reviewDeckHeuristic` (in `src/lib/heuristic-deck-coach.ts`) iterates 6
 * archetype templates, runs archetype + synergy + missing-synergy detection,
 * and composes a `DeckReviewOutput`. On a 100-card deck it is comfortably
 * >50ms on the main thread, blocking the deck-coach UI.
 *
 * This module is the single seam that routes that review through the AI Web
 * Worker when it is available, and falls back to identical main-thread
 * computation when it is not — so the coach keeps functioning even if the
 * worker fails to initialize or errors mid-call.
 *
 * It deliberately mirrors the existing `synergy-worker-bridge.ts` (#1079) and
 * `trigger-chain-worker-bridge.ts` (#1080) bridges, which is the established
 * convention for offloading CPU-heavy AI compute to the worker:
 *
 * Design notes:
 * - The real worker client (`ai-worker-client.ts`) resolves its worker URL with
 *   `import.meta.url`, which cannot be statically `require()`d under ts-jest /
 *   Node CommonJS (`SyntaxError: Cannot use 'import.meta' outside a module`).
 *   To keep this module (and every caller, e.g. `ai-deck-coach-review.ts`)
 *   Jest-safe, the client is loaded with a dynamic `import()` wrapped in
 *   try/catch — any failure simply activates the main-thread fallback.
 * - The client resolver is injectable (`_setHeuristicDeckCoachClientResolver`)
 *   so the worker path and the fallback path can be unit-tested without a
 *   real `Worker` global (jsdom does not provide one).
 * - The result is plain JSON (`DeckReviewOutput`), so a single `await` round
 *   trip is sufficient to receive the entire review — no streaming or partial
 *   ordering is required, and the worker path returns the same value the
 *   main-thread path would.
 */

import {
  reviewDeckHeuristic as reviewDeckHeuristicOnMain,
  type DeckReviewOutput,
} from "@/lib/heuristic-deck-coach";
import type { HeuristicDeckCard } from "./worker-types";

/**
 * Minimal shape of the AI worker client surface this bridge needs.
 * Declared locally (rather than importing the real client type) so tests can
 * inject a plain stub and stay decoupled from the import.meta-based client.
 */
export interface HeuristicDeckCoachWorkerClient {
  reviewDeck(
    decklist: string,
    format: string,
    cards: HeuristicDeckCard[],
  ): Promise<DeckReviewOutput | null>;
}

export type HeuristicDeckCoachClientResolver = () => Promise<
  HeuristicDeckCoachWorkerClient | null
>;

let fallbackWarningLogged = false;

/**
 * Default resolver: lazily dynamic-import the real client (browser / Next.js).
 * Dynamic import keeps this module Jest-safe — see fileoverview.
 */
const defaultResolver: HeuristicDeckCoachClientResolver = async () => {
  try {
    const mod = await import("./ai-worker-client");
    return mod.aiWorkerClient as unknown as HeuristicDeckCoachWorkerClient;
  } catch {
    return null;
  }
};

let clientResolver: HeuristicDeckCoachClientResolver = defaultResolver;

/**
 * Replace the client resolver. @internal — used by unit tests to inject a
 * stub worker client and exercise both the worker path and the fallback path.
 */
export function _setHeuristicDeckCoachClientResolver(
  resolver: HeuristicDeckCoachClientResolver,
): void {
  clientResolver = resolver;
}

/**
 * Restore the default client resolver and reset the one-shot fallback warning.
 * @internal — call this in `afterEach` of tests that use the setter.
 */
export function _resetHeuristicDeckCoachClientResolver(): void {
  clientResolver = defaultResolver;
  fallbackWarningLogged = false;
}

/**
 * Review a deck off the main thread when the AI worker is available;
 * otherwise compute on the main thread with identical results.
 *
 * Guarantees:
 * - The returned `DeckReviewOutput` is value-identical to a direct
 *   `reviewDeckHeuristic()` call (worker path forwards the same result).
 * - Never throws due to worker unavailability: any resolver/client error is
 *   swallowed and routed to the main-thread fallback.
 *
 * Issue #1243, roadmap Phase 32 (Off-Main-Thread Intelligence).
 */
export async function reviewDeckHeuristicAsync(
  decklist: string,
  format: string,
  cards: HeuristicDeckCard[],
): Promise<DeckReviewOutput> {
  let client: HeuristicDeckCoachWorkerClient | null = null;
  try {
    client = await clientResolver();
  } catch {
    client = null;
  }

  if (client) {
    try {
      const result = await client.reviewDeck(decklist, format, cards);
      if (result) {
        return result;
      }
    } catch (error) {
      // Worker present but errored (or returned nothing usable): fall through
      // to main-thread compute. Warn once to avoid log spam on tight loops.
      if (!fallbackWarningLogged) {
        console.warn(
          "[heuristic-deck-coach] AI worker review failed; falling back to main thread:",
          error,
        );
        fallbackWarningLogged = true;
      }
    }
  }

  return reviewDeckHeuristicOnMain(decklist, format, cards);
}
