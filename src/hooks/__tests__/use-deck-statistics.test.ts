import { describe, it, expect } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { DeckCard } from "@/app/actions";
import {
  analyzeDeck,
  getDeckSignature,
  useDeckStatistics,
} from "../use-deck-statistics";

/**
 * Tests for the deck-statistics memoization added in issue #1083.
 *
 * The deck builder re-renders frequently while editing (search typing, tab
 * switches, AI-assistant activity). `useDeckStatistics` must NOT recompute
 * its expensive `analyzeDeck` pass unless the deck's *contents* actually
 * change — even when the parent passes a freshly-allocated array.
 */
function makeCard(id: string, overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    id,
    name: id,
    cmc: 2,
    type_line: "Creature — Test",
    colors: ["R"],
    color_identity: ["R"],
    legalities: {},
    count: 1,
    ...overrides,
  } as DeckCard;
}

describe("getDeckSignature", () => {
  it("returns identical signatures for arrays with the same contents", () => {
    const a = [makeCard("a", { count: 2 }), makeCard("b")];
    const b = [makeCard("a", { count: 2 }), makeCard("b")];
    // Distinct array references, identical contents.
    expect(a).not.toBe(b);
    expect(getDeckSignature(a)).toBe(getDeckSignature(b));
  });

  it("changes when a card's count changes", () => {
    const a = [makeCard("a", { count: 1 })];
    const b = [makeCard("a", { count: 2 })];
    expect(getDeckSignature(a)).not.toBe(getDeckSignature(b));
  });

  it("changes when a card's cmc, colors, or type_line change", () => {
    const base = [makeCard("a")];
    expect(getDeckSignature(base)).not.toBe(
      getDeckSignature([makeCard("a", { cmc: 5 })]),
    );
    expect(getDeckSignature(base)).not.toBe(
      getDeckSignature([makeCard("a", { colors: ["U"] })]),
    );
    expect(getDeckSignature(base)).not.toBe(
      getDeckSignature([makeCard("a", { type_line: "Instant" })]),
    );
  });

  it("treats two empty decks as equal", () => {
    expect(getDeckSignature([])).toBe(getDeckSignature([]));
  });
});

describe("analyzeDeck", () => {
  it("aggregates counts, mana curve, colors, and types", () => {
    const deck = [
      makeCard("a", { count: 2, cmc: 1, colors: ["R"], type_line: "Creature" }),
      makeCard("b", { count: 3, cmc: 2, colors: ["U"], type_line: "Instant" }),
    ];
    const result = analyzeDeck(deck);
    expect(result.totalCards).toBe(5);
    expect(result.uniqueCards).toBe(2);
    expect(result.manaCurve[1]).toBe(2);
    expect(result.manaCurve[2]).toBe(3);
    expect(result.colorDistribution.R).toBe(2);
    expect(result.colorDistribution.U).toBe(3);
    expect(result.typeDistribution.creature).toBe(2);
    expect(result.typeDistribution.instant).toBe(3);
  });
});

describe("useDeckStatistics", () => {
  it("does not recompute when the deck array reference changes but contents are identical", () => {
    const contents = [makeCard("a", { count: 2 }), makeCard("b")];
    const deckA = [...contents];
    const deckB = [...contents]; // new array, same contents

    const { result, rerender } = renderHook(
        ({ deck }) => useDeckStatistics(deck),
        { initialProps: { deck: deckA } },
    );
    const first = result.current;

    // Re-render with a brand-new array reference holding identical cards.
    rerender({ deck: deckB });

    // Memoized: the exact same result object must be returned (no recompute).
    expect(result.current).toBe(first);
  });

  it("recomputes when the deck contents change", () => {
    const deckA = [makeCard("a", { count: 1 })];
    const deckB = [makeCard("a", { count: 1 }), makeCard("b")];

    const { result, rerender } = renderHook(
        ({ deck }) => useDeckStatistics(deck),
        { initialProps: { deck: deckA } },
    );
    const first = result.current;
    expect(first.totalCards).toBe(1);

    rerender({ deck: deckB });

    // A new result object reflecting the new contents.
    expect(result.current).not.toBe(first);
    expect(result.current.totalCards).toBe(2);
    expect(result.current.uniqueCards).toBe(2);
  });
});
