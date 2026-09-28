/**
 * Deathtouch keyword (CR 702.2).
 *
 * Issue #2330 — evergreen keyword enforcement (deathtouch portion).
 *
 * "Any nonzero amount of damage assigned to a creature by a source with
 * deathtouch is sufficient to destroy it."
 *
 * The canonical detection (`hasDeathtouch`) lives in
 * `evergreen-keywords.ts` and the gameplay wiring lives in
 * `isLethalDamage` (the >0 damage gate that deathtouch unlocks),
 * `combat/resolution.ts::getExcessTrampleDamage` (the
 * trample-LethalGuard interaction pinned by #2326), and
 * `combat/resolution.ts` (attacker / blocker deathtouch detection on
 * damage assignment). All sites still consult a substring oracle-text
 * fallback (`hasKeyword(card, "deathtouch")` substring search) that can
 * false-positive on any card whose oracle text mentions "deathtouch" as
 * a flavor word, a continuous-effect grant reference ("creatures you
 * control have deathtouch"), or a non-keyword usage. They also ignore
 * the parsed `keywords` array order-of-precedence: substrings can
 * override correctly-parsed absence.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`,
 * `flying.ts`, `reach.ts`, `menace.ts`, `first-strike.ts`,
 * `double-strike.ts`, `trample.ts`, and `vigilance.ts` for the same
 * reason. The deathtouch lifecycle — the `isLethalDamage` >0 collapse,
 * the trample `getExcessTrampleDamage` interaction, and the
 * damage-assignment attribution — is already implemented in
 * `combat/resolution.ts` and `keyword-actions/damage-tap.ts`; this
 * module does NOT re-implement that machinery. It only establishes the
 * strict-detection contract so the canonical function and the combat
 * wiring can defer to it.
 *
 * CR 702.2a: "Deathtouch is a static ability."
 * CR 702.2b: "A creature with deathtouch (CR 113.3d) deals damage to
 * creatures as though it were marked with lethal damage."
 * CR 702.2c: "Any nonzero amount of damage assigned to a creature by a
 * source with deathtouch is sufficient to destroy it."
 *
 * Continuous-effect grants land in the granted permanent's *effective*
 * keywords (post-layer) so this strict check will correctly identify
 * them — the substring fallback is the only path that mis-identifies
 * flavor-word mentions as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.2 — strict check for the Deathtouch keyword.
 *
 * True iff the parsed `keywords` array contains "deathtouch" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasFirstStrikeStrict` / `hasDoubleStrikeStrict` / `hasTrampleStrict`
 * / `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlashStrict` / `hasFlyingStrict` / `hasReachStrict` /
 * `hasMenaceStrict` / `hasVigilanceStrict` in consulting only the
 * parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasDeathtouch`
 * from `evergreen-keywords` only when you also need the substring
 * fallback for cards with missing keyword tags.
 */
export function hasDeathtouchStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^deathtouch\b/i.test(k.trim()));
}
