/**
 * Reach keyword enforcement tests — strict parsed-keywords contract (CR 702.12).
 *
 * Issue #2324 — evergreen keyword enforcement (reach portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "reach" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire reach via the strict check;
 *   - `evergreen-keywords.hasReach` defers to `hasReachStrict` first,
 *     preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the ward / hexproof / protection pattern).
 */

import { hasReachStrict } from "../keyword-actions/reach";
import { hasReach } from "../evergreen-keywords";
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
// (a) hasReachStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasReachStrict (CR 702.12)", () => {
  it("returns true when the parsed keywords array contains 'reach'", () => {
    const card = makeCardData({ keywords: ["reach"] });
    expect(hasReachStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  REACH  "] });
    expect(hasReachStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'Reach' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["Reach"] });
    expect(hasReachStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Reach",
    });
    expect(hasReachStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasReachStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions reach but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have reach. (This creature does not.)",
    });
    expect(hasReachStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'reach'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "The ancient tree's branches reach toward the sun, tangling with clouds.",
    });
    expect(hasReachStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasReach — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasReach — strict-first with substring fallback (CR 702.12)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["reach"] });
    expect(hasReach(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions reach (missing keyword tag)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Reach",
    });
    expect(hasReach(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention reach", () => {
    const card = makeCardData({
      keywords: ["trample"],
      oracle_text: "Trample",
    });
    expect(hasReach(makeInstance(card))).toBe(false);
  });
});