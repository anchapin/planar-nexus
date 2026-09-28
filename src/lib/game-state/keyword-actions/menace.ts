/**
 * Menace keyword (CR 702.110).
 *
 * Issue #2324 — evergreen keyword enforcement (menace portion).
 *
 * "This creature can't be blocked except by two or more creatures."
 *
 * The canonical detection (`hasMenace`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `combat/declaration.ts` at the
 * block-declaration step. `hasMenace` still defers only to the generic
 * `hasKeyword` substring helper, so a card whose `keywords` is missing
 * the tag but whose oracle text mentions the word "menace" is treated
 * as having it permanently. The block-declaration wiring rejects
 * under-blocked attackers at the right moment, but a UI caller asking
 * "can this creature block?" via `combat/queries.ts::canBlock` gets
 * `canBlock: true` for a single blocker against a menace attacker, then
 * is rejected at declaration time — the pre-check should surface the
 * menace requirement so callers can prompt for a second blocker.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, `ward.ts`, `hexproof.ts`, and `protection.ts` for the
 * same reason. The menace lifecycle — the N-blocker requirement at
 * block declaration — is already implemented in
 * `combat/declaration.ts`; this module does NOT re-implement that
 * machinery. It only establishes the strict-detection contract and the
 * block-requirement accessor so the canonical functions can defer to
 * it and `combat/queries.ts::canBlock` can surface the requirement
 * upstream.
 *
 * CR 702.110a: "Menace can be granted by an effect to a creature that
 * doesn't have it." Continuous-effect grants land in the granted
 * permanent's *effective* keywords (post-layer) so this strict check
 * will correctly identify them.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.110 — strict check for the Menace keyword.
 *
 * True iff the parsed `keywords` array contains "menace" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHexproofStrict` / `hasWardStrict` / `hasDefenderStrict` /
 * `hasFlyingStrict` / `hasReachStrict` in consulting only the parsed
 * keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasMenace` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasMenaceStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^menace\b/i.test(k.trim()));
}

/**
 * CR 702.110 — strict accessor for the menace block-requirement.
 *
 * Returns the number of blockers required to legally block this
 * creature: `2` if it has menace, `1` otherwise. Useful for UI
 * pre-checks (e.g. `combat/queries.ts::canBlock`) that want to surface
 * the requirement before block declaration.
 */
export function getMenaceBlockRequirementStrict(card: CardInstance): 1 | 2 {
  return hasMenaceStrict(card) ? 2 : 1;
}