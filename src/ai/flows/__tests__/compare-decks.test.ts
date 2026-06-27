/**
 * Tests for multi-deck comparison and meta-positioning (issue #1075).
 *
 * These verify the LOCAL-FIRST heuristic core:
 *   1. Fewer than two decks yields an insufficient report (no crash).
 *   2. Identical decks overlap 100% and mirror at 50/50.
 *   3. An asymmetric pair (aggro vs control) favours control, and the matrix
 *      is antisymmetric (row[a][b] + row[b][a] === 1) with a 0.5 diagonal.
 *   4. Meta-positioning ranks decks deterministically; rank 1 has the max score.
 *   5. The single-deck-vs-meta-archetype path resolves categories and produces
 *      a matrix without owning a list for the archetype.
 *   6. The recommendation names the best build and swap cards are grounded in
 *      the actual card names.
 */

import {
  compareDecks,
  type DeckComparisonEntry,
  type DeckComparisonReport,
} from "../compare-decks";
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

/**
 * A low-curve, creature-heavy aggro shell. The archetype detector keys off
 * average CMC, creature ratio and burn/removal text.
 */
function aggroDeck(): DeckCard[] {
  return [
    card("Lightning Bolt", "Instant", 1, 4, "Lightning Bolt deals 3 damage to any target.", ["R"]),
    card("Goblin Guide", "Creature — Goblin Scout", 1, 4, "Haste", ["R"]),
    card("Monastery Swiftspear", "Creature — Human Monk", 1, 4, "Prowess, haste", ["R"]),
    card("Eidolon of the Great Revel", "Creature — Spirit", 2, 3, "Whenever a player casts a spell, deal 2 damage.", ["R"]),
    card("Mountain", "Basic Land — Mountain", 0, 18, "", ["R"]),
  ];
}

/**
 * A reactive, high-CMC control shell: sweepers, countermagic, card draw and
 * few expensive finishers.
 */
function controlDeck(): DeckCard[] {
  return [
    card("Counterspell", "Instant", 2, 4, "Counter target spell.", ["U"]),
    card("Wrath of God", "Sorcery", 4, 4, "Destroy all creatures.", ["W"]),
    card("Fact or Fiction", "Instant", 4, 3, "Look at the top five cards of your library.", ["U"]),
    card("Teferi, Hero of Dominaria", "Legendary Planeswalker — Teferi", 5, 2, "+1 draw", ["W", "U"]),
    card("Plains", "Basic Land — Plains", 0, 12, "", ["W"]),
    card("Island", "Basic Land — Island", 0, 12, "", ["U"]),
  ];
}

/** A second distinct aggro list for the symmetric-pair test. */
function aggroDeckVariant(): DeckCard[] {
  return aggroDeck().map((c) => ({ ...c }));
}

function cell(
  report: DeckComparisonReport,
  rowName: string,
  colName: string,
) {
  return report.matchupMatrix.find(
    (c) => c.rowDeck === rowName && c.colDeck === colName,
  );
}

describe("compareDecks", () => {
  it("returns an insufficient report for fewer than two decks", () => {
    const one: DeckComparisonEntry[] = [
      { name: "Solo", cards: aggroDeck() },
    ];
    const empty = compareDecks([]);

    expect(one.length === 1 && true).toBe(true);
    const report = compareDecks(one);
    expect(report.sufficient).toBe(false);
    expect(report.matchupMatrix).toEqual([]);
    expect(report.metaPositioning).toEqual([]);
    expect(report.recommendation.bestDeck).toBe("");

    expect(empty.sufficient).toBe(false);
    expect(empty.note).toMatch(/at least two/i);
  });

  it("reports 100% overlap and a 50/50 mirror for identical decks", () => {
    const report = compareDecks([
      { name: "Aggro A", cards: aggroDeck() },
      { name: "Aggro B", cards: aggroDeckVariant() },
    ]);

    expect(report.sufficient).toBe(true);
    expect(report.overlaps).toHaveLength(1);
    expect(report.overlaps[0].overlapPercent).toBe(100);

    // Diagonal (mirror) cells are 0.5; off-diagonal same-category is also 0.5.
    const aa = cell(report, "Aggro A", "Aggro A");
    const ab = cell(report, "Aggro A", "Aggro B");
    expect(aa?.winProbability).toBeCloseTo(0.5, 5);
    expect(ab?.winProbability).toBeCloseTo(0.5, 5);

    // Identical decks share the same meta score and tie at rank 1.
    expect(report.metaPositioning).toHaveLength(2);
    const scores = report.metaPositioning.map((p) => p.metaScore);
    expect(scores[0]).toBeCloseTo(scores[1], 5);
    expect(report.metaPositioning.every((p) => p.rank === 1)).toBe(true);
  });

  it("favours control over aggro and keeps the matrix antisymmetric", () => {
    const report = compareDecks([
      { name: "Aggro", cards: aggroDeck() },
      { name: "Control", cards: controlDeck() },
    ]);

    expect(report.sufficient).toBe(true);

    const aggroVsControl = cell(report, "Aggro", "Control");
    const controlVsAggro = cell(report, "Control", "Aggro");

    expect(aggroVsControl).toBeDefined();
    expect(controlVsAggro).toBeDefined();
    // Control is favoured: aggro win prob < 0.5, control > 0.5.
    expect(aggroVsControl!.winProbability).toBeLessThan(0.5);
    expect(controlVsAggro!.winProbability).toBeGreaterThan(0.5);
    // Antisymmetry: row[a][b] + row[b][a] === 1.
    expect(
      aggroVsControl!.winProbability + controlVsAggro!.winProbability,
    ).toBeCloseTo(1, 5);

    // Diagonal mirrors are exactly 0.5.
    expect(cell(report, "Aggro", "Aggro")!.winProbability).toBeCloseTo(0.5, 5);
    expect(cell(report, "Control", "Control")!.winProbability).toBeCloseTo(0.5, 5);
  });

  it("ranks meta-positioning deterministically with rank 1 holding the max score", () => {
    const report = compareDecks([
      { name: "Aggro", cards: aggroDeck() },
      { name: "Control", cards: controlDeck() },
      { name: "Aggro 2", cards: aggroDeckVariant() },
    ]);

    const positions = [...report.metaPositioning].sort((a, b) => a.rank - b.rank);
    expect(positions[0].rank).toBe(1);
    const maxScore = Math.max(...report.metaPositioning.map((p) => p.metaScore));
    expect(positions[0].metaScore).toBeCloseTo(maxScore, 5);

    // Scores are monotonically non-increasing by rank.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].metaScore).toBeLessThanOrEqual(positions[i - 1].metaScore);
    }

    // The recommendation's best deck matches rank 1.
    expect(report.recommendation.bestDeck).toBe(positions[0].name);
    expect(report.recommendation.reasoning).toMatch(/best-positioned/i);
  });

  it("supports the single-deck-vs-meta-archetype path with no owned list", () => {
    const report = compareDecks([
      { name: "My Deck", cards: controlDeck() },
      { name: "Burn (meta)", archetypeOverride: "Burn" },
    ]);

    expect(report.sufficient).toBe(true);
    expect(report.decks).toHaveLength(2);

    const meta = report.decks.find((d) => d.name === "Burn (meta)");
    expect(meta).toBeDefined();
    expect(meta!.archetype).toBe("Burn");
    expect(meta!.category).toBe("aggro");

    // The matrix still resolves a real matchup between the two columns.
    const myVsBurn = cell(report, "My Deck", "Burn (meta)");
    expect(myVsBurn).toBeDefined();
    // Control (My Deck) is favoured vs aggro (Burn).
    expect(myVsBurn!.winProbability).toBeGreaterThan(0.5);
  });

  it("grounds the recommendation swap cards in the actual deck card names", () => {
    const report = compareDecks([
      { name: "Aggro", cards: aggroDeck() },
      { name: "Control", cards: controlDeck() },
    ]);

    expect(report.recommendation.swapsTowardBest).toBeDefined();
    const swap = report.recommendation.swapsTowardBest!;
    // From the weaker deck (aggro) toward the recommended build (control).
    expect(swap.fromDeck).toBe("Aggro");
    expect(swap.toDeck).toBe("Control");

    const allAdd = swap.cardsToAdd.map((c) => c.name.toLowerCase());
    const allRemove = swap.cardsToRemove.map((c) => c.name.toLowerCase());
    // Add cards are drawn from the control list; remove cards from the aggro list.
    expect(allAdd).toEqual(expect.arrayContaining(["counterspell", "wrath of god"]));
    expect(allRemove).toEqual(expect.arrayContaining(["lightning bolt", "goblin guide"]));
    // Capped at the three highest-impact swaps of each.
    expect(swap.cardsToAdd.length).toBeLessThanOrEqual(3);
    expect(swap.cardsToRemove.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic for identical inputs", () => {
    const entries: DeckComparisonEntry[] = [
      { name: "Aggro", cards: aggroDeck() },
      { name: "Control", cards: controlDeck() },
    ];
    expect(compareDecks(entries)).toEqual(compareDecks(entries));
  });

  it("produces role and curve diffs for every unordered pair", () => {
    const report = compareDecks([
      { name: "Aggro", cards: aggroDeck() },
      { name: "Control", cards: controlDeck() },
    ]);

    expect(report.roleDiffs).toHaveLength(1);
    expect(report.curveDiffs).toHaveLength(1);
    // Control runs more removal than aggro, so aggro's removal diff is negative.
    const roleDiff = report.roleDiffs[0].diff;
    expect(roleDiff.removal).toBeLessThan(0);
  });
});
