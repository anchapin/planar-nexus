/**
 * Prowess keyword action (CR 702.108): the "Whenever you cast a noncreature
 * spell, this creature gets +1/+1 until end of turn" triggered ability.
 *
 * Issue #2344 — evergreen keyword enforcement (prowess).
 *
 * Before this change, prowess was gated *only* through
 * `evergreen-keywords.hasProwess` -> `hasKeyword(card, "prowess")`, and
 * `hasKeyword` resolves as
 *
 *     keywords.some(exact) || oracleText.includes("prowess")
 *
 * The second arm is an **unanchored substring** test. Its sole production
 * consumer is the trigger-detection path:
 *
 *     spell-casting/cast.ts -> trigger-system/spell-triggers.ts
 *         detectProwessTriggers() -> hasProwess() -> hasKeyword()
 *
 * which then stamps the bonus on via `applyProwessBoost`, feeding the layer-7
 * power/toughness read. So a creature whose `keywords` array omits the tag but
 * whose oracle text merely *contains* the substring `prowess` was wrongly
 * granted the +1/+1. Measured against `96710c25`, `includes("prowess")`
 * matches inside `prowesses` and `unprowess`, not just the standalone keyword
 * — a direct divergence from the correctly anchored `parseProwess` in
 * `oracle-text-parser/casting-keywords.ts`, which proves the substring arm is
 * wrong rather than merely permissive.
 *
 * `hasProwessStrict` below establishes the canonical contract — consult ONLY
 * the parsed `keywords` array — mirroring `hasHasteStrict`, `hasShroudStrict`,
 * `hasPersistStrict`, and the other strict checks in this directory.
 *
 * This module is a **pure leaf**: it does not import `evergreen-keywords`, so
 * the `evergreen-keywords.ts <-> keyword-actions/prowess.ts` reference stays
 * a one-way edge and no module cycle is introduced. (`persist.ts` is the
 * exception in this directory, because it genuinely needs `hasPersist` /
 * `canPersistTrigger`.)
 */
import type { CardInstance } from "../types";

/**
 * CR 702.108 — strict check for the Prowess keyword.
 *
 * True iff the parsed `keywords` array contains "prowess" as a
 * case-insensitive, whitespace-trimmed standalone token. Mirrors
 * `hasHasteStrict` / `hasShroudStrict` / `hasPersistStrict` in consulting only
 * the parsed keyword list, never the raw oracle text.
 *
 * The word-boundary anchor matters: a keyword entry of "prowesses" is a
 * *mention*, not the keyword, and must not grant prowess.
 */
export function hasProwessStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => /^prowess\b/i.test(k.trim()));
}
