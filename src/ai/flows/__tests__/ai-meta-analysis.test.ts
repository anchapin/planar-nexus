/**
 * Tests for the heuristic meta-analysis flow (issue #1078).
 *
 * `ai-meta-analysis.ts` wraps `analyzeMetaHeuristic` (issue #440) with a
 * conversion layer (`convertHeuristicOutput`) plus two post-processing passes:
 * card-legality validation via `importDecklist` and an add/remove quantity
 * rebalance. The conversion + legality + rebalance logic previously had zero
 * direct coverage. These tests pin the output shape, the strength/weakness
 * inference, the format-specific branches, the legality filtering and the
 * rebalance edge case so the Lane 3 LLM-rewiring work cannot silently regress.
 */

import type { MetaAnalysisOutput as HeuristicMetaOutput } from "@/lib/heuristic-meta-analysis";

jest.mock("@/lib/heuristic-meta-analysis", () => ({
  analyzeMetaHeuristic: jest.fn(),
}));
jest.mock("@/lib/server-card-operations", () => ({
  importDecklist: jest.fn(),
}));

import { analyzeMetaAndSuggest } from "../ai-meta-analysis";
import { analyzeMetaHeuristic } from "@/lib/heuristic-meta-analysis";
import { importDecklist } from "@/lib/server-card-operations";

const mockedAnalyzeMeta = analyzeMetaHeuristic as jest.MockedFunction<
  typeof analyzeMetaHeuristic
>;
const mockedImportDecklist = importDecklist as jest.MockedFunction<
  typeof importDecklist
>;

const DECKLIST = ["4 Lightning Bolt", "2 Blood Moon", "3 Bad Card"].join("\n");

/** A canonical heuristic result exercising the strength + weakness descriptions. */
function baseResult(overrides: Partial<HeuristicMetaOutput> = {}): HeuristicMetaOutput {
  return {
    currentMeta: "The modern metagame is dominated by Burn.",
    archetypes: [
      {
        name: "Burn",
        prevalence: "High",
        playstyle: "burn",
        keyCards: ["Lightning Bolt"],
        weaknesses: ["Lifegain"],
      },
      {
        name: "Tron",
        prevalence: "Medium",
        playstyle: "big mana",
        keyCards: ["Karn Liberated"],
        weaknesses: ["Aggro"],
      },
    ],
    recommendations: [
      {
        title: "Improve Burn Matchup",
        description:
          "Your deck is naturally strong against Burn. Enhance this advantage.",
        cardsToAdd: [{ name: "Lightning Bolt", quantity: 2 }],
        cardsToRemove: [{ name: "Bad Card", quantity: 1 }],
        matchup: { against: "Burn", strategy: "Race them down" },
      },
      {
        title: "Improve Tron Matchup",
        description:
          "Your deck struggles against Tron. Address these weaknesses.",
        cardsToAdd: [{ name: "Blood Moon", quantity: 2 }],
        cardsToRemove: [{ name: "Other Card", quantity: 2 }],
        matchup: { against: "Tron", strategy: "Pressure the lands" },
      },
    ],
    ...overrides,
  };
}

function legalImport() {
  return Promise.resolve({ found: [], notFound: [], illegal: [] });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAnalyzeMeta.mockImplementation(() => baseResult());
  mockedImportDecklist.mockImplementation(legalImport);
});

describe("analyzeMetaAndSuggest — output shape", () => {
  it("returns a full MetaAnalysisOutput matching the documented contract", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });

    expect(out).toHaveProperty("metaOverview");
    expect(out).toHaveProperty("deckStrengths");
    expect(out).toHaveProperty("deckWeaknesses");
    expect(out).toHaveProperty("matchupAnalysis");
    expect(out).toHaveProperty("cardSuggestions");
    expect(out).toHaveProperty("strategicAdvice");
    expect(Array.isArray(out.deckStrengths)).toBe(true);
    expect(Array.isArray(out.matchupAnalysis)).toBe(true);
    expect(typeof out.strategicAdvice).toBe("string");
  });

  it("passes decklist, format and focusArchetype through to the heuristic engine", async () => {
    await analyzeMetaAndSuggest({
      decklist: DECKLIST,
      format: "modern",
      focusArchetype: "Burn",
    });
    expect(mockedAnalyzeMeta).toHaveBeenCalledWith(
      DECKLIST,
      "modern",
      expect.any(Array),
      "Burn",
    );
    // The decklist is parsed into card objects (3 named lines here).
    const cards = mockedAnalyzeMeta.mock.calls[0][2];
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ name: "Lightning Bolt", count: 4 });
  });
});

describe("analyzeMetaAndSuggest — conversion layer (convertHeuristicOutput)", () => {
  it("maps metaOverview from the heuristic currentMeta", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.metaOverview).toBe("The modern metagame is dominated by Burn.");
  });

  it("infers strengths/weaknesses from recommendation descriptions", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.deckStrengths).toContain("Strong against Burn");
    expect(out.deckWeaknesses).toContain("Weak against Tron");
  });

  it("converts recommendations into matchup analysis with sideboard notes", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.matchupAnalysis).toHaveLength(2);
    expect(out.matchupAnalysis[0]).toEqual({
      archetype: "Burn",
      recommendation: expect.stringContaining("naturally strong"),
      sideboardNotes: "Race them down",
    });
  });

  it("flattens recommendation cards into add/remove suggestions with reasons", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.cardSuggestions.cardsToAdd.map((c) => c.name)).toEqual([
      "Lightning Bolt",
      "Blood Moon",
    ]);
    expect(out.cardSuggestions.cardsToRemove.map((c) => c.name)).toEqual([
      "Bad Card",
      "Other Card",
    ]);
    expect(out.cardSuggestions.cardsToAdd[0].reason).toContain("heuristic");
    expect(out.cardSuggestions.cardsToRemove[0].reason).toContain("Underperforming");
  });

  it("renders strategicAdvice referencing format, archetypes and recommendation titles", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.strategicAdvice).toContain("modern");
    expect(out.strategicAdvice).toContain("Burn");
    expect(out.strategicAdvice).toContain("Improve Burn Matchup");
  });
});

describe("analyzeMetaAndSuggest — format-specific branches", () => {
  it("adds commander-specific strengths and weaknesses", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "commander" });
    expect(out.deckStrengths).toContain("Access to powerful Commanders and effects");
    expect(out.deckWeaknesses).toContain(
      "Slower game pace may struggle against fast combo",
    );
  });

  it("adds modern-specific strengths and weaknesses", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.deckStrengths).toContain("Access to powerful modern cards");
    expect(out.deckWeaknesses).toContain("Must prepare for diverse meta");
  });

  it("adds no format-specific entries for an unrecognized format", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "brawl" });
    expect(out.deckStrengths).not.toContain("Access to powerful modern cards");
    expect(out.deckWeaknesses).not.toContain("Must prepare for diverse meta");
  });
});

describe("analyzeMetaAndSuggest — decklist parsing edge cases", () => {
  it("handles an empty decklist without throwing", async () => {
    const out = await analyzeMetaAndSuggest({ decklist: "", format: "modern" });
    expect(mockedAnalyzeMeta).toHaveBeenCalledWith(
      "",
      "modern",
      [],
      undefined,
    );
    expect(out.metaOverview).toBeDefined();
  });

  it("ignores malformed lines (no quantity prefix) and blank lines", async () => {
    const decklist = [
      "", // blank
      "Lightning Bolt", // no quantity
      "   ", // whitespace
      "4 Blood Moon", // valid
      "garbage line",
    ].join("\n");
    await analyzeMetaAndSuggest({ decklist, format: "modern" });
    const cards = mockedAnalyzeMeta.mock.calls[0][2];
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Blood Moon");
  });
});

describe("analyzeMetaAndSuggest — card legality validation", () => {
  it("removes not-found cards from the add suggestions", async () => {
    mockedImportDecklist.mockResolvedValue({
      found: [],
      notFound: ["Blood Moon"],
      illegal: [],
    });
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.cardSuggestions.cardsToAdd.map((c) => c.name)).not.toContain(
      "Blood Moon",
    );
    expect(mockedImportDecklist).toHaveBeenCalled();
  });

  it("removes illegal cards from the add suggestions", async () => {
    mockedImportDecklist.mockResolvedValue({
      found: [],
      notFound: [],
      illegal: ["Lightning Bolt"],
    });
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.cardSuggestions.cardsToAdd.map((c) => c.name)).not.toContain(
      "Lightning Bolt",
    );
  });

  it("does not call importDecklist when there are no cards to add", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "Only Removes",
            description: "Your deck struggles against Tron. Address these weaknesses.",
            cardsToAdd: [],
            cardsToRemove: [{ name: "Bad Card", quantity: 2 }],
            matchup: { against: "Tron", strategy: "Pressure" },
          },
        ],
      }),
    );
    await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(mockedImportDecklist).not.toHaveBeenCalled();
  });
});

describe("analyzeMetaAndSuggest — quantity rebalancing", () => {
  it("trims removals down to match additions when removes exceed adds", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "Rebalance",
            description:
              "Your deck struggles against Tron. Address these weaknesses.",
            cardsToAdd: [{ name: "Blood Moon", quantity: 2 }],
            cardsToRemove: [
              { name: "Too Slow A", quantity: 3 },
              { name: "Too Slow B", quantity: 2 },
            ],
            matchup: { against: "Tron", strategy: "Pressure" },
          },
        ],
      }),
    );

    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    const addCount = out.cardSuggestions.cardsToAdd.reduce((s, c) => s + c.quantity, 0);
    const removeCount = out.cardSuggestions.cardsToRemove.reduce(
      (s, c) => s + c.quantity,
      0,
    );
    // adds stayed at 2; removals (originally 5) were trimmed to <= adds.
    expect(addCount).toBe(2);
    expect(removeCount).toBeLessThanOrEqual(addCount);
  });

  it("leaves removals untouched when adds already meet or exceed them", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "More Adds",
            description:
              "Your deck is naturally strong against Burn. Enhance this advantage.",
            cardsToAdd: [{ name: "Bolt", quantity: 4 }],
            cardsToRemove: [{ name: "Bad", quantity: 1 }],
            matchup: { against: "Burn", strategy: "Race" },
          },
        ],
      }),
    );
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.cardSuggestions.cardsToRemove).toEqual([
      { name: "Bad", quantity: 1, reason: expect.any(String) },
    ]);
  });
});

describe("analyzeMetaAndSuggest — sideboard cap", () => {
  it("limits sideboardSuggestions to the first 5 add cards", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "Big",
            description: "Your deck is naturally strong against Burn. Enhance this advantage.",
            cardsToAdd: Array.from({ length: 8 }, (_, i) => ({
              name: `Card ${i}`,
              quantity: 1,
            })),
            cardsToRemove: [],
            matchup: { against: "Burn", strategy: "Race" },
          },
        ],
      }),
    );
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.sideboardSuggestions).toHaveLength(5);
  });
});
