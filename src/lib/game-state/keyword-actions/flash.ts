/**
 * Flash keyword (CR 702.8).
 *
 * Issue #2293 — evergreen keyword enforcement (flash portion).
 *
 * "You may cast this card any time you could cast an instant."
 *
 * The canonical detection (`hasFlash`) lives in `evergreen-keywords.ts`;
 * this module owns the **timing-permission decision** and the fix to the
 * previous substring-search bug where any card with the literal word
 * "flash" in its oracle text — e.g. a card with the *Flashback* ability —
 * was incorrectly granted flash. The substring search lived inline in
 * `spell-casting/cast.ts` and `validation-service.ts`; both now delegate
 * to the canonical keyword-list check via `canCastAtInstantSpeed()` below.
 *
 * Decision function is exposed so callers can ask "would flash permit this
 * cast right now?" without re-implementing the timing rules.
 */

import type { CardInstance } from "../types";

/**
 * CR 702.8 — returns true iff the card may be cast at instant speed.
 *
 * True for:
 *   - instants (already instant-speed by type);
 *   - any card with the Flash keyword (regardless of card type, EXCEPT
 *     sorceries — a sorcery with flash would be a contradiction; we still
 *     honour the type-line so a hypothetical "Sorcery — Flash" card would
 *     not be incorrectly promoted).
 *
 * Replaces the previous `oracleText.toLowerCase().includes("flash")`
 * check, which false-positived on Flashback and any other oracle text
 * containing the substring "flash".
 *
 * Note: we deliberately consult only the parsed `keywords` array — not the
 * raw oracle text — so a card with the substring "flash" anywhere in
 * oracle_text (e.g. "flashback", "flashes", flavor text) does NOT acquire
 * flash. This matches the canonical keyword-list contract used by the
 * rest of the engine (cf. `evergreen-keywords.hasKeyword`, which still
 * retains the substring fallback for cards with missing keyword tags;
 * that fallback is intentionally NOT consulted here).
 */
export function canCastAtInstantSpeed(card: CardInstance): boolean {
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (typeLine.includes("sorcery")) {
    // Sorceries are sorcery-speed by definition; flash on a sorcery
    // would be a rules contradiction. Honoured as a no-op.
    return false;
  }
  if (typeLine.includes("instant")) {
    return true;
  }
  const keywords = (card.cardData.keywords ?? []).map((k) => k.toLowerCase());
  return keywords.includes("flash");
}

/**
 * Returns true iff the card has the Flash keyword listed in its parsed
 * keyword array. Bypasses the substring oracle-text fallback in
 * `evergreen-keywords.hasKeyword` so that "flashback" / "flashes" do NOT
 * grant flash.
 */
export function hasFlash(card: CardInstance): boolean {
  const keywords = (card.cardData.keywords ?? []).map((k) => k.toLowerCase());
  return keywords.includes("flash");
}
