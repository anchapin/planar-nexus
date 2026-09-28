/**
 * Protection keyword (CR 702.16) — strict parsed-keywords contract.
 *
 * Issue #2296 — evergreen keyword enforcement (protection-from-color portion).
 *
 * "This permanent can't be the target of, dealt damage by, blocked by,
 * or enchanted by anything with the protected quality, and any damage
 * that would be dealt to it by a source with the protected quality is
 * prevented."
 *
 * The canonical detection lives in `evergreen-keywords.ts`
 * (`hasProtectionFrom`, `getProtectionQualities`, `isProtectedFromSource`)
 * and `targeting-validation.ts` (`hasProtectionFromColor`,
 * `getProtectionQualities`, `isProtectedFromSource`). Both still parse
 * the `protection from X` substring from oracle text exclusively,
 * ignoring the parsed `keywords` array. A card with `"protection from
 * red"` listed in `keywords` but with the substring missing from oracle
 * text (or vice-versa for continuous-effect grants) is misclassified.
 *
 * This module owns the **strict** check that consults the parsed
 * `keywords` array first, mirroring the pattern established by
 * `flash.ts`, `defender.ts`, `ward.ts`, and `hexproof.ts` for the same
 * reason. The protection lifecycle itself — `isProtectedFromSource`,
 * `canTargetCard`, `canBeEnchantedBy`, `canBeEquippedBy`, damage
 * prevention in `damage-tap.ts`, blocking restrictions in `combat/
 * queries.ts::canBlock` — is already implemented; this module only
 * establishes the strict-detection contract so the canonical functions
 * can defer to it.
 *
 * Scope note: this PR covers `protection from [color]`. Other CR 702.16b
 * sub-qualities (e.g. "protection from demons", "protection from all
 * colors") are intentionally out of scope and left as a future
 * refinement, the same way #2316 didn't add ward-from variants.
 */

import type { CardInstance } from "../types";

/** Standard MTG color names — CR 702.16 protection qualities. */
const MTG_COLORS = ["white", "blue", "black", "red", "green"] as const;

const COLOR_ABBREV_TO_FULL: Record<string, string> = {
  w: "white",
  u: "blue",
  b: "black",
  r: "red",
  g: "green",
};

/** Parse a single quality token from a `protection from X` keyword tag. */
function normalizeQuality(raw: string): string | null {
  const lowered = raw.toLowerCase().trim();
  if (MTG_COLORS.includes(lowered as (typeof MTG_COLORS)[number])) {
    return lowered;
  }
  const mapped = COLOR_ABBREV_TO_FULL[lowered];
  if (mapped) {
    return mapped;
  }
  return null;
}

/**
 * Parse the protected qualities out of a single keyword token.
 *
 * Scryfall's `keywords` array contains entries like `"protection from red"`
 * or `"protection from red and blue"` (note: the *grammar* of the keyword
 * may also include `,` separators historically — accept both " and " and
 * ", " as quality separators). Returns an array of normalized color
 * names. Empty array if the token is not a `protection from ...` keyword
 * or contains no recognized color qualities.
 */
function parseProtectionQualitiesFromKeyword(keyword: string): string[] {
  const trimmed = keyword.trim();
  const match = /^protection\s+from\s+(.+)$/i.exec(trimmed);
  if (!match) {
    return [];
  }
  const tail = match[1];
  // Split on " and " or ", " so both `protection from red and blue` and
  // historical `protection from red, blue` are supported.
  const tokens = tail.split(/\s*(?:,|\band\b)\s*/i);
  const qualities: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeQuality(token);
    if (normalized && !qualities.includes(normalized)) {
      qualities.push(normalized);
    }
  }
  return qualities;
}

/**
 * CR 702.16 — strict check for the Protection keyword, with the
 * protected color resolved from the parsed `keywords` array.
 *
 * True iff the card's parsed `keywords` array contains one or more
 * `protection from X` entries whose X set includes `color` (matched
 * case-insensitively, with W/U/B/R/G normalized to full color names).
 *
 * Deliberately bypasses the oracle-text regex fallback used by
 * `evergreen-keywords.hasProtectionFrom` so that:
 *   - a card with `["protection from red"]` in keywords but no
 *     `protection from red` substring in oracle text (e.g. a layered
 *     grant) still resolves correctly via this strict path;
 *   - a card whose oracle text *mentions* "protection from red" but
 *     does not actually carry the keyword (e.g. flavor text, a
 *     continuous-effect grant description, or a card that *gives*
 *     protection) does NOT acquire protection on its own via this
 *     strict path.
 *
 * The substring fallback for cards with missing keyword tags is
 * preserved by `evergreen-keywords.hasProtectionFrom` — it defers to
 * this strict check first, then falls through to its regex.
 */
export function hasProtectionFromColorStrict(
  card: CardInstance,
  color: string,
): boolean {
  const qualities = getProtectionQualitiesStrict(card);
  const target = normalizeQuality(color);
  if (!target) {
    return false;
  }
  return qualities.includes(target);
}

/**
 * CR 702.16 — strict variant of `getProtectionQualities`.
 *
 * Returns the set of normalized color names the card has protection
 * from, derived from the parsed `keywords` array. Empty array if no
 * `protection from X` keyword tag is present in `keywords`.
 *
 * Mirrors `getProtectionQualities` in `evergreen-keywords.ts` and
 * `targeting-validation.ts`, but consults only the parsed keyword
 * list — never the raw oracle text. The substring fallback for cards
 * with missing keyword tags is preserved by the deferred callers.
 */
export function getProtectionQualitiesStrict(card: CardInstance): string[] {
  const keywords = card.cardData.keywords ?? [];
  const qualities: string[] = [];
  for (const keyword of keywords) {
    for (const quality of parseProtectionQualitiesFromKeyword(keyword)) {
      if (!qualities.includes(quality)) {
        qualities.push(quality);
      }
    }
  }
  return qualities;
}
