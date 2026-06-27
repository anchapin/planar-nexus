/**
 * Tests for the heuristic deck-coach-review flow (issue #1078).
 *
 * `reviewDeck` (issue #440) selects between an AI proxy path and a heuristic
 * fallback, gated by rate limiting (issue #526), online status, and the
 * prompt-security output validator (issue #1107). The heuristic tail also
 * validates card legality and rebalances add/remove quantities. All of these
 * branches previously had zero direct coverage.
 *
 * The dependencies are mocked so the REAL flow logic (branch selection,
 * validation, rebalancing, summary prefixing, option filtering) is exercised.
 * `@/ai/prompt-security` is left real because `validateDeckReviewOutput` is a
 * pure function already covered elsewhere — feeding it well-formed vs malformed
 * payloads drives the AI→heuristic fallback branch honestly.
 */

jest.mock("@/lib/heuristic-deck-coach", () => ({
  reviewDeckHeuristic: jest.fn(),
}));
jest.mock("@/lib/server-card-operations", () => ({
  validateCardLegality: jest.fn(),
}));
jest.mock("@/lib/ai-proxy-client", () => ({
  callAIProxy: jest.fn(),
}));
jest.mock("@/lib/rate-limiter", () => {
  // Keep the real RateLimitError class so `instanceof` in the flow works, while
  // stubbing enforceRateLimit and the request queue (queue runs fn inline).
  const actual = jest.requireActual("@/lib/rate-limiter");
  return {
    ...actual,
    enforceRateLimit: jest.fn(),
    aiRequestQueue: { add: (fn: () => Promise<unknown>) => fn() },
  };
});
// Issue #1072: the local citation verification gate resolves suggested cards
// against the local card database. Mock it so the gate's behaviour is
// deterministic without an IndexedDB store.
jest.mock("@/lib/card-database", () => ({
  getCardByName: jest.fn(),
  getDatabaseStatus: jest.fn(),
}));

import { reviewDeck } from "../ai-deck-coach-review";
import type { DeckReviewOutput } from "../ai-deck-coach-review";
import { reviewDeckHeuristic } from "@/lib/heuristic-deck-coach";
import { validateCardLegality } from "@/lib/server-card-operations";
import { callAIProxy } from "@/lib/ai-proxy-client";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limiter";
import { getCardByName, getDatabaseStatus } from "@/lib/card-database";
import type { MinimalCard } from "@/lib/card-database";

const mockedHeuristic = reviewDeckHeuristic as jest.MockedFunction<
  typeof reviewDeckHeuristic
>;
const mockedValidate = validateCardLegality as jest.MockedFunction<
  typeof validateCardLegality
>;
const mockedProxy = callAIProxy as jest.MockedFunction<typeof callAIProxy>;
const mockedEnforce = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const mockedGetCardByName = getCardByName as jest.MockedFunction<
  typeof getCardByName
>;
const mockedGetDatabaseStatus = getDatabaseStatus as jest.MockedFunction<
  typeof getDatabaseStatus
>;

const DECKLIST = "4 Lightning Bolt\n2 Blood Moon\n3 Forest";

function heuristicResult(
  overrides: Partial<DeckReviewOutput> = {},
): DeckReviewOutput {
  return {
    reviewSummary: "Heuristic review summary.",
    deckOptions: [
      {
        title: "Optimize for Aggro",
        description: "Lower your curve.",
        cardsToAdd: [{ name: "Lightning Bolt", quantity: 2 }],
        cardsToRemove: [{ name: "Expensive Card", quantity: 2 }],
      },
    ],
    archetype: { primary: "Aggro", confidence: 0.8 },
    synergies: { present: [], missing: [] },
    ...overrides,
  };
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
    writable: true,
  });
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  // The flow intentionally logs when the AI path fails and it falls back to
  // the heuristic — silence that expected noise so it does not pollute output.
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockedEnforce.mockImplementation(() => {});
  mockedHeuristic.mockReturnValue(heuristicResult());
  mockedValidate.mockResolvedValue({ found: [], notFound: [], illegal: [] });
  // By default the AI path is unavailable → falls through to heuristic.
  mockedProxy.mockResolvedValue({ success: false } as never);
  // Issue #1072: default to an EMPTY local card database so the verification
  // gate reports every suggestion as "unverifiable" and leaves them intact —
  // this keeps the pre-existing heuristic-path assertions unchanged. Tests
  // that exercise the populated-DB gate override these mocks locally.
  mockedGetDatabaseStatus.mockResolvedValue({ loaded: false, cardCount: 0 });
  mockedGetCardByName.mockResolvedValue(undefined);
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
  errorSpy.mockRestore();
});

describe("reviewDeck — rate limiting", () => {
  it("throws a friendly error when the rate limit is exceeded", async () => {
    mockedEnforce.mockImplementation(() => {
      throw new RateLimitError("limited", 5000, 0);
    });
    await expect(
      reviewDeck({ decklist: DECKLIST, format: "modern" }),
    ).rejects.toThrow(/Rate limit exceeded.*5 seconds/);
    expect(mockedHeuristic).not.toHaveBeenCalled();
  });

  it("rethrows non-rate-limit errors unchanged", async () => {
    mockedEnforce.mockImplementation(() => {
      throw new Error("unexpected boom");
    });
    await expect(
      reviewDeck({ decklist: DECKLIST, format: "modern" }),
    ).rejects.toThrow("unexpected boom");
  });

  it("enforces the limit under a per-format user id", async () => {
    await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(mockedEnforce).toHaveBeenCalledWith("deck-review-modern");
  });
});

describe("reviewDeck — heuristic path", () => {
  it("returns the heuristic summary WITHOUT a mode prefix when online and AI is off", async () => {
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.reviewSummary).toBe("Heuristic review summary.");
    expect(out.archetype).toEqual({ primary: "Aggro", confidence: 0.8 });
    expect(out.synergies).toEqual({ present: [], missing: [] });
  });

  it("prefixes the summary in Heuristic Mode when offline", async () => {
    setOnline(false);
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.reviewSummary).toBe(
      "[Heuristic Mode - AI Unavailable] Heuristic review summary.",
    );
  });

  it("parses the decklist and passes card objects to the heuristic engine", async () => {
    await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(mockedHeuristic).toHaveBeenCalledWith(
      DECKLIST,
      "modern",
      expect.arrayContaining([
        expect.objectContaining({ name: "Lightning Bolt", count: 4 }),
      ]),
    );
  });

  it("handles an empty decklist without throwing", async () => {
    mockedHeuristic.mockReturnValue(
      heuristicResult({ deckOptions: [] }),
    );
    const out = await reviewDeck({ decklist: "", format: "modern" });
    expect(out.deckOptions).toEqual([]);
  });

  it("filters out deck options that propose no card changes", async () => {
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "No Changes",
            description: "Nothing to add.",
            // no cardsToAdd / cardsToRemove
          },
          {
            title: "Has Adds",
            description: "Add this.",
            cardsToAdd: [{ name: "Bolt", quantity: 1 }],
          },
        ],
      }),
    );
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.deckOptions).toHaveLength(1);
    expect(out.deckOptions[0].title).toBe("Has Adds");
  });
});

describe("reviewDeck — card legality validation in the heuristic tail", () => {
  it("removes not-found and illegal cards from the add suggestions", async () => {
    mockedValidate.mockResolvedValue({
      found: [],
      notFound: ["Lightning Bolt"],
      illegal: ["Blood Moon"],
    });
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "Opt",
            description: "d",
            cardsToAdd: [
              { name: "Lightning Bolt", quantity: 1 },
              { name: "Blood Moon", quantity: 1 },
              { name: "Good Card", quantity: 1 },
            ],
            cardsToRemove: [{ name: "Cut", quantity: 1 }],
          },
        ],
      }),
    );
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.deckOptions[0].cardsToAdd).toEqual([
      { name: "Good Card", quantity: 1 },
    ]);
  });

  it("does not call validateCardLegality when an option has no cards to add", async () => {
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          { title: "Removes only", description: "d", cardsToRemove: [{ name: "Cut", quantity: 1 }] },
        ],
      }),
    );
    await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(mockedValidate).not.toHaveBeenCalled();
  });
});

describe("reviewDeck — local citation verification gate (issue #1072)", () => {
  function realCard(name: string): MinimalCard {
    return {
      id: name,
      name,
      cmc: 1,
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      legalities: { modern: "legal" },
      mana_cost: "{R}",
      oracle_text: "deal damage",
    };
  }

  it("strips suggested cards that are not in a POPULATED local database", async () => {
    // DB has cards; "Lightning Bolt" resolves but "Fabricated Dragon" does not.
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: true, cardCount: 42 });
    mockedGetCardByName.mockImplementation(async (name: string) =>
      name === "Lightning Bolt" ? realCard("Lightning Bolt") : undefined,
    );
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "Opt",
            description: "d",
            cardsToAdd: [
              { name: "Lightning Bolt", quantity: 2 },
              { name: "Fabricated Dragon", quantity: 1 },
            ],
            cardsToRemove: [{ name: "Slow Card", quantity: 3 }],
          },
        ],
      }),
    );

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    const adds = out.deckOptions[0].cardsToAdd || [];
    // Hallucinated card is removed; the real card survives.
    expect(adds.map((c) => c.name)).toEqual(["Lightning Bolt"]);
  });

  it("leaves suggestions intact when the local database is empty (unverifiable)", async () => {
    // Empty DB → cannot refute anything → must not strip legitimate advice.
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: false, cardCount: 0 });
    mockedGetCardByName.mockResolvedValue(undefined);
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "Opt",
            description: "d",
            cardsToAdd: [{ name: "Lightning Bolt", quantity: 2 }],
            cardsToRemove: [{ name: "Slow Card", quantity: 2 }],
          },
        ],
      }),
    );

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.deckOptions[0].cardsToAdd).toEqual([
      { name: "Lightning Bolt", quantity: 2 },
    ]);
  });

  it("runs the local gate before legality validation so survivors are still legality-checked", async () => {
    mockedGetDatabaseStatus.mockResolvedValue({ loaded: true, cardCount: 10 });
    // "Real Card" and "Keep Card" exist locally; "Ghost" does not (hallucination).
    mockedGetCardByName.mockImplementation(async (name: string) =>
      name === "Real Card" || name === "Keep Card"
        ? realCard(name)
        : undefined,
    );
    // Legality validation then flags "Real Card" as illegal, but leaves
    // "Keep Card" (which survived the local gate) alone.
    mockedValidate.mockResolvedValue({
      found: [],
      notFound: [],
      illegal: ["Real Card"],
    });
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "Opt",
            description: "d",
            cardsToAdd: [
              { name: "Ghost", quantity: 1 }, // stripped by local gate (hallucination)
              { name: "Real Card", quantity: 1 }, // stripped by legality check
              { name: "Keep Card", quantity: 1 }, // survives both
            ],
            cardsToRemove: [{ name: "Cut", quantity: 3 }],
          },
        ],
      }),
    );

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    // Ghost (local gate) and Real Card (legality) both gone; Keep Card remains.
    expect(out.deckOptions[0].cardsToAdd).toEqual([
      { name: "Keep Card", quantity: 1 },
    ]);
  });
});

describe("reviewDeck — quantity rebalancing (issue #1078 regression)", () => {
  it("trims removals down to the add count without looping forever", async () => {
    // removes (5) exceed adds (2). Pre-fix this hung forever because the
    // zero-quantity tail item was re-pushed and never let earlier items shrink.
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "Rebalance",
            description: "d",
            cardsToAdd: [{ name: "Bolt", quantity: 2 }],
            cardsToRemove: [
              { name: "Slow A", quantity: 3 },
              { name: "Slow B", quantity: 2 },
            ],
          },
        ],
      }),
    );
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    const option = out.deckOptions[0];
    const removeCount = (option.cardsToRemove || []).reduce(
      (s, c) => s + c.quantity,
      0,
    );
    expect(removeCount).toBeLessThanOrEqual(2);
    // No zero-quantity entries leak through.
    expect((option.cardsToRemove || []).every((c) => c.quantity > 0)).toBe(true);
  });

  it("leaves a single oversized removal entry correctly trimmed", async () => {
    mockedHeuristic.mockReturnValue(
      heuristicResult({
        deckOptions: [
          {
            title: "One Big Remove",
            description: "d",
            cardsToAdd: [{ name: "Bolt", quantity: 2 }],
            cardsToRemove: [{ name: "Huge", quantity: 6 }],
          },
        ],
      }),
    );
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" });
    expect(out.deckOptions[0].cardsToRemove).toEqual([
      { name: "Huge", quantity: 2 },
    ]);
  });
});

describe("reviewDeck — AI vs heuristic branch selection", () => {
  it("returns the validated AI output when useAI and the proxy succeeds", async () => {
    mockedProxy.mockResolvedValue({
      success: true,
      data: {
        reviewSummary: "AI summary.",
        deckOptions: [{ title: "AI option", description: "from model" }],
      },
    } as never);

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" }, true);

    expect(mockedProxy).toHaveBeenCalled();
    expect(out.reviewSummary).toBe("AI summary.");
    // Heuristic engine must not run when the AI response is used.
    expect(mockedHeuristic).not.toHaveBeenCalled();
  });

  it("falls back to the heuristic when the AI payload is malformed (validator rejects it)", async () => {
    // validateDeckReviewOutput returns null for non-object payloads.
    mockedProxy.mockResolvedValue({
      success: true,
      data: "not-an-object",
    } as never);

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" }, true);

    expect(mockedHeuristic).toHaveBeenCalled();
    // useAI=true → heuristic summary carries the unavailable-mode prefix.
    expect(out.reviewSummary).toContain("Heuristic Mode");
  });

  it("falls back to the heuristic when the proxy reports failure", async () => {
    mockedProxy.mockResolvedValue({ success: false } as never);

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" }, true);

    expect(mockedHeuristic).toHaveBeenCalled();
    expect(out.reviewSummary).toContain("Heuristic Mode");
  });

  it("falls back to the heuristic when the proxy throws", async () => {
    mockedProxy.mockRejectedValue(new Error("network down"));

    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" }, true);

    expect(mockedHeuristic).toHaveBeenCalled();
    expect(out.reviewSummary).toContain("Heuristic Mode");
  });

  it("skips the AI call entirely when offline, even if useAI is true", async () => {
    setOnline(false);
    const out = await reviewDeck({ decklist: DECKLIST, format: "modern" }, true);
    expect(mockedProxy).not.toHaveBeenCalled();
    expect(out.reviewSummary).toContain("Heuristic Mode");
  });
});
