/**
 * @fileOverview Context PRE-FETCHING for the conversational AI coach (issue #928).
 *
 * The coaching flows previously assembled their context (archetype, deck stats,
 * synergy clusters, missing-synergy gaps) LAZILY and SERIALLY inside the
 * request handler — `detectArchetype` → `calculateDeckStats` → `detectSynergies`
 * → `detectMissingSynergies` ran one after another on every request, with no
 * cache, adding avoidable latency before the model was ever invoked. This
 * unmet the WORKER-03 latency target.
 *
 * This module is the latency-critical front end of the coach pipeline. It:
 *   1. Resolves the INDEPENDENT analyses (`archetype`, `stats`, `synergies`)
 *      IN PARALLEL via `Promise.all`. Only `missingSynergies` (which depends on
 *      the archetype) runs afterwards. Structuring the independent pieces as
 *      promises means that the moment any of them becomes genuinely async
 *      (e.g. Genkit re-added, card-definition lookups moved to a network/cache
 *      layer) they parallelise automatically with zero further change here.
 *   2. CACHES the assembled context by a deck + format fingerprint so that the
 *      common case — many coaching questions about the SAME deck in one session
 *      — skips re-computation entirely and returns in O(1).
 *   3. Exposes a single `prefetchCoachContext` entry point so that, by the time
 *      the Genkit/model flow is invoked, every piece of context it needs is
 *      already resolved and resident.
 *
 * Assembly logic is NOT duplicated: it funnels through
 * `assembleStructuredAnalysis` (from `./coach-deck-analysis`).
 */

import type { DeckCard } from "@/app/actions";
import { detectArchetype } from "@/ai/archetype-detector";
import { calculateDeckStats } from "@/ai/archetype-signatures";
import { detectMissingSynergies } from "@/ai/synergy-detector";
import { detectSynergiesAsync } from "@/ai/worker/synergy-worker-bridge";
import {
  assembleStructuredAnalysis,
  formatStructuredAnalysisForLLM,
  type StructuredDeckAnalysis,
} from "./coach-deck-analysis";

/** Everything the coach flow needs, resolved up-front before model invocation. */
export interface PrefetchedCoachContext {
  /** Full structured analysis object (archetype, curve, roles, synergies...). */
  structuredAnalysis: StructuredDeckAnalysis;
  /** The analysis rendered as the LLM-friendly markdown block for the prompt. */
  structuredAnalysisText: string;
  /** Primary detected archetype (convenience field, mirrors the analysis). */
  archetype: string;
  /** Format the coaching request is scoped to. */
  format: string;
  /** True when served from cache without re-computation (latency telemetry). */
  fromCache: boolean;
}

interface CacheEntry {
  analysis: StructuredDeckAnalysis;
  analysisText: string;
  archetype: string;
  expires: number;
}

/** A coaching session's worth of consecutive turns against the same deck. */
export const COACH_CONTEXT_CACHE_TTL_MS = 60_000;
/** Bound the cache so a chatty session can't grow unbounded. */
export const COACH_CONTEXT_CACHE_MAX_ENTRIES = 64;

const cache = new Map<string, CacheEntry>();

// Indirection over the clock so tests can advance time deterministically.
let clock: () => number = () => Date.now();

/**
 * Stable, order-independent fingerprint for a deck so identical decks (even if
 * their card arrays are ordered differently between requests) hit the cache.
 * Cheap: a sorted join of `count x name` pairs.
 */
export function computeDeckFingerprint(deck: DeckCard[]): string {
  if (!Array.isArray(deck) || deck.length === 0) return "empty";
  return deck
    .map((c) => `${c.count || 1}x${c.name}`)
    .sort()
    .join("|");
}

function cacheKey(deck: DeckCard[], format: string): string {
  return `${format}::${computeDeckFingerprint(deck)}`;
}

function evictExpired(): void {
  const t = clock();
  for (const [key, entry] of cache) {
    if (entry.expires <= t) cache.delete(key);
  }
}

/** Simple size bound: drop the entry that expires soonest when full. */
function evictIfFull(): void {
  if (cache.size < COACH_CONTEXT_CACHE_MAX_ENTRIES) return;
  let oldestKey: string | undefined;
  let oldestExpiry = Infinity;
  for (const [key, entry] of cache) {
    if (entry.expires < oldestExpiry) {
      oldestExpiry = entry.expires;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/** Clear the entire pre-fetch cache. Intended for tests and explicit resets. */
export function clearCoachContextCache(): void {
  cache.clear();
}

/** @internal Replace the clock used for TTL evaluation (tests only). */
export function _setCoachContextClock(fn: () => number): () => void {
  const prev = clock;
  clock = fn;
  return () => {
    clock = prev;
  };
}

/** @internal Inspect live cache size (tests/telemetry only). */
export function _coachContextCacheSize(): number {
  return cache.size;
}

/**
 * Resolve the three INDEPENDENT deck analyses concurrently.
 *
 * `detectArchetype`, `calculateDeckStats` and synergy detection do not depend
 * on one another. Running them through `Promise.all` guarantees that whenever
 * any becomes async it executes in parallel with the others rather than
 * serially — the core latency fix for issue #928.
 *
 * Synergy detection is routed through the AI Web Worker bridge (issue #1079)
 * so the CPU-heavy scoring runs off the main thread, falling back to identical
 * main-thread compute when the worker is unavailable. It is already a Promise,
 * so it overlaps with the other two analyses.
 */
async function resolveIndependentAnalyses(deck: DeckCard[]) {
  const [archetype, stats, synergies] = await Promise.all([
    Promise.resolve(detectArchetype(deck)),
    Promise.resolve(calculateDeckStats(deck)),
    detectSynergiesAsync(deck),
  ]);
  return { archetype, stats, synergies };
}

/**
 * Build the structured deck analysis with the independent pieces resolved in
 * parallel. Equivalent in OUTPUT to `buildStructuredDeckAnalysis` but arranged
 * for minimum latency: independent work overlaps, only the dependent
 * `detectMissingSynergies` step waits on the archetype.
 */
export async function buildStructuredDeckAnalysisParallel(
  deck: DeckCard[],
): Promise<StructuredDeckAnalysis> {
  const safeDeck = Array.isArray(deck) ? deck : [];

  const { archetype, stats, synergies } =
    await resolveIndependentAnalyses(safeDeck);

  // Dependent step: missing-synergy gaps need the detected archetype.
  const missing = detectMissingSynergies(safeDeck, archetype.primary);

  return assembleStructuredAnalysis(safeDeck, {
    archetype,
    stats,
    synergies,
    missing,
  });
}

/**
 * Pre-fetch ALL context the conversational coach needs, up-front and in
 * parallel, returning it ready for the model invocation.
 *
 * On a cache hit the structured analysis is returned without any re-computation
 * — the dominant latency win for a coaching session that asks many questions
 * about the same deck. On a miss the independent analyses run concurrently and
 * the result is stored for subsequent requests.
 *
 * Returns `null` when there is nothing to pre-fetch (no deck cards), so the
 * caller can fall back to a digested/legacy context path.
 */
export async function prefetchCoachContext(params: {
  deckCards?: DeckCard[];
  format: string;
  ttlMs?: number;
}): Promise<PrefetchedCoachContext | null> {
  const { deckCards, format } = params;
  if (!Array.isArray(deckCards) || deckCards.length === 0) return null;

  const ttl = params.ttlMs ?? COACH_CONTEXT_CACHE_TTL_MS;
  const key = cacheKey(deckCards, format);

  evictExpired();
  const cached = cache.get(key);
  if (cached) {
    return {
      structuredAnalysis: cached.analysis,
      structuredAnalysisText: cached.analysisText,
      archetype: cached.archetype,
      format,
      fromCache: true,
    };
  }

  const analysis = await buildStructuredDeckAnalysisParallel(deckCards);
  const analysisText = formatStructuredAnalysisForLLM(analysis);

  evictIfFull();
  cache.set(key, {
    analysis,
    analysisText,
    archetype: analysis.archetype,
    expires: clock() + ttl,
  });

  return {
    structuredAnalysis: analysis,
    structuredAnalysisText: analysisText,
    archetype: analysis.archetype,
    format,
    fromCache: false,
  };
}
