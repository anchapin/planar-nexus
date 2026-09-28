/**
 * Menace keyword enforcement tests — strict parsed-keywords contract (CR 702.110).
 *
 * Issue #2324 — evergreen keyword enforcement (menace portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "menace" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire menace via the strict check;
 *   - `evergreen-keywords.hasMenace` defers to `hasMenaceStrict` first,
 *     preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the ward / hexproof / protection pattern);
 *   - `getMenaceBlockRequirementStrict` returns 2 for a menace creature
 *     and 1 otherwise.
 */

import {
  hasMenaceStrict,
  getMenaceBlockRequirementStrict,
} from "../keyword-actions/menace";
import { hasMenace, getMenaceMinimumBlockers } from "../evergreen-keywords";
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
// (a) hasMenaceStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasMenaceStrict (CR 702.110)", () => {
  it("returns true when the parsed keywords array contains 'menace'", () => {
    const card = makeCardData({ keywords: ["menace"] });
    expect(hasMenaceStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  MENACE  "] });
    expect(hasMenaceStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'Menace' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["Menace"] });
    expect(hasMenaceStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Menace",
    });
    expect(hasMenaceStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasMenaceStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions menace but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have menace. (This creature does not.)",
    });
    expect(hasMenaceStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'menace'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "The warlord's smile carried a quiet menace that unsettled the council.",
    });
    expect(hasMenaceStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) getMenaceBlockRequirementStrict — blocker count accessor
// ─────────────────────────────────────────────────────────────────────────────

describe("getMenaceBlockRequirementStrict (CR 702.110)", () => {
  it("returns 2 when the card has menace", () => {
    const card = makeCardData({ keywords: ["menace"] });
    expect(getMenaceBlockRequirementStrict(makeInstance(card))).toBe(2);
  });

  it("returns 1 when the card does not have menace", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(getMenaceBlockRequirementStrict(makeInstance(card))).toBe(1);
  });

  it("returns 1 when the keywords array is empty", () => {
    const card = makeCardData({ keywords: [] });
    expect(getMenaceBlockRequirementStrict(makeInstance(card))).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) evergreen-keywords.hasMenace / getMenaceMinimumBlockers — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasMenace — strict-first with substring fallback (CR 702.110)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["menace"] });
    expect(hasMenace(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions menace (missing keyword tag)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Menace",
    });
    expect(hasMenace(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention menace", () => {
    const card = makeCardData({
      keywords: ["trample"],
      oracle_text: "Trample",
    });
    expect(hasMenace(makeInstance(card))).toBe(false);
  });

  it("getMenaceMinimumBlockers returns 2 for a menace creature and 1 otherwise", () => {
    const menace = makeCardData({ keywords: ["menace"] });
    expect(getMenaceMinimumBlockers(makeInstance(menace))).toBe(2);

    const plain = makeCardData({ keywords: ["trample"] });
    expect(getMenaceMinimumBlockers(makeInstance(plain))).toBe(1);
  });
});