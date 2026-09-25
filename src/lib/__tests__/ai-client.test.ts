/**
 * Tests for `generateOpponentDeck` offline heuristic (issue #2202).
 *
 * `src/lib/ai-client.ts` exposes three public entry points:
 *   - `generateOpponent(input)` — tries AI first, falls back to heuristic on error
 *   - `generateOpponentDeckFromHeuristics(input)` — pure heuristic path
 *   - `getDeckReview(input)` — uses AI when configured, heuristic offline fallback otherwise
 *
 * Issue #2202: the fallback branch (source === "heuristic") was never
 * exercised by any test. This suite covers:
 *   1. `generateOpponent` falls back to heuristic when `generateAIOpponentDeck` throws
 *   2. `generateOpponent` returns AI result when `generateAIOpponentDeck` succeeds
 *   3. `generateOpponent` throws when both AI and heuristic fail
 *   4. `generateOpponentDeckFromHeuristics` in isolation
 *
 * Issue #2180: `getDeckReview` offline fallback (heuristic path when no AI provider
 * is configured) was never exercised. This suite also covers:
 *   5. `getDeckReview` uses heuristic when no AI provider is configured (offline fallback)
 *   6. `getDeckReview` uses AI path when a provider is configured
 *
 * Valid format values are keys of `gameModes` (from `@/lib/game-state/format-rules`):
 *   "legendary-commander" | "constructed-core" | "constructed-legacy" | etc.
 */

jest.mock("@/ai/flows/ai-opponent-deck-generation", () => ({
  generateAIOpponentDeck: jest.fn(),
}));

jest.mock("@/ai/flows/ai-deck-coach-review", () => ({
  reviewDeck: jest.fn(),
}));

jest.mock("@/ai/providers/factory", () => ({
  isProviderConfigured: jest.fn(),
}));

import {
  generateOpponent,
  generateOpponentDeckFromHeuristics,
  getDeckReview,
} from "../ai-client";
import { generateAIOpponentDeck } from "@/ai/flows/ai-opponent-deck-generation";
import { reviewDeck } from "@/ai/flows/ai-deck-coach-review";
import { isProviderConfigured } from "@/ai/providers/factory";
import type { CounterTargetArchetype } from "@/ai/opponent-deck-generator";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";

const aiOpponentDeckGen = generateAIOpponentDeck as jest.MockedFunction<
  typeof generateAIOpponentDeck
>;

const mockedReviewDeck = reviewDeck as jest.MockedFunction<typeof reviewDeck>;

const mockedIsProviderConfigured = isProviderConfigured as jest.MockedFunction<
  typeof isProviderConfigured
>;

const LEGENDARY_COMMANDER = "legendary-commander" as const;
const CONSTRUCTED_CORE = "constructed-core" as const;

const minimalInput = {
  theme: undefined,
  difficulty: "medium" as const,
  format: LEGENDARY_COMMANDER,
  colorIdentity: [] as string[],
  targetArchetype: undefined,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("generateOpponent — offline heuristic fallback (issue #2202)", () => {
  it("returns source=heuristic when generateAIOpponentDeck throws", async () => {
    aiOpponentDeckGen.mockRejectedValue(new Error("AI unavailable"));

    const result = await generateOpponent(minimalInput);

    expect(result.source).toBe("heuristic");
    expect(result.deck).toBeDefined();
    expect(typeof result.deck.name).toBe("string");
    expect(result.deck.name.length).toBeGreaterThan(0);
  });

  it("returns source=heuristic with difficulty and format passed through", async () => {
    aiOpponentDeckGen.mockRejectedValue(new Error("AI unavailable"));

    const input: {
      theme: "burn" | undefined;
      difficulty: "hard";
      format: typeof CONSTRUCTED_CORE;
      colorIdentity: string[];
      targetArchetype: CounterTargetArchetype | undefined;
    } = {
      theme: "burn",
      difficulty: "hard",
      format: CONSTRUCTED_CORE,
      colorIdentity: ["R", "G"],
      targetArchetype: "aggro",
    };

    const result = await generateOpponent(input);

    expect(result.source).toBe("heuristic");
    expect(result.deck.format).toBe(CONSTRUCTED_CORE);
    expect(result.deck.difficulty).toBe("hard");
    expect(Array.isArray(result.deck.colorIdentity)).toBe(true);
  });

  it("returns source=ai when generateAIOpponentDeck succeeds", async () => {
    aiOpponentDeckGen.mockResolvedValue({
      strategicApproach: "Play creatures and attack.",
      deckList: ["3 Lightning Bolt", "4 Birds of Paradise"],
    });

    const result = await generateOpponent(minimalInput);

    expect(result.source).toBe("ai");
    expect(result.deck.description).toBe("Play creatures and attack.");
  });

  it("maps AI deckList lines to card objects correctly", async () => {
    aiOpponentDeckGen.mockResolvedValue({
      strategicApproach: "Control the game.",
      deckList: ["4 Counterspell", "2 Mystic Confluence", "1 Ancestral Recall"],
    });

    const result = await generateOpponent(minimalInput);

    expect(result.source).toBe("ai");
    expect(result.deck.cards).toEqual([
      { name: "Counterspell", quantity: 4 },
      { name: "Mystic Confluence", quantity: 2 },
      { name: "Ancestral Recall", quantity: 1 },
    ]);
  });

  it("applies defaults when AI omits optional fields", async () => {
    aiOpponentDeckGen.mockResolvedValue({
      strategicApproach: "Aggro beatdown.",
      deckList: ["4 Goblin Guide"],
    });

    const result = await generateOpponent({});

    expect(result.source).toBe("ai");
    expect(result.deck.difficulty).toBe("medium");
    expect(result.deck.format).toBe("commander");
    expect(result.deck.colorIdentity).toEqual([]);
  });

  it("throws when generateOpponentDeckFromHeuristics throws", async () => {
    aiOpponentDeckGen.mockRejectedValue(new Error("AI unavailable"));

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      generateOpponent({ format: "nonexistent-format" as any }),
    ).rejects.toThrow();

    errorSpy.mockRestore();
  });
});

describe("generateOpponentDeckFromHeuristics — direct calls", () => {
  it("returns a GeneratedDeck with all required fields", async () => {
    const deck = await generateOpponentDeckFromHeuristics(minimalInput);

    expect(deck).toHaveProperty("name");
    expect(deck).toHaveProperty("archetype");
    expect(deck).toHaveProperty("theme");
    expect(deck).toHaveProperty("description");
    expect(deck).toHaveProperty("strategicApproach");
    expect(deck).toHaveProperty("cards");
    expect(Array.isArray(deck.cards)).toBe(true);
    expect(deck).toHaveProperty("colorIdentity");
    expect(deck).toHaveProperty("difficulty");
    expect(deck).toHaveProperty("format");
    expect(deck).toHaveProperty("sideboard");
  });

  it("uses themed path when theme is supplied", async () => {
    const deck = await generateOpponentDeckFromHeuristics({
      ...minimalInput,
      theme: "burn",
    });

    expect(deck.theme).toBe("burn");
  });

  it("passes difficulty and format through", async () => {
    const deck = await generateOpponentDeckFromHeuristics({
      theme: undefined,
      difficulty: "easy",
      format: CONSTRUCTED_CORE,
      colorIdentity: ["W"] as string[],
      targetArchetype: undefined,
    });

    expect(deck.difficulty).toBe("easy");
    expect(deck.format).toBe(CONSTRUCTED_CORE);
    expect(deck.colorIdentity).toEqual(["W"]);
  });

  it("generates non-empty deck", async () => {
    const deck = await generateOpponentDeckFromHeuristics(minimalInput);

    expect(deck.cards.length).toBeGreaterThan(0);
    expect(deck.sideboard).toEqual(expect.any(Array));
  });
});

describe("getDeckReview — offline fallback (issue #2180)", () => {
  const heuristicOutput: DeckReviewOutput = {
    reviewSummary: "A solid aggro deck.",
    deckOptions: [
      {
        title: "Add more reach",
        description: "Consider adding more burn spells.",
        cardsToAdd: [{ name: "Lightning Bolt", quantity: 4 }],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls reviewDeck with useAI=false when no AI provider is configured", async () => {
    mockedIsProviderConfigured.mockReturnValue(false);
    mockedReviewDeck.mockResolvedValue(heuristicOutput);

    const result = await getDeckReview({
      decklist: "4 Lightning Bolt\n4 Monk of the Order",
      format: "standard",
    });

    expect(mockedIsProviderConfigured).toHaveBeenCalled();
    expect(mockedReviewDeck).toHaveBeenCalledWith(
      {
        decklist: "4 Lightning Bolt\n4 Monk of the Order",
        format: "standard",
      },
      false,
    );
    expect(result).toEqual(heuristicOutput);
  });

  it("calls reviewDeck with useAI=true when AI provider is configured", async () => {
    mockedIsProviderConfigured.mockReturnValue(true);
    const aiOutput: DeckReviewOutput = {
      reviewSummary: "AI review: strong aggro deck.",
      deckOptions: [],
    };
    mockedReviewDeck.mockResolvedValue(aiOutput);

    const result = await getDeckReview({
      decklist: "4 Lightning Bolt\n4 Monk of the Order",
      format: "standard",
    });

    expect(mockedIsProviderConfigured).toHaveBeenCalled();
    expect(mockedReviewDeck).toHaveBeenCalledWith(
      {
        decklist: "4 Lightning Bolt\n4 Monk of the Order",
        format: "standard",
      },
      true,
    );
    expect(result).toEqual(aiOutput);
  });
});
