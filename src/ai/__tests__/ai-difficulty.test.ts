import {
  aiDifficultyManager,
  DIFFICULTY_CONFIGS,
  DIFFICULTY_LEVELS,
  LEGACY_DIFFICULTY_ALIASES,
  isValidDifficulty,
  normalizeDifficultyLevel,
  type DifficultyLevel,
} from "../ai-difficulty";

describe("AIDifficultyManager", () => {
  test("should initialize with default difficulty (medium)", () => {
    expect(aiDifficultyManager.getLevel()).toBe("medium");
  });

  test("should set and get difficulty level", () => {
    aiDifficultyManager.setDifficulty("hard");
    expect(aiDifficultyManager.getLevel()).toBe("hard");
    expect(aiDifficultyManager.getDifficulty().level).toBe("hard");
  });

  test("should handle player-specific difficulty", () => {
    aiDifficultyManager.setDifficulty("easy", "player1");
    expect(aiDifficultyManager.getDifficulty("player1").level).toBe("easy");
    expect(aiDifficultyManager.getLevel()).toBe("hard"); // Global should remain hard
  });

  test("should return correct lookahead depth", () => {
    aiDifficultyManager.setDifficulty("expert");
    expect(aiDifficultyManager.getLookaheadDepth()).toBe(4);

    aiDifficultyManager.setDifficulty("easy");
    expect(aiDifficultyManager.getLookaheadDepth()).toBe(1);
  });

  test("should apply randomness correctly", () => {
    aiDifficultyManager.setDifficulty("expert");
    const options = ["choice1", "choice2", "choice3"];
    // Expert has very low randomness (0.02), so it should almost always pick first option
    // (though Math.random is not mocked here, we just check it returns something from options)
    const choice = aiDifficultyManager.applyRandomness(options);
    expect(options).toContain(choice);
  });

  test("should identify blunder chance", () => {
    aiDifficultyManager.setDifficulty("easy");
    // Easy has 0.25 blunder chance.
    // We can't easily test the randomness without mocking Math.random
    // but we can check if the method exists and returns a boolean
    expect(typeof aiDifficultyManager.shouldBlunder()).toBe("boolean");
  });

  test("should provide evaluation weights", () => {
    aiDifficultyManager.setDifficulty("medium");
    const weights = aiDifficultyManager.getEvaluationWeights();
    expect(weights).toBeDefined();
    // Check for some expected weight properties
    expect(weights).toHaveProperty("lifeScore");
    expect(weights).toHaveProperty("creaturePower");
  });
});

// ---------------------------------------------------------------------------
// Canonical difficulty taxonomy (issue #1064)
// ---------------------------------------------------------------------------

describe("DIFFICULTY_LEVELS (canonical taxonomy, issue #1064)", () => {
  test("exposes exactly the four canonical tiers, easiest → hardest", () => {
    expect(DIFFICULTY_LEVELS).toEqual(["easy", "medium", "hard", "expert"]);
  });

  test("every canonical tier has a complete DIFFICULTY_CONFIGS entry (exhaustiveness)", () => {
    // DIFFICULTY_CONFIGS is keyed by DifficultyLevel, so this also asserts the
    // compile-time exhaustiveness guard holds at runtime.
    for (const level of DIFFICULTY_LEVELS) {
      expect(DIFFICULTY_CONFIGS[level]).toBeDefined();
      expect(DIFFICULTY_CONFIGS[level].level).toBe(level);
    }
  });
});

describe("isValidDifficulty (canonical)", () => {
  test.each(DIFFICULTY_LEVELS)("accepts canonical tier %s", (level) => {
    expect(isValidDifficulty(level)).toBe(true);
  });

  test("rejects legacy archival names", () => {
    expect(isValidDifficulty("beginner")).toBe(false);
    expect(isValidDifficulty("normal")).toBe(false);
    expect(isValidDifficulty("master")).toBe(false);
  });

  test("rejects junk / case variants", () => {
    expect(isValidDifficulty("")).toBe(false);
    expect(isValidDifficulty("EASY")).toBe(false);
    expect(isValidDifficulty("nightmare")).toBe(false);
  });
});

describe("normalizeDifficultyLevel", () => {
  test("passes canonical values through unchanged", () => {
    for (const level of DIFFICULTY_LEVELS) {
      expect(normalizeDifficultyLevel(level)).toBe(level);
    }
  });

  test("maps legacy names onto the canonical set", () => {
    expect(normalizeDifficultyLevel("beginner")).toBe("easy");
    expect(normalizeDifficultyLevel("normal")).toBe("medium");
    expect(normalizeDifficultyLevel("master")).toBe("expert");
  });

  test("legacy alias table only ever yields canonical tiers", () => {
    for (const mapped of Object.values(LEGACY_DIFFICULTY_ALIASES)) {
      expect(
        (DIFFICULTY_LEVELS as readonly DifficultyLevel[]).includes(mapped),
      ).toBe(true);
    }
  });

  test("falls back to medium for unknown / empty / nullish input", () => {
    expect(normalizeDifficultyLevel("nightmare")).toBe("medium");
    expect(normalizeDifficultyLevel("")).toBe("medium");
    expect(normalizeDifficultyLevel(undefined)).toBe("medium");
    expect(normalizeDifficultyLevel(null)).toBe("medium");
  });
});
