/**
 * Case-insensitive keyword helpers for AI layer.
 *
 * Scryfall's `keywords` array is title-case (e.g., "Indestructible",
 * "Deathtouch", "Flying"), but the AI layer was checking with lower-case
 * literals (e.g., `keywords?.includes("indestructible")`), which always
 * returned false for real Scryfall-sourced data.
 *
 * These helpers perform case-insensitive, whitespace-trimmed keyword checks
 * on `AIPermanent.keywords` (the AI's simplified representation). They mirror
 * the engine's strict-check pattern from `evergreen-keywords.ts` and
 * `keyword-actions/indestructible.ts`. A local copy is used instead of the
 * engine helpers because those take `CardInstance`, not `AIPermanent`.
 *
 * Issue #2355: AI layer 14 case-sensitive indestructible checks are live
 * false negatives (AI is blind to indestructible).
 */

import type { AIPermanent } from "@/lib/game-state";

/**
 * Check if a permanent has a keyword (case-insensitive).
 * Returns false if keywords is undefined.
 */
function hasKeyword(permanent: AIPermanent, keyword: string): boolean {
  return (
    permanent.keywords?.some((k) =>
      new RegExp(`^${keyword}\\b`, "i").test(k.trim()),
    ) ?? false
  );
}

// ============== INDESTRUCTIBLE (CR 702.12) ==============
/**
 * Check if a creature is indestructible.
 * CR 702.12a: "Can't be destroyed."
 */
export function hasIndestructible(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "indestructible");
}

// ============== DEATHTOUCH (CR 702.2) ==============
/**
 * Check if a creature has deathtouch.
 * CR 702.2b: "Any nonzero amount of damage assigned to a creature by a
 * source with deathtouch is sufficient to destroy it."
 */
export function hasDeathtouch(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "deathtouch");
}

// ============== TRAMPLE (CR 702.19) ==============
/**
 * Check if a creature has trample.
 * CR 702.19: "Trample"
 */
export function hasTrample(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "trample");
}

// ============== FLYING (CR 702.9) ==============
/**
 * Check if a creature has flying.
 * CR 702.9: "Flying"
 */
export function hasFlying(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "flying");
}

// ============== FIRST STRIKE (CR 702.7) ==============
/**
 * Check if a creature has first strike.
 * CR 702.7: "First strike"
 */
export function hasFirstStrike(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "first strike");
}

// ============== DOUBLE STRIKE (CR 702.4) ==============
/**
 * Check if a creature has double strike.
 * CR 702.4: "Double strike"
 */
export function hasDoubleStrike(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "double strike");
}

// ============== MENACE (CR 702.11) ==============
/**
 * Check if a creature has menace.
 * CR 702.11: "Menace"
 */
export function hasMenace(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "menace");
}

// ============== HASTE (CR 702.10) ==============
/**
 * Check if a creature has haste.
 * CR 702.10: "Haste"
 */
export function hasHaste(permanent: AIPermanent): boolean {
  return hasKeyword(permanent, "haste");
}
