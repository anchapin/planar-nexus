/**
 * Heuristic deck-coach worker bridge tests (#1243)
 *
 * The bridge (`heuristic-deck-coach-worker-bridge.ts`) is the single seam
 * between the main thread and the AI Web Worker for the heuristic deck
 * review. These tests cover the three required scenarios:
 *
 *  1. Client invocation — when a worker client is available, the bridge
 *     forwards to it and returns the worker's result (no main-thread
 *     compute).
 *  2. Fallback (no worker) — when the client resolves to null (e.g. jsdom, or
 *     `Worker` is undefined), the bridge computes on the main thread with
 *     results IDENTICAL to a direct `reviewDeckHeuristic` call.
 *  3. Fallback (worker error) — when the client throws (or returns null), the
 *     bridge falls back to main-thread compute identically.
 *
 * Plus that the default resolver degrades gracefully to the fallback in jsdom.
 */
import { describe, test, expect, afterEach } from "@jest/globals";

import {
  reviewDeckHeuristicAsync,
  _setHeuristicDeckCoachClientResolver,
  _resetHeuristicDeckCoachClientResolver,
  type HeuristicDeckCoachWorkerClient,
} from "../heuristic-deck-coach-worker-bridge";
import {
  reviewDeckHeuristic,
  type DeckReviewOutput,
} from "@/lib/heuristic-deck-coach";
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

const decklist = "1 Sol Ring\n4 Counterspell\n2 Cryptic Command\n2 Thoughtseize";
const format = "commander";
const cards = buildControlDeck();
const mainThreadResult: DeckReviewOutput = reviewDeckHeuristic(
  decklist,
  format,
  cards,
);

describe("heuristic-deck-coach-worker-bridge (#1243)", () => {
  afterEach(() => {
    _resetHeuristicDeckCoachClientResolver();
  });

  describe("client invocation (worker path)", () => {
    test("forwards to the worker client and returns its result", async () => {
      const reviewMock = jest
        .fn<Promise<DeckReviewOutput | null>, []>()
        .mockResolvedValue(mainThreadResult);
      const fakeClient: HeuristicDeckCoachWorkerClient = {
        reviewDeck: reviewMock,
      };
      _setHeuristicDeckCoachClientResolver(async () => fakeClient);

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(mainThreadResult);
      expect(reviewMock).toHaveBeenCalledTimes(1);
      expect(reviewMock).toHaveBeenCalledWith(decklist, format, cards);
    });

    test("does not recompute on the main thread when the worker succeeds", async () => {
      // Return a sentinel from the worker. If the bridge used the worker
      // result verbatim, the sentinel must surface (proving main-thread
      // compute did NOT run and overwrite it).
      const sentinel: DeckReviewOutput = {
        reviewSummary: "SENTINEL FROM WORKER",
        deckOptions: [
          {
            title: "Sentinel option",
            description: "sentinel",
            cardsToAdd: [{ name: "Sentinel Card", quantity: 1 }],
          },
        ],
        archetype: { primary: "Sentinel", confidence: 1 },
        synergies: { present: [], missing: [] },
      };
      const fakeClient: HeuristicDeckCoachWorkerClient = {
        reviewDeck: jest.fn().mockResolvedValue(sentinel),
      };
      _setHeuristicDeckCoachClientResolver(async () => fakeClient);

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(sentinel);
      expect(result).not.toEqual(mainThreadResult);
    });
  });

  describe("fallback (worker unavailable)", () => {
    test("falls back to main-thread compute when client resolves to null", async () => {
      _setHeuristicDeckCoachClientResolver(async () => null);

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the client throws (worker error)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: HeuristicDeckCoachWorkerClient = {
        reviewDeck: jest.fn().mockRejectedValue(new Error("worker boom")),
      };
      _setHeuristicDeckCoachClientResolver(async () => throwingClient);

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(mainThreadResult);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("falls back when the worker returns null (no proxy)", async () => {
      const nullClient: HeuristicDeckCoachWorkerClient = {
        reviewDeck: jest.fn().mockResolvedValue(null),
      };
      _setHeuristicDeckCoachClientResolver(async () => nullClient);

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the resolver itself throws", async () => {
      _setHeuristicDeckCoachClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(result).toEqual(mainThreadResult);
    });

    test("fallback warning is emitted at most once across calls", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: HeuristicDeckCoachWorkerClient = {
        reviewDeck: jest.fn().mockRejectedValue(new Error("worker boom")),
      };
      _setHeuristicDeckCoachClientResolver(async () => throwingClient);

      await reviewDeckHeuristicAsync(decklist, format, cards);
      await reviewDeckHeuristicAsync(decklist, format, cards);
      await reviewDeckHeuristicAsync(decklist, format, cards);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("fallback handles an empty deck identically to the in-process engine", async () => {
      _setHeuristicDeckCoachClientResolver(async () => null);

      const expected = reviewDeckHeuristic("", "commander", []);
      const result = await reviewDeckHeuristicAsync("", "commander", []);

      expect(result).toEqual(expected);
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    test("degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly.
      _resetHeuristicDeckCoachClientResolver();

      const result = await reviewDeckHeuristicAsync(decklist, format, cards);

      // jsdom provides no `Worker`, so the real client exposes no proxy and
      // the dynamic import path resolves to null → main-thread fallback.
      expect(result).toEqual(mainThreadResult);
    });
  });
});
