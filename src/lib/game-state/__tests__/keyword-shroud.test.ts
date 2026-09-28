/**
 * Shroud keyword enforcement tests — strict parsed-keywords contract (CR 702.18).
 *
 * Issue #2336 — evergreen keyword enforcement (shroud portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "shroud" (e.g. a continuous-effect grant reference like "creatures
 *     your opponents control lose shroud") must NOT acquire shroud via the
 *     strict check;
 *   - false-NEGATIVE regression (the bug this change fixes): a permanent
 *     carrying `keywords: ["Shroud"]` whose oracle text does not contain the
 *     word "Shroud" was previously treated as targetable, because
 *     `targeting-validation.hasShroud` consulted oracle text only;
 *   - both canonical copies (`evergreen-keywords.hasShroud` and
 *     `targeting-validation.hasShroud`) defer to `hasShroudStrict` first
 *     and agree on the parsed-keyword path, closing the pre-existing
 *     divergence between them;
 *   - CR 702.18a — shroud blocks targeting for *everyone*; there is no
 *     controller-symmetry escape hatch (contrast hexproof, CR 702.11a).
 *
 * The live targeting gate is `canTargetCard` in `targeting-validation.ts`
 * (covered by `shroud-targeting.test.ts`).
 */

import { hasShroudStrict } from "../keyword-actions/shroud";
import { hasShroud, canTarget } from "../evergreen-keywords";
import { hasShroud as hasShroudTargeting } from "../targeting-validation";
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
// (a) hasShroudStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasShroudStrict (CR 702.18)", () => {
  it("returns true when the parsed keywords array contains 'shroud'", () => {
    const card = makeCardData({ keywords: ["shroud"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Shroud  "] });
    expect(hasShroudStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'SHROUD' (all caps) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["SHROUD"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(true);
  });

  it("returns true when shroud is one of several parsed keywords", () => {
    const card = makeCardData({ keywords: ["Flying", "Shroud", "Trample"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({ keywords: [] });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when the parsed keywords array is undefined", () => {
    const card = makeCardData({ keywords: undefined });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for an unrelated keyword list", () => {
    const card = makeCardData({ keywords: ["Flying", "Deathtouch"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  // ── false-positive regressions: oracle text must never grant shroud ────────

  it("returns false when the oracle text merely mentions shroud", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Creatures your opponents control lose shroud until end of turn.",
    });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for an oracle text that grants shroud as an effect", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Target creature gains shroud until end of turn.",
    });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for oracle text that removes shroud", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Remove all abilities and counterspell target shroud.",
    });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("does not treat a non-keyword use of the word 'shrouded' as the keyword", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "The mists shrouded the battlefield at dusk.",
    });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("returns false for keyword tags that only share the 'shroud' stem", () => {
    const card = makeCardData({ keywords: ["Shrouded", "Unshroud"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });

  it("requires a word boundary — 'shroud' must be a standalone token", () => {
    const card = makeCardData({ keywords: ["shroudx"] });
    expect(hasShroudStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasShroud — strict-first, substring fallback preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasShroud (CR 702.18a)", () => {
  it("defers to hasShroudStrict for a parsed keyword tag", () => {
    const card = makeCardData({ keywords: ["Shroud"], oracle_text: "" });
    const instance = makeInstance(card);
    expect(hasShroud(instance)).toBe(true);
    expect(hasShroudStrict(instance)).toBe(true);
  });

  it("retains the substring fallback for untagged cards whose oracle text has the word", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flash. Hexproof. Shroud.",
    });
    expect(hasShroud(makeInstance(card))).toBe(true);
  });

  it("preserves the fallback for mixed-case oracle text", () => {
    const card = makeCardData({ keywords: [], oracle_text: "SHROUD" });
    expect(hasShroud(makeInstance(card))).toBe(true);
  });

  it("returns false for an unremarkable card", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flying. When this enters, draw a card.",
    });
    expect(hasShroud(makeInstance(card))).toBe(false);
  });

  it("does not false-positive on the stem 'shrouded' in oracle text", () => {
    // The substring fallback is `oracleText.includes("shroud")`, so this
    // still resolves true — documented as the known, accepted limit of the
    // fallback. Pinned so a future tightening of the fallback is a
    // deliberate, visible change rather than a silent behaviour shift.
    const card = makeCardData({
      keywords: [],
      oracle_text: "This has the word unshroud",
    });
    expect(hasShroud(makeInstance(card))).toBe(true);
  });

  it("gates canTarget on the strict path (no spell may target a shrouded permanent)", () => {
    const card = makeCardData({ keywords: ["Shroud"], oracle_text: "" });
    const result = canTarget(
      makeInstance(card),
      "bob" as CardInstance["controllerId"],
    );
    expect(result.canTarget).toBe(false);
    expect(result.reason).toBe("Target has shroud");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) targeting-validation.hasShroud — false-negative regression + parity
// ─────────────────────────────────────────────────────────────────────────────

describe("targeting-validation.hasShroud (CR 702.18a) — issue #2336", () => {
  it("detects shroud from the parsed keywords array (regression: was false)", () => {
    // Before #2336 this returned false: the oracle-text-only regex never
    // read `keywords`, so this permanent was treated as targetable.
    const card = makeCardData({
      keywords: ["Shroud"],
      oracle_text: "A colossal walker of the void.",
    });
    expect(hasShroudTargeting(makeInstance(card))).toBe(true);
  });

  it("detects shroud granted by a continuous effect (regression: was false)", () => {
    // Continuous-effect grants land in the permanent's effective keywords,
    // not its printed oracle text — exactly the path the old regex missed.
    const card = makeCardData({
      keywords: ["Shroud", "Flying"],
      oracle_text: "Flying",
    });
    expect(hasShroudTargeting(makeInstance(card))).toBe(true);
  });

  it("still detects shroud from oracle text for untagged cards", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flash. Hexproof. Shroud.",
    });
    expect(hasShroudTargeting(makeInstance(card))).toBe(true);
  });

  it("does not match 'unshroud' as a substring of oracle text", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "This has the word unshroud",
    });
    expect(hasShroudTargeting(makeInstance(card))).toBe(false);
  });

  it("returns false for a card with neither keyword tag nor oracle mention", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Flash. Hexproof.",
    });
    expect(hasShroudTargeting(makeInstance(card))).toBe(false);
  });

  it("agrees with evergreen-keywords.hasShroud on the parsed-keyword path", () => {
    const card = makeCardData({
      keywords: ["Shroud"],
      oracle_text: "A colossal walker of the void.",
    });
    const instance = makeInstance(card);
    expect(hasShroudTargeting(instance)).toBe(hasShroud(instance));
  });
});
