/**
 * Tests for the heuristic gameplay-assistance flow (issue #1078).
 *
 * `ai-gameplay-assistance.ts` (issue #446, #565, #677) replaced its Genkit AI
 * provider calls with pure heuristic functions: `analyzeCurrentGameState`,
 * `analyzePlay`, `getManaAdvice`, `evaluateBoardState` and `getMulliganAdvice`.
 * All five entry points previously had zero direct coverage. This suite mocks
 * the evaluator and the rate limiter at the module boundary so the flow's
 * branching — warnings, suggested plays, board-advantage thresholds, mana
 * advice, error handling — is exercised in isolation.
 */

import {
  createMockPlayerState,
  createMockPermanent,
  createTestGameState,
} from "@/ai/__tests__/test-helpers";
import type { AIGameState } from "@/lib/game-state/types";

jest.mock("@/ai/game-state-evaluator", () => ({
  evaluateGameState: jest.fn(),
  quickScore: jest.fn(),
  GameState: jest.fn(),
}));
jest.mock("@/ai/mulligan-advisor", () => ({
  analyzeMulligan: jest.fn(),
}));
jest.mock("@/lib/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/rate-limiter");
  return {
    ...actual,
    enforceRateLimit: jest.fn(),
    aiRequestQueue: { add: (fn: () => Promise<unknown>) => fn() },
  };
});

import { analyzeCurrentGameState, analyzePlay, getManaAdvice, evaluateBoardState, getMulliganAdvice } from "../ai-gameplay-assistance";
import { evaluateGameState, quickScore } from "@/ai/game-state-evaluator";
import { analyzeMulligan } from "@/ai/mulligan-advisor";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limiter";

const mockedEvaluate = evaluateGameState as jest.MockedFunction<
  typeof evaluateGameState
>;
const mockedQuickScore = quickScore as jest.MockedFunction<typeof quickScore>;
const mockedMulligan = analyzeMulligan as jest.MockedFunction<
  typeof analyzeMulligan
>;
const mockedEnforce = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const PLAYER = "player1";
const OPPONENT = "player2";

function baseEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    totalScore: 0,
    factors: {
      lifeScore: 0,
      poisonScore: 0,
      cardAdvantage: 0,
      handQuality: 0,
      libraryDepth: 0,
      creaturePower: 0,
      creatureToughness: 0,
      creatureCount: 0,
      permanentAdvantage: 0,
      manaAvailable: 0,
      tempoAdvantage: 0,
      commanderDamage: 0,
      commanderPresence: 0,
      cardSelection: 0,
      graveyardValue: 0,
      synergy: 0,
      winConditionProgress: 0,
      inevitability: 0,
    },
    threats: [],
    opportunities: [],
    recommendedActions: [],
    ...overrides,
  };
}

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  mockedEnforce.mockImplementation(() => {});
  mockedEvaluate.mockReturnValue(baseEvaluation() as never);
  mockedQuickScore.mockReturnValue(0);
  mockedMulligan.mockReturnValue({
    shouldMulligan: false,
    reasoning: "Keep",
  } as never);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("analyzeCurrentGameState — rate limiting", () => {
  it("throws a friendly error when the rate limit is exceeded", async () => {
    mockedEnforce.mockImplementation(() => {
      throw new RateLimitError("limited", 7500, 0);
    });
    const state = createTestGameState();
    await expect(
      analyzeCurrentGameState({ gameState: state, playerName: PLAYER }),
    ).rejects.toThrow(/Rate limit exceeded.*8 seconds/);
  });

  it("rethrows non-rate-limit errors unchanged", async () => {
    mockedEnforce.mockImplementation(() => {
      throw new Error("boom");
    });
    const state = createTestGameState();
    await expect(
      analyzeCurrentGameState({ gameState: state, playerName: PLAYER }),
    ).rejects.toThrow("boom");
  });

  it("enforces the limit using the supplied player name as the key", async () => {
    const state = createTestGameState();
    await analyzeCurrentGameState({ gameState: state, playerName: "Alex" });
    expect(mockedEnforce).toHaveBeenCalledWith("Alex");
  });
});

describe("analyzeCurrentGameState — output shape", () => {
  it("returns a complete GameStateAnalysisOutput for a basic board", async () => {
    const state = createTestGameState();
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    expect(out).toHaveProperty("overallAssessment");
    expect(out).toHaveProperty("suggestedPlays");
    expect(out).toHaveProperty("warnings");
    expect(out).toHaveProperty("manaUsage");
    expect(out).toHaveProperty("boardThreats");
    expect(out).toHaveProperty("strategicAdvice");
    expect(typeof out.overallAssessment).toBe("string");
    expect(Array.isArray(out.suggestedPlays)).toBe(true);
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(Array.isArray(out.boardThreats)).toBe(true);
    expect(Array.isArray(out.strategicAdvice)).toBe(true);
  });

  it("passes gameState and playerName to both evaluators", async () => {
    const state = createTestGameState();
    await analyzeCurrentGameState({ gameState: state, playerName: PLAYER });
    expect(mockedEvaluate).toHaveBeenCalledWith(state, PLAYER);
    expect(mockedQuickScore).toHaveBeenCalledWith(state, PLAYER);
  });
});

describe("analyzeCurrentGameState — warnings", () => {
  it("flags critically low life as a danger warning", async () => {
    const state = createTestGameState(7, 20);
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    const danger = out.warnings.find((w) => w.type === "danger");
    expect(danger?.message).toMatch(/life total is critically low/i);
  });

  it("flags an empty hand as a caution warning", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [];
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    const caution = out.warnings.find((w) => w.type === "caution");
    expect(caution?.message).toMatch(/no cards in hand/i);
  });

  it("flags fewer than 3 lands as an info warning", async () => {
    const state = createTestGameState();
    state.players[PLAYER].battlefield = [];
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    const info = out.warnings.find((w) => w.type === "info");
    expect(info?.message).toMatch(/land base/i);
  });
});

describe("analyzeCurrentGameState — suggested plays", () => {
  it("suggests playing a land as a high-priority play", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Plains",
        type: "Basic Land — Plains",
        manaValue: 0,
      },
    ];
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    const landPlay = out.suggestedPlays.find((p) => p.cardName === "Plains");
    expect(landPlay?.priority).toBe("high");
  });

  it("suggests removal when the opponent has a creature threat", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Lightning Bolt",
        type: "Instant",
        manaValue: 1,
      },
    ];
    state.players[OPPONENT].battlefield = [
      createMockPermanent("p1", "Grizzly Bears", "creature", 2, 2),
    ];
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    const removal = out.suggestedPlays.find((p) => p.cardName === "Lightning Bolt");
    expect(removal?.priority).toBe("high");
    expect(removal?.reasoning).toMatch(/Remove opponent's threat/i);
  });
});

describe("analyzeCurrentGameState — strategic advice", () => {
  it("emits a 'comeback' message when the score is significantly negative", async () => {
    // The function uses `evaluation.totalScore ?? score` and prefers the
    // evaluator's totalScore. Set both to ensure the -10 path is taken.
    mockedQuickScore.mockReturnValue(-10);
    mockedEvaluate.mockReturnValue(
      baseEvaluation({ totalScore: -10 }) as never,
    );
    const state = createTestGameState();
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    expect(out.strategicAdvice.some((s) => /stabilizing|comeback/i.test(s))).toBe(true);
  });

  it("emits an 'aggressive' message when the score is significantly positive", async () => {
    mockedQuickScore.mockReturnValue(10);
    mockedEvaluate.mockReturnValue(
      baseEvaluation({ totalScore: 10 }) as never,
    );
    const state = createTestGameState();
    const out = await analyzeCurrentGameState({
      gameState: state,
      playerName: PLAYER,
    });
    expect(out.strategicAdvice.some((s) => /aggressive|close out/i.test(s))).toBe(true);
  });
});

describe("analyzePlay", () => {
  it("returns a complete PlayAnalysisOutput for a creature play", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Grizzly Bears",
        type: "Creature",
        manaValue: 2,
      },
    ];
    state.players[PLAYER].manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 3, colorless: 0 };
    const out = await analyzePlay({
      gameState: state,
      playerName: PLAYER,
      cardName: "Grizzly Bears",
    });
    expect(out.isRecommended).toBe(true);
    expect(["excellent", "good", "okay"]).toContain(out.rating);
    expect(typeof out.reasoning).toBe("string");
    expect(Array.isArray(out.alternativePlays)).toBe(true);
    expect(Array.isArray(out.potentialUpgrades)).toBe(true);
  });

  it("returns 'Card not found' when the named card is not in hand", async () => {
    const state = createTestGameState();
    const out = await analyzePlay({
      gameState: state,
      playerName: PLAYER,
      cardName: "Missing Card",
    });
    expect(out.isRecommended).toBe(false);
    expect(out.reasoning).toMatch(/not found in hand/i);
  });

  it("rates an instant as 'excellent'", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Counterspell",
        type: "Instant",
        manaValue: 2,
      },
    ];
    const out = await analyzePlay({
      gameState: state,
      playerName: PLAYER,
      cardName: "Counterspell",
    });
    expect(out.rating).toBe("excellent");
  });
});

describe("getManaAdvice", () => {
  it("sums the manaPool into availableMana.total", async () => {
    const state = createTestGameState();
    state.players[PLAYER].manaPool = { red: 2, green: 1, colorless: 0 };
    const out = await getManaAdvice({ gameState: state, playerName: PLAYER });
    expect(out.availableMana.total).toBe(3);
    expect(out.availableMana.colored.red).toBe(2);
    expect(out.availableMana.colored.green).toBe(1);
  });

  it("emits suggestions for playable cards in hand", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Grizzly Bears",
        type: "Creature",
        manaValue: 2,
      },
    ];
    state.players[PLAYER].manaPool = { red: 0, blue: 0, black: 0, white: 0, green: 3, colorless: 0 };
    const out = await getManaAdvice({ gameState: state, playerName: PLAYER });
    expect(out.suggestions.some((s) => s.cardName === "Grizzly Bears")).toBe(true);
  });

  it("flags optimal:false when the player has instants in hand and 2+ unused mana", async () => {
    const state = createTestGameState();
    state.players[PLAYER].hand = [
      {
        cardInstanceId: "h1",
        name: "Counterspell",
        type: "Instant",
        manaValue: 2,
      },
    ];
    state.players[PLAYER].manaPool = { blue: 2 };
    const out = await getManaAdvice({ gameState: state, playerName: PLAYER });
    expect(out.optimal).toBe(false);
  });

  it("flags optimal:true when there is no unused mana", async () => {
    const state = createTestGameState();
    state.players[PLAYER].manaPool = { red: 0 };
    const out = await getManaAdvice({ gameState: state, playerName: PLAYER });
    expect(out.optimal).toBe(true);
  });
});

describe("evaluateBoardState", () => {
  it("returns boardAdvantage='winning' for a strongly positive score", async () => {
    mockedQuickScore.mockReturnValue(10);
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.boardAdvantage).toBe("winning");
  });

  it("returns boardAdvantage='slightly_ahead' for a small positive score", async () => {
    mockedQuickScore.mockReturnValue(3);
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.boardAdvantage).toBe("slightly_ahead");
  });

  it("returns boardAdvantage='even' for a small absolute score", async () => {
    mockedQuickScore.mockReturnValue(0);
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.boardAdvantage).toBe("even");
  });

  it("returns boardAdvantage='slightly_behind' for a small negative score", async () => {
    mockedQuickScore.mockReturnValue(-3);
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.boardAdvantage).toBe("slightly_behind");
  });

  it("returns boardAdvantage='losing' for a strongly negative score", async () => {
    mockedQuickScore.mockReturnValue(-10);
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.boardAdvantage).toBe("losing");
  });

  it("clamps the win chance to the 5..95 range", async () => {
    // Score that would otherwise push the win chance outside the 5..95 band.
    mockedQuickScore.mockReturnValue(100);
    const high = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(high.playerWinChance).toBeLessThanOrEqual(95);

    mockedQuickScore.mockReturnValue(-100);
    const low = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(low.playerWinChance).toBeGreaterThanOrEqual(5);
  });

  it("exposes key factors from the evaluation", async () => {
    mockedEvaluate.mockReturnValue(
      baseEvaluation({
        factors: {
          lifeScore: 1,
          cardAdvantage: 1,
          permanentAdvantage: 1,
          manaAvailable: 1,
        },
      }) as never,
    );
    const out = await evaluateBoardState({
      gameState: createTestGameState(),
      playerName: PLAYER,
    });
    expect(out.keyFactors).toEqual(
      expect.arrayContaining([
        "Healthy life total",
        "Card advantage",
        "Board presence",
        "Mana available",
      ]),
    );
  });
});

describe("getMulliganAdvice (issue #677)", () => {
  it("forwards hand + options to the mulligan advisor", () => {
    const hand = [
      {
        cardInstanceId: "h1",
        name: "Forest",
        type: "Basic Land",
        manaValue: 0,
      },
    ];
    getMulliganAdvice(hand, {
      archetype: "Burn",
      format: "constructed",
      gameNumber: 2,
      onThePlay: true,
    });
    expect(mockedMulligan).toHaveBeenCalledWith({
      hand,
      archetype: "Burn",
      format: "constructed",
      gameNumber: 2,
      onThePlay: true,
    });
  });

  it("forwards the call even when no options are provided", () => {
    const hand = [
      {
        cardInstanceId: "h1",
        name: "Forest",
        type: "Basic Land",
        manaValue: 0,
      },
    ];
    getMulliganAdvice(hand);
    expect(mockedMulligan).toHaveBeenCalledWith({
      hand,
      archetype: undefined,
      format: undefined,
      gameNumber: undefined,
      onThePlay: undefined,
    });
  });

  it("returns whatever the mulligan advisor produces", () => {
    mockedMulligan.mockReturnValue({
      shouldMulligan: true,
      reasoning: "Not enough lands",
    } as never);
    const out = getMulliganAdvice([]);
    expect(out).toEqual({ shouldMulligan: true, reasoning: "Not enough lands" });
  });
});
