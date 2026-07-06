/**
 * AI Worker — heuristic deck-coach handler tests (#1243)
 *
 * Asserts the `reviewDeck` handler exposed by the AI Web Worker:
 *  - returns results IDENTICAL to the in-thread `reviewDeckHeuristic` (parity
 *    / no behavior change), across aggro, control and stress decks;
 *  - accepts the same `decklist` / `format` / `cards` shape callers already
 *    pass to the in-process function;
 *  - returns the same `DeckReviewOutput` structure for an empty deck
 *    (graceful fallback, no error).
 *
 * The handler object is imported directly (Comlink.expose is a no-op side
 * effect under jsdom), which is exactly the code that runs inside the worker.
 */
import { describe, test, expect } from "@jest/globals";

import { aiWorker } from "../ai-worker";
import { reviewDeckHeuristic } from "@/lib/heuristic-deck-coach";
import type { DeckReviewOutput } from "@/lib/heuristic-deck-coach";
import type { HeuristicDeckCard } from "../worker-types";

function makeHeuristicCard(
  name: string,
  count: number,
  overrides: Partial<HeuristicDeckCard> = {},
): HeuristicDeckCard {
  return {
    name,
    count,
    id: name.toLowerCase().replace(/\s+/g, "-"),
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: {},
    type_line: "",
    mana_cost: "{0}",
    oracle_text: "",
    ...overrides,
  };
}

/** A representative Control-leaning deck used in the parity test. */
function buildControlDeck(): HeuristicDeckCard[] {
  return [
    makeHeuristicCard("Sol Ring", 1, { type_line: "Artifact", mana_cost: "{1}" }),
    makeHeuristicCard("Counterspell", 4, {
      type_line: "Instant",
      cmc: 2,
      colors: ["U"],
      color_identity: ["U"],
      mana_cost: "{U}{U}",
    }),
    makeHeuristicCard("Cryptic Command", 2, {
      type_line: "Instant",
      cmc: 4,
      colors: ["U"],
      color_identity: ["U"],
      mana_cost: "{U}{U}{U}{U}",
    }),
    makeHeuristicCard("Thoughtseize", 2, {
      type_line: "Sorcery",
      cmc: 1,
      colors: ["B"],
      color_identity: ["B"],
      mana_cost: "{B}",
    }),
  ];
}

/** An Aggro deck used to confirm parity across archetypes (#1243). */
function buildAggroDeck(): HeuristicDeckCard[] {
  return [
    makeHeuristicCard("Goblin Guide", 4, {
      type_line: "Creature — Goblin Warrior",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      mana_cost: "{R}",
    }),
    makeHeuristicCard("Lightning Bolt", 4, {
      type_line: "Instant",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      mana_cost: "{R}",
    }),
    makeHeuristicCard("Monastery Swiftspear", 4, {
      type_line: "Creature — Human Warrior",
      cmc: 1,
      colors: ["R"],
      color_identity: ["R"],
      mana_cost: "{R}",
    }),
  ];
}

describe("AI Worker — reviewDeck handler (#1243)", () => {
  test("returns identical DeckReviewOutput to the in-process engine (control deck)", async () => {
    const cards = buildControlDeck();
    const decklist = "1 Sol Ring\n4 Counterspell\n2 Cryptic Command\n2 Thoughtseize";
    const format = "commander";

    const expected: DeckReviewOutput = reviewDeckHeuristic(
      decklist,
      format,
      cards,
    );
    const result = (await aiWorker.reviewDeck({
      decklist,
      format,
      cards,
    })) as DeckReviewOutput;

    // Deep equality — the worker path must not alter decisions.
    expect(result).toEqual(expected);
  });

  test("returns identical DeckReviewOutput for an aggro deck", async () => {
    const cards = buildAggroDeck();
    const decklist = "4 Goblin Guide\n4 Lightning Bolt\n4 Monastery Swiftspear";
    const format = "modern";

    const expected = reviewDeckHeuristic(decklist, format, cards);
    const result = (await aiWorker.reviewDeck({
      decklist,
      format,
      cards,
    })) as DeckReviewOutput;

    expect(result).toEqual(expected);
  });

  test("returns a well-formed DeckReviewOutput for an empty deck (no error)", async () => {
    const result = (await aiWorker.reviewDeck({
      decklist: "",
      format: "commander",
      cards: [],
    })) as DeckReviewOutput;

    expect(result).toBeDefined();
    expect(typeof result.reviewSummary).toBe("string");
    expect(result.reviewSummary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.deckOptions)).toBe(true);
    expect(result.synergies).toBeDefined();
    expect(Array.isArray(result.synergies!.present)).toBe(true);
    expect(Array.isArray(result.synergies!.missing)).toBe(true);
  });

  test("worker result matches the in-process engine for an empty deck", async () => {
    const expected = reviewDeckHeuristic("", "commander", []);
    const result = (await aiWorker.reviewDeck({
      decklist: "",
      format: "commander",
      cards: [],
    })) as DeckReviewOutput;

    expect(result).toEqual(expected);
  });

  test("forwards decklist / format / cards verbatim (no mutation)", async () => {
    // The worker must not strip or rewrite payload fields — the result must
    // be byte-for-byte identical to a direct in-process call with the same
    // inputs, which is exactly the parity guarantee the offload promises.
    const cards = buildControlDeck();
    const decklist = "1 Sol Ring\n4 Counterspell";
    const format = "modern";

    const expected = reviewDeckHeuristic(decklist, format, cards);
    const result = (await aiWorker.reviewDeck({
      decklist,
      format,
      cards,
    })) as DeckReviewOutput;

    expect(result.reviewSummary).toBe(expected.reviewSummary);
    expect(result.deckOptions).toEqual(expected.deckOptions);
    expect(result.archetype).toEqual(expected.archetype);
    expect(result.synergies).toEqual(expected.synergies);
  });

  test("STRESS FIXTURE: 100-card deck stays identical between worker and main thread", async () => {
    // Documents the stress deck used to validate offloading (#1243 parity).
    // Real 60fps measurement requires a browser; this test guarantees the
    // worker returns byte-for-byte the same `DeckReviewOutput` on a heavy
    // deck so offloading is behavior-preserving. See PR body for the perf
    // rationale (roadmap Phase 32 — Off-Main-Thread Intelligence).
    const cardNames = [
      "Sol Ring",
      "Counterspell",
      "Cryptic Command",
      "Thoughtseize",
      "Lightning Bolt",
      "Goblin Guide",
    ];
    const cards: HeuristicDeckCard[] = Array.from({ length: 100 }, (_, i) =>
      makeHeuristicCard(`${cardNames[i % cardNames.length]} ${i}`, 1, {
        type_line: "Creature",
        cmc: 2,
        oracle_text: "draw a card",
      }),
    );
    const decklist = cards
      .map((c) => `${c.count} ${c.name}`)
      .join("\n");
    const format = "commander";

    const expected = reviewDeckHeuristic(decklist, format, cards);
    const result = (await aiWorker.reviewDeck({
      decklist,
      format,
      cards,
    })) as DeckReviewOutput;

    expect(result).toEqual(expected);
  });

  test("returned result is the DeckReviewOutput shape (no shape drift)", async () => {
    const result = (await aiWorker.reviewDeck({
      decklist: "1 Sol Ring",
      format: "commander",
      cards: buildControlDeck(),
    })) as DeckReviewOutput;

    // Top-level shape
    expect(typeof result.reviewSummary).toBe("string");
    expect(Array.isArray(result.deckOptions)).toBe(true);

    // Options shape
    for (const option of result.deckOptions) {
      expect(typeof option.title).toBe("string");
      expect(typeof option.description).toBe("string");
    }

    // Archetype shape (if present)
    if (result.archetype) {
      expect(typeof result.archetype.primary).toBe("string");
      expect(typeof result.archetype.confidence).toBe("number");
    }

    // Synergies shape
    expect(result.synergies).toBeDefined();
    expect(Array.isArray(result.synergies!.present)).toBe(true);
    for (const s of result.synergies!.present) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.score).toBe("number");
      expect(Array.isArray(s.cards)).toBe(true);
      expect(typeof s.description).toBe("string");
      expect(typeof s.category).toBe("string");
    }
    expect(Array.isArray(result.synergies!.missing)).toBe(true);
  });
});
