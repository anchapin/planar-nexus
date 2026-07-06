/**
 * Tests for the deck-signature LRU cache (issue #1237).
 *
 * The LRU sits between the coach route (`/api/chat/coach`) and the heavy
 * `buildStructuredDeckAnalysis` pipeline so that the dominant recompute
 * cost (`detectArchetype`, `calculateDeckStats`, `detectSynergies`,
 * `detectMissingSynergies`) is paid ONCE per unique deck even when many
 * turns of a coaching session span that same deck.
 *
 * These tests prove all four acceptance criteria from the issue:
 *   1. Repeated identical-deck requests REUSE the cached structured
 *      analysis (builder invoked exactly once across N turns).
 *   2. Changing one card's count produces a NEW signature and a FRESH
 *      analysis (no stale answer bleeds across deck changes).
 *   3. The cache is BOUNDED by LRU eviction and does not leak memory
 *      across many distinct decks.
 *   4. Coverage of the public API (signature, get/set, clear, clock
 *      injection) is maintained.
 */

import type { DeckCard } from "@/app/actions";

// Mock the heavy detectors so we can assert how often the builder actually
// runs. The LRU is what we want to exercise — the worker bridge and Genkit
// flows stay out of scope.
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
  buildStructuredDeckAnalysis,
  computeDeckSignature,
  getCachedStructuredAnalysis,
  setCachedStructuredAnalysis,
  getOrBuildStructuredAnalysis,
  clearDeckAnalysisCache,
  _setDeckAnalysisClock,
  _deckAnalysisCacheSize,
  DECK_ANALYSIS_LRU_MAX_ENTRIES,
} from "../coach-deck-analysis";

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

/** Build a real-ish elf-ramp deck used across the test cases. */
function buildDeck(opts: { cardCount?: number; landCount?: number } = {}): DeckCard[] {
  const c = (
    name: string,
    typeLine: string,
    cmc: number,
    count: number,
    oracle = "",
  ): DeckCard => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
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
    c("Llanowar Elves", "Creature — Elf Druid", 1, opts.cardCount ?? 4, "Tap: Add G."),
    c("Elvish Mystic", "Creature — Elf Druid", 1, 4, "Tap: Add G."),
    c("Craterhoof Behemoth", "Creature — Beast", 8, 2),
    c("Forest", "Basic Land — Forest", 0, opts.landCount ?? 20),
  ];
}

/** Wire the mocked detectors to the REAL implementations. */
function useRealDetectorImplementations() {
  jest.dontMock("@/ai/archetype-detector");
  jest.dontMock("@/ai/archetype-signatures");
  jest.dontMock("@/ai/synergy-detector");
  const realArchetype = jest.requireActual("@/ai/archetype-detector");
  const realSignatures = jest.requireActual("@/ai/archetype-signatures");
  const realSynergy = jest.requireActual("@/ai/synergy-detector");
  detectArchetypeMock.mockImplementation(realArchetype.detectArchetype);
  calcStatsMock.mockImplementation(realSignatures.calculateDeckStats);
  detectSynergiesMock.mockImplementation(realSynergy.detectSynergies);
  detectMissingMock.mockImplementation(realSynergy.detectMissingSynergies);
}

describe("computeDeckSignature", () => {
  it("is order-independent (same deck, different ordering → same signature)", () => {
    const deck = buildDeck();
    const shuffled = [...deck].reverse();
    expect(computeDeckSignature(deck)).toBe(computeDeckSignature(shuffled));
  });

  it("returns a stable, fixed-width token for an empty deck", () => {
    expect(computeDeckSignature([])).toBe("deck:empty");
  });

  it("changes when a card count changes", () => {
    const a = buildDeck({ cardCount: 4, landCount: 20 });
    const b = buildDeck({ cardCount: 3, landCount: 20 });
    expect(computeDeckSignature(a)).not.toBe(computeDeckSignature(b));
  });

  it("changes when a card is added", () => {
    const a: DeckCard[] = buildDeck();
    const b: DeckCard[] = [
      ...buildDeck(),
      {
        id: "priest-of-titania",
        name: "Priest of Titania",
        cmc: 2,
        type_line: "Creature — Elf Druid",
        colors: ["G"],
        color_identity: ["G"],
        legalities: {},
        count: 1,
        oracle_text: "Tap: Add G for each Elf on the battlefield.",
      },
    ];
    expect(computeDeckSignature(a)).not.toBe(computeDeckSignature(b));
  });

  it("returns a fixed-width hex token (bounded key size)", () => {
    const sig = computeDeckSignature(buildDeck());
    // Fixed-width contract: `deck:` prefix + exactly 8 hex chars. Keeps the
    // LRU key footprint bounded even for 99-card Commander decks.
    expect(sig).toMatch(/^deck:[0-9a-f]{8}$/);
  });
});

describe("getOrBuildStructuredAnalysis", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRealDetectorImplementations();
    clearDeckAnalysisCache();
  });

  afterEach(() => {
    clearDeckAnalysisCache();
  });

  it("AC1: repeated identical decks reuse the cached analysis (builder invoked once across N turns)", async () => {
    const deck = buildDeck();

    const turns = 5;
    const results: Awaited<ReturnType<typeof getOrBuildStructuredAnalysis>>[] =
      [];
    for (let i = 0; i < turns; i++) {
      // Slight reorderings on each iteration simulate a chat client that
      // re-serialises cards between turns. The signature key MUST remain
      // identical so the cache hit survives.
      results.push(await getOrBuildStructuredAnalysis([...deck].reverse()));
    }

    // Heavy builder ran exactly once; the rest are O(1) cache hits.
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);
    expect(calcStatsMock).toHaveBeenCalledTimes(1);
    expect(detectSynergiesMock).toHaveBeenCalledTimes(1);
    expect(detectMissingMock).toHaveBeenCalledTimes(1);

    // All turns returned the same structured analysis object identity.
    for (let i = 1; i < turns; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  it("AC2: changing one card's count produces a new signature and a fresh analysis", async () => {
    const a = buildDeck({ cardCount: 4 });
    const b = buildDeck({ cardCount: 3 });

    const first = await getOrBuildStructuredAnalysis(a);
    // Reset mock counters AFTER the first build so the second build is the
    // one under observation.
    jest.clearAllMocks();

    const second = await getOrBuildStructuredAnalysis(b);

    // Different counts ⇒ different signature ⇒ builder re-runs.
    expect(detectArchetypeMock).toHaveBeenCalledTimes(1);
    expect(calcStatsMock).toHaveBeenCalledTimes(1);
    expect(detectSynergiesMock).toHaveBeenCalledTimes(1);
    expect(detectMissingMock).toHaveBeenCalledTimes(1);

    // AND the cached analysis is structurally different (different total
    // card count, etc.) — no stale analysis bleeds across deck changes.
    expect(second).not.toBe(first);
    expect(second.totalCards).not.toBe(first.totalCards);
  });

  it("AC3: cache is bounded by LRU eviction — does not leak memory across decks", async () => {
    // Build `DECK_ANALYSIS_LRU_MAX_ENTRIES + 1` distinct decks so the
    // first insertion MUST be evicted on the final write.
    const decks: DeckCard[][] = [];
    for (let i = 0; i < DECK_ANALYSIS_LRU_MAX_ENTRIES; i++) {
      decks.push(
        buildDeck({
          cardCount: 1 + i, // distinct cardCount per deck
          landCount: 18,
        }),
      );
    }

    for (const deck of decks) {
      // Drop call-counter state from the prior iteration so we can prove the
      // next miss required a real build. The mock-impl wiring is set once in
      // `beforeEach` (lint rule disallows re-installing in a loop).
      jest.clearAllMocks();
      await getOrBuildStructuredAnalysis(deck);
    }

    // Cache bounded to `MAX_ENTRIES`.
    expect(_deckAnalysisCacheSize()).toBe(DECK_ANALYSIS_LRU_MAX_ENTRIES);

    // Insert one MORE distinct deck — the LRU must drop the very first
    // insert to make room. We then look up that evicted signature and
    // assert it no longer hits the cache (i.e. it WAS evicted).
    const overflow = buildDeck({ cardCount: 999, landCount: 17 });
    jest.clearAllMocks();
    await getOrBuildStructuredAnalysis(overflow);
    expect(_deckAnalysisCacheSize()).toBe(DECK_ANALYSIS_LRU_MAX_ENTRIES);

    const evictedSignature = computeDeckSignature(decks[0]);
    expect(getCachedStructuredAnalysis(evictedSignature)).toBeUndefined();

    // And the most-recently inserted signature is still resident.
    const keptSignature = computeDeckSignature(overflow);
    expect(getCachedStructuredAnalysis(keptSignature)).toBeDefined();
  });

  it("AC3: repeated read touches the LRU so an actively-used deck survives eviction pressure", async () => {
    // Inject DECK_ANALYSIS_LRU_MAX_ENTRIES distinct decks, then "touch"
    // the first one (read from cache) and overflow with one more. The
    // touched deck should be promoted to MRU and survive eviction,
    // whereas an UNTURNED deck from the middle should not.
    const decks: DeckCard[][] = [];
    for (let i = 0; i < DECK_ANALYSIS_LRU_MAX_ENTRIES; i++) {
      decks.push(
        buildDeck({ cardCount: 1 + i, landCount: 18 }),
      );
    }
    for (const deck of decks) {
      jest.clearAllMocks();
      await getOrBuildStructuredAnalysis(deck);
    }

    // Touch the oldest deck (a read promotes it to MRU).
    const touchedSignature = computeDeckSignature(decks[0]);
    expect(getCachedStructuredAnalysis(touchedSignature)).toBeDefined();

    // Overflow with a fresh deck. The previous LRU tail (decks[1]) should
    // be evicted; the touched decks[0] should survive.
    jest.clearAllMocks();
    await getOrBuildStructuredAnalysis(buildDeck({ cardCount: 999, landCount: 17 }));

    expect(_deckAnalysisCacheSize()).toBe(DECK_ANALYSIS_LRU_MAX_ENTRIES);
    expect(getCachedStructuredAnalysis(touchedSignature)).toBeDefined();
    expect(getCachedStructuredAnalysis(computeDeckSignature(decks[1]))).toBeUndefined();
  });

  it("evicts entries once the configured TTL elapses", async () => {
    let t = 1_000_000;
    const restore = _setDeckAnalysisClock(() => t);

    const deck = buildDeck();
    await getOrBuildStructuredAnalysis(deck);
    const sig = computeDeckSignature(deck);
    expect(getCachedStructuredAnalysis(sig)).toBeDefined();

    // Advance past the default TTL.
    t += 6 * 60_000;
    expect(getCachedStructuredAnalysis(sig)).toBeUndefined();

    restore();
  });
});

describe("LRU primitives", () => {
  beforeEach(() => {
    clearDeckAnalysisCache();
    jest.clearAllMocks();
    useRealDetectorImplementations();
  });

  afterEach(() => {
    clearDeckAnalysisCache();
  });

  it("setCachedStructuredAnalysis stores and getCachedStructuredAnalysis returns the same object", async () => {
    const deck = buildDeck();
    const analysis = await buildStructuredDeckAnalysis(deck);
    const sig = computeDeckSignature(deck);

    setCachedStructuredAnalysis(sig, analysis);
    const cached = getCachedStructuredAnalysis(sig);
    expect(cached).toBe(analysis);
    expect(_deckAnalysisCacheSize()).toBe(1);
  });

  it("clearDeckAnalysisCache empties the LRU", async () => {
    await getOrBuildStructuredAnalysis(buildDeck());
    expect(_deckAnalysisCacheSize()).toBeGreaterThan(0);
    clearDeckAnalysisCache();
    expect(_deckAnalysisCacheSize()).toBe(0);
  });
});
