/**
 * Haste keyword enforcement tests — strict parsed-keywords contract (CR 702.10).
 *
 * Issue #2334 — evergreen keyword enforcement (Plan G, haste portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "haste" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire haste via the strict check — CR 302.6
 *     summoning sickness must not be silently waived;
 *   - `evergreen-keywords.hasHaste` defers to `hasHasteStrict` first,
 *     preserving the substring fallback only for cards with missing
 *     keyword tags (mirrors the deathtouch / lifelink / vigilance /
 *     flying / reach / menace / first-strike / double-strike / trample
 *     pattern).
 *
 * CR 702.10b: "A creature with haste can attack or use abilities with the
 * tap symbol or untap symbol as though it had been under its
 * controller's control continuously since the beginning of their most
 * recent turn." The summoning-sickness gate wiring is in
 * `combat/queries.ts` (covered by `combat-haste.test.ts`).
 */

import { hasHasteStrict } from "../keyword-actions/haste";
import { hasHaste, canAttackThisTurn } from "../evergreen-keywords";
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
// (a) hasHasteStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasHasteStrict (CR 702.10)", () => {
  it("returns true when the parsed keywords array contains 'haste'", () => {
    const card = makeCardData({ keywords: ["haste"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Haste  "] });
    expect(hasHasteStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'HASTE' (all caps) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["HASTE"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({ keywords: [], oracle_text: "Haste" });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["vigilance"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions haste but has no keyword tag (grant reference)", () => {
    // The exact bug this issue fixes: the old substring check in
    // `combat/queries.ts` granted haste to this card, silently waiving
    // summoning sickness (CR 302.6).
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have haste. (This creature does not.)",
    });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'haste'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "The falcon's haste carried it home before the storm could break.",
    });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });

  it("matches 'haste' alongside other keywords (e.g. ['Flying', 'Haste'])", () => {
    const card = makeCardData({ keywords: ["Flying", "Haste"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the keyword is a substring of a different keyword (word-bound check)", () => {
    // "nonhaste" contains "haste" as a substring but is not the haste
    // keyword. The strict check must use a word-bound regex.
    const card = makeCardData({ keywords: ["nonhaste"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for 'hasted' (a derivative, not the haste keyword)", () => {
    const card = makeCardData({ keywords: ["hasted"] });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasHaste — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasHaste — strict-first with substring fallback (CR 702.10)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["haste"] });
    expect(hasHaste(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions haste (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({ keywords: [], oracle_text: "Haste" });
    expect(hasHaste(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention haste", () => {
    const card = makeCardData({
      keywords: ["vigilance"],
      oracle_text: "Vigilance",
    });
    expect(hasHaste(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback", () => {
    const card = makeCardData({
      keywords: ["haste"],
      oracle_text: "Other creatures you control have haste.",
    });
    expect(hasHaste(makeInstance(card))).toBe(true);
  });

  it("returns false on the strict check but true via substring fallback (mixed signals: parsed absent, oracle present)", () => {
    // Pins the strict-first contract: the canonical helper does NOT treat
    // a flavor-word mention as a real grant via the strict path, but it
    // DOES still return true via the substring fallback so legacy cards
    // without keyword tags continue to behave.
    const card = makeCardData({
      keywords: [],
      oracle_text: "This creature has haste.",
    });
    expect(hasHasteStrict(makeInstance(card))).toBe(false);
    expect(hasHaste(makeInstance(card))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) canAttackThisTurn — CR 302.6 / 702.10b integration
// ─────────────────────────────────────────────────────────────────────────────

describe("canAttackThisTurn — haste waives summoning sickness (CR 302.6 / 702.10b)", () => {
  it("allows a haste creature with summoning sickness to attack", () => {
    const instance = makeInstance(makeCardData({ keywords: ["Haste"] }));
    instance.hasSummoningSickness = true;
    expect(canAttackThisTurn(instance)).toBe(true);
  });

  it("blocks a non-haste creature with summoning sickness", () => {
    const instance = makeInstance(makeCardData({ keywords: [] }));
    instance.hasSummoningSickness = true;
    expect(canAttackThisTurn(instance)).toBe(false);
  });

  it("allows a non-haste creature with no summoning sickness", () => {
    const instance = makeInstance(makeCardData({ keywords: [] }));
    instance.hasSummoningSickness = false;
    expect(canAttackThisTurn(instance)).toBe(true);
  });
});
