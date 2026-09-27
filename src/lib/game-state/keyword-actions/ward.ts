/**
 * Ward keyword (CR 702.21).
 *
 * Issue #2315 — evergreen keyword enforcement (ward portion).
 *
 * "Whenever this permanent becomes the target of a spell or ability an
 * opponent controls, counter that spell or ability unless its controller
 * pays [cost]."
 *
 * The canonical detection (`hasWard`) lives in `evergreen-keywords.ts`,
 * but it still consults a word-bounded oracle-text fallback
 * (`\bward\b`) for cards whose `keywords` array is missing the tag.
 * That fallback can false-positive on cards whose oracle text happens to
 * contain the standalone word "ward" (flavor text, reminder text, etc.).
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern used by `flash.ts` and
 * `defender.ts` for the same reason.
 *
 * The ward lifecycle itself — trigger detection, payment, and resolution
 * — is already implemented in `ward-system.ts` and wired into
 * `spell-casting/resolve.ts::resolveTopOfStack`. This module does NOT
 * re-implement that machinery; it only establishes the strict
 * detection contract so `evergreen-keywords.hasWard` can defer to it
 * as its canonical source.
 *
 * CR 702.21 has no per-turn cooldown: ward fires every time the
 * permanent becomes the target of an opponent's spell/ability. (The
 * "first time per turn" rule was incorrectly attributed to 702.21b in
 * the original plan; that subsection does not exist in the ward rule.)
 */

import type { CardInstance, PlayerId } from "../types";

/**
 * CR 702.21 — strict check for the Ward keyword.
 *
 * True iff the parsed `keywords` array contains "ward" as a standalone
 * token (case-insensitive). Mirrors `hasFlashStrict` and
 * `hasDefenderStrict` in consulting only the parsed keyword list, never
 * the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasWard` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasWardStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^ward\b/i.test(k.trim()));
}

/**
 * CR 702.21 — strict variant of `isProtectedByWard`.
 *
 * True iff `hasWardStrict(card)` AND the spell/ability source is
 * controlled by an opponent of the warded permanent's controller.
 * Ward never triggers for the controller's own spells/abilities
 * (CR 702.21a).
 */
export function isProtectedByWardStrict(
  card: CardInstance,
  sourceControllerId: PlayerId,
): boolean {
  if (!hasWardStrict(card)) {
    return false;
  }
  return card.controllerId !== sourceControllerId;
}
