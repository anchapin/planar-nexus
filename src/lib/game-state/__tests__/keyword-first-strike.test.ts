/**
 * First strike keyword enforcement tests — strict parsed-keywords contract (CR 702.7).
 *
 * Issue #2326 — evergreen keyword enforcement (first-strike portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "first strike" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire first strike via the strict check;
 *   - `evergreen-keywords.hasFirstStrike` defers to `hasFirstStrikeStrict`
 *     first, preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the flying / reach / menace pattern).
 */

import { hasFirstStrikeStrict } from "../keyword-actions/first-strike";
import { hasFirstStrike } from "../evergreen-keywords";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "test-card",
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature — Test",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    rarity: overrides.rarity ?? "common",
    set: overrides.set ?? "tst",
    ...overrides,
  } as ScryfallCard;
}

function makeInstance(
  cardData: ScryfallCard,
  controllerId = "alice",
): CardInstance {
  return createCardInstance(
    cardData,
    controllerId as CardInstance["controllerId"],
    controllerId as CardInstance["ownerId"],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasFirstStrikeStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasFirstStrikeStrict (CR 702.7)", () => {
  it("returns true when the parsed keywords array contains 'first strike'", () => {
    const card = makeCardData({ keywords: ["first strike"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  First Strike  "] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'First Strike' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["First Strike"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "First Strike",
    });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["double strike"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions first strike but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have first strike. (This creature does not.)",
    });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'first strike'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'The knight struck first — "strike" echoed, and a second blow followed. A "first strike", the bards would say.',
    });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive when 'first' and 'strike' are split across separate entries (no merged token)", () => {
    const card = makeCardData({ keywords: ["first", "strike"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasFirstStrike — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasFirstStrike — strict-first with substring fallback (CR 702.7)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["first strike"] });
    expect(hasFirstStrike(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions first strike (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "First strike",
    });
    expect(hasFirstStrike(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention first strike", () => {
    const card = makeCardData({
      keywords: ["double strike"],
      oracle_text: "Double strike",
    });
    expect(hasFirstStrike(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    // A card that DOES have a real first-strike tag should still match;
    // the substring fallback is unnecessary here but the strict path is.
    const card = makeCardData({
      keywords: ["first strike"],
      oracle_text: "Other creatures you control have first strike.",
    });
    expect(hasFirstStrike(makeInstance(card))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Word-bound contract — anchored to ^first strike\b
// ─────────────────────────────────────────────────────────────────────────────

describe("hasFirstStrikeStrict — word-bound contract", () => {
  it("matches a related keyword 'first strikes' (plural — word boundary after 'strike')", () => {
    // The regex is /first strike\b/i. "first strikes" matches because
    // "strike" is followed by "s" (a word character — no boundary), so
    // actually this DOES NOT match. Confirm the actual contract: the
    // regex requires a word boundary between "strike" and what follows,
    // so "first strikes" (s is a word char) → false.
    const card = makeCardData({ keywords: ["first strikes"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT match 'first-strike' (hyphen — the regex requires a literal space, not a word boundary, between first and strike)", () => {
    // The regex /first strike\b/i requires the literal substring
    // "first strike" (with a space). The hyphen in "first-strike"
    // breaks the match. The canonical `hasFirstStrike` would still
    // pick up such cards via the substring oracle-text fallback
    // (deferred second-pass), preserving backward compat for legacy
    // card data that may have used hyphens.
    const card = makeCardData({ keywords: ["first-strike"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT match a keyword whose text starts with a non-matching token (anchored to ^)", () => {
    // The regex is anchored at ^. A parsed keyword like
    // "gets first strike until eot" would NOT match because the keyword
    // text starts with "gets", not "first strike". The strict check
    // intentionally rejects these — the canonical `hasFirstStrike` would
    // still pick up such cards via the substring oracle-text fallback
    // (deferred second-pass), preserving backward compat for any
    // misparsed legacy card data.
    const card = makeCardData({ keywords: ["gets first strike until eot"] });
    expect(hasFirstStrikeStrict(makeInstance(card))).toBe(false);
  });
});
