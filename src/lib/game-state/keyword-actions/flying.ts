/**
 * Flying keyword (CR 702.9).
 *
 * Issue #2324 — evergreen keyword enforcement (flying portion).
 *
 * "This creature can't be blocked except by creatures with flying or reach."
 *
 * The canonical detection (`hasFlying`) lives in `evergreen-keywords.ts` and
 * the gameplay wiring lives in `combat/queries.ts::canBlock`. Both still
 * consult a substring oracle-text fallback (`oracle_text.includes("flying")`
 * or the broader `hasKeyword` substring search) that can false-positive on
 * any card whose oracle text mentions the word "flying" as a flavor word,
 * a continuous-effect grant reference ("creatures you control have flying"),
 * or a non-keyword usage. They also ignore the parsed `keywords` array
 * order-of-precedence: substrings can override correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, and `protection.ts` for the
 * same reason. The flying lifecycle — evasion against ground-blockers,
 * the flying-vs-flying interaction, and the reach-exception — is already
 * implemented in `combat/queries.ts::canBlock`; this module does NOT
 * re-implement that machinery. It only establishes the strict-detection
 * contract so the canonical functions can defer to it.
 *
 * CR 702.9a: "Flying can be granted by an effect to a creature that
 * doesn't have it. Losing flying removes it from that creature
 * (permanently, unless it gains it again)." Continuous-effect grants
 * land in the granted permanent's *effective* keywords (post-layer) so
 * this strict check will correctly identify them — the substring
 * fallback is the only path that mis-identifies flavor-word mentions
 * as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.9 — strict check for the Flying keyword.
 *
 * True iff the parsed `keywords` array contains "flying" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` in
 * consulting only the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasFlying` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasFlyingStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^flying\b/i.test(k.trim()));
}