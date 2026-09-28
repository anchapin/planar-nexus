/**
 * Vigilance keyword (CR 702.2b).
 *
 * Issue #2328 — evergreen keyword enforcement (vigilance portion).
 *
 * "Attacking doesn't cause this creature to tap."
 *
 * The canonical detection (`hasVigilance`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/queries.ts::canAttack` and
 * `getAvailableAttackers` (pre-checks that a tapped creature cannot attack
 * unless it has vigilance) and `combat/declaration.ts::declareAttackers`
 * (the declaration-time tap-suppression that mirrors the CR 702.2b
 * "doesn't tap when attacking" rule). All three sites still consult a
 * substring oracle-text fallback
 * (`oracle_text.includes("vigilance")` or the broader `hasKeyword`
 * substring search) that can false-positive on any card whose oracle
 * text mentions the word "vigilance" as a flavor word, a
 * continuous-effect grant reference ("creatures you control have
 * vigilance"), or a non-keyword usage. They also ignore the parsed
 * `keywords` array order-of-precedence: substrings can override
 * correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`, `flying.ts`,
 * `reach.ts`, `menace.ts`, `first-strike.ts`, `double-strike.ts`, and
 * `trample.ts` for the same reason. The vigilance lifecycle — the
 * tap-suppression at attack declaration — is already implemented in
 * `combat/declaration.ts`; this module does NOT re-implement that
 * machinery. It only establishes the strict-detection contract so the
 * canonical functions and the combat wiring can defer to it.
 *
 * CR 702.2b: "Vigilance can be granted by an effect to a creature that
 * doesn't have it. Losing vigilance removes it from that creature
 * (permanently, unless it gains it again)." Continuous-effect grants
 * land in the granted permanent's *effective* keywords (post-layer) so
 * this strict check will correctly identify them — the substring
 * fallback is the only path that mis-identifies flavor-word mentions
 * as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.2b — strict check for the Vigilance keyword.
 *
 * True iff the parsed `keywords` array contains "vigilance" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasFlyingStrict` / `hasReachStrict` / `hasMenaceStrict` /
 * `hasFirstStrikeStrict` / `hasDoubleStrikeStrict` / `hasTrampleStrict`
 * / `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlashStrict` in consulting only the parsed keyword list, never
 * the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasVigilance`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasVigilanceStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^vigilance\b/i.test(k.trim()));
}
