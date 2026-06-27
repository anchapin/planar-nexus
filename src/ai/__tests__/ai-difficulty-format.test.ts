/**
 * @fileoverview Per-format difficulty config override tests (issue #1069).
 *
 * Covers the resolution contract added to `src/ai/ai-difficulty.ts`:
 *   - Base config returned unchanged when no format is supplied (backward compat)
 *   - Each format family (commander / constructed / limited) applies its override
 *   - Override wins (merge precedence); base fills every non-overridden knob
 *   - Unknown / undefined format falls back to base
 *   - The {@link AIDifficultyManager} threads format into live decisions
 *   - Deck generation resolves the per-format config from a Format identifier
 */

import { describe, it, expect } from "@jest/globals";

import {
  AIDifficultyManager,
  DIFFICULTY_CONFIGS,
  FORMAT_DIFFICULTY_OVERRIDES,
  classifyDifficultyFormat,
  getDifficultyConfig,
  mergeDifficultyConfig,
  resolveDifficultyConfig,
  type AIDifficultyConfig,
  type DifficultyFormat,
  type DifficultyLevel,
} from "../ai-difficulty";
import { resolveAIOpponentDifficultyConfig } from "../flows/ai-opponent-deck-generation";

const LEVELS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];
const FORMATS: DifficultyFormat[] = ["commander", "constructed", "limited"];

describe("Per-format difficulty config overrides (#1069)", () => {
  // -------------------------------------------------------------------------
  // Backward compatibility: no format => base config, by reference.
  // -------------------------------------------------------------------------
  describe("backward compatibility (no format)", () => {
    it.each(LEVELS)(
      "getDifficultyConfig(%s) returns the base config by reference",
      (level) => {
        expect(getDifficultyConfig(level)).toBe(DIFFICULTY_CONFIGS[level]);
      },
    );

    it.each(LEVELS)(
      "resolveDifficultyConfig(%s, undefined) returns the base config by reference",
      (level) => {
        expect(resolveDifficultyConfig(level, undefined)).toBe(
          DIFFICULTY_CONFIGS[level],
        );
      },
    );

    it("an unknown format falls back to the base config by reference", () => {
      // classifyDifficultyFormat maps unknowns to undefined => base config.
      expect(classifyDifficultyFormat("some-future-format")).toBeUndefined();
      // @ts-expect-error -- exercising the runtime fallback for an invalid family
      expect(resolveDifficultyConfig("medium", "brawl")).toBe(
        DIFFICULTY_CONFIGS.medium,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Per-format override application: each format x tier resolves to a config
  // that differs from base and matches the declared override values.
  // -------------------------------------------------------------------------
  describe("each format applies its override", () => {
    it.each(FORMATS)("format %s is defined for every tier", (format) => {
      for (const level of LEVELS) {
        expect(FORMAT_DIFFICULTY_OVERRIDES[format][level]).toBeDefined();
      }
    });

    it.each(FORMATS)(
      "at least one weight differs from base for every tier of %s",
      (format) => {
        for (const level of LEVELS) {
          const resolved = getDifficultyConfig(level, format);
          const base = DIFFICULTY_CONFIGS[level];
          const overrideWeights =
            FORMAT_DIFFICULTY_OVERRIDES[format][level]!.evaluationWeights ?? {};
          const changedKeys = Object.keys(
            overrideWeights,
          ) as (keyof typeof overrideWeights)[];
          expect(changedKeys.length).toBeGreaterThan(0);
          for (const key of changedKeys) {
            // Override value is reflected in the resolved config.
            expect(resolved.evaluationWeights[key]).toBe(overrideWeights[key]);
            // ...and therefore differs from the base value for that tier.
            expect(resolved.evaluationWeights[key]).not.toBe(
              base.evaluationWeights[key],
            );
          }
        }
      },
    );

    it("commander raises commander-damage awareness and relaxes life priority", () => {
      const resolved = getDifficultyConfig("hard", "commander");
      const base = DIFFICULTY_CONFIGS.hard;
      expect(resolved.evaluationWeights.commanderDamageWeight).toBeGreaterThan(
        base.evaluationWeights.commanderDamageWeight,
      );
      expect(resolved.evaluationWeights.lifeScore).toBeLessThan(
        base.evaluationWeights.lifeScore,
      );
    });

    it("constructed stays close to base (competitive reference) but still differs", () => {
      const resolved = getDifficultyConfig("medium", "constructed");
      const base = DIFFICULTY_CONFIGS.medium;
      expect(resolved.evaluationWeights.cardAdvantage).not.toBe(
        base.evaluationWeights.cardAdvantage,
      );
    });

    it("limited emphasizes creatures and de-emphasizes commander weights", () => {
      const resolved = getDifficultyConfig("expert", "limited");
      const base = DIFFICULTY_CONFIGS.expert;
      expect(resolved.evaluationWeights.creaturePower).toBeGreaterThan(
        base.evaluationWeights.creaturePower,
      );
      expect(resolved.evaluationWeights.commanderDamageWeight).toBeLessThan(
        base.evaluationWeights.commanderDamageWeight,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Merge precedence: format override wins on overridden knobs; base fills the
  // rest (both scalar knobs and individual weights).
  // -------------------------------------------------------------------------
  describe("merge precedence (format wins, base fills)", () => {
    it("overrides win on declared weights; unmentioned weights keep base values", () => {
      const resolved = getDifficultyConfig("hard", "commander");
      const override =
        FORMAT_DIFFICULTY_OVERRIDES.commander.hard!.evaluationWeights ?? {};

      // Overridden weight => override value.
      expect(resolved.evaluationWeights.commanderDamageWeight).toBe(
        override.commanderDamageWeight,
      );
      // Non-overridden weight => base value (poisonScore is never overridden).
      expect(resolved.evaluationWeights.poisonScore).toBe(
        DIFFICULTY_CONFIGS.hard.evaluationWeights.poisonScore,
      );
    });

    it("overrides win on declared scalar knobs; unmentioned scalars keep base values", () => {
      const resolved = getDifficultyConfig("hard", "commander");
      // tempoPriority is overridden for commander/hard.
      expect(resolved.tempoPriority).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.commander.hard!.tempoPriority,
      );
      // blunderChance is never overridden => base.
      expect(resolved.blunderChance).toBe(
        DIFFICULTY_CONFIGS.hard.blunderChance,
      );
      expect(resolved.lookaheadDepth).toBe(
        DIFFICULTY_CONFIGS.hard.lookaheadDepth,
      );
    });

    it("preserves the base identity fields (level / displayName / description)", () => {
      const resolved = getDifficultyConfig("expert", "limited");
      expect(resolved.level).toBe("expert");
      expect(resolved.displayName).toBe(DIFFICULTY_CONFIGS.expert.displayName);
      expect(resolved.description).toBe(DIFFICULTY_CONFIGS.expert.description);
    });

    it("does not mutate the base config or its weights", () => {
      const baseBefore: AIDifficultyConfig = {
        ...DIFFICULTY_CONFIGS.medium,
        evaluationWeights: { ...DIFFICULTY_CONFIGS.medium.evaluationWeights },
      };
      // Force a resolution + merge.
      mergeDifficultyConfig(DIFFICULTY_CONFIGS.medium, {
        evaluationWeights: { lifeScore: 99 },
        tempoPriority: 0.99,
      });
      expect(DIFFICULTY_CONFIGS.medium.evaluationWeights.lifeScore).toBe(
        baseBefore.evaluationWeights.lifeScore,
      );
      expect(DIFFICULTY_CONFIGS.medium.tempoPriority).toBe(
        baseBefore.tempoPriority,
      );
    });
  });

  // -------------------------------------------------------------------------
  // classifyDifficultyFormat: detailed game-mode IDs + legacy aliases.
  // -------------------------------------------------------------------------
  describe("classifyDifficultyFormat", () => {
    const cases: Array<[string, DifficultyFormat]> = [
      ["commander", "commander"],
      ["legendary-commander", "commander"],
      ["constructed-core", "constructed"],
      ["constructed-vintage", "constructed"],
      ["modern", "constructed"],
      ["standard", "constructed"],
      ["pioneer", "constructed"],
      ["limited", "limited"],
      ["sealed", "limited"],
      ["draft", "limited"],
    ];
    it.each(cases)("classifies %s -> %s", (input, expected) => {
      expect(classifyDifficultyFormat(input)).toBe(expected);
    });

    it.each([undefined, null, "", "brawl", "planechase"] as Array<
      string | null | undefined
    >)("returns undefined for unknown/empty input %p", (input) => {
      expect(classifyDifficultyFormat(input)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // AIDifficultyManager threads format into live decisions.
  // -------------------------------------------------------------------------
  describe("AIDifficultyManager format threading", () => {
    it("is backward compatible without a format (base config, by reference)", () => {
      const manager = new AIDifficultyManager("hard");
      expect(manager.getFormat()).toBeUndefined();
      expect(manager.getDifficulty()).toBe(DIFFICULTY_CONFIGS.hard);
      expect(manager.getLevel()).toBe("hard");
    });

    it("applies the per-format override from the constructor", () => {
      const manager = new AIDifficultyManager("hard", "commander");
      expect(manager.getFormat()).toBe("commander");
      expect(
        manager.getDifficulty().evaluationWeights.commanderDamageWeight,
      ).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.commander.hard!.evaluationWeights
          ?.commanderDamageWeight,
      );
      expect(manager.getEvaluationWeights().commanderDamageWeight).not.toBe(
        DIFFICULTY_CONFIGS.hard.evaluationWeights.commanderDamageWeight,
      );
    });

    it("setFormat switches the active override family", () => {
      const manager = new AIDifficultyManager("expert");
      manager.setFormat("limited");
      expect(manager.getFormat()).toBe("limited");
      expect(manager.getEvaluationWeights().creaturePower).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.limited.expert!.evaluationWeights
          ?.creaturePower,
      );
      // Reverting clears overrides => base config again.
      manager.setFormat(undefined);
      expect(manager.getDifficulty()).toBe(DIFFICULTY_CONFIGS.expert);
    });

    it("format is game-wide: per-player difficulty is resolved with it too", () => {
      const manager = new AIDifficultyManager("hard", "commander");
      manager.setDifficulty("easy", "player1");
      const perPlayer = manager.getDifficulty("player1");
      // Easy tier + commander family.
      expect(perPlayer.evaluationWeights.commanderDamageWeight).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.commander.easy!.evaluationWeights
          ?.commanderDamageWeight,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Deck generation resolves the per-format config from a Format identifier.
  // -------------------------------------------------------------------------
  describe("deck generation respects per-format config", () => {
    it("resolves a legacy 'commander' alias to the commander family", () => {
      const resolved = resolveAIOpponentDifficultyConfig("hard", "commander");
      expect(resolved.evaluationWeights.commanderDamageWeight).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.commander.hard!.evaluationWeights
          ?.commanderDamageWeight,
      );
    });

    it("resolves a detailed 'constructed-core' id to the constructed family", () => {
      const resolved = resolveAIOpponentDifficultyConfig(
        "medium",
        "constructed-core",
      );
      expect(resolved.evaluationWeights.cardAdvantage).toBe(
        FORMAT_DIFFICULTY_OVERRIDES.constructed.medium!.evaluationWeights
          ?.cardAdvantage,
      );
    });

    it("falls back to base for an unknown format", () => {
      const resolved = resolveAIOpponentDifficultyConfig("medium", "brawl");
      expect(resolved).toBe(DIFFICULTY_CONFIGS.medium);
    });
  });
});
