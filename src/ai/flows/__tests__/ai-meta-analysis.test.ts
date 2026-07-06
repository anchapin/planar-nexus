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

import {
  analyzeMetaAndSuggest,
  coerceMetaAnalysisOutput,
  extractJsonFromLLM,
} from "../ai-meta-analysis";
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

  // Ensure the LLM provider routing added in #1073 never fires in the
  // heuristic-only suites: no provider key may be considered configured,
  // regardless of what the host shell has exported.
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.ZAI_API_KEY;
  delete process.env.CUSTOM_AI_API_KEY;
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
    // Issue #1240: adds and removes must net to an equal count for a valid
    // 1-for-1 swap. adds stayed at 2; removals (originally 5) were trimmed
    // down to match.
    expect(addCount).toBe(2);
    expect(removeCount).toBe(2);
  });

  it("trims additions down to match removals when adds exceed removes (issue #1240)", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "More Adds",
            description:
              "Your deck is naturally strong against Burn. Enhance this advantage.",
            cardsToAdd: [
              { name: "Bolt", quantity: 3 },
              { name: "Skullcrack", quantity: 2 },
            ],
            cardsToRemove: [{ name: "Bad", quantity: 1 }],
            matchup: { against: "Burn", strategy: "Race" },
          },
        ],
      }),
    );

    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    const addCount = out.cardSuggestions.cardsToAdd.reduce(
      (s, c) => s + c.quantity,
      0,
    );
    const removeCount = out.cardSuggestions.cardsToRemove.reduce(
      (s, c) => s + c.quantity,
      0,
    );
    // The pre-#1240 code only handled removeCount > addCount and let this
    // case leak through, growing the deck above its legal size. Adds (5)
    // must now be trimmed down to match the single removal.
    expect(removeCount).toBe(1);
    expect(addCount).toBe(1);
    expect(out.cardSuggestions.cardsToRemove).toEqual([
      { name: "Bad", quantity: 1, reason: expect.any(String) },
    ]);
  });

  it("keeps both lists in balance for representative constructed decklists", async () => {
    // 60-card Modern shell where the heuristic overshoots on the add side —
    // a classic case the pre-#1240 bug would have silently shipped as a
    // 62-card deck suggestion.
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "Pressure Lifegain",
            description:
              "Your deck struggles against Tron. Address these weaknesses.",
            cardsToAdd: [
              { name: "Skullcrack", quantity: 3 },
              { name: "Searing Blaze", quantity: 2 },
            ],
            cardsToRemove: [{ name: "Lava Spike", quantity: 1 }],
            matchup: { against: "Tron", strategy: "Race them down" },
          },
        ],
      }),
    );

    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    const addCount = out.cardSuggestions.cardsToAdd.reduce(
      (s, c) => s + c.quantity,
      0,
    );
    const removeCount = out.cardSuggestions.cardsToRemove.reduce(
      (s, c) => s + c.quantity,
      0,
    );
    expect(addCount).toBe(removeCount);
    expect(addCount).toBeGreaterThan(0);
  });

  it("produces no add/remove when both lists start empty", async () => {
    mockedAnalyzeMeta.mockReturnValue(
      baseResult({
        recommendations: [
          {
            title: "No swap",
            description:
              "Your deck is naturally strong against Burn. Enhance this advantage.",
            cardsToAdd: [],
            cardsToRemove: [],
            matchup: { against: "Burn", strategy: "Race" },
          },
        ],
      }),
    );
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.cardSuggestions.cardsToAdd).toEqual([]);
    expect(out.cardSuggestions.cardsToRemove).toEqual([]);
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

// ---------------------------------------------------------------------------
// Issue #1073 — LLM provider routing, structured-output validation, failover,
// and the local-first heuristic fallback.
// ---------------------------------------------------------------------------

describe("extractJsonFromLLM", () => {
  it("parses a plain JSON string", () => {
    expect(extractJsonFromLLM('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a ```json fenced block", () => {
    const text = "Here you go:\n```json\n{\"metaOverview\":\"x\"}\n```\nthanks";
    expect(extractJsonFromLLM(text)).toEqual({ metaOverview: "x" });
  });

  it("extracts the outermost {...} block from surrounding prose", () => {
    expect(extractJsonFromLLM('sure! {"a":1,"b":2} done')).toEqual({ a: 1, b: 2 });
  });

  it("returns null for non-JSON text", () => {
    expect(extractJsonFromLLM("I cannot help with that.")).toBeNull();
    expect(extractJsonFromLLM("")).toBeNull();
  });
});

describe("coerceMetaAnalysisOutput", () => {
  function validRaw(overrides: Record<string, unknown> = {}) {
    return {
      metaOverview: "LLM overview",
      strategicAdvice: "Concrete advice",
      deckStrengths: ["Strength A"],
      deckWeaknesses: ["Weakness A"],
      matchupAnalysis: [{ archetype: "Burn", recommendation: "Race them" }],
      cardSuggestions: {
        cardsToAdd: [{ name: "Skullcrack", quantity: 2 }],
        cardsToRemove: [{ name: "Bad Card", quantity: 2 }],
      },
      ...overrides,
    };
  }

  it("coerces a well-formed LLM object into MetaAnalysisOutput", () => {
    const out = coerceMetaAnalysisOutput(validRaw());
    expect(out).not.toBeNull();
    expect(out!.matchupAnalysis[0]).toEqual({
      archetype: "Burn",
      recommendation: "Race them",
    });
    // Missing reasons are defaulted rather than dropped.
    expect(out!.cardSuggestions.cardsToAdd[0]).toEqual({
      name: "Skullcrack",
      quantity: 2,
      reason: "LLM suggestion",
    });
  });

  it("clamps invalid quantities to a minimum of 1", () => {
    const out = coerceMetaAnalysisOutput(
      validRaw({
        cardSuggestions: {
          cardsToAdd: [{ name: "X", quantity: -3 }],
          cardsToRemove: [{ name: "Y", quantity: "two" }],
        },
      }),
    );
    expect(out!.cardSuggestions.cardsToAdd[0].quantity).toBe(1);
    expect(out!.cardSuggestions.cardsToRemove[0].quantity).toBe(1);
  });

  it("returns null for a non-object", () => {
    expect(coerceMetaAnalysisOutput("not an object")).toBeNull();
    expect(coerceMetaAnalysisOutput(null)).toBeNull();
    expect(coerceMetaAnalysisOutput([1, 2, 3])).toBeNull();
  });

  it("returns null when required top-level strings are missing", () => {
    expect(coerceMetaAnalysisOutput({ metaOverview: "ov" })).toBeNull();
    expect(coerceMetaAnalysisOutput({ strategicAdvice: "adv" })).toBeNull();
  });

  it("returns null when no substantive section survives validation", () => {
    expect(
      coerceMetaAnalysisOutput({ metaOverview: "ov", strategicAdvice: "adv" }),
    ).toBeNull();
  });

  it("keeps sideboardSuggestions only when non-empty", () => {
    const withSb = coerceMetaAnalysisOutput(
      validRaw({ sideboardSuggestions: [{ name: "Relic", quantity: 1 }] }),
    );
    expect(withSb!.sideboardSuggestions).toHaveLength(1);

    const emptySb = coerceMetaAnalysisOutput(validRaw({ sideboardSuggestions: [] }));
    expect(emptySb!.sideboardSuggestions).toBeUndefined();
  });
});

describe("analyzeMetaAndSuggest — LLM provider routing (#1073)", () => {
  /** A well-formed LLM JSON response that references the deck specifically. */
  function validLLMJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      metaOverview: "Your Burn shell is well-positioned in the Modern meta.",
      deckStrengths: ["Efficient red reach for your specific list"],
      deckWeaknesses: ["Soft to lifegain out of Tron sideboards"],
      matchupAnalysis: [
        {
          archetype: "Burn",
          recommendation: "In the mirror, your bolt density lets you outrace.",
          sideboardNotes: "Bring in Skullcrack for their lifegain",
        },
      ],
      cardSuggestions: {
        cardsToAdd: [
          { name: "Skullcrack", quantity: 2, reason: "Answers lifegain in your weak matchup." },
        ],
        cardsToRemove: [
          { name: "Bad Card", quantity: 2, reason: "Underperforms across the current meta." },
        ],
      },
      strategicAdvice: "Tight advice tied to your Burn deck's mana curve.",
      ...overrides,
    });
  }

  /** Test-seam model resolver that returns an opaque marker per provider. */
  function seamModel(provider: string): Promise<unknown> {
    return Promise.resolve(`model:${provider}`);
  }

  /** Heuristic-path marker so we can prove the fallback ran. */
  function isHeuristic(out: { cardSuggestions: { cardsToAdd: { reason: string }[] } }) {
    return out.cardSuggestions.cardsToAdd.some((c) => c.reason.includes("heuristic"));
  }

  it("returns the LLM-enriched output when a provider is configured", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest.fn().mockResolvedValue({ text: validLLMJson() });

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai"],
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    expect(getModel).toHaveBeenCalledWith("openai", undefined);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out.metaOverview).toBe("Your Burn shell is well-positioned in the Modern meta.");
    expect(out.matchupAnalysis[0].archetype).toBe("Burn");
    // Enriched output replaces the heuristic boilerplate reason.
    expect(isHeuristic(out)).toBe(false);
  });

  it("falls back to the heuristic output when no provider is configured", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest.fn();

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai", "anthropic"],
        isConfigured: () => false,
        getModel,
        generateText,
      },
    );

    // No provider was even attempted (local-first short-circuit).
    expect(getModel).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(out.metaOverview).toBe("The modern metagame is dominated by Burn.");
    expect(isHeuristic(out)).toBe(true);
  });

  it("falls back to heuristic when the LLM returns unparseable then schema-invalid text", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest
      .fn()
      // Provider A: prose, not JSON.
      .mockResolvedValueOnce({ text: "Sorry, I cannot produce that analysis." })
      // Provider B: parses but lacks required fields + substance.
      .mockResolvedValueOnce({ text: JSON.stringify({ metaOverview: "only" }) });

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai", "anthropic"],
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    // Both providers were tried (parse-failure also advances the failover).
    expect(generateText).toHaveBeenCalledTimes(2);
    // ...and neither produced usable output → heuristic fallback.
    expect(out.metaOverview).toBe("The modern metagame is dominated by Burn.");
    expect(isHeuristic(out)).toBe(true);
  });

  it("fails over to the next provider when the primary provider errors", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest
      .fn()
      .mockRejectedValueOnce(new Error("openai is down"))
      .mockResolvedValueOnce({ text: validLLMJson() });

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai", "anthropic"],
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    expect(getModel).toHaveBeenCalledWith("openai", undefined);
    expect(getModel).toHaveBeenCalledWith("anthropic", undefined);
    expect(generateText).toHaveBeenCalledTimes(2);
    // Provider A threw → provider B's enriched output is returned.
    expect(out.metaOverview).toBe("Your Burn shell is well-positioned in the Modern meta.");
    expect(isHeuristic(out)).toBe(false);
  });

  it("fails over on a provider parse failure and returns the next provider's valid output", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest
      .fn()
      // Provider A returns garbage JSON.
      .mockResolvedValueOnce({ text: "nope" })
      // Provider B returns a valid enriched object.
      .mockResolvedValueOnce({ text: validLLMJson() });

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai", "anthropic"],
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(out.strategicAdvice).toBe("Tight advice tied to your Burn deck's mana curve.");
  });

  it("falls back to heuristic when model setup fails for every provider", async () => {
    const getModel = jest.fn().mockRejectedValue(new Error("sdk missing"));
    const generateText = jest.fn();

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai", "anthropic"],
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    expect(getModel).toHaveBeenCalledTimes(2);
    expect(generateText).not.toHaveBeenCalled();
    expect(isHeuristic(out)).toBe(true);
  });

  it("forwards provider/modelId/options to the model resolver and LLM call", async () => {
    const getModel = jest.fn(seamModel);
    const generateText = jest.fn().mockResolvedValue({ text: validLLMJson() });

    await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern", focusArchetype: "Burn" },
      {
        providers: ["anthropic"],
        modelId: "claude-x",
        isConfigured: () => true,
        getModel,
        generateText,
      },
    );

    expect(getModel).toHaveBeenCalledWith("anthropic", "claude-x");
    const call = generateText.mock.calls[0][0];
    expect(call.temperature).toBe(0.2);
    // The grounding context includes the decklist + focus archetype.
    expect(call.messages[0].content).toContain("Lightning Bolt");
    expect(call.messages[0].content).toContain("Burn");
    expect(call.system).toContain("STRICT JSON");
  });

  it("respects an aborted signal and falls back to heuristic", async () => {
    const controller = new AbortController();
    controller.abort();
    const getModel = jest.fn(seamModel);
    const generateText = jest.fn();

    const out = await analyzeMetaAndSuggest(
      { decklist: DECKLIST, format: "modern" },
      {
        providers: ["openai"],
        isConfigured: () => true,
        signal: controller.signal,
        getModel,
        generateText,
      },
    );

    expect(getModel).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(isHeuristic(out)).toBe(true);
  });

  it("without options, behaves like the heuristic-only flow (default deployment)", async () => {
    // No opts ⇒ no provider ⇒ heuristic, byte-for-byte.
    const out = await analyzeMetaAndSuggest({ decklist: DECKLIST, format: "modern" });
    expect(out.metaOverview).toBe("The modern metagame is dominated by Burn.");
    expect(isHeuristic(out)).toBe(true);
  });
});
