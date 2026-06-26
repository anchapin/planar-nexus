/**
 * Tests for the coach context PRE-FETCH layer (issue #928).
 *
 * These prove the three latency guarantees the issue requires:
 *   1. The independent analyses (archetype / stats / synergies) are resolved
 *      CONCURRENTLY via Promise.all — verified by spying on the detectors and
 *      asserting all three are invoked, and that the parallel builder produces
 *      the same output as the serial one.
 *   2. Repeated requests for the same deck hit the CACHE and skip
 *      re-computation — verified with deterministic clock control + detector
 *      call counts.
 *   3. The pre-fetched context carries every field the coach flow needs BEFORE
 *      the model is invoked.
 */

import type { DeckCard } from "@/app/actions";

jest.mock("@/ai/archetype-detector", () => ({
  detectArchetype: jest.fn(),
}));
jest.mock("@/ai/archetype-signatures", () => ({
  calculateDeckStats: jest.fn(),
}));
jest.mock("@/ai/synergy-detector", () => ({
  detectSynergies: jest.fn(),
  detectMissingSynergies: jest.fn(),
}));

import { detectArchetype } from "@/ai/archetype-detector";
import { calculateDeckStats } from "@/ai/archetype-signatures";
import { detectSynergies, detectMissingSynergies } from "@/ai/synergy-detector";
import {
  prefetchCoachContext,
  buildStructuredDeckAnalysisParallel,
  computeDeckFingerprint,
  clearCoachContextCache,
  _setCoachContextClock,
  _coachContextCacheSize,
} from "../coach-context-prefetch";
import { buildStructuredDeckAnalysis } from "../coach-deck-analysis";

const detectArchetypeMock = detectArchetype as jest.MockedFunction<
  typeof detectArchetype
>;
const calcStatsMock = calculateDeckStats as jest.MockedFunction<
  typeof calculateDeckStats
>;
const detectSynergiesMock = detectSynergies as jest.MockedFunction<
  typeof detectSynergies
>;
const detectMissingMock = detectMissingSynergies as jest.MockedFunction<
  typeof detectMissingSynergies
>;

/** A small but real-ish ramp deck used across tests. */
function buildDeck(): DeckCard[] {
  const c = (
    name: string,
    typeLine: string,
    cmc: number,
    count: number,
    oracle = "",
  ): DeckCard => ({
    id: name.toLowerCase(),
    name,
    cmc,
    type_line: typeLine,
    colors: ["G"],
    color_identity: ["G"],
    legalities: {},
    count,
    oracle_text: oracle,
  });
  return [
    c("Llanowar Elves", "Creature — Elf Druid", 1, 4, "Tap: Add G."),
    c("Elvish Mystic", "Creature — Elf Druid", 1, 4, "Tap: Add G."),
    c("Craterhoof Behemoth", "Creature — Beast", 8, 2),
    c("Forest", "Basic Land — Forest", 0, 20),
  ];
}

/** Wire the mocked detectors to the REAL implementations for output parity. */
function useRealDetectorImplementations() {
  jest.dontMock("@/ai/archetype-detector");
  jest.dontMock("@/ai/archetype-signatures");
  jest.dontMock("@/ai/synergy-detector");
  // Re-import the real implementations after un-mocking.
  const realArchetype = jest.requireActual("@/ai/archetype-detector");
  const realSignatures = jest.requireActual("@/ai/archetype-signatures");
  const realSynergy = jest.requireActual("@/ai/synergy-detector");
  detectArchetypeMock.mockImplementation(realArchetype.detectArchetype);
  calcStatsMock.mockImplementation(realSignatures.calculateDeckStats);
  detectSynergiesMock.mockImplementation(realSynergy.detectSynergies);
  detectMissingMock.mockImplementation(realSynergy.detectMissingSynergies);
}

describe("computeDeckFingerprint", () => {
  it("is order-independent (same deck, different card order → same key)", () => {
    const deck = buildDeck();
    const shuffled = [...deck].reverse();
    expect(computeDeckFingerprint(deck)).toBe(computeDeckFingerprint(shuffled));
  });

  it("returns a stable marker for an empty deck", () => {
    expect(computeDeckFingerprint([])).toBe("empty");
  });
});

describe("buildStructuredDeckAnalysisParallel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRealDetectorImplementations();
  });

  it("resolves the three independent analyses via Promise.all", async () => {
    await buildStructuredDeckAnalysisParallel(buildDeck());

    // All three independent detectors must have been invoked exactly once.
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);
    expect(calcStatsMock).toHaveBeenCalledTimes(1);
    expect(detectSynergiesMock).toHaveBeenCalledTimes(1);
    // The dependent detector runs once, after the archetype resolves.
    expect(detectMissingMock).toHaveBeenCalledTimes(1);
  });

  it("produces output identical to the serial builder", async () => {
    const deck = buildDeck();
    const parallel = await buildStructuredDeckAnalysisParallel(deck);
    // Serial builder is now async (synergy detection goes through the worker
    // bridge, #1079). Both paths fall back to identical main-thread compute in
    // jsdom, so their output must still match exactly.
    const serial = await buildStructuredDeckAnalysis(deck);
    expect(parallel).toEqual(serial);
  });
});

describe("prefetchCoachContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRealDetectorImplementations();
    clearCoachContextCache();
  });

  afterEach(() => {
    clearCoachContextCache();
  });

  it("returns null when there are no deck cards (nothing to pre-fetch)", async () => {
    const result = await prefetchCoachContext({
      deckCards: [],
      format: "modern",
    });
    expect(result).toBeNull();
  });

  it("returns a fully-resolved context with every field the coach needs", async () => {
    const result = await prefetchCoachContext({
      deckCards: buildDeck(),
      format: "commander",
    });

    expect(result).not.toBeNull();
    expect(result!.fromCache).toBe(false);
    expect(result!.format).toBe("commander");
    expect(result!.structuredAnalysis).toBeDefined();
    expect(result!.structuredAnalysisText).toContain(
      "### Structured Deck Analysis",
    );
    expect(result!.structuredAnalysis).toHaveProperty("archetype");
    expect(result!.structuredAnalysis).toHaveProperty("manaCurve");
    expect(result!.structuredAnalysis).toHaveProperty("roleDistribution");
    expect(result!.structuredAnalysis).toHaveProperty("synergyClusters");
    expect(result!.archetype).toBe(result!.structuredAnalysis.archetype);
  });

  it("serves a cache HIT for a repeated deck without re-computing", async () => {
    const deck = buildDeck();
    const format = "commander";

    const first = await prefetchCoachContext({ deckCards: deck, format });
    expect(first!.fromCache).toBe(false);
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);

    const second = await prefetchCoachContext({ deckCards: deck, format });
    // Cache hit: no detector should have run a second time.
    expect(second!.fromCache).toBe(true);
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);
    expect(calcStatsMock).toHaveBeenCalledTimes(1);
    expect(detectSynergiesMock).toHaveBeenCalledTimes(1);
    expect(detectMissingMock).toHaveBeenCalledTimes(1);

    // Cached payload is identical to the freshly-computed one.
    expect(second!.structuredAnalysis).toEqual(first!.structuredAnalysis);
    expect(second!.structuredAnalysisText).toEqual(
      first!.structuredAnalysisText,
    );
  });

  it("treats decks with different card orderings as the same cache entry", async () => {
    const deck = buildDeck();
    const format = "modern";

    const first = await prefetchCoachContext({ deckCards: deck, format });
    const reordered = await prefetchCoachContext({
      deckCards: [...deck].reverse(),
      format,
    });

    expect(first!.fromCache).toBe(false);
    expect(reordered!.fromCache).toBe(true);
  });

  it("distinguishes caches by format for the same deck", async () => {
    const deck = buildDeck();
    const asCommander = await prefetchCoachContext({
      deckCards: deck,
      format: "commander",
    });
    const asModern = await prefetchCoachContext({
      deckCards: deck,
      format: "modern",
    });

    expect(asCommander!.fromCache).toBe(false);
    expect(asModern!.fromCache).toBe(false);
    expect(_coachContextCacheSize()).toBe(2);
  });

  it("expires entries after the TTL elapses", async () => {
    let t = 1_000_000;
    const restore = _setCoachContextClock(() => t);

    const deck = buildDeck();
    const first = await prefetchCoachContext({
      deckCards: deck,
      format: "commander",
      ttlMs: 5_000,
    });
    expect(first!.fromCache).toBe(false);

    // Before TTL: cache hit, no recompute.
    const cached = await prefetchCoachContext({
      deckCards: deck,
      format: "commander",
      ttlMs: 5_000,
    });
    expect(cached!.fromCache).toBe(true);

    // Advance past the TTL: must recompute.
    detectArchetypeMock.mockClear();
    t += 6_000;
    const refreshed = await prefetchCoachContext({
      deckCards: deck,
      format: "commander",
      ttlMs: 5_000,
    });
    expect(refreshed!.fromCache).toBe(false);
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);

    restore();
  });
});
