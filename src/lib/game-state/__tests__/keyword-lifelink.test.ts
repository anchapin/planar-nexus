/**
 * Lifelink keyword enforcement tests — strict parsed-keywords contract (CR 702.15).
 *
 * Issue #2332 — evergreen keyword enforcement (lifelink portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "lifelink" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire lifelink via the strict check;
 *   - `evergreen-keywords.hasLifelink` defers to `hasLifelinkStrict`
 *     first, preserving the substring fallback only for cards with
 *     missing keyword tags (mirrors the deathtouch / vigilance / flying
 *     / reach / menace / first-strike / double-strike / trample pattern).
 *
 * CR 702.15b: "Damage dealt by a source with lifelink causes its
 * controller to gain that much life." The damage-assignment and
 * life-gain wiring is in `effect-resolution.ts::applyLifelink` and
 * `combat/resolution.ts` (covered by `combat-lifelink.test.ts`).
 */

import { hasLifelinkStrict } from "../keyword-actions/lifelink";
import { hasLifelink } from "../evergreen-keywords";
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
// (a) hasLifelinkStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasLifelinkStrict (CR 702.15)", () => {
  it("returns true when the parsed keywords array contains 'lifelink'", () => {
    const card = makeCardData({ keywords: ["lifelink"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Lifelink  "] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'LIFELINK' (all caps) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["LIFELINK"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Lifelink",
    });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions lifelink but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have lifelink. (This creature does not.)",
    });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'lifelink'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "The vampire's curse was a quiet lifelink, a thread of borrowed vitality that whispered between donor and host.",
    });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });

  it("matches 'lifelink' alongside other keywords (e.g. ['Flying', 'Lifelink'])", () => {
    const card = makeCardData({ keywords: ["Flying", "Lifelink"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the keyword is a substring of a different keyword (word-bound check)", () => {
    // "nonlifelink" contains "lifelink" as a substring but is not the
    // lifelink keyword. The strict check must use a word-bound regex.
    const card = makeCardData({ keywords: ["nonlifelink"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for 'lifelinked' (a derivative, not the lifelink keyword)", () => {
    const card = makeCardData({ keywords: ["lifelinked"] });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasLifelink — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasLifelink — strict-first with substring fallback (CR 702.15)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["lifelink"] });
    expect(hasLifelink(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions lifelink (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Lifelink",
    });
    expect(hasLifelink(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention lifelink", () => {
    const card = makeCardData({
      keywords: ["flying"],
      oracle_text: "Flying",
    });
    expect(hasLifelink(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    const card = makeCardData({
      keywords: ["lifelink"],
      oracle_text: "Other creatures you control have lifelink.",
    });
    expect(hasLifelink(makeInstance(card))).toBe(true);
  });

  it("returns false on the strict check but true via substring fallback (mixed signals: parsed absent, oracle present)", () => {
    // This pins the strict-first contract: the canonical helper does NOT
    // treat a flavor-word mention as a real grant, but it DOES still
    // return true via the substring fallback so legacy cards without
    // keyword tags continue to behave.
    const card = makeCardData({
      keywords: [],
      oracle_text: "This creature has lifelink.",
    });
    expect(hasLifelinkStrict(makeInstance(card))).toBe(false);
    expect(hasLifelink(makeInstance(card))).toBe(true);
  });
});
