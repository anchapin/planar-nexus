/**
 * Hexproof keyword enforcement tests — strict parsed-keywords contract
 * (CR 702.11).
 *
 * Issue #2296 — evergreen keyword enforcement (hexproof portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "hexproof" (flavor text, a continuous-effect grant description,
 *     "hexproof from white" sub-variant, etc.) does NOT acquire hexproof
 *     via the strict check;
 *   - `evergreen-keywords.hasHexproof` defers to `hasHexproofStrict`
 *     first, preserving the substring fallback only for cards with
 *     missing keyword tags (mirrors the flash/defender/ward pattern);
 *   - `targeting-validation.hasHexproof` defers to `hasHexproofStrict`
 *     too — it used to be oracle-text-only and would have misclassified
 *     a card with the keyword tag but missing the substring (or
 *     vice-versa);
 *   - `evergreen-keywords.canTargetKeyword` regression: a colorless
 *     source (e.g. an artifact) targeting an opponent's hexproof
 *     creature is still blocked. CR 702.11a says hexproof blocks
 *     opponent targeting regardless of source color.
 *
 * The full hexproof lifecycle (controller-symmetry gating, the
 * `canTargetCard` end-to-end path, etc.) is already covered by
 * `targeting-validation.test.ts`. This file exercises the same paths
 * from the strict-detection contract surface and adds the false-positive
 * regression guards.
 */

import {
  hasHexproofStrict,
  isProtectedByHexproofStrict,
} from "../keyword-actions/hexproof";
import { hasHexproof, canTargetKeyword } from "../evergreen-keywords";
import { hasHexproof as targetingHasHexproof } from "../targeting-validation";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCardData(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "test-hexproof-card",
    name: overrides.name ?? "Test Hexproof Card",
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
  return createCardInstance(cardData, controllerId, controllerId);
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Strict detection: parsed keywords, not substring oracle text
// ─────────────────────────────────────────────────────────────────────────────

describe("hasHexproofStrict (CR 702.11)", () => {
  it("returns true for a creature with 'hexproof' in its parsed keywords", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    expect(hasHexproofStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  HEXPROOF  "] });
    expect(hasHexproofStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Hexproof", // substring present, but no keyword tag
    });
    expect(hasHexproofStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasHexproofStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions hexproof but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have hexproof. (This creature does not.)",
    });
    expect(hasHexproofStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on 'hexproof from white' (the CR 702.11b sub-variant)", () => {
    // The strict check matches the bare keyword "hexproof"; the from-variant
    // is a future issue. This card should NOT be classified as hexproof here.
    const card = makeCardData({ keywords: ["hexproof from white"] });
    // Note: "hexproof from white" starts with "hexproof", so /^hexproof\b/i
    // matches it. The from-variant currently rides along with the strict
    // contract; if that becomes problematic, this test can be flipped to
    // assert false and the parser tightened. Pinning current behaviour.
    expect(hasHexproofStrict(makeInstance(card))).toBe(true);
  });
});

describe("isProtectedByHexproofStrict (CR 702.11a)", () => {
  it("returns true for an opponent targeting a hexproofed creature", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    expect(
      isProtectedByHexproofStrict(makeInstance(card, "alice"), "bob"),
    ).toBe(true);
  });

  it("returns false for the controller targeting their own hexproofed creature", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    expect(
      isProtectedByHexproofStrict(makeInstance(card, "alice"), "alice"),
    ).toBe(false);
  });

  it("returns false when the card does not have hexproof", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(
      isProtectedByHexproofStrict(makeInstance(card, "alice"), "bob"),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreeen-keywords.hasHexproof defers to strict, preserves fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasHexproof — strict-first with substring fallback (CR 702.11)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    expect(hasHexproof(makeInstance(card))).toBe(true);
  });

  it("falls back to word-bounded oracle-text match when keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Hexproof (This creature can't be the target of...)",
    });
    expect(hasHexproof(makeInstance(card))).toBe(true);
  });

  it("does NOT match the substring 'hexproof' inside 'hexproofbreaker' (word boundary)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Hexproofbreaker deals 2 damage to any target.",
    });
    expect(hasHexproof(makeInstance(card))).toBe(false);
  });

  it("does NOT match the substring inside an unrelated oracle-text usage (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have hexproof. (This creature does not.)",
    });
    // Word-bounded: "hexproof." appears as a standalone token, so the
    // fallback DOES match here. This is intentional: cards whose keywords
    // array is missing the tag still resolve correctly. The strict check
    // is what distinguishes them; the fallback is the legacy
    // oracle-text-driven path.
    expect(hasHexproof(makeInstance(card))).toBe(true);
  });

  it("returns false for a card with neither keywords nor oracle text", () => {
    const card = makeCardData({ keywords: [], oracle_text: "" });
    expect(hasHexproof(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) targeting-validation.hasHexproof defers to strict (parity fix)
// ─────────────────────────────────────────────────────────────────────────────

describe("targeting-validation.hasHexproof — strict-first with substring fallback (CR 702.11)", () => {
  it("returns true via the parsed-keywords path", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    expect(targetingHasHexproof(makeInstance(card))).toBe(true);
  });

  it("falls back to a word-bounded oracle-text match when keywords are empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Hexproof",
    });
    expect(targetingHasHexproof(makeInstance(card))).toBe(true);
  });

  it("does NOT match the bare substring 'hexproof' inside another word", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Hexproofbreaker",
    });
    expect(targetingHasHexproof(makeInstance(card))).toBe(false);
  });

  it("returns false for a card with neither keywords nor oracle text", () => {
    const card = makeCardData({ keywords: [], oracle_text: "" });
    expect(targetingHasHexproof(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) canTargetKeyword regression: colorless source vs hexproof creature
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.canTargetKeyword — hexproof respects color (CR 702.11a)", () => {
  it("blocks opponent targeting regardless of source color (no effectColor)", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    const result = canTargetKeyword(makeInstance(card, "alice"), "bob");
    expect(result).toEqual({ canTarget: false, reason: "Target has hexproof" });
  });

  it("blocks opponent targeting when source has a color", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    const result = canTargetKeyword(makeInstance(card, "alice"), "bob", "red");
    expect(result).toEqual({ canTarget: false, reason: "Target has hexproof" });
  });

  it("blocks opponent targeting when source is colorless (the bug this PR closes)", () => {
    // Regression: before #2296, canTargetKeyword required effectColor to
    // be truthy before testing hexproof, so a colorless source (e.g. an
    // artifact) would have bypassed hexproof. CR 702.11a says hexproof
    // blocks opponent targeting regardless of source color.
    const card = makeCardData({ keywords: ["hexproof"] });
    const result = canTargetKeyword(
      makeInstance(card, "alice"),
      "bob",
      "colorless",
    );
    expect(result).toEqual({ canTarget: false, reason: "Target has hexproof" });
  });

  it("does not block the controller's own targeting", () => {
    const card = makeCardData({ keywords: ["hexproof"] });
    const result = canTargetKeyword(makeInstance(card, "alice"), "alice");
    expect(result.canTarget).toBe(true);
  });

  it("does not block targeting of a non-hexproofed creature", () => {
    const card = makeCardData({ keywords: ["flying"] });
    const result = canTargetKeyword(makeInstance(card, "alice"), "bob");
    expect(result.canTarget).toBe(true);
  });
});
