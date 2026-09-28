/**
 * Shroud keyword (CR 702.18).
 *
 * Issue #2336 — evergreen keyword enforcement (shroud portion).
 *
 * "This permanent can't be the target of spells or abilities your opponents
 * control."
 *
 * CR 702.18a: "A permanent with shroud can't be the target of spells or
 * abilities."
 *
 * Shroud — unlike hexproof — applies to *everyone*, not just opponents.
 * There is no controller-symmetry escape hatch, which is why the strict
 * contract below is a plain boolean with no source-controller argument
 * (contrast `isProtectedByHexproofStrict`, which needs one).
 *
 * Shroud is detected in **two divergent places**, and before this change
 * neither consulted the parsed `keywords` array canonically:
 *
 *   1. `evergreen-keywords.hasShroud` used the bare `hasKeyword` helper,
 *      which resolves as `oracleText.includes("shroud")` — an *unanchored*
 *      substring match. It false-positives on any card whose oracle text
 *      merely mentions shroud ("creatures your opponents control lose
 *      shroud", a continuous-effect grant reference) rather than carrying
 *      the keyword itself.
 *
 *   2. `targeting-validation.hasShroud` — the copy actually used by the
 *      live targeting pipeline via `canTargetCard` — tested a word-bound
 *      regex against `oracle_text` and **never read
 *      `card.cardData.keywords` at all**. That is a genuine false
 *      *negative*: a permanent carrying `keywords: ["Shroud"]`, or one
 *      that acquired shroud through a layer-applied continuous-effect
 *      grant (the standard path for granted keywords in this engine),
 *      but whose oracle text does not literally contain the word
 *      "Shroud", was treated as fully targetable. A shroud permanent
 *      being legally targeted is a hard rules violation.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, `protection.ts`, `flying.ts`,
 * `reach.ts`, `menace.ts`, `first-strike.ts`, `double-strike.ts`,
 * `trample.ts`, `vigilance.ts`, `deathtouch.ts`, `lifelink.ts`, and
 * `haste.ts` for the same reason. The shroud lifecycle — the targeting
 * gate in `canTargetCard` — is already implemented in
 * `targeting-validation.ts`; this module does NOT re-implement that
 * machinery. It only establishes the strict-detection contract so both
 * canonical functions can defer to it.
 *
 * Continuous-effect grants land in the granted permanent's *effective*
 * keywords (post-layer) so this strict check will correctly identify
 * them — the substring fallbacks are the only paths that can
 * mis-identify a flavor-word mention as a real grant.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.18 — strict check for the Shroud keyword.
 *
 * True iff the parsed `keywords` array contains "shroud" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHasteStrict` / `hasLifelinkStrict` / `hasHexproofStrict` /
 * `hasFlashStrict` / `hasWardStrict` in consulting only the parsed
 * keyword list, never the raw oracle text.
 *
 * Note the deliberate asymmetry with `hasShroud`: this function answers
 * "does this permanent have shroud?" (a property of the permanent), not
 * "can this source target it?" — per CR 702.18a, shroud blocks everyone.
 *
 * Use this when you want the canonical contract; use `hasShroud` from
 * `evergreen-keywords` or `targeting-validation` only when you also need
 * the substring fallback for cards with missing keyword tags.
 */
export function hasShroudStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^shroud\b/i.test(k.trim()));
}
