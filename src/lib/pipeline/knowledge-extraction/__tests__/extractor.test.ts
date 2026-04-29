import { KnowledgeExtractor } from "../extractor";
import type { DecisionRecord } from "../../decision-extraction/types";
import type { HeuristicCategory } from "../types";
import { HEURISTIC_CATEGORIES } from "../types";

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: "test-decision-1",
    video_id: "vid-1",
    timestamp_ms: 1000,
    moment_type: "attack_declaration",
    action: "attack with all creatures",
    reason: "Wide board advantage, close the game",
    alternatives_considered: ["hold back evasive"],
    outcome: "dealt 12 damage",
    confidence: 0.9,
    transcript_window: "The player attacks with everything",
    ...overrides,
  };
}

describe("KnowledgeExtractor", () => {
  let extractor: KnowledgeExtractor;

  beforeEach(() => {
    extractor = new KnowledgeExtractor();
  });

  describe("extractFromDecisionRecords", () => {
    it("extracts heuristic records from decision records", () => {
      const decisions = [makeDecision()];
      const heuristics = extractor.extractFromDecisionRecords(decisions);

      expect(heuristics).toHaveLength(1);
      expect(heuristics[0].category).toBe("attack_lines");
      expect(heuristics[0].action).toBe("attack with all creatures");
      expect(heuristics[0].state_hash).toBeTruthy();
    });

    it("detects category from moment_type", () => {
      const tests: Array<{
        moment_type: DecisionRecord["moment_type"];
        expected: HeuristicCategory;
      }> = [
        { moment_type: "attack_declaration", expected: "attack_lines" },
        { moment_type: "block_declaration", expected: "block_assignments" },
        { moment_type: "spell_cast", expected: "combat_trick_timing" },
        { moment_type: "ability_activation", expected: "combat_trick_timing" },
        { moment_type: "mulligan", expected: "mulligan_threshold" },
      ];

      for (const { moment_type, expected } of tests) {
        const decisions = [makeDecision({ moment_type })];
        const heuristics = extractor.extractFromDecisionRecords(decisions);
        expect(heuristics[0].category).toBe(expected);
      }
    });

    it("detects counterspell category from text content", () => {
      const decisions = [
        makeDecision({
          moment_type: "other",
          action: "hold Counterspell",
          reason: "opponent has multiple spells to cast",
        }),
      ];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      expect(heuristics[0].category).toBe("counterspell_decisions");
    });

    it("detects sideboard category from text content", () => {
      const decisions = [
        makeDecision({
          moment_type: "other",
          action: "board out sweepers",
          reason: "opponent is control, few creatures",
        }),
      ];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      expect(heuristics[0].category).toBe("sideboard_swap");
    });

    it("deduplicates records with same state_hash", () => {
      const decisions = [
        makeDecision({ id: "d1" }),
        makeDecision({ id: "d2" }),
      ];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      const uniqueHashes = new Set(heuristics.map((h) => h.state_hash));
      expect(uniqueHashes.size).toBe(1);
    });

    it("preserves video source in extracted records", () => {
      const decisions = [makeDecision({ video_id: "vid-test-42" })];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      expect(heuristics[0].source_video_id).toBe("vid-test-42");
    });

    it("sets turn_range when turn_number is present", () => {
      const decisions = [makeDecision({ turn_number: 5 })];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      expect(heuristics[0].turn_range).toEqual({ min: 5, max: 5 });
    });
  });

  describe("aggregateByCategory", () => {
    it("groups records by category", () => {
      const decisions = [
        makeDecision({
          id: "a1",
          moment_type: "attack_declaration",
          action: "attack with all creatures",
        }),
        makeDecision({
          id: "b1",
          moment_type: "block_declaration",
          action: "block with deathtouch creature",
        }),
        makeDecision({
          id: "a2",
          moment_type: "attack_declaration",
          action: "attack with evasive threat only",
          reason: "hold back ground creatures for defense",
        }),
      ];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      const aggregated = extractor.aggregateByCategory(heuristics);

      expect(aggregated.length).toBe(HEURISTIC_CATEGORIES.length);
      const attackCat = aggregated.find((c) => c.category === "attack_lines");
      expect(attackCat?.total_records).toBe(2);
      const blockCat = aggregated.find(
        (c) => c.category === "block_assignments",
      );
      expect(blockCat?.total_records).toBe(1);
    });

    it("returns correct avg_confidence", () => {
      const decisions = [
        makeDecision({
          id: "a1",
          confidence: 0.6,
          action: "attack with small creatures",
        }),
        makeDecision({
          id: "a2",
          confidence: 0.8,
          action: "attack with large creatures",
        }),
      ];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      const aggregated = extractor.aggregateByCategory(heuristics);
      const attackCat = aggregated.find((c) => c.category === "attack_lines");

      expect(attackCat?.avg_confidence).toBeCloseTo(0.7);
    });

    it("returns empty categories with zero counts", () => {
      const decisions = [makeDecision()];
      const heuristics = extractor.extractFromDecisionRecords(decisions);
      const aggregated = extractor.aggregateByCategory(heuristics);

      for (const cat of aggregated) {
        if (cat.category !== "attack_lines") {
          expect(cat.total_records).toBe(0);
          expect(cat.patterns).toEqual([]);
        }
      }
    });
  });

  describe("mergeWithExisting", () => {
    it("merges new records with existing ones", () => {
      const existing = extractor.extractFromDecisionRecords([
        makeDecision({ id: "e1", action: "attack with all creatures" }),
      ]);
      const incoming = extractor.extractFromDecisionRecords([
        makeDecision({ id: "i1", action: "hold back blockers" }),
      ]);

      const merged = extractor.mergeWithExisting(incoming, existing);
      expect(merged).toHaveLength(2);
    });

    it("deduplicates across merge boundary", () => {
      const existing = extractor.extractFromDecisionRecords([
        makeDecision({ id: "e1" }),
      ]);
      const incoming = extractor.extractFromDecisionRecords([
        makeDecision({ id: "e1" }),
      ]);

      const merged = extractor.mergeWithExisting(incoming, existing);
      expect(merged).toHaveLength(1);
      expect(merged[0].frequency).toBe(2);
    });
  });
});
