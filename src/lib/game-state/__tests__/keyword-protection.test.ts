/**
 * Protection-from-color keyword enforcement tests — strict parsed-keywords
 * contract (CR 702.16).
 *
 * Issue #2296 — evergreen keyword enforcement (protection-from-color portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text mentions
 *     "protection from red" but doesn't carry the keyword (flavor text,
 *     a continuous-effect grant description, or a card that *gives*
 *     protection) does NOT acquire protection via the strict check;
 *   - `evergreen-keywords.hasProtectionFrom` /
 *     `evergreen-keywords.getProtectionQualities` /
 *     `targeting-validation.getProtectionQualities` all defer to the
 *     strict variants first, preserving the regex fallback only for
 *     cards with missing keyword tags (mirrors the ward/hexproof pattern);
 *   - multi-quality protection ("protection from red and blue") is parsed
 *     from a single keyword tag and reported as ["red", "blue"];
 *   - W/U/B/R/G color abbreviations are normalized to full color names.
 *
 * The full protection lifecycle — `isProtectedFromSource`,
 * `canTargetCard`, `canBeEnchantedBy`, `canBeEquippedBy`, damage
 * prevention in `damage-tap.ts`, blocking restrictions — is already
 * covered by `targeting-validation.test.ts`. This file exercises the
 * detection contract surface and adds the false-positive regression
 * guards.
 */

import {
  hasProtectionFromColorStrict,
  getProtectionQualitiesStrict,
} from "../keyword-actions/protection";
import {
  hasProtectionFrom,
  getProtectionQualities,
} from "../evergreen-keywords";
import { getProtectionQualities as targetingGetProtectionQualities } from "../targeting-validation";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "test-protection-card",
    name: overrides.name ?? "Test Protection Card",
    type_line: overrides.type_line ?? "Creature — Test",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{W}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
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
  return createCardInstance(cardData, controllerId, controllerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Strict detection: parsed keywords, not substring oracle text
// ─────────────────────────────────────────────────────────────────────────────

describe("hasProtectionFromColorStrict (CR 702.16)", () => {
  it("returns true for a creature with 'protection from red' in keywords", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(true);
  });

  it("returns false when the card has no protection keyword", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(false);
  });

  it("returns false when the parsed keywords array is empty (even if oracle text mentions protection)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Protection from red",
    });
    // Strict path does NOT consult oracle text; the keyword tag must be
    // present. Substring fallback is the job of the deferred callers.
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions 'protection from red' as a flavor/grant", () => {
    // A continuous-effect grant — this card *gives* protection from red
    // to other creatures; it does not itself have protection.
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have protection from red. (This creature does not.)",
    });
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(false);
  });

  it("normalizes W/U/B/R/G abbreviations to full color names", () => {
    const card = makeCardData({ keywords: ["protection from R"] });
    expect(hasProtectionFromColorStrict(makeInstance(card), "r")).toBe(true);
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(true);
  });

  it("is case-insensitive on the protected color in the keyword tag", () => {
    const card = makeCardData({ keywords: ["Protection From RED"] });
    expect(hasProtectionFromColorStrict(makeInstance(card), "red")).toBe(true);
  });

  it("returns false for an unrecognized color quality", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    // Purple isn't a valid MTG color.
    expect(hasProtectionFromColorStrict(makeInstance(card), "purple")).toBe(
      false,
    );
  });
});

describe("getProtectionQualitiesStrict (CR 702.16)", () => {
  it("returns an empty array when the card has no protection keywords", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual([]);
  });

  it("returns ['red'] for a single-quality protection tag", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual(["red"]);
  });

  it("returns ['red', 'blue'] for a multi-quality 'and' tag", () => {
    const card = makeCardData({
      keywords: ["protection from red and blue"],
    });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual([
      "red",
      "blue",
    ]);
  });

  it("accepts comma-separated qualities (historical formatting)", () => {
    const card = makeCardData({
      keywords: ["protection from red, blue"],
    });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual([
      "red",
      "blue",
    ]);
  });

  it("normalizes W/U/B/R/G abbreviations to full color names", () => {
    const card = makeCardData({ keywords: ["protection from R, U"] });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual([
      "red",
      "blue",
    ]);
  });

  it("does NOT false-positive on a card whose oracle text mentions protection (no keyword tag)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Protection from red. Protection from blue.",
    });
    expect(getProtectionQualitiesStrict(makeInstance(card))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreeen-keywords.hasProtectionFrom defers to strict, preserves regex fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasProtectionFrom — strict-first with regex fallback (CR 702.16)", () => {
  it("returns true via the strict path when keywords include protection", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    expect(hasProtectionFrom(makeInstance(card), "red")).toBe(true);
  });

  it("falls back to the oracle-text regex when keywords are empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Protection from red",
    });
    expect(hasProtectionFrom(makeInstance(card), "red")).toBe(true);
  });

  it("returns false for a card with neither keywords nor oracle text", () => {
    const card = makeCardData({ keywords: [], oracle_text: "" });
    expect(hasProtectionFrom(makeInstance(card), "red")).toBe(false);
  });

  it("returns false for the wrong color", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    expect(hasProtectionFrom(makeInstance(card), "blue")).toBe(false);
  });
});

describe("evergreen-keywords.getProtectionQualities — strict-first with regex fallback (CR 702.16)", () => {
  it("returns the strict qualities when keywords include protection", () => {
    const card = makeCardData({
      keywords: ["protection from red and blue"],
    });
    expect(getProtectionQualities(makeInstance(card))).toEqual(["red", "blue"]);
  });

  it("falls back to the oracle-text regex when keywords are empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Protection from red and blue",
    });
    expect(getProtectionQualities(makeInstance(card))).toEqual(["red", "blue"]);
  });

  it("returns an empty array for a card with no protection", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(getProtectionQualities(makeInstance(card))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) targeting-validation.getProtectionQualities defers to strict (parity fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("targeting-validation.getProtectionQualities — strict-first with regex fallback (CR 702.16)", () => {
  it("returns the strict qualities when keywords include protection", () => {
    const card = makeCardData({ keywords: ["protection from red"] });
    expect(targetingGetProtectionQualities(makeInstance(card))).toEqual([
      "red",
    ]);
  });

  it("falls back to the oracle-text regex when keywords are empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Protection from red",
    });
    expect(targetingGetProtectionQualities(makeInstance(card))).toEqual([
      "red",
    ]);
  });

  it("returns an empty array for a card with no protection", () => {
    const card = makeCardData({ keywords: [], oracle_text: "Flying" });
    expect(targetingGetProtectionQualities(makeInstance(card))).toEqual([]);
  });
});
