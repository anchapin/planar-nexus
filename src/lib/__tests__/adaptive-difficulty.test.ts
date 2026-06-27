/**
 * @fileoverview Tests for Adaptive Difficulty Service
 *
 * Issue #1064: the adaptive service now uses the single canonical difficulty
 * taxonomy from `src/ai/ai-difficulty.ts` (`easy | medium | hard | expert`).
 * These tests assert the canonical set, the shared-source-of-truth invariant,
 * and that legacy archival names are normalized onto that set.
 */

import {
  analyzeDifficulty,
  getAdaptiveDifficulty,
  getNextDifficulty,
  isValidDifficulty,
  getDifficultyInfo,
  DIFFICULTY_LEVELS,
  DEFAULT_THRESHOLDS,
} from "../adaptive-difficulty";
import {
  DIFFICULTY_LEVELS as AI_DIFFICULTY_LEVELS,
  normalizeDifficultyLevel,
} from "@/ai/ai-difficulty";
import type { GameRecord } from "../game-history";

// Helper to create test records
function createTestRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `game-${Math.random().toString(36).substr(2, 9)}`,
    date: Date.now(),
    mode: "vs_ai",
    result: "win",
    playerDeck: "Test Deck",
    opponentDeck: "Aggro",
    difficulty: "medium",
    turns: 10,
    playerLifeAtEnd: 20,
    opponentLifeAtEnd: 0,
    mulligans: 0,
    ...overrides,
  };
}

describe("canonical taxonomy (issue #1064)", () => {
  it("uses the canonical four-tier set", () => {
    expect(DIFFICULTY_LEVELS).toEqual(["easy", "medium", "hard", "expert"]);
  });

  it("references the same source of truth as src/ai/ai-difficulty.ts", () => {
    // adaptive-difficulty re-exports the canonical array rather than
    // redeclaring it, so the two modules must be literally identical.
    expect(DIFFICULTY_LEVELS).toBe(AI_DIFFICULTY_LEVELS);
  });
});

describe("analyzeDifficulty", () => {
  const mediumDifficulty = "medium" as const;

  describe("insufficient games", () => {
    it("should return maintain when fewer than minGames required", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
      ];

      const result = analyzeDifficulty(records, mediumDifficulty, {
        ...DEFAULT_THRESHOLDS,
        minGamesForRecommendation: 5,
      });

      expect(result.recommendation).toBe("maintain");
      expect(result.gamesAnalyzed).toBe(4);
      expect(result.reason).toContain("Not enough games");
    });
  });

  describe("high win rate", () => {
    it("should recommend increase when win rate > 80%", () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: "medium", result: "win" }),
      );

      const result = analyzeDifficulty(records, mediumDifficulty);

      expect(result.recommendation).toBe("increase");
      expect(result.winRate).toBe(100);
      expect(result.suggestedDifficulty).toBe("hard");
    });

    it("should recommend maintain for 4 out of 5 wins (80%)", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
      ];

      const result = analyzeDifficulty(records, mediumDifficulty);

      // 4/5 = 80%, which is at the threshold
      expect(result.recommendation).toBe("maintain");
    });
  });

  describe("low win rate", () => {
    it("should recommend decrease when win rate < 20%", () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: "medium", result: "loss" }),
      );

      const result = analyzeDifficulty(records, mediumDifficulty);

      expect(result.recommendation).toBe("decrease");
      expect(result.winRate).toBe(0);
      expect(result.suggestedDifficulty).toBe("easy");
    });

    it("should recommend maintain for 1 out of 5 wins (20%)", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
      ];

      const result = analyzeDifficulty(records, mediumDifficulty);

      // 1/5 = 20%, which is at the threshold
      expect(result.recommendation).toBe("maintain");
    });
  });

  describe("balanced performance", () => {
    it("should recommend maintain when win rate is between thresholds", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
        createTestRecord({ difficulty: "medium", result: "loss" }),
      ];

      const result = analyzeDifficulty(records, mediumDifficulty);

      expect(result.recommendation).toBe("maintain");
      expect(result.winRate).toBe(40);
    });
  });

  describe("edge cases", () => {
    it("should only analyze games at the specified difficulty", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "easy", result: "win" }),
        createTestRecord({ difficulty: "easy", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
        createTestRecord({ difficulty: "medium", result: "win" }),
      ];

      const result = analyzeDifficulty(records, "medium");

      // Should only count 3 medium games, not enough for recommendation
      expect(result.gamesAnalyzed).toBe(3);
      expect(result.recommendation).toBe("maintain");
    });

    it("should count legacy archival names toward the canonical tier (issue #1064)", () => {
      // Older saved games may carry the legacy "normal" rung; it must still
      // count toward the canonical "medium" analysis.
      const records: GameRecord[] = Array.from({ length: 5 }, (_, i) =>
        createTestRecord({
          difficulty: i < 2 ? "normal" : "medium",
          result: "win",
        }),
      );

      const result = analyzeDifficulty(records, "medium");

      expect(result.gamesAnalyzed).toBe(5);
      expect(result.recommendation).toBe("increase");
    });

    it("should handle draws correctly", () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: "medium", result: "draw" }),
        createTestRecord({ difficulty: "medium", result: "draw" }),
        createTestRecord({ difficulty: "medium", result: "draw" }),
        createTestRecord({ difficulty: "medium", result: "draw" }),
        createTestRecord({ difficulty: "medium", result: "draw" }),
      ];

      const result = analyzeDifficulty(records, mediumDifficulty);

      // 0% win rate should trigger decrease
      expect(result.recommendation).toBe("decrease");
    });

    it("should return null suggestion at the bottom of the ladder", () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: "easy", result: "loss" }),
      );

      const result = analyzeDifficulty(records, "easy");

      // 'easy' is the lowest canonical tier; cannot decrease further.
      expect(result.recommendation).toBe("decrease");
      expect(result.suggestedDifficulty).toBeUndefined();
    });

    it("should return null suggestion at the top of the ladder", () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: "expert", result: "win" }),
      );

      const result = analyzeDifficulty(records, "expert");

      // 'expert' is the highest canonical tier; cannot increase further.
      expect(result.recommendation).toBe("increase");
      expect(result.suggestedDifficulty).toBeUndefined();
    });
  });
});

describe("getAdaptiveDifficulty", () => {
  it("should infer difficulty from most recent vs_ai game", () => {
    const records: GameRecord[] = [
      createTestRecord({ difficulty: "hard", date: Date.now() - 1000 }),
      createTestRecord({ difficulty: "easy", date: Date.now() }),
    ];

    const result = getAdaptiveDifficulty(records);

    // Should use 'easy' as it's the most recent
    expect(result.currentDifficulty).toBe("easy");
  });

  it("should normalize a legacy difficulty inferred from history", () => {
    const records: GameRecord[] = [
      createTestRecord({ difficulty: "normal", date: Date.now() }),
    ];

    const result = getAdaptiveDifficulty(records);

    // Legacy "normal" must collapse to canonical "medium".
    expect(result.currentDifficulty).toBe("medium");
  });

  it("should use provided difficulty if given", () => {
    const records: GameRecord[] = [createTestRecord({ difficulty: "hard" })];

    const result = getAdaptiveDifficulty(records, "expert");

    expect(result.currentDifficulty).toBe("expert");
  });

  it("should default to medium if no history", () => {
    const result = getAdaptiveDifficulty([]);

    expect(result.currentDifficulty).toBe("medium");
  });
});

describe("getNextDifficulty", () => {
  it("should return next higher difficulty along the canonical ladder", () => {
    expect(getNextDifficulty("easy", "increase")).toBe("medium");
    expect(getNextDifficulty("medium", "increase")).toBe("hard");
    expect(getNextDifficulty("hard", "increase")).toBe("expert");
  });

  it("should return next lower difficulty along the canonical ladder", () => {
    expect(getNextDifficulty("medium", "decrease")).toBe("easy");
    expect(getNextDifficulty("hard", "decrease")).toBe("medium");
    expect(getNextDifficulty("expert", "decrease")).toBe("hard");
  });

  it("should return null at boundaries", () => {
    expect(getNextDifficulty("expert", "increase")).toBeNull();
    expect(getNextDifficulty("easy", "decrease")).toBeNull();
  });

  it("should only ever return canonical tiers (issue #1064)", () => {
    for (const level of DIFFICULTY_LEVELS) {
      const up = getNextDifficulty(level, "increase");
      const down = getNextDifficulty(level, "decrease");
      if (up) expect(DIFFICULTY_LEVELS).toContain(up);
      if (down) expect(DIFFICULTY_LEVELS).toContain(down);
    }
  });
});

describe("isValidDifficulty", () => {
  it("should return true for canonical difficulties only", () => {
    expect(isValidDifficulty("easy")).toBe(true);
    expect(isValidDifficulty("medium")).toBe(true);
    expect(isValidDifficulty("hard")).toBe(true);
    expect(isValidDifficulty("expert")).toBe(true);
  });

  it("should return false for legacy / non-canonical difficulties", () => {
    // Legacy rungs are no longer valid canonical levels (issue #1064); feed
    // them through normalizeDifficultyLevel instead.
    expect(isValidDifficulty("beginner")).toBe(false);
    expect(isValidDifficulty("normal")).toBe(false);
    expect(isValidDifficulty("master")).toBe(false);
  });

  it("should return false for invalid difficulties", () => {
    expect(isValidDifficulty("invalid")).toBe(false);
    expect(isValidDifficulty("")).toBe(false);
    expect(isValidDifficulty("MEDIUM")).toBe(false);
  });
});

describe("getDifficultyInfo", () => {
  it("should return info for each canonical difficulty", () => {
    for (const difficulty of DIFFICULTY_LEVELS) {
      const info = getDifficultyInfo(difficulty);

      expect(info).toHaveProperty("label");
      expect(info).toHaveProperty("description");
      expect(info).toHaveProperty("color");
    }
  });

  it("should return correct labels for the canonical tiers", () => {
    expect(getDifficultyInfo("easy").label).toBe("Easy");
    expect(getDifficultyInfo("medium").label).toBe("Medium");
    expect(getDifficultyInfo("hard").label).toBe("Hard");
    expect(getDifficultyInfo("expert").label).toBe("Expert");
  });

  it("should normalize legacy archival names before lookup (issue #1064)", () => {
    // UI may iterate dynamic keys (e.g. winRateByDifficulty) that still hold
    // legacy strings; getDifficultyInfo must not throw on them.
    expect(getDifficultyInfo("beginner").label).toBe("Easy");
    expect(getDifficultyInfo("normal").label).toBe("Medium");
    expect(getDifficultyInfo("master").label).toBe("Expert");
  });
});

describe("normalizeDifficultyLevel (re-exported canonical helper)", () => {
  it("passes canonical values through unchanged", () => {
    expect(normalizeDifficultyLevel("easy")).toBe("easy");
    expect(normalizeDifficultyLevel("medium")).toBe("medium");
    expect(normalizeDifficultyLevel("hard")).toBe("hard");
    expect(normalizeDifficultyLevel("expert")).toBe("expert");
  });

  it("maps legacy archival names onto the canonical set", () => {
    expect(normalizeDifficultyLevel("beginner")).toBe("easy");
    expect(normalizeDifficultyLevel("normal")).toBe("medium");
    expect(normalizeDifficultyLevel("master")).toBe("expert");
  });

  it("falls back to medium for unknown / empty / nullish input", () => {
    expect(normalizeDifficultyLevel("nightmare")).toBe("medium");
    expect(normalizeDifficultyLevel("")).toBe("medium");
    expect(normalizeDifficultyLevel(undefined)).toBe("medium");
    expect(normalizeDifficultyLevel(null)).toBe("medium");
  });
});

describe("DIFFICULTY_LEVELS", () => {
  it("should be in order from easiest to hardest", () => {
    expect(DIFFICULTY_LEVELS).toEqual(["easy", "medium", "hard", "expert"]);
  });
});

describe("DEFAULT_THRESHOLDS", () => {
  it("should have correct values", () => {
    expect(DEFAULT_THRESHOLDS.increaseThreshold).toBe(80);
    expect(DEFAULT_THRESHOLDS.decreaseThreshold).toBe(20);
    expect(DEFAULT_THRESHOLDS.minGamesForRecommendation).toBe(5);
  });
});
