/**
 * Tests for the heuristic post-game analysis flow (issue #1078).
 *
 * `ai-post-game-analysis.ts` replaced its Genkit AI provider calls with pure
 * heuristic algorithms (issue #446). These tests lock in the CURRENT behavior
 * of the three exported entry points and their internal helpers — including the
 * defensive type-guards and the win/loss/draw, life-change, card-advantage,
 * mistake, rating-clamp and low-life branches — so the Lane 3 LLM-rewiring
 * work can refactor safely against a concrete baseline.
 */

import type { GameReplay, GameAnalysisTurn, Threat } from "@/ai/types";
import {
  analyzeGame,
  identifyKeyMoments,
  generateQuickTips,
} from "../ai-post-game-analysis";

const PLAYER = "Alex";

/** Build a single analysis turn with sensible defaults. */
function turn(
  overrides: Partial<GameAnalysisTurn> & { turnNumber: number },
): GameAnalysisTurn {
  return { ...overrides };
}

/** Build a well-formed Threat entry. */
function threat(card: string, threatText: string): Threat {
  return { card, threat: threatText, priority: "low" };
}

/** A replay where the player won with card advantage. */
function winningReplay(): GameReplay {
  return {
    playerLife: 18,
    opponentLife: 0,
    turns: [
      turn({ turnNumber: 1, cardAdvantage: { [PLAYER]: 1 } }),
      turn({ turnNumber: 2, cardAdvantage: { [PLAYER]: 2 } }),
    ],
  };
}

describe("analyzeGame", () => {
  it("returns a complete GameAnalysisOutput shape for a typical winning game", async () => {
    const out = await analyzeGame({ replay: winningReplay(), playerName: PLAYER });

    expect(typeof out.gameSummary).toBe("string");
    expect(out.gameSummary).toContain("won");
    expect(Array.isArray(out.keyMoments)).toBe(true);
    expect(Array.isArray(out.mistakes)).toBe(true);
    expect(Array.isArray(out.strengths)).toBe(true);
    expect(Array.isArray(out.improvementAreas)).toBe(true);
    expect(Array.isArray(out.deckSuggestions)).toBe(true);
    expect(Array.isArray(out.tips)).toBe(true);
    expect(typeof out.overallRating).toBe("number");
  });

  it("reports a win when player life exceeds opponent life", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 20, opponentLife: 5 },
      playerName: PLAYER,
    });
    expect(out.gameSummary).toContain(`${PLAYER} won`);
    expect(out.gameSummary).toContain("20 life");
  });

  it("reports a loss when player life is below opponent life", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 3, opponentLife: 12 },
      playerName: PLAYER,
    });
    expect(out.gameSummary).toContain(`${PLAYER} lost`);
  });

  it("reports a draw when life totals are equal", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 10, opponentLife: 10 },
      playerName: PLAYER,
    });
    expect(out.gameSummary).toContain("draw");
  });

  it("falls back to 20 life when player/opponent life are missing", async () => {
    const out = await analyzeGame({ replay: {}, playerName: PLAYER });
    // 20 vs 20 → draw
    expect(out.gameSummary).toContain("draw");
  });

  it("counts the number of turns actually played", async () => {
    const replay: GameReplay = {
      turns: [
        turn({ turnNumber: 1 }),
        turn({ turnNumber: 2 }),
        turn({ turnNumber: 3 }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.gameSummary).toContain("Game lasted 3 turns");
  });

  it("ignores malformed turns that lack a numeric turnNumber", async () => {
    const replay = {
      turns: [
        { turnNumber: 1 },
        { foo: "bar" }, // no turnNumber → filtered out by type guard
        { turnNumber: "two" }, // non-numeric → filtered out
        { turnNumber: 3 },
      ],
    } as unknown as GameReplay;
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.gameSummary).toContain("Game lasted 2 turns");
  });

  it("handles an empty replay (no turns) without throwing", async () => {
    const out = await analyzeGame({ replay: {}, playerName: PLAYER });
    expect(out.gameSummary).toContain("Game lasted 0 turns");
    expect(out.mistakes).toEqual([]);
    expect(out.keyMoments).toEqual([]);
    expect(out.strengths.length).toBeGreaterThan(0);
  });

  it("handles a replay with an empty turns array", async () => {
    const out = await analyzeGame({ replay: { turns: [] }, playerName: PLAYER });
    expect(out.gameSummary).toContain("0 turns");
  });
});

describe("analyzeGame — key moments (life changes & card advantage)", () => {
  it("flags significant positive/negative life changes (>= 5)", async () => {
    const replay: GameReplay = {
      turns: [
        turn({ turnNumber: 1, lifeChanges: { [PLAYER]: 6 } }),
        turn({ turnNumber: 2, lifeChanges: { [PLAYER]: -8 } }),
        turn({ turnNumber: 3, lifeChanges: { [PLAYER]: 2 } }), // below threshold
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.keyMoments).toHaveLength(2);
    expect(out.keyMoments[0].impact).toBe("positive");
    expect(out.keyMoments[1].impact).toBe("negative");
  });

  it("flags card-advantage shifts (>= 2)", async () => {
    const replay: GameReplay = {
      turns: [turn({ turnNumber: 1, cardAdvantage: { [PLAYER]: 3 } })],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.keyMoments).toHaveLength(1);
    expect(out.keyMoments[0].description).toContain("Card advantage");
  });

  it("limits key moments to the top 5", async () => {
    const turns: GameAnalysisTurn[] = Array.from({ length: 8 }, (_, i) =>
      turn({ turnNumber: i + 1, lifeChanges: { [PLAYER]: -5 } }),
    );
    const out = await analyzeGame({ replay: { turns }, playerName: PLAYER });
    expect(out.keyMoments.length).toBeLessThanOrEqual(5);
  });
});

describe("analyzeGame — mistakes", () => {
  it("records missed opportunities as minor mistakes", async () => {
    const replay: GameReplay = {
      turns: [
        turn({
          turnNumber: 1,
          missedOpportunities: {
            [PLAYER]: [
              threat("Lightning Bolt", "Looming goyf"),
              threat("Counterspell", "Key spell"),
            ],
          },
        }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.mistakes).toHaveLength(2);
    expect(out.mistakes.every((m) => m.severity === "minor")).toBe(true);
    expect(out.mistakes[0].description).toContain("Lightning Bolt");
  });

  it("records suboptimal plays as major mistakes", async () => {
    const replay: GameReplay = {
      turns: [
        turn({
          turnNumber: 2,
          suboptimalPlays: { [PLAYER]: ["Attacked into a blocker", "Wasted removal"] },
        }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.mistakes).toHaveLength(2);
    expect(out.mistakes.every((m) => m.severity === "major")).toBe(true);
  });

  it("ignores malformed missed-opportunity entries (no card/threat)", async () => {
    const replay: GameReplay = {
      turns: [
        turn({
          turnNumber: 1,
          missedOpportunities: {
            [PLAYER]: [
              { card: "Bolt" },
              "not-an-object",
              { threat: "x" },
            ] as unknown as Threat[],
          },
        }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.mistakes).toEqual([]);
  });

  it("ignores non-string suboptimal plays", async () => {
    const replay: GameReplay = {
      turns: [
        turn({
          turnNumber: 1,
          // Intentionally malformed: numeric entries must be skipped.
          suboptimalPlays: { [PLAYER]: [123, "valid play"] as unknown as string[] },
        }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.mistakes).toHaveLength(1);
    expect(out.mistakes[0].description).toBe("valid play");
  });

  it("limits mistakes to the top 5", async () => {
    const turns: GameAnalysisTurn[] = Array.from({ length: 8 }, (_, i) =>
      turn({
        turnNumber: i + 1,
        suboptimalPlays: { [PLAYER]: ["bad play"] },
      }),
    );
    const out = await analyzeGame({ replay: { turns }, playerName: PLAYER });
    expect(out.mistakes.length).toBeLessThanOrEqual(5);
  });
});

describe("analyzeGame — strengths, improvement areas & tips", () => {
  it("credits card advantage and life lead as strengths", async () => {
    const out = await analyzeGame({
      replay: {
        playerLife: 20,
        opponentLife: 5,
        turns: [turn({ turnNumber: 1, cardAdvantage: { [PLAYER]: 2 } })],
      },
      playerName: PLAYER,
    });
    expect(out.strengths).toContain("Maintained healthy life total throughout the game");
    expect(out.strengths).toContain("Generated card advantage through effective play");
  });

  it("flags low life as an improvement area and adds a survival tip", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 8, opponentLife: 18 },
      playerName: PLAYER,
    });
    expect(out.improvementAreas).toContain(
      "Improve defensive strategies to preserve life total",
    );
    expect(out.tips).toContain("Prioritize survival over aggression when life is low");
  });

  it("flags excessive missed opportunities as an improvement area", async () => {
    const replay: GameReplay = {
      turns: [
        turn({
          turnNumber: 1,
          missedOpportunities: {
            [PLAYER]: [
              threat("a", "t"),
              threat("b", "t"),
              threat("c", "t"),
              threat("d", "t"),
            ],
          },
        }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.improvementAreas).toContain(
      "Consider all available options more carefully before making decisions",
    );
  });

  it("always returns the baseline improvement areas and tips", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 20, opponentLife: 20 },
      playerName: PLAYER,
    });
    expect(out.improvementAreas).toContain("Work on timing of spells and abilities");
    expect(out.improvementAreas).toContain("Develop better understanding of opponent's deck");
    expect(out.tips.length).toBeGreaterThanOrEqual(5);
  });
});

describe("analyzeGame — deck suggestions", () => {
  it("suggests life-gain cards when life is low", async () => {
    const out = await analyzeGame({
      replay: { playerLife: 6, opponentLife: 10 },
      playerName: PLAYER,
    });
    expect(
      out.deckSuggestions.some((s) => /life gain/i.test(s.card)),
    ).toBe(true);
  });

  it("suggests lower-cost cards when the average mana cost is high", async () => {
    const replay: GameReplay = {
      turns: [
        turn({ turnNumber: 1, manaCost: 5 }),
        turn({ turnNumber: 2, manaCost: 5 }),
      ],
    };
    const out = await analyzeGame({ replay, playerName: PLAYER });
    expect(out.deckSuggestions.some((s) => /Lower-cost/i.test(s.card))).toBe(true);
  });

  it("always suggests card draw and caps at 3 suggestions", async () => {
    const out = await analyzeGame({
      replay: {
        playerLife: 5,
        turns: [turn({ turnNumber: 1, manaCost: 6 })],
      },
      playerName: PLAYER,
    });
    expect(out.deckSuggestions.some((s) => /Card draw/i.test(s.card))).toBe(true);
    expect(out.deckSuggestions.length).toBeLessThanOrEqual(3);
  });
});

describe("analyzeGame — overall rating", () => {
  it("clamps the rating to the 1..10 range", async () => {
    // Huge negative life swing and heavy card disadvantage would otherwise
    // drag the rating well below zero.
    const low = await analyzeGame({
      replay: { playerLife: 1, opponentLife: 30 },
      playerName: PLAYER,
    });
    expect(low.overallRating).toBeGreaterThanOrEqual(1);
    expect(low.overallRating).toBeLessThanOrEqual(10);

    // Dominant position would otherwise push it above 10.
    const high = await analyzeGame({
      replay: {
        playerLife: 40,
        opponentLife: 1,
        turns: Array.from({ length: 5 }, (_, i) =>
          turn({ turnNumber: i + 1, cardAdvantage: { [PLAYER]: 3 } }),
        ),
      },
      playerName: PLAYER,
    });
    expect(high.overallRating).toBe(10);
  });

  it("rewards card advantage in the rating", async () => {
    const withCa = await analyzeGame({
      replay: {
        playerLife: 10,
        opponentLife: 10,
        turns: [turn({ turnNumber: 1, cardAdvantage: { [PLAYER]: 4 } })],
      },
      playerName: PLAYER,
    });
    const withoutCa = await analyzeGame({
      replay: { playerLife: 10, opponentLife: 10 },
      playerName: PLAYER,
    });
    expect(withCa.overallRating).toBeGreaterThan(withoutCa.overallRating);
  });
});

describe("identifyKeyMoments", () => {
  it("maps positive impact → great_play and negative → mistake", async () => {
    const replay: GameReplay = {
      turns: [
        turn({ turnNumber: 1, lifeChanges: { [PLAYER]: 7 } }), // positive
        turn({ turnNumber: 2, lifeChanges: { [PLAYER]: -9 } }), // negative
        turn({ turnNumber: 3, cardAdvantage: { [PLAYER]: 0 } }), // no moment
      ],
    };
    const out = await identifyKeyMoments({ replay, playerName: PLAYER });
    expect(out.moments).toHaveLength(2);
    expect(out.moments[0].type).toBe("great_play");
    expect(out.moments[1].type).toBe("mistake");
    expect(out.moments[0].whatHappened).toBe(out.moments[0].description);
    expect(out.moments[0].couldHaveHappened).toBeDefined();
    expect(out.summary).toContain("2 key moments");
  });

  it("handles a replay with no detectable moments", async () => {
    const out = await identifyKeyMoments({ replay: {}, playerName: PLAYER });
    expect(out.moments).toEqual([]);
    expect(out.summary).toContain("0 key moments");
  });

  it("tolerates a malformed replay without throwing", async () => {
    const out = await identifyKeyMoments({
      replay: { turns: "not-an-array" } as unknown as GameReplay,
      playerName: PLAYER,
    });
    expect(out.moments).toEqual([]);
  });
});

describe("generateQuickTips", () => {
  it("returns tips plus the improvement focus areas", async () => {
    const out = await generateQuickTips({
      replay: { playerLife: 5, opponentLife: 12 },
      playerName: PLAYER,
    });
    expect(out.tips.length).toBeGreaterThan(0);
    expect(out.focusAreas.length).toBeGreaterThan(0);
    // Low life surfaces a dedicated survival tip and a defensive focus area.
    expect(out.tips).toContain("Prioritize survival over aggression when life is low");
    expect(out.focusAreas).toContain(
      "Improve defensive strategies to preserve life total",
    );
  });

  it("returns the baseline tip set for a comfortable game", async () => {
    const out = await generateQuickTips({
      replay: { playerLife: 20, opponentLife: 20 },
      playerName: PLAYER,
    });
    expect(out.tips).toHaveLength(5);
  });
});
