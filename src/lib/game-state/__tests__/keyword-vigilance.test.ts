/**
 * Vigilance keyword enforcement tests — strict parsed-keywords contract (CR 702.2b).
 *
 * Issue #2328 — evergreen keyword enforcement (vigilance portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "vigilance" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire vigilance via the strict check;
 *   - `evergreen-keywords.hasVigilance` defers to `hasVigilanceStrict`
 *     first, preserving the substring fallback only for cards with
 *     missing keyword tags (mirrors the flying / reach / menace /
 *     first-strike / double-strike / trample pattern);
 *   - `tapsWhenAttacking` (the canonical "does this creature tap when
 *     it attacks" accessor) inverts the canonical `hasVigilance` and
 *     therefore inherits the strict-first contract.
 *
 * CR 702.2b: "Attacking doesn't cause this creature to tap." The tap
 * suppression at attack declaration is wired in
 * `combat/declaration.ts::declareAttackers` (covered by
 * `combat-vigilance.test.ts`).
 */

import { hasVigilanceStrict } from "../keyword-actions/vigilance";
import { hasVigilance, tapsWhenAttacking } from "../evergreen-keywords";
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
    power: overrides.power ?? "1",
    toughness: overrides.toughness ?? "1",
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
// (a) hasVigilanceStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasVigilanceStrict (CR 702.2b)", () => {
  it("returns true when the parsed keywords array contains 'vigilance'", () => {
    const card = makeCardData({ keywords: ["vigilance"] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Vigilance  "] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'VIGILANCE' (all caps) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["VIGILANCE"] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Vigilance",
    });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions vigilance but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have vigilance. (This creature does not.)",
    });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'vigilance'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'The night watchman kept his vigil with unwavering vigilance, his eyes never leaving the wall. "Vigilance" was his watchword.',
    });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(false);
  });

  it("matches 'vigilance' alongside other keywords (e.g. ['Flying', 'Vigilance'])", () => {
    const card = makeCardData({ keywords: ["Flying", "Vigilance"] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the keyword is a substring of a different keyword (word-bound check)", () => {
    // "hypervigilance" contains "vigilance" as a substring but is not the
    // vigilance keyword. The strict check must use a word-bound regex.
    const card = makeCardData({ keywords: ["hypervigilance"] });
    expect(hasVigilanceStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasVigilance — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasVigilance — strict-first with substring fallback (CR 702.2b)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["vigilance"] });
    expect(hasVigilance(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions vigilance (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Vigilance",
    });
    expect(hasVigilance(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention vigilance", () => {
    const card = makeCardData({
      keywords: ["flying"],
      oracle_text: "Flying",
    });
    expect(hasVigilance(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    const card = makeCardData({
      keywords: ["vigilance"],
      oracle_text: "Other creatures you control have vigilance.",
    });
    expect(hasVigilance(makeInstance(card))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) tapsWhenAttacking — inverts canonical hasVigilance
// ─────────────────────────────────────────────────────────────────────────────

describe("tapsWhenAttacking — inherits the strict-first contract", () => {
  it("returns false (no tap) when the card has the vigilance keyword tag", () => {
    const card = makeCardData({ keywords: ["vigilance"] });
    expect(tapsWhenAttacking(makeInstance(card))).toBe(false);
  });

  it("returns true (tap on attack) when the card lacks the vigilance keyword tag", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(tapsWhenAttacking(makeInstance(card))).toBe(true);
  });

  it("returns true when the keywords array is empty (no strict match, no substring fallback)", () => {
    const card = makeCardData({ keywords: [], oracle_text: "" });
    expect(tapsWhenAttacking(makeInstance(card))).toBe(true);
  });

  it("returns false via the substring fallback when only oracle_text mentions vigilance (missing keyword tag)", () => {
    // Back-compat path: a card with missing keyword tag but oracle text
    // mentioning vigilance still does not tap.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Vigilance",
    });
    expect(tapsWhenAttacking(makeInstance(card))).toBe(false);
  });
});
