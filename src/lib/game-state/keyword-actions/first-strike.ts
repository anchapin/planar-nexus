/**
 * First strike keyword (CR 702.7).
 *
 * Issue #2326 — evergreen keyword enforcement (first-strike portion).
 *
 * "This creature deals combat damage before creatures without first strike."
 *
 * The canonical detection (`hasFirstStrike`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/declaration.ts` (per-attacker /
 * per-blocker tag) and `combat/resolution.ts` (first-strike damage step
 * ordering). All three sites still consult a substring oracle-text fallback
 * (`oracle_text.includes("first strike")` or the broader `hasKeyword`
 * substring search) that can false-positive on any card whose oracle text
 * mentions the word "first strike" as a flavor word, a continuous-effect
 * grant reference ("creatures you control have first strike"), or a
 * non-keyword usage. They also ignore the parsed `keywords` array
 * order-of-precedence: substrings can override correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`, `flying.ts`,
 * `reach.ts`, and `menace.ts` for the same reason. The first-strike
 * lifecycle — damage-step ordering, double-strike double-deal, and the
 * first-strike-only creatures that do NOT deal damage in the regular
 * step — is already implemented in `combat/resolution.ts`; this module
 * does NOT re-implement that machinery. It only establishes the
 * strict-detection contract so the canonical functions and the combat
 * wiring can defer to it.
 *
 * CR 702.7a: "First strike can be granted by an effect to a creature that
 * doesn't have it. Losing first strike removes it from that creature
 * (permanently, unless it gains it again)." Continuous-effect grants
 * land in the granted permanent's *effective* keywords (post-layer) so
 * this strict check will correctly identify them — the substring
 * fallback is the only path that mis-identifies flavor-word mentions
 * as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.7 — strict check for the First Strike keyword.
 *
 * True iff the parsed `keywords` array contains "first strike" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlyingStrict` / `hasReachStrict` / `hasMenaceStrict` in consulting
 * only the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasFirstStrike`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasFirstStrikeStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^first strike\b/i.test(k.trim()));
}
