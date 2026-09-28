/**
 * Deathtouch keyword enforcement tests — strict parsed-keywords contract (CR 702.2).
 *
 * Issue #2330 — evergreen keyword enforcement (deathtouch portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "deathtouch" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire deathtouch via the strict check;
 *   - `evergreen-keywords.hasDeathtouch` defers to `hasDeathtouchStrict`
 *     first, preserving the substring fallback only for cards with
 *     missing keyword tags (mirrors the flying / reach / menace /
 *     first-strike / double-strike / trample / vigilance pattern);
 *   - `isLethalDamage` (the canonical ">0 damage is lethal" gate) inherits
 *     the strict-first contract through `hasDeathtouch`.
 *
 * CR 702.2b: "A creature with deathtouch deals damage to creatures as
 * though it were marked with lethal damage." The damage-assignment
 * wiring is in `combat/resolution.ts::getExcessTrampleDamage` (covered
 * by `combat-deathtouch.test.ts`).
 */

import { hasDeathtouchStrict } from "../keyword-actions/deathtouch";
import { hasDeathtouch, isLethalDamage } from "../evergreen-keywords";
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
  ) as CardInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) hasDeathtouchStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasDeathtouchStrict (CR 702.2)", () => {
  it("returns true when the parsed keywords array contains 'deathtouch'", () => {
    const card = makeCardData({ keywords: ["deathtouch"] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Deathtouch  "] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'DEATHTOUCH' (all caps) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["DEATHTOUCH"] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Deathtouch",
    });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions deathtouch but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have deathtouch. (This creature does not.)",
    });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'deathtouch'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'The assassin\'s blade whispered its deathtouch promise, lingering on the rim of every shadow. "Deathtouch" was the gossip in the alleys.',
    });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
  });

  it("matches 'deathtouch' alongside other keywords (e.g. ['Trample', 'Deathtouch'])", () => {
    const card = makeCardData({ keywords: ["Trample", "Deathtouch"] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the keyword is a substring of a different keyword (word-bound check)", () => {
    // "nondeathtouch" contains "deathtouch" as a substring but is not the
    // deathtouch keyword. The strict check must use a word-bound regex.
    const card = makeCardData({ keywords: ["nondeathtouch"] });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasDeathtouch — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasDeathtouch — strict-first with substring fallback (CR 702.2)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["deathtouch"] });
    expect(hasDeathtouch(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions deathtouch (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Deathtouch",
    });
    expect(hasDeathtouch(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention deathtouch", () => {
    const card = makeCardData({
      keywords: ["flying"],
      oracle_text: "Flying",
    });
    expect(hasDeathtouch(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    const card = makeCardData({
      keywords: ["deathtouch"],
      oracle_text: "Other creatures you control have deathtouch.",
    });
    expect(hasDeathtouch(makeInstance(card))).toBe(true);
  });

  it("returns false on the strict check but true via substring fallback (mixed signals: parsed absent, oracle present)", () => {
    // This pins the strict-first contract: the canonical helper does NOT
    // treat a flavor-word mention as a real grant, but it DOES still
    // return true via the substring fallback so legacy cards without
    // keyword tags continue to behave.
    const card = makeCardData({
      keywords: [],
      oracle_text: "This creature has deathtouch.",
    });
    expect(hasDeathtouchStrict(makeInstance(card))).toBe(false);
    expect(hasDeathtouch(makeInstance(card))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) isLethalDamage — inherits the strict-first contract via hasDeathtouch
// ─────────────────────────────────────────────────────────────────────────────

describe("isLethalDamage — inherits the strict-first contract (CR 702.2c)", () => {
  it("returns true for damage >= 1 when the source has the deathtouch keyword tag", () => {
    const card = makeCardData({ keywords: ["deathtouch"] });
    expect(isLethalDamage(1, makeInstance(card))).toBe(true);
    expect(isLethalDamage(2, makeInstance(card))).toBe(true);
  });

  it("returns false for damage = 0 even when the source has deathtouch (CR 702.2c: nonzero)", () => {
    const card = makeCardData({ keywords: ["deathtouch"] });
    expect(isLethalDamage(0, makeInstance(card))).toBe(false);
  });

  it("returns false when the source lacks deathtouch (no keyword tag, no oracle text)", () => {
    const card = makeCardData({
      keywords: ["flying"],
      oracle_text: "Flying",
    });
    expect(isLethalDamage(5, makeInstance(card))).toBe(false);
  });

  it("returns true via the substring fallback for a card with missing keyword tag but oracle text mentioning deathtouch", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Deathtouch",
    });
    expect(isLethalDamage(1, makeInstance(card))).toBe(true);
  });
});
