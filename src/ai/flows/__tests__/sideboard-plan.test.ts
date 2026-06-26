/**
 * Tests for per-matchup sideboard plan generation (issue #1076).
 *
 * These verify the LOCAL-FIRST heuristic:
 *   1. Vs aggro, removal is boarded in and slow threats boarded out.
 *   2. Vs combo, disruption is boarded in and creature-only removal is NOT.
 *   3. An empty sideboard yields empty board-in/out for every matchup.
 *   4. The default emits >= 3 matchup plans and is deterministic.
 *   5. Board-in/out quantities are balanced (out matches in).
 */

import {
  generatePerMatchupSideboardPlans,
  type MatchupSideboardPlan,
} from "../sideboard-plan";
import type { DeckCard } from "@/app/actions";

function card(
  name: string,
  typeLine: string,
  cmc: number,
  count: number,
  oracle = "",
  colors: string[] = ["W"],
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: typeLine,
    colors,
    color_identity: colors,
    legalities: {},
    count,
    oracle_text: oracle,
  };
}

/** A midrange white deck with expensive threats and a little maindeck removal. */
function buildMainDeck(): DeckCard[] {
  return [
    card("Serra Angel", "Creature — Angel", 5, 4, "Flying, vigilance"),
    card("Grizzly Bears", "Creature — Bear", 2, 4),
    card("Day of Judgment", "Sorcery", 4, 2, "Destroy all creatures."),
    card("Plains", "Basic Land — Plains", 0, 14),
  ];
}

/** A sideboard heavy on removal + disruption, with a threat filler. */
function buildSideboard(): DeckCard[] {
  return [
    card("Wrath of God", "Sorcery", 4, 4, "Destroy all creatures."),
    card("Path to Exile", "Instant", 1, 4, "Exile target creature."),
    card("Thoughtseize", "Sorcery", 1, 2, "Target player discards a card."),
    card("Negate", "Instant", 2, 2, "Counter target noncreature spell."),
    card("Llanowar Elves", "Creature — Elf Druid", 1, 3, "Tap: Add G."),
  ];
}

function names(plan: MatchupSideboardPlan, which: "in" | "out"): string[] {
  const list = which === "in" ? plan.boardIn : plan.boardOut;
  return list.map((c) => c.cardName);
}

function total(
  plan: MatchupSideboardPlan,
  which: "in" | "out",
): number {
  const list = which === "in" ? plan.boardIn : plan.boardOut;
  return list.reduce((s, c) => s + c.count, 0);
}

describe("generatePerMatchupSideboardPlans", () => {
  it("boards removal IN and slow threats OUT versus an aggro matchup", () => {
    const result = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
      ["Burn"],
    );

    expect(result.matchupPlans).toHaveLength(1);
    const plan = result.matchupPlans[0];
    expect(plan.opponentArchetypeCategory).toBe("aggro");

    const inNames = names(plan, "in");
    expect(inNames).toContain("Wrath of God");
    expect(inNames).toContain("Path to Exile");

    // Expensive creature is the first to come out vs a fast deck.
    expect(names(plan, "out")).toContain("Serra Angel");

    // Boarded out quantity matches boarded in quantity.
    expect(total(plan, "out")).toBe(total(plan, "in"));
    expect(total(plan, "in")).toBeGreaterThan(0);
  });

  it("boards disruption IN and excludes creature removal vs a combo matchup", () => {
    const result = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
      ["Storm"],
    );

    const plan = result.matchupPlans[0];
    expect(plan.opponentArchetypeCategory).toBe("combo");

    const inNames = names(plan, "in");
    expect(inNames).toContain("Thoughtseize");
    expect(inNames).toContain("Negate");
    // Creature-only removal is not wanted against combo.
    expect(inNames).not.toContain("Wrath of God");
    expect(inNames).not.toContain("Path to Exile");
  });

  it("trims redundant removal vs a control matchup", () => {
    const result = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
      ["Draw-Go"],
    );

    const plan = result.matchupPlans[0];
    expect(plan.opponentArchetypeCategory).toBe("control");
    // Vs control, maindeck removal (Day of Judgment) is cuttable.
    expect(names(plan, "out")).toContain("Day of Judgment");
  });

  it("returns empty board-in/out for every matchup when the sideboard is empty", () => {
    const result = generatePerMatchupSideboardPlans(buildMainDeck(), [], [
      "Burn",
      "Storm",
      "Draw-Go",
    ]);

    expect(result.matchupPlans.length).toBeGreaterThan(0);
    for (const plan of result.matchupPlans) {
      expect(plan.boardIn).toEqual([]);
      expect(plan.boardOut).toEqual([]);
    }
  });

  it("emits at least three matchup plans by default", () => {
    const result = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
    );
    expect(result.matchupPlans.length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for identical inputs", () => {
    const a = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
    );
    const b = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
    );
    expect(b).toEqual(a);
  });

  it("detects a player archetype and keeps board-in/out balanced", () => {
    const result = generatePerMatchupSideboardPlans(
      buildMainDeck(),
      buildSideboard(),
    );
    expect(result.playerArchetype).toBeTruthy();
    expect(result.playerArchetypeCategory).toBeTruthy();

    for (const plan of result.matchupPlans) {
      // Out quantity should never exceed in quantity for a generated plan.
      expect(total(plan, "out")).toBeLessThanOrEqual(total(plan, "in"));
    }
  });

  it("handles a malformed/empty maindeck without throwing", () => {
    expect(() =>
      generatePerMatchupSideboardPlans([], buildSideboard(), ["Burn"]),
    ).not.toThrow();
    const result = generatePerMatchupSideboardPlans(
      [],
      buildSideboard(),
      ["Burn"],
    );
    expect(result.matchupPlans).toHaveLength(1);
    expect(result.matchupPlans[0].boardOut).toEqual([]);
  });
});
