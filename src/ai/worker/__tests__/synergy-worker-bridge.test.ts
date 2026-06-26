/**
 * Synergy worker bridge tests (#1079)
 *
 * The bridge (`synergy-worker-bridge.ts`) is the single seam between the main
 * thread and the AI Web Worker for synergy detection. These tests cover the
 * three required scenarios:
 *
 *  1. Client invocation — when a worker client is available, the bridge
 *     forwards to it and returns the worker's result (no main-thread compute).
 *  2. Fallback (no worker) — when the client resolves to null (e.g. jsdom, or
 *     `Worker` is undefined), the bridge computes on the main thread with
 *     results IDENTICAL to the direct detector.
 *  3. Fallback (worker error) — when the client throws (or returns null), the
 *     bridge falls back to main-thread compute identically.
 *
 * Plus ordering preservation (results stay sorted by score) and that the
 * default resolver degrades gracefully to the fallback in jsdom.
 */
import { describe, test, expect, afterEach } from "@jest/globals";

import {
  detectSynergiesAsync,
  _setSynergyClientResolver,
  _resetSynergyClientResolver,
  type SynergyWorkerClient,
} from "../synergy-worker-bridge";
import { detectSynergies } from "../../synergy-detector";
import type { SynergyResult } from "../../synergy-detector";
import type { DeckCard } from "@/app/actions";

function makeCard(
  name: string,
  typeLine: string,
  count: number,
  oracle = "",
  cmc = 2,
): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: typeLine,
    colors: ["G"],
    color_identity: ["G"],
    legalities: {},
    count,
    oracle_text: oracle,
  };
}

function buildElfRampDeck(): DeckCard[] {
  return [
    makeCard("Llanowar Elves", "Creature — Elf Druid", 4, "Tap: Add G.", 1),
    makeCard("Elvish Mystic", "Creature — Elf Druid", 4, "Tap: Add G.", 1),
    makeCard(
      "Elvish Archdruid",
      "Creature — Elf Druid",
      3,
      "Other Elf creatures get +1/+1. Tap: Add G for each Elf you control.",
      3,
    ),
    makeCard("Heritage Druid", "Creature — Elf Druid", 3, "", 1),
    makeCard("Nettle Sentinel", "Creature — Elf Warrior", 4, "", 1),
    makeCard("Craterhoof Behemoth", "Creature — Beast", 2, "", 8),
    makeCard(
      "Cultivate",
      "Sorcery",
      3,
      "Search your library for a basic land.",
      3,
    ),
    makeCard("Harmonize", "Sorcery", 2, "Draw three cards.", 4),
    makeCard("Forest", "Basic Land — Forest", 18, "", 0),
  ];
}

const deck = buildElfRampDeck();
const mainThreadResult: SynergyResult[] = detectSynergies(deck);

describe("synergy-worker-bridge (#1079)", () => {
  afterEach(() => {
    _resetSynergyClientResolver();
  });

  describe("client invocation (worker path)", () => {
    test("forwards to the worker client and returns its result", async () => {
      const detectMock = jest
        .fn<Promise<SynergyResult[]>, []>()
        .mockResolvedValue(mainThreadResult.map((s) => ({ ...s })));
      const fakeClient: SynergyWorkerClient = {
        detectSynergies: detectMock,
      };
      _setSynergyClientResolver(async () => fakeClient);

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(mainThreadResult);
      expect(detectMock).toHaveBeenCalledTimes(1);
      expect(detectMock).toHaveBeenCalledWith(deck, undefined, undefined);
    });

    test("does not recompute on the main thread when the worker succeeds", async () => {
      // Return a sentinel from the worker. If the bridge used the worker
      // result verbatim, the sentinel must surface (proving main-thread
      // compute did NOT run and overwrite it).
      const sentinel: SynergyResult[] = [
        {
          name: "SENTINEL",
          score: 999,
          cards: ["Sentinel Card"],
          description: "sentinel",
          category: "sentinel",
        },
      ];
      const fakeClient: SynergyWorkerClient = {
        detectSynergies: jest.fn().mockResolvedValue(sentinel),
      };
      _setSynergyClientResolver(async () => fakeClient);

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(sentinel);
      expect(result).not.toEqual(mainThreadResult);
    });

    test("forwards minScore and maxResults to the worker client", async () => {
      const detectMock = jest
        .fn<Promise<SynergyResult[]>, []>()
        .mockResolvedValue(mainThreadResult);
      _setSynergyClientResolver(async () => ({
        detectSynergies: detectMock,
      }));

      await detectSynergiesAsync(deck, 50, 3);

      expect(detectMock).toHaveBeenCalledWith(deck, 50, 3);
    });
  });

  describe("fallback (worker unavailable)", () => {
    test("falls back to main-thread compute when client resolves to null", async () => {
      _setSynergyClientResolver(async () => null);

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the client throws (worker error)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: SynergyWorkerClient = {
        detectSynergies: jest.fn().mockRejectedValue(new Error("worker boom")),
      };
      _setSynergyClientResolver(async () => throwingClient);

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(mainThreadResult);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("falls back when the worker returns null (no proxy)", async () => {
      const nullClient: SynergyWorkerClient = {
        detectSynergies: jest.fn().mockResolvedValue(null),
      };
      _setSynergyClientResolver(async () => nullClient);

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(mainThreadResult);
    });

    test("falls back when the resolver itself throws", async () => {
      _setSynergyClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const result = await detectSynergiesAsync(deck);

      expect(result).toEqual(mainThreadResult);
    });

    test("fallback warning is emitted at most once across calls", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: SynergyWorkerClient = {
        detectSynergies: jest.fn().mockRejectedValue(new Error("worker boom")),
      };
      _setSynergyClientResolver(async () => throwingClient);

      await detectSynergiesAsync(deck);
      await detectSynergiesAsync(deck);
      await detectSynergiesAsync(deck);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("fallback returns identical results across minScore / maxResults", async () => {
      _setSynergyClientResolver(async () => null);

      for (const [minScore, maxResults] of [
        [0, 50],
        [50, 3],
        [90, 1],
      ] as const) {
        const result = await detectSynergiesAsync(deck, minScore, maxResults);
        const expected = detectSynergies(deck, minScore, maxResults);
        expect(result).toEqual(expected);
      }
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    test("degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly.
      _resetSynergyClientResolver();

      const result = await detectSynergiesAsync(deck);

      // jsdom provides no `Worker`, so the real client exposes no proxy and
      // the dynamic import path resolves to null → main-thread fallback.
      expect(result).toEqual(mainThreadResult);
    });
  });

  describe("ordering preservation", () => {
    test("results remain sorted by score descending after the round-trip", async () => {
      const result = await detectSynergiesAsync(deck);

      const scores = result.map((s) => s.score);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    });
  });
});
