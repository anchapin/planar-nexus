/**
 * AI Provider Coercion Helpers (issue #1809)
 *
 * Single source of truth for narrowing near-`AIProvider` strings to the
 * canonical union, used by every AI surface that receives a
 * provider-shaped value from an external source (route handlers, coach
 * stream consumers, etc.).
 *
 * The lenient coercion lives here explicitly. Before #1809 it was a
 * local helper inside `src/app/api/chat/route.ts` that silently coerced
 * unknown names to `'custom'` — the issue flagged this as the worst
 * variant of the prior multi-copy surface. The behavior is preserved
 * (the `CoachStreamEvent` wire contract depends on it for usage-log
 * attribution) but now lives in one place and is exhaustively tested
 * against {@link AI_PROVIDER_IDS}.
 */

import { AI_PROVIDER_IDS, type AIProvider } from "./types";

/**
 * Set view of {@link AI_PROVIDER_IDS} for `.has()` checks. Derived once
 * (module-load) rather than per-call so consumer hot paths don't pay
 * for the array → set conversion.
 */
const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set(AI_PROVIDER_IDS);

/**
 * Leniently narrow a near-`AIProvider` string to the {@link AIProvider}
 * union. Returns `'custom'` for any unrecognized value.
 *
 * Why lenient rather than strict:
 *   - The `/api/chat` route forwards usage events from the upstream
 *     `CoachStreamEvent` stream whose `event.provider` field is opaque.
 *     A typo from the producer should not become a 500-level error in
 *     the consumer; falling through to `'custom'` keeps the wire
 *     contract stable and produces a clear, observable log
 *     attribution (`provider="custom"` on the usage record).
 *   - Strict rejection would require every AI-stream producer to be
 *     machine-validated upstream, which is out of scope for this
 *     tech-debt consolidation.
 *
 * If strict rejection becomes desirable, replace this body with
 * `throw new Error(...)` and surface the failure at the call site that
 * previously tolerated the coercion.
 */
export function coerceToKnownProvider(provider: string): AIProvider {
  return KNOWN_PROVIDER_IDS.has(provider) ? (provider as AIProvider) : "custom";
}
