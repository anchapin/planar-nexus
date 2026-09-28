/**
 * Trample keyword (CR 702.3).
 *
 * Issue #2326 — evergreen keyword enforcement (trample portion).
 *
 * "This creature can deal excess combat damage to the player or
 * planeswalker it's attacking."
 *
 * The canonical detection (`hasTrample`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/resolution.ts` (excess-damage
 * overflow after blocker damage is assigned). Both still consult a
 * substring oracle-text fallback (`oracle_text.includes("trample")` or
 * the broader `hasKeyword` substring search) that can false-positive on
 * any card whose oracle text mentions the word "trample" as a flavor
 * word, a continuous-effect grant reference ("creatures you control have
 * trample"), or a non-keyword usage. They also ignore the parsed
 * `keywords` array order-of-precedence: substrings can override
 * correctly-parsed absence.
 *
 * This is the highest-risk remaining keyword in Epic #2300 because
 * trample overflow is computed in the only path in the engine that
 * assigns per-blocker damage on a multi-blocker attacker. The same
 * substring anti-pattern as the prior plans (flying / reach / menace,
 * etc.) exists here. The deathtouch-trample interaction (CR 702.2b–d:
 * deathtouch turns any nonzero damage from a blocker into lethal, so
 * trample excess math flips from "leftover ≥ blockerToughness" to
 * "leftover > 0") is partially wired in `getExcessTrampleDamage` and
 * needs explicit unit coverage to pin the contract.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`, `flying.ts`,
 * `reach.ts`, and `menace.ts` for the same reason. The trample
 * lifecycle — blocker-damage-then-excess-overflow against the defender
 * (player or planeswalker), and the deathtouch-trample interaction —
 * is already implemented in `combat/resolution.ts` and
 * `evergreen-keywords.getExcessTrampleDamage`; this module does NOT
 * re-implement that machinery. It only establishes the strict-detection
 * contract so the canonical functions and the combat wiring can defer
 * to it.
 *
 * CR 702.3a: "Trample can be granted by an effect to a creature that
 * doesn't have it. Losing trample removes it from that creature
 * (permanently, unless it gains it again)." Continuous-effect grants
 * land in the granted permanent's *effective* keywords (post-layer) so
 * this strict check will correctly identify them — the substring
 * fallback is the only path that mis-identifies flavor-word mentions
 * as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.3 — strict check for the Trample keyword.
 *
 * True iff the parsed `keywords` array contains "trample" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlyingStrict` / `hasReachStrict` / `hasMenaceStrict` /
 * `hasFirstStrikeStrict` / `hasDoubleStrikeStrict` in consulting only
 * the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasTrample`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasTrampleStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^trample\b/i.test(k.trim()));
}
