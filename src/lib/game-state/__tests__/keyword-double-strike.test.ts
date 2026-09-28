/**
 * Double strike keyword enforcement tests — strict parsed-keywords contract (CR 702.4).
 *
 * Issue #2326 — evergreen keyword enforcement (double-strike portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "double strike" (e.g. as a flavor word, a grant effect, or a
 *     non-keyword usage) must NOT acquire double strike via the strict check;
 *   - `evergreen-keywords.hasDoubleStrike` defers to `hasDoubleStrikeStrict`
 *     first, preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the flying / reach / menace pattern).
 */

import { hasDoubleStrikeStrict } from "../keyword-actions/double-strike";
import { hasDoubleStrike } from "../evergreen-keywords";
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
// (a) hasDoubleStrikeStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasDoubleStrikeStrict (CR 702.4)", () => {
  it("returns true when the parsed keywords array contains 'double strike'", () => {
    const card = makeCardData({ keywords: ["double strike"] });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Double Strike  "] });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'Double Strike' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["Double Strike"] });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Double Strike",
    });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["first strike"] });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions double strike but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have double strike. (This creature does not.)",
    });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'double strike'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'The general struck twice in rapid succession. "A double strike!" the herald cried.',
    });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive when 'double' and 'strike' are split across separate entries (no merged token)", () => {
    const card = makeCardData({ keywords: ["double", "strike"] });
    expect(hasDoubleStrikeStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasDoubleStrike — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasDoubleStrike — strict-first with substring fallback (CR 702.4)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["double strike"] });
    expect(hasDoubleStrike(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions double strike (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Double strike",
    });
    expect(hasDoubleStrike(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention double strike", () => {
    const card = makeCardData({
      keywords: ["first strike"],
      oracle_text: "First strike",
    });
    expect(hasDoubleStrike(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    const card = makeCardData({
      keywords: ["double strike"],
      oracle_text: "Other creatures you control have double strike.",
    });
    expect(hasDoubleStrike(makeInstance(card))).toBe(true);
  });
});
