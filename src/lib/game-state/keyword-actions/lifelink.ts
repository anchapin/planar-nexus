/**
 * Lifelink keyword (CR 702.15).
 *
 * Issue #2332 — evergreen keyword enforcement (lifelink portion).
 *
 * "Damage dealt by a source with lifelink causes its controller to gain
 * that much life."
 *
 * The canonical detection (`hasLifelink`) lives in
 * `evergreen-keywords.ts` and the gameplay wiring lives in
 * `effect-resolution.ts::applyLifelink` (the life-gain step that fires
 * after damage is dealt) and `combat/resolution.ts` (attacker and
 * blocker lifelink detection on damage assignment). Both combat sites
 * consult a substring oracle-text fallback
 * (`keywords?.includes("Lifelink") || oracle_text.toLowerCase().includes("lifelink")`)
 * that can false-positive on any card whose oracle text mentions
 * "lifelink" as a flavor word, a continuous-effect grant reference
 * ("creatures you control have lifelink"), or a non-keyword usage. They
 * also ignore the parsed `keywords` array order-of-precedence:
 * substrings can override correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`,
 * `flying.ts`, `reach.ts`, `menace.ts`, `first-strike.ts`,
 * `double-strike.ts`, `trample.ts`, `vigilance.ts`, and `deathtouch.ts`
 * for the same reason. The lifelink lifecycle — the `applyLifelink`
 * life-gain step and the damage-assignment attribution — is already
 * implemented in `effect-resolution.ts` and `combat/resolution.ts`; this
 * module does NOT re-implement that machinery. It only establishes the
 * strict-detection contract so the canonical function and the combat
 * wiring can defer to it.
 *
 * CR 702.15a: "Lifelink is a static ability."
 * CR 702.15b: "Damage dealt by a source with lifelink causes its
 * controller to gain that much life."
 *
 * Continuous-effect grants land in the granted permanent's *effective*
 * keywords (post-layer) so this strict check will correctly identify
 * them — the substring fallback is the only path that mis-identifies
 * flavor-word mentions as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.15 — strict check for the Lifelink keyword.
 *
 * True iff the parsed `keywords` array contains "lifelink" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasFirstStrikeStrict` / `hasDoubleStrikeStrict` / `hasTrampleStrict`
 * / `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlashStrict` / `hasFlyingStrict` / `hasReachStrict` /
 * `hasMenaceStrict` / `hasVigilanceStrict` / `hasDeathtouchStrict` in
 * consulting only the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasLifelink`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasLifelinkStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^lifelink\b/i.test(k.trim()));
}
