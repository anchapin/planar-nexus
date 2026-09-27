/**
 * Defender keyword (CR 702.13).
 *
 * Issue #2293 — evergreen keyword enforcement (defender portion).
 *
 * "This creature can't attack."
 *
 * The canonical detection (`hasDefender`) lives in `evergreen-keywords.ts`,
 * but it still consults the substring oracle-text fallback via `hasKeyword`,
 * which can false-positive on any card whose oracle text mentions the word
 * "defender" (e.g. cards that give other creatures defender, or cards with
 * flavor text containing the word). This module owns the **strict** check
 * that consults ONLY the parsed `keywords` array, mirroring the pattern used
 * by `flash.ts` for the same reason.
 *
 * This decision function is wired into `combat/queries.ts::canAttack` and
 * `getAvailableAttackers` so that any creature with the defender keyword is
 * rejected at attack declaration. The fix closes a real bug where a "Wall of
 * Wood" (or any defender creature) could currently be declared as an attacker.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.13 — strict check for the Defender keyword.
 *
 * True iff the parsed `keywords` array contains "defender" (case-insensitive).
 *
 * Deliberately bypasses the substring oracle-text fallback in
 * `evergreen-keywords.hasKeyword` so that a card with the substring
 * "defender" anywhere in oracle_text (e.g. "creatures you control have
 * defender", flavor text, or a continuous-effect grant) does NOT acquire
 * defender on its own. This matches the canonical keyword-list contract
 * used by `flash.ts::canCastAtInstantSpeed` and the rest of the engine.
 *
 * Note: when a layer effect legitimately grants defender to another
 * permanent (e.g. "Other creatures you control have defender"), the
 * granted permanent's *effective* keywords (post-layer) will include
 * "defender" and this check will correctly identify it as a defender.
 */
export function hasDefenderStrict(card: CardInstance): boolean {
  const keywords = card.cardData.keywords ?? [];
  return keywords.some((k) => k.toLowerCase() === "defender");
}

/**
 * CR 702.13 — returns true iff the card is eligible to attack, ignoring
 * unrelated constraints (tapped, summoning sickness, etc.). A creature with
 * the defender keyword (per the strict check) cannot attack.
 *
 * This is the decision function wired into `combat/queries.ts` to enforce
 * CR 702.13 at attack declaration. Mirrors the role of
 * `flash.canCastAtInstantSpeed` — the engine-layer gate that decides whether
 * a given card may participate in the attack phase.
 */
export function canAttackAsNonDefender(card: CardInstance): boolean {
  return !hasDefenderStrict(card);
}
