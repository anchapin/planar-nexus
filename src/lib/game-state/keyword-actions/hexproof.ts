/**
 * Hexproof keyword (CR 702.11).
 *
 * Issue #2296 — evergreen keyword enforcement (hexproof portion).
 *
 * "This permanent can't be the target of spells or abilities your
 * opponents control."
 *
 * The canonical detection (`hasHexproof`) lives in `evergreen-keywords.ts`
 * and the gameplay wiring lives in `targeting-validation.ts`. Both still
 * consult a substring oracle-text fallback (`oracleText.includes("hexproof")`
 * or the broader `hasKeyword` substring search) that can false-positive on
 * any card whose oracle text mentions the word "hexproof" as a flavor word,
 * a continuous-effect grant reference ("creatures you control have
 * hexproof"), or a non-keyword usage. They also ignore the parsed
 * `keywords` array entirely in some paths.
 *
 * This module owns the **strict** check that consults ONLY the parsed
 * `keywords` array, mirroring the pattern established by `flash.ts`,
 * `defender.ts`, and `ward.ts` for the same reason. The hexproof lifecycle
 * itself — `isProtectedByHexproof`, `canTargetCard`, opponent-only gating,
 * and the controller-symmetry check — is already implemented in
 * `targeting-validation.ts`; this module does NOT re-implement that
 * machinery. It only establishes the strict-detection contract so the
 * canonical functions can defer to it.
 *
 * CR 702.11b extends hexproof to "hexproof from [quality]" (e.g. "hexproof
 * from white"). The strict contract below covers the standard `hexproof`
 * keyword; the from-variant is left as a future refinement (mirrors how
 * #2316 didn't add ward-from variants either).
 */

import type { CardInstance, PlayerId } from "../types";

/**
 * CR 702.11 — strict check for the Hexproof keyword.
 *
 * True iff the parsed `keywords` array contains "hexproof" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasFlashStrict` / `hasDefenderStrict` / `hasWardStrict` in consulting
 * only the parsed keyword list, never the raw oracle text.
 *
 * Use this when you want the canonical contract; use `hasHexproof` from
 * `evergreen-keywords` only when you also need the substring fallback
 * for cards with missing keyword tags.
 */
export function hasHexproofStrict(card: CardInstance): boolean {
  if (card.turnCreatureForm?.hexproof) return true;
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^hexproof\b/i.test(k.trim()));
}

/**
 * CR 702.11a — strict variant of `isProtectedByHexproof`.
 *
 * True iff `hasHexproofStrict(card)` AND the spell/ability source is
 * controlled by an opponent of the hexproofed permanent's controller.
 * Hexproof never triggers for the controller's own spells/abilities
 * (CR 702.11a).
 */
export function isProtectedByHexproofStrict(
  card: CardInstance,
  sourceControllerId: PlayerId,
): boolean {
  if (!hasHexproofStrict(card)) {
    return false;
  }
  return card.controllerId !== sourceControllerId;
}
