/**
 * Flying keyword enforcement tests — strict parsed-keywords contract (CR 702.9).
 *
 * Issue #2324 — evergreen keyword enforcement (flying portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "flying" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire flying via the strict check;
 *   - `evergreen-keywords.hasFlying` defers to `hasFlyingStrict` first,
 *     preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the ward / hexproof / protection pattern).
 */

import { hasFlyingStrict } from "../keyword-actions/flying";
import { hasFlying } from "../evergreen-keywords";
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
// (a) hasFlyingStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasFlyingStrict (CR 702.9)", () => {
  it("returns true when the parsed keywords array contains 'flying'", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasFlyingStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  FLYING  "] });
    expect(hasFlyingStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'Flying' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["Flying"] });
    expect(hasFlyingStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flying",
    });
    expect(hasFlyingStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["reach"] });
    expect(hasFlyingStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions flying but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have flying. (This creature does not.)",
    });
    expect(hasFlyingStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'flying'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'As the hawk took flight, its wings seemed almost too large for its body. "Flying" is too gentle a word.',
    });
    expect(hasFlyingStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasFlying — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasFlying — strict-first with substring fallback (CR 702.9)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasFlying(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions flying (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flying",
    });
    expect(hasFlying(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention flying", () => {
    const card = makeCardData({
      keywords: ["trample"],
      oracle_text: "Trample",
    });
    expect(hasFlying(makeInstance(card))).toBe(false);
  });
});