import { describe, it, expect } from "@jest/globals";
import {
  segmentTranscript,
  searchKeywords,
  extractEdgeCases,
  computePipelineStats,
} from "../transcript-pipeline";
import { DEFAULT_PIPELINE_CONFIG } from "../types";
import type { TranscriptSegment, ExtractedEdgeCase } from "../types";
import rulesEdgeCases from "../data/rules-edge-cases.json";

function createMockSegment(
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    id: "test-seg-001",
    timestamp: "01:23",
    speaker: "judge",
    text: "The rule is that deathtouch means any damage is lethal damage, correctly applied.",
    keywords_matched: [],
    ...overrides,
  };
}

describe("transcript-pipeline", () => {
  describe("segmentTranscript", () => {
    it("should split transcript text into segments by speaker", () => {
      const transcript = `01:00 Speaker One: This is the first segment.
02:00 Speaker Two: This is the second segment.
03:00 Speaker One: And this is the third.`;
      const segments = segmentTranscript(transcript, "Test Source");
      expect(segments).toHaveLength(3);
      expect(segments[0].speaker).toBe("Speaker One");
      expect(segments[1].speaker).toBe("Speaker Two");
    });

    it("should handle empty transcript", () => {
      const segments = segmentTranscript("", "Test");
      expect(segments).toHaveLength(0);
    });

    it("should handle transcript with no speaker markers", () => {
      const transcript = "Just some text without timestamps.";
      const segments = segmentTranscript(transcript, "Test");
      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe("Just some text without timestamps.");
    });
  });

  describe("searchKeywords", () => {
    it("should find segments matching keywords", () => {
      const segments = [createMockSegment()];
      const keywords = ["the rule is", "deathtouch"];
      const results = searchKeywords(segments, keywords);
      expect(results).toHaveLength(1);
      expect(results[0].matchedKeywords).toContain("the rule is");
    });

    it("should score segments by number of keyword matches", () => {
      const segments = [
        createMockSegment({
          id: "a",
          text: "the rule is actually correctly that the interaction works this way",
        }),
        createMockSegment({
          id: "b",
          text: "the rule is that deathtouch works",
        }),
      ];
      const keywords = ["the rule is", "actually", "correctly"];
      const results = searchKeywords(segments, keywords);
      expect(results[0].segment.id).toBe("a");
      expect(results[0].score).toBe(3);
      expect(results[1].score).toBe(1);
    });

    it("should return empty for no keyword matches", () => {
      const segments = [createMockSegment({ text: "No keywords here" })];
      const results = searchKeywords(segments, ["the rule is"]);
      expect(results).toHaveLength(0);
    });

    it("should sort results by score descending", () => {
      const segments = [
        createMockSegment({ id: "low", text: "the rule is" }),
        createMockSegment({
          id: "high",
          text: "the rule is actually correctly",
        }),
      ];
      const results = searchKeywords(segments, [
        "the rule is",
        "actually",
        "correctly",
      ]);
      expect(results[0].segment.id).toBe("high");
    });
  });

  describe("extractEdgeCases", () => {
    it("should extract edge cases from keyword results", () => {
      const segment = createMockSegment({
        text: "Actually, the rule is that deathtouch applies to any amount of damage. The correct interaction is that Giant Growth does not change deathtouch behavior. In this case, the 4/4 creature still dies.",
      });
      const results = [
        {
          segment: {
            ...segment,
            keywords_matched: ["actually", "the rule is"],
          },
          score: 2,
          matchedKeywords: ["actually", "the rule is"],
        },
      ];
      const edgeCases = extractEdgeCases(results, "Test Source");
      expect(edgeCases).toHaveLength(1);
      expect(edgeCases[0].category).toBe("combat");
      expect(edgeCases[0].confidence).toBe("medium");
    });

    it("should skip segments shorter than 50 characters", () => {
      const segment = createMockSegment({ text: "Too short" });
      const results = [
        {
          segment: { ...segment, keywords_matched: ["the rule is"] },
          score: 1,
          matchedKeywords: ["the rule is"],
        },
      ];
      const edgeCases = extractEdgeCases(results, "Test");
      expect(edgeCases).toHaveLength(0);
    });

    it("should classify combat category correctly", () => {
      const results = [
        {
          segment: createMockSegment({
            text: "Actually the correct interaction is that when a creature with trample is blocked, excess damage goes to the player. This is how it works correctly.",
          }),
          score: 2,
          matchedKeywords: ["actually", "the correct interaction"],
        },
      ];
      const edgeCases = extractEdgeCases(results, "Test");
      expect(edgeCases[0].category).toBe("combat");
    });

    it("should assign correct engine module for each category", () => {
      const results = [
        {
          segment: createMockSegment({
            text: "The correct interaction for indestructible creatures is that state-based actions for zero toughness still apply. The rule is correctly applied.",
          }),
          score: 2,
          matchedKeywords: ["the correct interaction", "the rule is"],
        },
      ];
      const edgeCases = extractEdgeCases(results, "Test");
      expect(edgeCases[0].engineModule).toBe("state-based-actions.ts");
    });

    it("should estimate high confidence for multi-keyword long segments", () => {
      const results = [
        {
          segment: createMockSegment({
            text: "Actually, the rule is that the correct interaction is incorrectly understood. In this case the common mistake is that deathtouch requires exactly one damage. The correct answer is any damage is lethal.",
          }),
          score: 5,
          matchedKeywords: [
            "actually",
            "the rule is",
            "the correct interaction",
            "incorrectly",
            "in this case",
          ],
        },
      ];
      const edgeCases = extractEdgeCases(results, "Test");
      expect(edgeCases[0].confidence).toBe("high");
    });
  });

  describe("computePipelineStats", () => {
    it("should compute correct stats", () => {
      const keywordResults = [
        { segment: createMockSegment(), score: 1, matchedKeywords: ["a"] },
        { segment: createMockSegment(), score: 2, matchedKeywords: ["a", "b"] },
      ];
      const edgeCases = [
        {
          id: "1",
          confidence: "high" as const,
          convertedToTest: true,
        } as unknown as ExtractedEdgeCase,
        {
          id: "2",
          confidence: "low" as const,
          convertedToTest: false,
        } as unknown as ExtractedEdgeCase,
      ];
      const stats = computePipelineStats(5, 100, keywordResults, edgeCases);
      expect(stats.totalTranscripts).toBe(5);
      expect(stats.totalSegments).toBe(100);
      expect(stats.keywordMatches).toBe(2);
      expect(stats.extractedEdgeCases).toBe(2);
      expect(stats.highConfidenceCount).toBe(1);
      expect(stats.convertedToTests).toBe(1);
    });
  });
});

describe("rules edge cases data (nlp-001 to nlp-011 regression tests)", () => {
  it("nlp-001: deathtouch applies regardless of damage amount", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-001")!;
    expect(ec.correctOutcome).toContain("any amount of damage is lethal");
    expect(ec.category).toBe("combat");
    expect(ec.crReferences).toContain("CR 702.2c");
    expect(ec.verified).toBe(true);
    expect(ec.convertedToTest).toBe(true);
  });

  it("nlp-002: Blood Artist triggers for each creature dying simultaneously", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-002")!;
    expect(ec.correctOutcome.toLowerCase()).toContain("triggers");
    expect(ec.category).toBe("ability");
    expect(ec.engineModule).toBe("abilities.ts");
  });

  it("nlp-003: trample damage does not carry over after assignment", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-003")!;
    expect(ec.correctOutcome).toContain("resolves as assigned");
    expect(ec.category).toBe("combat");
    expect(ec.commonMisconception).toBeDefined();
  });

  it("nlp-004: no limit to stack depth", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-004")!;
    expect(ec.correctOutcome).toContain("No");
    expect(ec.category).toBe("stack");
    expect(ec.crReferences).toContain("CR 117.4");
  });

  it("nlp-005: indestructible does not prevent 0-toughness SBA", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-005")!;
    expect(ec.correctOutcome).toContain("No");
    expect(ec.correctOutcome).toContain("not destruction");
    expect(ec.category).toBe("state-based-action");
    expect(ec.engineModule).toBe("state-based-actions.ts");
  });

  it("nlp-006: loyalty abilities can be activated in response to damage", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-006")!;
    expect(ec.correctOutcome).toContain("Yes");
    expect(ec.correctOutcome).toContain("priority");
    expect(ec.category).toBe("stack");
  });

  it("nlp-007: protection prevents targeting", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-007")!;
    expect(ec.correctOutcome).toContain("No");
    expect(ec.correctOutcome).toContain("targeting");
    expect(ec.category).toBe("protection");
    expect(ec.engineModule).toBe("protection.ts");
  });

  it("nlp-008: god cards are non-creatures below devotion threshold", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-008")!;
    expect(ec.correctOutcome.toLowerCase()).toContain(
      "non-creature enchantment",
    );
    expect(ec.category).toBe("layer-system");
    expect(ec.cardNames).toContain("Erebos, God of the Dead");
  });

  it("nlp-009: scry only after keeping your hand (Vancouver mulligan)", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-009")!;
    expect(ec.correctOutcome).toContain("after keeping");
    expect(ec.category).toBe("turn-phases");
    expect(ec.engineModule).toBe("phase-handler.ts");
  });

  it("nlp-010: commander damage accumulates across combats", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-010")!;
    expect(ec.correctOutcome).toContain("cumulatively");
    expect(ec.correctOutcome).toContain("21");
    expect(ec.category).toBe("commander-damage");
    expect(ec.crReferences).toContain("CR 903.10a");
  });

  it("nlp-011: spell targets are locked after casting", () => {
    const ec = rulesEdgeCases.find((e) => e.id === "nlp-011")!;
    expect(ec.correctOutcome).toContain("No");
    expect(ec.correctOutcome).toContain("locked");
    expect(ec.category).toBe("stack");
    expect(ec.crReferences).toContain("CR 115.3");
  });
});

describe("rules edge cases dataset validation", () => {
  it("should contain 50 or more edge cases", () => {
    expect(rulesEdgeCases.length).toBeGreaterThanOrEqual(50);
  });

  it("all edge cases should have required fields", () => {
    for (const ec of rulesEdgeCases) {
      expect(ec.id).toMatch(/^nlp-\d{3}$/);
      expect(ec.source).toBeDefined();
      expect(ec.category).toBeDefined();
      expect(ec.ruleInQuestion).toBeDefined();
      expect(ec.correctOutcome).toBeDefined();
      expect(ec.engineModule).toBeDefined();
      expect(ec.confidence).toMatch(/^(high|medium|low)$/);
    }
  });

  it("at least 10 edge cases should be marked as converted to tests", () => {
    const testCases = rulesEdgeCases.filter((ec) => ec.convertedToTest);
    expect(testCases.length).toBeGreaterThanOrEqual(10);
  });

  it("all verified edge cases should have CR references", () => {
    const verified = rulesEdgeCases.filter((ec) => ec.verified);
    for (const ec of verified) {
      expect(ec.crReferences.length).toBeGreaterThan(0);
    }
  });

  it("should cover multiple categories", () => {
    const categories = new Set(rulesEdgeCases.map((ec) => ec.category));
    expect(categories.size).toBeGreaterThanOrEqual(10);
  });

  it("should cover multiple source channels", () => {
    const sources = new Set(rulesEdgeCases.map((ec) => ec.source));
    expect(sources.size).toBeGreaterThanOrEqual(5);
  });
});

describe("DEFAULT_PIPELINE_CONFIG", () => {
  it("should have the required keyword list", () => {
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain("actually");
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain("the rule is");
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain("correctly");
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain("incorrectly");
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain("in this case");
    expect(DEFAULT_PIPELINE_CONFIG.keywords).toContain(
      "the correct interaction",
    );
  });

  it("should target the specified channels", () => {
    expect(DEFAULT_PIPELINE_CONFIG.channels).toContain(
      "tolarian-community-college",
    );
    expect(DEFAULT_PIPELINE_CONFIG.channels).toContain("mtg-goldfish");
    expect(DEFAULT_PIPELINE_CONFIG.channels).toContain("loadingreadyrun");
    expect(DEFAULT_PIPELINE_CONFIG.channels).toContain(
      "judge-highlight-compilation",
    );
  });
});
