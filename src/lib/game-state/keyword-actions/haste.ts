/**
 * Haste keyword (CR 702.10).
 *
 * Issue #2334 — evergreen keyword enforcement (haste portion).
 *
 * "A creature with haste can attack or use abilities with the tap symbol
 * or untap symbol as though it had been under its controller's control
 * continuously since the beginning of their most recent turn."
 *
 * The canonical detection (`hasHaste`) lives in
 * `evergreen-keywords.ts` and the gameplay wiring lives in
 * `combat/queries.ts` (the summoning-sickness gate in `canAttack` and the
 * identical gate in the `getAvailableAttackers` filter). Both combat
 * sites consult an inline substring oracle-text fallback
 * (`keywords?.includes("Haste") || oracle_text.toLowerCase().includes("haste")`)
 * that can false-positive on any card whose oracle text mentions "haste"
 * as a flavor word, a continuous-effect grant reference ("creatures you
 * control have haste"), or a non-keyword usage. They also ignore the
 * parsed `keywords` array order-of-precedence: substrings can override
 * correctly-parsed absence. A false-positive haste grant silently
 * bypasses summoning sickness (CR 302.6), which is a real rules
 * divergence — the creature is allowed to attack the turn it entered.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`,
 * `flying.ts`, `reach.ts`, `menace.ts`, `first-strike.ts`,
 * `double-strike.ts`, `trample.ts`, `vigilance.ts`, `deathtouch.ts`, and
 * `lifelink.ts` for the same reason. The haste lifecycle — the
 * summoning-sickness gate itself — is already implemented in
 * `combat/queries.ts`; this module does NOT re-implement that
 * machinery. It only establishes the strict-detection contract so the
 * canonical function and the combat wiring can defer to it.
 *
 * CR 702.10a: "Haste is a static ability."
 * CR 702.10b: "A creature with haste can attack or use abilities with the
 * tap symbol or untap symbol as though it had been under its
 * controller's control continuously since the beginning of their most
 * recent turn. (See rule 302.6.)"
 *
 * Continuous-effect grants land in the granted permanent's *effective*
 * keywords (post-layer) so this strict check will correctly identify
 * them — the substring fallback is the only path that mis-identifies
 * flavor-word mentions as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.10 — strict check for the Haste keyword.
 *
 * True iff the parsed `keywords` array contains "haste" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasLifelinkStrict` / `hasDeathtouchStrict` / `hasVigilanceStrict` /
 * `hasTrampleStrict` / `hasFirstStrikeStrict` / `hasDoubleStrikeStrict`
 * / `hasMenaceStrict` / `hasFlyingStrict` / `hasReachStrict` /
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` in
 * consulting only the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasHaste` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasHasteStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^haste\b/i.test(k.trim()));
}
