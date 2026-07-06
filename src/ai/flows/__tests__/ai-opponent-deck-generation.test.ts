/**
 * Tests for the heuristic opponent-deck-generation flow (issue #1078).
 *
 * `ai-opponent-deck-generation.ts` (issue #441) wraps three generators from
 * `@/lib/opponent-deck-generator` and resolves per-format difficulty tuning
 * (issue #1069). The flow has three public entry points
 * (`generateAIOpponentDeck`, `generateRandomOpponent`,
 * `resolveAIOpponentDifficultyConfig`) that all previously had zero direct
 * coverage. This suite mocks the heavy deck generator library and the
 * difficulty module at the module boundary so the wrapper's branching,
 * defaults, format-strategy note and error paths are exercised in isolation.
 *
 * The expected coverage increase (~0% → 70% stmts / 50% branches) is the
 * acceptance criterion called out in issue #1259.
 */

jest.mock("@/lib/opponent-deck-generator", () => {
  const actual = jest.requireActual("@/lib/opponent-deck-generator");
  return {
    ...actual,
    // The generators are pure stochastic functions backed by a large
    // fixed card pool. We mock them with simple, deterministic outputs
    // so the wrapper's branching is exercised in isolation.
    generateOpponentDeck: jest.fn(),
    generateRandomDeck: jest.fn(),
    generateThemedDeck: jest.fn(),
  };
});

jest.mock("@/ai/ai-difficulty", () => {
  const actual = jest.requireActual("@/ai/ai-difficulty");
  return {
    ...actual,
    classifyDifficultyFormat: jest.fn(),
    getDifficultyConfig: jest.fn(),
  };
});

import {
  generateAIOpponentDeck,
  generateRandomOpponent,
  resolveAIOpponentDifficultyConfig,
} from "../ai-opponent-deck-generation";
import {
  generateOpponentDeck,
  generateRandomDeck,
  generateThemedDeck,
} from "@/lib/opponent-deck-generator";
import { classifyDifficultyFormat, getDifficultyConfig } from "@/ai/ai-difficulty";

const mockedGenerateOpponent = generateOpponentDeck as jest.MockedFunction<
  typeof generateOpponentDeck
>;
const mockedGenerateRandom = generateRandomDeck as jest.MockedFunction<
  typeof generateRandomDeck
>;
const mockedGenerateThemed = generateThemedDeck as jest.MockedFunction<
  typeof generateThemedDeck
>;
const mockedClassify = classifyDifficultyFormat as jest.MockedFunction<
  typeof classifyDifficultyFormat
>;
const mockedGetConfig = getDifficultyConfig as jest.MockedFunction<
  typeof getDifficultyConfig
>;

function generatedDeck(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test Deck",
    archetype: "midrange",
    theme: "control",
    description: "test",
    strategicApproach: "Apply pressure and answer threats.",
    cards: [
      { name: "Lightning Bolt", quantity: 4 },
      { name: "Counterspell", quantity: 3 },
    ],
    colorIdentity: ["U", "R"],
    difficulty: "medium" as const,
    format: "commander" as const,
    sideboard: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: classify yields "commander" family for any non-null input,
  // getDifficultyConfig returns a minimal config with the weights the
  // flow's format-strategy note reads.
  mockedClassify.mockImplementation((f?: string | null) =>
    f ? ("commander" as never) : undefined,
  );
  mockedGetConfig.mockReturnValue({
    level: "medium",
    displayName: "Medium",
    evaluationWeights: {
      commanderDamageWeight: 2,
      creaturePower: 1,
      tempoAdvantage: 1,
    },
  } as never);
  mockedGenerateOpponent.mockReturnValue(generatedDeck() as never);
  mockedGenerateRandom.mockReturnValue(generatedDeck({ name: "Random Deck" }) as never);
  mockedGenerateThemed.mockReturnValue(generatedDeck({ name: "Themed Deck" }) as never);
});

describe("generateAIOpponentDeck — defaults and branching", () => {
  it("uses medium difficulty + commander format when none is provided", async () => {
    await generateAIOpponentDeck({});
    expect(mockedGenerateOpponent).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: "medium", format: "commander" }),
    );
    // Themed path is NOT used when no theme is supplied.
    expect(mockedGenerateThemed).not.toHaveBeenCalled();
  });

  it("forwards theme through the themed-deck path", async () => {
    await generateAIOpponentDeck({ theme: "burn" });
    expect(mockedGenerateThemed).toHaveBeenCalledWith("burn", "commander", "medium");
    expect(mockedGenerateOpponent).not.toHaveBeenCalled();
  });

  it("forwards colorIdentity to the underlying generator", async () => {
    await generateAIOpponentDeck({ colorIdentity: ["W", "U"] });
    expect(mockedGenerateOpponent).toHaveBeenCalledWith(
      expect.objectContaining({ colorIdentity: ["W", "U"] }),
    );
  });

  it("flattens the generated card list to a string[]", async () => {
    const out = await generateAIOpponentDeck({});
    expect(out.deckList).toEqual([
      "Lightning Bolt x4",
      "Counterspell x3",
    ]);
  });

  it("uses the bare card name when quantity is 1", async () => {
    mockedGenerateOpponent.mockReturnValue(
      generatedDeck({
        cards: [
          { name: "Plains", quantity: 1 },
          { name: "Island", quantity: 4 },
        ],
      }) as never,
    );
    const out = await generateAIOpponentDeck({});
    expect(out.deckList).toEqual(["Plains", "Island x4"]);
  });

  it("appends a per-format strategy note when the format is a known family", async () => {
    mockedClassify.mockReturnValue("commander" as never);
    const out = await generateAIOpponentDeck({ format: "commander" });
    expect(out.strategicApproach).toContain("Per-format tuning (Commander)");
    expect(out.strategicApproach).toContain("commander damage");
  });

  it("appends a Limited strategy note for limited formats", async () => {
    mockedClassify.mockReturnValue("limited" as never);
    const out = await generateAIOpponentDeck({ format: "sealed" });
    expect(out.strategicApproach).toContain("Per-format tuning (Limited)");
  });

  it("appends a Constructed strategy note for constructed formats", async () => {
    mockedClassify.mockReturnValue("constructed" as never);
    const out = await generateAIOpponentDeck({ format: "modern" });
    expect(out.strategicApproach).toContain("Per-format tuning (Constructed)");
  });

  it("omits the strategy note when the format cannot be classified", async () => {
    mockedClassify.mockReturnValue(undefined as never);
    const out = await generateAIOpponentDeck({ format: "mystery" });
    expect(out.strategicApproach).not.toContain("Per-format tuning");
  });

  it("surfaces a typed error when the underlying generator throws", async () => {
    mockedGenerateOpponent.mockImplementation(() => {
      throw new Error("explode");
    });
    // Silence the expected console.error from the catch branch.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateAIOpponentDeck({})).rejects.toThrow(
      "Failed to generate opponent deck.",
    );
    errorSpy.mockRestore();
  });
});

describe("generateRandomOpponent", () => {
  it("uses the random generator with the supplied format", async () => {
    await generateRandomOpponent("modern");
    expect(mockedGenerateRandom).toHaveBeenCalledWith("modern");
    expect(mockedGenerateOpponent).not.toHaveBeenCalled();
  });

  it("defaults to commander when no format is given", async () => {
    await generateRandomOpponent();
    expect(mockedGenerateRandom).toHaveBeenCalledWith("commander");
  });

  it("returns the strategicApproach verbatim (no per-format tuning appended)", async () => {
    mockedClassify.mockReturnValue("commander" as never);
    const out = await generateRandomOpponent("commander");
    expect(out.strategicApproach).toBe("Apply pressure and answer threats.");
  });

  it("flattens quantities onto card names", async () => {
    mockedGenerateRandom.mockReturnValue(
      generatedDeck({
        cards: [
          { name: "Forest", quantity: 1 },
          { name: "Llanowar Elves", quantity: 4 },
        ],
      }) as never,
    );
    const out = await generateRandomOpponent();
    expect(out.deckList).toEqual(["Forest", "Llanowar Elves x4"]);
  });

  it("surfaces a typed error when the random generator throws", async () => {
    mockedGenerateRandom.mockImplementation(() => {
      throw new Error("rng failure");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(generateRandomOpponent()).rejects.toThrow(
      "Failed to generate random opponent deck.",
    );
    errorSpy.mockRestore();
  });
});

describe("resolveAIOpponentDifficultyConfig", () => {
  it("classifies the format and forwards it to getDifficultyConfig", () => {
    mockedClassify.mockReturnValue("limited" as never);
    mockedGetConfig.mockReturnValue({ level: "hard" } as never);
    const cfg = resolveAIOpponentDifficultyConfig("hard", "sealed");
    expect(mockedClassify).toHaveBeenCalledWith("sealed");
    expect(mockedGetConfig).toHaveBeenCalledWith("hard", "limited");
    expect(cfg).toEqual({ level: "hard" });
  });

  it("propagates the undefined-family path when format is unclassified", () => {
    mockedClassify.mockReturnValue(undefined as never);
    resolveAIOpponentDifficultyConfig("medium", "mystery");
    expect(mockedGetConfig).toHaveBeenCalledWith("medium", undefined);
  });

  it("handles a missing format by skipping classification", () => {
    mockedClassify.mockReturnValue(undefined as never);
    resolveAIOpponentDifficultyConfig("easy");
    expect(mockedClassify).toHaveBeenCalledWith(undefined);
    expect(mockedGetConfig).toHaveBeenCalledWith("easy", undefined);
  });
});
