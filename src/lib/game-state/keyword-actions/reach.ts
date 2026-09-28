/**
 * Reach keyword (CR 702.12).
 *
 * Issue #2324 — evergreen keyword enforcement (reach portion).
 *
 * "This creature can block creatures with flying as though they didn't
 * have flying."
 *
 * The canonical detection (`hasReach`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/queries.ts::canBlock`. Both
 * still consult a substring oracle-text fallback
 * (`oracle_text.includes("reach")` or the broader `hasKeyword` substring
 * search) that can false-positive on any card whose oracle text mentions
 * the word "reach" as a flavor word, a continuous-effect grant reference
 * ("creatures you control have reach"), or a non-keyword usage.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, and `protection.ts` for the
 * same reason. The reach lifecycle — the reach-exception to flying
 * evasion — is already implemented in `combat/queries.ts::canBlock`;
 * this module does NOT re-implement that machinery. It only establishes
 * the strict-detection contract so the canonical functions can defer
 * to it.
 *
 * CR 702.12a: "Reach can be granted by an effect to a creature that
 * doesn't have it. Losing reach removes it from that creature
 * (permanently, unless it gains it again)." Continuous-effect grants
 * land in the granted permanent's *effective* keywords (post-layer) so
 * this strict check will correctly identify them.
 *
 * Note: CR 702.9b clarifies that a creature with both flying and
 * reach "ignores the flying evasion of any creature it blocks." This
 * strict check is just a tag-presence test; the "ignores evasion"
 * semantics are still implemented in `combat/queries.ts::canBlock`.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.12 — strict check for the Reach keyword.
 *
 * True iff the parsed `keywords` array contains "reach" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlyingStrict` in consulting only the parsed keyword list, never
 * the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasReach` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasReachStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^reach\b/i.test(k.trim()));
}