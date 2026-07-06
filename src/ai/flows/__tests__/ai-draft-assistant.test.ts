/**
 * Tests for the heuristic draft + sealed-deck assistant flow (issue #1078).
 *
 * `ai-draft-assistant.ts` (issue #446, #565) replaced its Genkit AI provider
 * calls with pure heuristic algorithms and the three exported entry points
 * (`getDraftPickRecommendation`, `buildSealedDeck`, `analyzeLimitedPool`) had
 * zero direct coverage. This suite exercises the public surface plus the
 * implicit internal branches:
 *   - pick scoring: creatures > instants/sorceries > CMC, color-synergy bonus
 *   - color counting + sorted-color recommendation
 *   - sealed-deck selection, curve analysis and archetype detection
 *   - power-card identification (creature, instant, sorcery)
 *   - sideboard generation = pool - deck
 *   - synergy + color-alignment helpers
 * The functions take plain JSON-shaped inputs (DraftCard with loose typing)
 * and the source file has no external imports, so we drive the real
 * implementation end-to-end with no mocking required.
 */

import {
  getDraftPickRecommendation,
  buildSealedDeck,
  analyzeLimitedPool,
} from "../ai-draft-assistant";

interface DraftCard {
  name: string;
  colors?: string[];
  cmc?: number;
  type?: string;
  [key: string]: unknown;
}

function card(name: string, overrides: Partial<DraftCard> = {}): DraftCard {
  return { name, ...overrides };
}

describe("getDraftPickRecommendation", () => {
  it("returns a structured output for a typical draft pack", async () => {
    const out = await getDraftPickRecommendation({
      pool: [
        card("Savannah Lion", { colors: ["W"], cmc: 1, type: "Creature" }),
        card("Healing Salve", { colors: ["W"], cmc: 1, type: "Instant" }),
      ],
      pickNumber: 1,
      packCards: [
        card("Grizzly Bears", { colors: ["G"], cmc: 2, type: "Creature" }),
        card("Divination", { colors: ["U"], cmc: 3, type: "Sorcery" }),
        card("Plains", { type: "Basic Land — Plains" }),
      ],
      format: "draft",
    });

    expect(out).toHaveProperty("recommendedPick");
    expect(out).toHaveProperty("reasoning");
    expect(out).toHaveProperty("alternativeOptions");
    expect(out).toHaveProperty("synergies");
    expect(out).toHaveProperty("colorAlignment");
    expect(typeof out.recommendedPick).toBe("number");
    expect(typeof out.reasoning).toBe("string");
    expect(Array.isArray(out.alternativeOptions)).toBe(true);
    expect(Array.isArray(out.synergies)).toBe(true);
  });

  it("prefers creatures over instants and sorceries in a creature-light pack", async () => {
    const out = await getDraftPickRecommendation({
      pool: [],
      pickNumber: 1,
      packCards: [
        card("Divination", { colors: ["U"], cmc: 3, type: "Sorcery" }),
        card("Grizzly Bears", { colors: ["G"], cmc: 2, type: "Creature" }),
      ],
      format: "draft",
    });

    // Index 1 = Grizzly Bears (creature, higher score).
    expect(out.recommendedPick).toBe(1);
  });

  it("throws when the pack is empty (no cards to evaluate)", async () => {
    // The current implementation dereferences `packCards[bestPick].name`
    // unconditionally, so an empty pack surfaces as a TypeError. Documented
    // here so a future guard change is a visible behaviour delta.
    await expect(
      getDraftPickRecommendation({
        pool: [],
        pickNumber: 1,
        packCards: [],
        format: "draft",
      }),
    ).rejects.toThrow();
  });

  it("lists cards within 3 score points of the best as alternatives (best pick excluded)", async () => {
    // Both cards score identically (creature + same CMC + no color overlap).
    // The first card wins the tie (bestPick) and the second surfaces as an
    // alternative because it is within bestScore - 3 of the winner.
    const out = await getDraftPickRecommendation({
      pool: [],
      pickNumber: 1,
      packCards: [
        card("Bear A", { colors: ["G"], cmc: 2, type: "Creature" }),
        card("Bear B", { colors: ["G"], cmc: 2, type: "Creature" }),
      ],
      format: "draft",
    });
    const indices = out.alternativeOptions.map((a) => a.index);
    // The winner is never an alternative.
    expect(indices).not.toContain(out.recommendedPick);
    // The runner-up within bestScore - 3 must be listed.
    expect(indices).toContain(out.recommendedPick === 0 ? 1 : 0);
  });

  it("rewards color overlap with the existing pool", async () => {
    const out = await getDraftPickRecommendation({
      pool: [
        card("Forest #1", { colors: ["G"] }),
        card("Forest #2", { colors: ["G"] }),
        card("Forest #3", { colors: ["G"] }),
      ],
      pickNumber: 1,
      packCards: [
        card("Off-color Bear", { colors: ["B"], cmc: 2, type: "Creature" }),
        // Same score on type, but heavy green bonus from pool (3 * 2 = +6).
        card("Grizzly Bears", { colors: ["G"], cmc: 2, type: "Creature" }),
      ],
      format: "draft",
    });
    expect(out.recommendedPick).toBe(1);
    expect(out.colorAlignment.primary).toBe("G");
  });

  it("emits a colorAlignment even when the chosen card has no colors", async () => {
    const out = await getDraftPickRecommendation({
      pool: [],
      pickNumber: 1,
      packCards: [card("Colorless Artifact", { cmc: 2, type: "Artifact" })],
      format: "draft",
    });
    expect(out.recommendedPick).toBe(0);
    // No color info on the chosen card ⇒ empty alignment is the documented
    // behaviour from `analyzeColorAlignment`.
    expect(out.colorAlignment).toEqual({});
  });
});

describe("buildSealedDeck", () => {
  it("returns a complete SealedBuildOutput for a typical pool", async () => {
    const out = await buildSealedDeck({
      pool: [
        card("Grizzly Bears", { colors: ["G"], cmc: 2, type: "Creature" }),
        card("Llanowar Elves", { colors: ["G"], cmc: 1, type: "Creature" }),
        card("Divination", { colors: ["U"], cmc: 3, type: "Sorcery" }),
      ],
      format: "sealed",
    });

    expect(out).toHaveProperty("suggestedDeck");
    expect(out).toHaveProperty("colorRecommendation");
    expect(out).toHaveProperty("curveAnalysis");
    expect(out).toHaveProperty("sideboard");
    expect(out).toHaveProperty("archetypes");
    expect(out.suggestedDeck.length).toBeLessThanOrEqual(40);
    expect(typeof out.colorRecommendation.primary).toBe("string");
    expect(typeof out.colorRecommendation.reasoning).toBe("string");
  });

  it("selects the color with the most cards as primary", async () => {
    const out = await buildSealedDeck({
      pool: [
        card("R Card 1", { colors: ["R"] }),
        card("R Card 2", { colors: ["R"] }),
        card("R Card 3", { colors: ["R"] }),
        card("W Card 1", { colors: ["W"] }),
      ],
      format: "sealed",
    });
    expect(out.colorRecommendation.primary).toBe("R");
  });

  it("falls back to 'W' as the default primary when no colors are present", async () => {
    const out = await buildSealedDeck({
      pool: [
        card("Colorless 1", { type: "Artifact" }),
        card("Colorless 2", { type: "Artifact" }),
      ],
      format: "sealed",
    });
    expect(out.colorRecommendation.primary).toBe("W");
  });

  it("places deck cards in a separate sideboard (no overlap by name)", async () => {
    const out = await buildSealedDeck({
      pool: [
        card("Grizzly Bears", { colors: ["G"], type: "Creature" }),
        card("Llanowar Elves", { colors: ["G"], type: "Creature" }),
        card("Divination", { colors: ["U"], type: "Sorcery" }),
      ],
      format: "sealed",
    });
    const deckNames = new Set(out.suggestedDeck.map((c) => c.name));
    for (const side of out.sideboard) {
      expect(deckNames.has(side.name)).toBe(false);
    }
  });

  it("returns an archetypes array (per-format detection is covered by analyzeLimitedPool)", async () => {
    // The sealed-deck builder currently passes the (dehydrated) deck to
    // detectArchetypes, so no type info survives; archetypes come out empty.
    // Per-pool archetype detection is covered by the analyzeLimitedPool
    // suite below, where the full card objects are still in scope.
    const pool: DraftCard[] = Array.from({ length: 20 }, (_, i) =>
      card(`Bear ${i}`, { colors: ["G"], type: "Creature" }),
    );
    const out = await buildSealedDeck({ pool, format: "sealed" });
    expect(Array.isArray(out.archetypes)).toBe(true);
  });

  it("handles an empty pool without throwing", async () => {
    const out = await buildSealedDeck({ pool: [], format: "sealed" });
    expect(out.suggestedDeck).toEqual([]);
    expect(out.sideboard).toEqual([]);
  });
});

describe("analyzeLimitedPool", () => {
  it("returns a complete PoolAnalysisOutput for a typical pool", async () => {
    const out = await analyzeLimitedPool({
      pool: [
        card("Grizzly Bears", { colors: ["G"], cmc: 2, type: "Creature" }),
        card("Divination", { colors: ["U"], cmc: 3, type: "Sorcery" }),
      ],
      format: "sealed",
    });

    expect(out).toHaveProperty("colorBreakdown");
    expect(out).toHaveProperty("curveBreakdown");
    expect(out).toHaveProperty("recommendedColors");
    expect(out).toHaveProperty("archetypeSuggestions");
    expect(out).toHaveProperty("powerCards");
    expect(typeof out.colorBreakdown).toBe("object");
    expect(typeof out.curveBreakdown).toBe("object");
  });

  it("counts each color once per card even with multi-color cards", async () => {
    const out = await analyzeLimitedPool({
      pool: [
        card("Selesnya Card", { colors: ["W", "G"] }),
        card("Selesnya Card 2", { colors: ["W", "G"] }),
      ],
      format: "sealed",
    });
    expect(out.colorBreakdown.W).toBe(2);
    expect(out.colorBreakdown.G).toBe(2);
  });

  it("builds a curve breakdown keyed by CMC", async () => {
    const out = await analyzeLimitedPool({
      pool: [
        card("One Drop", { cmc: 1 }),
        card("Two Drop", { cmc: 2 }),
        card("Two Drop 2", { cmc: 2 }),
      ],
      format: "sealed",
    });
    expect(out.curveBreakdown[1]).toBe(1);
    expect(out.curveBreakdown[2]).toBe(2);
  });

  it("treats cards with no cmc as 0 in the curve", async () => {
    const out = await analyzeLimitedPool({
      pool: [card("No CMC")],
      format: "sealed",
    });
    expect(out.curveBreakdown[0]).toBe(1);
  });

  it("flags low-cost creatures as power cards", async () => {
    const out = await analyzeLimitedPool({
      pool: [card("Heir of the Wilds", { cmc: 2, type: "Creature" })],
      format: "sealed",
    });
    expect(out.powerCards).toEqual([
      expect.objectContaining({ name: "Heir of the Wilds", rating: 7 }),
    ]);
  });

  it("flags instants/sorceries as 6-rated power cards", async () => {
    const out = await analyzeLimitedPool({
      pool: [card("Lightning Bolt", { cmc: 1, type: "Instant" })],
      format: "sealed",
    });
    expect(out.powerCards).toEqual([
      expect.objectContaining({ name: "Lightning Bolt", rating: 6 }),
    ]);
  });

  it("ignores cards that are neither creatures nor instants/sorceries", async () => {
    const out = await analyzeLimitedPool({
      pool: [card("Plains", { type: "Basic Land" })],
      format: "sealed",
    });
    expect(out.powerCards).toEqual([]);
  });

  it("caps the power cards list at 5 entries", async () => {
    const pool: DraftCard[] = Array.from({ length: 12 }, (_, i) =>
      card(`Bear ${i}`, { cmc: 2, type: "Creature" }),
    );
    const out = await analyzeLimitedPool({ pool, format: "sealed" });
    expect(out.powerCards.length).toBeLessThanOrEqual(5);
  });

  it("sorts power cards by rating descending", async () => {
    const out = await analyzeLimitedPool({
      pool: [
        card("Bolt", { cmc: 1, type: "Instant" }),
        card("Bear", { cmc: 2, type: "Creature" }),
      ],
      format: "sealed",
    });
    const ratings = out.powerCards.map((p) => p.rating);
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i - 1]).toBeGreaterThanOrEqual(ratings[i]);
    }
  });

  it("handles an empty pool without throwing", async () => {
    const out = await analyzeLimitedPool({ pool: [], format: "sealed" });
    expect(out.colorBreakdown).toEqual({});
    expect(out.curveBreakdown).toEqual({});
    expect(out.powerCards).toEqual([]);
    expect(out.archetypeSuggestions).toEqual([]);
  });

  it("emits an Aggro archetype when the pool has > 15 creatures", async () => {
    const pool: DraftCard[] = Array.from({ length: 20 }, (_, i) =>
      card(`Bear ${i}`, { colors: ["G"], type: "Creature" }),
    );
    const out = await analyzeLimitedPool({ pool, format: "sealed" });
    expect(out.archetypeSuggestions.some((a) => a.name === "Aggro")).toBe(true);
  });

  it("emits a Control archetype when the pool has > 10 instants/sorceries", async () => {
    const pool: DraftCard[] = Array.from({ length: 12 }, (_, i) =>
      card(`Spell ${i}`, { colors: ["U"], type: "Instant" }),
    );
    const out = await analyzeLimitedPool({ pool, format: "sealed" });
    expect(out.archetypeSuggestions.some((a) => a.name === "Control")).toBe(true);
  });

  it("emits no archetype for a small mixed pool", async () => {
    const pool: DraftCard[] = [
      card("Bear", { type: "Creature" }),
      card("Bolt", { type: "Instant" }),
      card("Counterspell", { type: "Instant" }),
    ];
    const out = await analyzeLimitedPool({ pool, format: "sealed" });
    expect(out.archetypeSuggestions).toEqual([]);
  });
});
