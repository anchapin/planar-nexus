/**
 * Shroud targeting-gate integration tests (CR 702.18a).
 *
 * Issue #2336 — evergreen keyword enforcement (shroud portion).
 *
 * `keyword-shroud.test.ts` pins the strict *detection* contract. This file
 * pins the *gameplay* consequence: `canTargetCard` in `targeting-validation.ts`
 * is the live targeting gate, and it consults its own local `hasShroud` copy
 * (not the `evergreen-keywords` one). That local copy used to read oracle text
 * only, so a permanent carrying `keywords: ["Shroud"]` was legally targetable —
 * a hard rules violation. These tests exercise the gate end to end.
 *
 * CR 702.18a: "A permanent with shroud can't be the target of spells or
 * abilities." Unlike hexproof (CR 702.11a), there is no controller-symmetry
 * escape hatch — the controller's own spells cannot target it either.
 */

import {
  canTargetCard,
  hasShroud,
  getTargetingRestrictions,
} from "../targeting-validation";
import { hasShroudStrict } from "../keyword-actions/shroud";
import { createCardInstance } from "../card-instance";
import type { CardInstance, ScryfallCard } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a mock creature. Unlike the helper in `targeting-validation.test.ts`
 * this one does NOT backfill `oracle_text` from the keyword list — shroud
 * regression cases need a permanent whose parsed keyword and printed text
 * deliberately disagree.
 */
function makeCreature(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "shroud-target",
    name: overrides.name ?? "Ulamog",
    type_line: overrides.type_line ?? "Creature — Eldrazi",
    power: overrides.power ?? "10",
    toughness: overrides.toughness ?? "10",
    mana_cost: overrides.mana_cost ?? "{10}",
    cmc: overrides.cmc ?? 10,
    colors: overrides.colors ?? ["C"],
    color_identity: overrides.color_identity ?? ["C"],
    keywords: overrides.keywords ?? [],
    oracle_text: overrides.oracle_text ?? "",
    rarity: overrides.rarity ?? "mythic",
    set: overrides.set ?? "tst",
    ...overrides,
  } as ScryfallCard;
}

function makeSpell(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: overrides.id ?? "shroud-spell",
    name: overrides.name ?? "Ablaze",
    type_line: overrides.type_line ?? "Instant",
    mana_cost: overrides.mana_cost ?? "{R}",
    cmc: overrides.cmc ?? 1,
    colors: overrides.colors ?? ["R"],
    color_identity: overrides.color_identity ?? ["R"],
    keywords: [],
    oracle_text:
      overrides.oracle_text ?? "Ablaze deals 3 damage to any target.",
    rarity: overrides.rarity ?? "common",
    set: overrides.set ?? "tst",
    ...overrides,
  } as ScryfallCard;
}

function instantiate(
  cardData: ScryfallCard,
  controllerId = "player1",
): CardInstance {
  return createCardInstance(
    cardData,
    controllerId as CardInstance["controllerId"],
    controllerId as CardInstance["ownerId"],
  ) as CardInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) The gate — canTargetCard honours parsed-keyword shroud
// ─────────────────────────────────────────────────────────────────────────────

describe("canTargetCard — shroud gate (CR 702.18a)", () => {
  it("rejects a target whose parsed keywords say Shroud but oracle text does not", () => {
    // The core regression. Pre-#2336 this was valid=true: the gate's local
    // hasShroud read oracle_text only and never consulted `keywords`.
    const target = instantiate(
      makeCreature({ keywords: ["Shroud"], oracle_text: "A colossal walker." }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("shroud");
  });

  it("rejects a target that gained shroud from a continuous effect", () => {
    // Continuous-effect grants land in effective keywords, not printed text.
    const target = instantiate(
      makeCreature({ keywords: ["Shroud", "Flying"], oracle_text: "Flying" }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("shroud");
  });

  it("still rejects a target whose oracle text names shroud without a keyword tag", () => {
    const target = instantiate(
      makeCreature({ keywords: [], oracle_text: "Shroud" }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("shroud");
  });

  it("rejects targeting by the controller's own spell — shroud has no self-exemption", () => {
    // Contrast hexproof (CR 702.11a), which does let the controller through.
    const target = instantiate(
      makeCreature({ keywords: ["Shroud"], oracle_text: "A colossal walker." }),
      "player1",
    );
    const source = instantiate(makeSpell(), "player1");

    const result = canTargetCard(target, source, "player1");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("shroud");
  });

  it("produces a human-readable message naming the permanent", () => {
    const target = instantiate(
      makeCreature({
        name: "Blighdroid",
        keywords: ["Shroud"],
        oracle_text: "A towering construct.",
      }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(result.valid).toBe(false);
    expect(result.message).toContain("Blighdroid");
    expect(result.message).toContain("shroud");
  });

  it("allows targeting a permanent with no shroud", () => {
    const target = instantiate(
      makeCreature({ keywords: ["Flying"], oracle_text: "Flying" }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(result.valid).toBe(true);
  });

  it("KNOWN LIMIT: the oracle fallback still fires on 'lose shroud'", () => {
    // Documented accepted limitation of the substring fallback, NOT a
    // regression introduced by #2336 — the pre-existing word-bound regex
    // matched this text too. A card that strips shroud from others is
    // reported as shrouded by both detection copies.
    //
    // `hasShroudStrict` correctly rejects this card; only the fallback
    // over-matches. Tightening this would mean a negation/granting-aware
    // oracle parse, which is out of scope here and is the same follow-up
    // noted in `keyword-actions/hexproof.ts` for "hexproof from" variants.
    const target = instantiate(
      makeCreature({
        keywords: ["Flying"],
        oracle_text: "Creatures your opponents control lose shroud.",
      }),
    );
    const source = instantiate(makeSpell(), "player2");

    const result = canTargetCard(target, source, "player2");

    expect(hasShroudStrict(target)).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("shroud");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) getTargetingRestrictions — the UI-facing restriction list
// ─────────────────────────────────────────────────────────────────────────────

describe("getTargetingRestrictions — shroud surfacing (CR 702.18a)", () => {
  it("reports shroud for a permanent with only a parsed keyword tag", () => {
    // Issue #2336: this site used `oracleText.includes("shroud")`, so a
    // keyword-tagged permanent with unrelated printed text showed no
    // restriction in the UI while the gate still blocked targeting.
    const card = instantiate(
      makeCreature({ keywords: ["Shroud"], oracle_text: "A colossal walker." }),
    );

    expect(getTargetingRestrictions(card)).toContain(
      "Shroud (can't be targeted)",
    );
  });

  it("still reports shroud when only the oracle text names it", () => {
    const card = instantiate(
      makeCreature({ keywords: [], oracle_text: "Shroud" }),
    );

    expect(getTargetingRestrictions(card)).toContain(
      "Shroud (can't be targeted)",
    );
  });

  it("KNOWN LIMIT: still reports shroud for text that only strips it from others", () => {
    // Same accepted fallback limitation as the gate test above — the UI
    // list mirrors the gate exactly, so the two stay consistent even where
    // the shared fallback over-matches.
    const card = instantiate(
      makeCreature({
        keywords: ["Flying"],
        oracle_text: "Creatures your opponents control lose shroud.",
      }),
    );

    expect(getTargetingRestrictions(card)).toContain(
      "Shroud (can't be targeted)",
    );
  });

  it("reports no restrictions for a plain permanent", () => {
    const card = instantiate(
      makeCreature({ keywords: ["Flying"], oracle_text: "Flying" }),
    );

    expect(getTargetingRestrictions(card)).not.toContain(
      "Shroud (can't be targeted)",
    );
  });

  it("agrees with the canTargetCard gate on the same permanent", () => {
    const card = makeCreature({
      keywords: ["Shroud"],
      oracle_text: "A colossal walker.",
    });
    const target = instantiate(card);
    const source = instantiate(makeSpell(), "player2");

    const gateSaysBlocked = !canTargetCard(target, source, "player2").valid;
    const uiSaysBlocked = getTargetingRestrictions(target).includes(
      "Shroud (can't be targeted)",
    );

    expect(gateSaysBlocked).toBe(true);
    expect(uiSaysBlocked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Contract parity between the three copies
// ─────────────────────────────────────────────────────────────────────────────

describe("shroud contract parity (issue #2336)", () => {
  it("gate-level hasShroud agrees with hasShroudStrict on the parsed-keyword path", () => {
    const card = makeCreature({
      keywords: ["Shroud"],
      oracle_text: "Nothing here.",
    });
    const instance = instantiate(card);
    expect(hasShroud(instance)).toBe(true);
    expect(hasShroudStrict(instance)).toBe(true);
  });

  it("gate-level hasShroud does not fire on a mere 'unshroud' substring", () => {
    const card = makeCreature({
      keywords: [],
      oracle_text: "This has the word unshroud",
    });
    expect(hasShroud(instantiate(card))).toBe(false);
  });

  it("both detection paths reject a permanent with neither signal", () => {
    const card = makeCreature({ keywords: [], oracle_text: "T flying" });
    const instance = instantiate(card);
    expect(hasShroud(instance)).toBe(false);
    expect(hasShroudStrict(instance)).toBe(false);
  });
});
