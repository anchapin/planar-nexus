/**
 * Double strike keyword (CR 702.4).
 *
 * Issue #2326 — evergreen keyword enforcement (double-strike portion).
 *
 * "This creature deals both first-strike and regular combat damage."
 *
 * The canonical detection (`hasDoubleStrike`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/declaration.ts` (per-attacker /
 * per-blocker tag) and `combat/resolution.ts` (damage-step ordering:
 * double-strikers deal in BOTH the first-strike step and the regular step).
 * All three sites still consult a substring oracle-text fallback
 * (`oracle_text.includes("double strike")` or the broader `hasKeyword`
 * substring search) that can false-positive on any card whose oracle text
 * mentions the phrase "double strike" as a flavor word, a continuous-effect
 * grant reference ("creatures you control have double strike"), or a
 * non-keyword usage. They also ignore the parsed `keywords` array
 * order-of-precedence: substrings can override correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`, `flying.ts`,
 * `reach.ts`, and `menace.ts` for the same reason. The double-strike
 * lifecycle — surviving double-strikers dealing damage in BOTH steps,
 * and dead double-strikers being excluded from the regular step per
 * CR 510.1c — is already implemented in `combat/resolution.ts`; this
 * module does NOT re-implement that machinery. It only establishes the
 * strict-detection contract so the canonical functions and the combat
 * wiring can defer to it.
 *
 * CR 702.4a: "Double strike can be granted by an effect to a creature
 * that doesn't have it. Losing double strike removes it from that
 * creature (permanently, unless it gains it again)." Continuous-effect
 * grants land in the granted permanent's *effective* keywords (post-layer)
 * so this strict check will correctly identify them — the substring
 * fallback is the only path that mis-identifies flavor-word mentions
 * as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.4 — strict check for the Double Strike keyword.
 *
 * True iff the parsed `keywords` array contains "double strike" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlyingStrict` / `hasReachStrict` / `hasMenaceStrict` /
 * `hasFirstStrikeStrict` in consulting only the parsed keyword list,
 * never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasDoubleStrike`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasDoubleStrikeStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^double strike\b/i.test(k.trim()));
}
