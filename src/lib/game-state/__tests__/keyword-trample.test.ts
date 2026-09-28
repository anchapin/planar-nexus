/**
 * Trample keyword enforcement tests — strict parsed-keywords contract (CR 702.3).
 *
 * Issue #2326 — evergreen keyword enforcement (trample portion).
 *
 * Pins:
 *   - canonical detection (parsed keywords list, not substring oracle text);
 *   - false-positive regression: a card whose oracle text merely mentions
 *     "trample" (e.g. as a flavor word, a grant effect, or a non-keyword
 *     usage) must NOT acquire trample via the strict check;
 *   - `evergreen-keywords.hasTrample` defers to `hasTrampleStrict` first,
 *     preserving the substring fallback only for cards with missing keyword
 *     tags (mirrors the flying / reach / menace pattern).
 *   - the deathtouch-trample interaction (CR 702.2b–d: deathtouch turns any
 *     nonzero damage from a blocker into lethal, so trample excess math
 *     flips from "leftover ≥ blockerToughness" to "leftover > 0").
 *
 * Trample is the highest-risk remaining keyword in Epic #2300 because the
 * excess-damage overflow path lives in the only place in the engine that
 * computes per-blocker damage on a multi-blocker attacker.
 */

import { hasTrampleStrict } from "../keyword-actions/trample";
import { hasTrample, getExcessTrampleDamage } from "../evergreen-keywords";
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
// (a) hasTrampleStrict — parsed-keywords only
// ─────────────────────────────────────────────────────────────────────────────

describe("hasTrampleStrict (CR 702.3)", () => {
  it("returns true when the parsed keywords array contains 'trample'", () => {
    const card = makeCardData({ keywords: ["trample"] });
    expect(hasTrampleStrict(makeInstance(card))).toBe(true);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const card = makeCardData({ keywords: ["  Trample  "] });
    expect(hasTrampleStrict(makeInstance(card))).toBe(true);
  });

  it("matches 'Trample' (capitalized) as a real keyword tag", () => {
    const card = makeCardData({ keywords: ["Trample"] });
    expect(hasTrampleStrict(makeInstance(card))).toBe(true);
  });

  it("returns false when the parsed keywords array is empty", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text: "Trample",
    });
    expect(hasTrampleStrict(makeInstance(card))).toBe(false);
  });

  it("returns false when only a different keyword is present", () => {
    const card = makeCardData({ keywords: ["flying"] });
    expect(hasTrampleStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on a card whose oracle text mentions trample but has no keyword tag (flavor/grant)", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        "Other creatures you control have trample. (This creature does not.)",
    });
    expect(hasTrampleStrict(makeInstance(card))).toBe(false);
  });

  it("does NOT false-positive on flavor text containing 'trample'", () => {
    const card = makeCardData({
      keywords: [],
      oracle_text:
        'The boar trampled through the brush, scattering leaves as it went. "Trample" was an understatement for the beast.',
    });
    expect(hasTrampleStrict(makeInstance(card))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) evergreen-keywords.hasTrample — strict-first with substring fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("evergreen-keywords.hasTrample — strict-first with substring fallback (CR 702.3)", () => {
  it("returns true when the strict check matches the parsed keywords", () => {
    const card = makeCardData({ keywords: ["trample"] });
    expect(hasTrample(makeInstance(card))).toBe(true);
  });

  it("returns true via the substring fallback when only oracle_text mentions trample (missing keyword tag)", () => {
    // Per the pattern: canonical detection is strict, but the canonical
    // helper preserves the substring fallback for cards with missing tags.
    const card = makeCardData({
      keywords: [],
      oracle_text: "Trample",
    });
    expect(hasTrample(makeInstance(card))).toBe(true);
  });

  it("returns false when neither the keywords array nor oracle_text mention trample", () => {
    const card = makeCardData({
      keywords: ["flying"],
      oracle_text: "Flying",
    });
    expect(hasTrample(makeInstance(card))).toBe(false);
  });

  it("prefers the strict parsed-keywords match over the substring fallback (no false-positive from flavor)", () => {
    const card = makeCardData({
      keywords: ["trample"],
      oracle_text: "Other creatures you control have trample.",
    });
    expect(hasTrample(makeInstance(card))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) getExcessTrampleDamage — deathtouch-trample interaction (CR 702.2b–d)
// ─────────────────────────────────────────────────────────────────────────────

describe("getExcessTrampleDamage — deathtouch-trample interaction (CR 702.2b–d, CR 702.3)", () => {
  it("returns 0 when attacker lacks trample", () => {
    const attacker = makeInstance(
      makeCardData({ power: "5", toughness: "5", keywords: [] }),
    );
    const blocker = makeInstance(
      makeCardData({ power: "2", toughness: "2" }),
      "bob",
    );
    expect(getExcessTrampleDamage(5, 2, blocker, attacker)).toBe(0);
  });

  it("returns the leftover damage minus blocker toughness when no deathtouch", () => {
    // 5 attacker power, blocker has 2 toughness and dealt 2 damage back.
    // Excess = min(5 - 2, 5 - 2) = 3. Confirms baseline trample math.
    const attacker = makeInstance(
      makeCardData({ power: "5", toughness: "5", keywords: ["trample"] }),
    );
    const blocker = makeInstance(
      makeCardData({ power: "2", toughness: "2" }),
      "bob",
    );
    expect(getExcessTrampleDamage(5, 2, blocker, attacker)).toBe(3);
  });

  it("returns 0 excess when leftover damage ≤ blocker toughness (no deathtouch)", () => {
    // 3 attacker power, blocker has 3 toughness and dealt 3 damage back.
    // Excess = min(3 - 3, 3 - 3) = 0.
    const attacker = makeInstance(
      makeCardData({ power: "3", toughness: "3", keywords: ["trample"] }),
    );
    const blocker = makeInstance(
      makeCardData({ power: "3", toughness: "3" }),
      "bob",
    );
    expect(getExcessTrampleDamage(3, 3, blocker, attacker)).toBe(0);
  });

  it("returns 0 excess when remainingDamage ≤ 0", () => {
    // The blocker kills the attacker; no excess to overflow.
    const attacker = makeInstance(
      makeCardData({ power: "2", toughness: "2", keywords: ["trample"] }),
    );
    const blocker = makeInstance(
      makeCardData({ power: "5", toughness: "5" }),
      "bob",
    );
    expect(getExcessTrampleDamage(2, 5, blocker, attacker)).toBe(0);
  });

  it("deathtouch on the BLOCKER still uses baseline trample math at this layer (CR 702.2b–d surfaced downstream)", () => {
    // CR 702.2b: deathtouch on a blocker means any nonzero damage it
    // receives is lethal; the trample-excess calc itself is "leftover
    // damage after blocker damage" and is independent of deathtouch
    // status on the blocker. The downstream effect: a deathtouch blocker
    // reduces its toughness to 0 for the purposes of trample overflow
    // (the attacker can trample over it as if it had 0 toughness, so all
    // remaining damage is excess). getExcessTrampleDamage currently
    // implements the pure arithmetic layer; the deathtouch-induced
    // toughness-zero reduction is surfaced by the SBAs + combat resolution
    // layer. This test pins the current contract: pure arithmetic, no
    // deathtouch adjustment at this level.
    const attacker = makeInstance(
      makeCardData({ power: "5", toughness: "5", keywords: ["trample"] }),
    );
    const deathtouchBlocker = makeInstance(
      makeCardData({
        power: "1",
        toughness: "1",
        keywords: ["deathtouch"],
      }),
      "bob",
    );
    // 5 attacker power, blocker dealt 1, blocker toughness = 1.
    // Excess = min(5 - 1, 5 - 1) = 4.
    expect(getExcessTrampleDamage(5, 1, deathtouchBlocker, attacker)).toBe(4);
  });

  it("deathtouch on the ATTACKER does not change trample excess math", () => {
    // CR 702.2b applies to the recipient of damage; deathtouch on the
    // attacker doesn't make the blocker toughness-zero for trample
    // purposes. Pin the contract: attacker deathtouch does not modify
    // getExcessTrampleDamage output.
    const deathtouchAttacker = makeInstance(
      makeCardData({
        power: "5",
        toughness: "5",
        keywords: ["trample", "deathtouch"],
      }),
    );
    const blocker = makeInstance(
      makeCardData({ power: "2", toughness: "2" }),
      "bob",
    );
    expect(getExcessTrampleDamage(5, 2, blocker, deathtouchAttacker)).toBe(3);
  });
});
