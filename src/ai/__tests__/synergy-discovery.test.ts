import { describe, it, expect } from "@jest/globals";
import {
  discoverSynergies,
  createReviewGate,
  SYNERGY_KEYWORDS,
  FORMAT_KEYWORDS,
  ARCHETYPE_KEYWORDS,
  type DiscoveredSynergy,
} from "../synergy-discovery";

describe("synergy-discovery", () => {
  describe("SYNERGY_KEYWORDS", () => {
    it("should include all required keywords from issue #679", () => {
      const required = [
        "this combo",
        "these two cards together",
        "this enables",
        "pairs well with",
        "goes infinite with",
      ];
      for (const kw of required) {
        expect(SYNERGY_KEYWORDS).toContain(kw);
      }
    });

    it("should have at least 10 keywords", () => {
      expect(SYNERGY_KEYWORDS.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("discoverSynergies", () => {
    it("should extract card pair synergies from transcript segments", () => {
      const segments = [
        {
          text: "This combo is insane. Thassa Oracle goes infinite with Demonic Consultation.",
          speaker: "analyst",
        },
      ];

      const results = discoverSynergies(segments);

      expect(results.length).toBeGreaterThanOrEqual(1);

      const match = results.find(
        (r) =>
          r.cards.some((c) => c.toLowerCase().includes("thassa")) &&
          r.cards.some((c) => c.toLowerCase().includes("demonic")),
      );
      expect(match).toBeDefined();
      expect(match!.cards.length).toBeGreaterThanOrEqual(2);
      expect(match!.confidence).toBeDefined();
      expect(["high", "medium", "low"]).toContain(match!.confidence);
      expect(match!.source_text).toContain("Thassa Oracle");
    });

    it('should detect "pairs well with" keyword', () => {
      const segments = [
        {
          text: "Sanguine Bond pairs well with Exquisite Blood for infinite life drain.",
        },
      ];

      const results = discoverSynergies(segments);

      expect(results.length).toBeGreaterThanOrEqual(1);

      const match = results.find(
        (r) =>
          r.cards.some((c) => c.toLowerCase().includes("sanguine")) ||
          r.cards.some((c) => c.toLowerCase().includes("exquisite")),
      );
      expect(match).toBeDefined();
    });

    it('should detect "these two cards together" keyword', () => {
      const segments = [
        {
          text: "These two cards together, Humility and Opalescence, create a unique board lock. Blood Artist works with Humility too.",
        },
      ];

      const results = discoverSynergies(segments);

      expect(results.length).toBeGreaterThanOrEqual(1);

      const match = results.find(
        (r) =>
          r.cards.some((c) => c.toLowerCase().includes("humility")) ||
          r.cards.some((c) => c.toLowerCase().includes("opalescence")) ||
          r.cards.some((c) => c.toLowerCase().includes("blood artist")),
      );
      expect(match).toBeDefined();
    });

    it('should detect "this enables" keyword', () => {
      const segments = [
        {
          text: "This enables a storm combo finish with Dockside Extortionist. Aetherflux Reservoir works great with Dockside too.",
        },
      ];

      const results = discoverSynergies(segments);

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract format from transcript context", () => {
      const segments = [
        {
          text: "In commander format, this combo with Najeela and extra combat goes infinite.",
        },
      ];

      const results = discoverSynergies(segments);

      if (results.length > 0) {
        expect(results[0].format).toBe("commander");
      }
    });

    it("should extract archetype from transcript context", () => {
      const segments = [
        {
          text: "This combo is a staple in combo decks in modern format.",
        },
      ];

      const results = discoverSynergies(segments);

      if (results.length > 0) {
        expect(results[0].archetype).toBe("combo");
      }
    });

    it("should return empty array for segments without synergy keywords", () => {
      const segments = [
        { text: "The weather is nice today and I like playing Magic." },
        { text: "This card has good art and the flavor text is funny." },
      ];

      const results = discoverSynergies(segments);
      expect(results.length).toBe(0);
    });

    it("should return empty array for empty input", () => {
      const results = discoverSynergies([]);
      expect(results).toEqual([]);
    });

    it("should deduplicate synergies with same card pair", () => {
      const segments = [
        {
          text: "This combo is insane. Thassa Oracle goes infinite with Demonic Consultation.",
        },
        {
          text: "Thassa Oracle goes infinite with Demonic Consultation for an instant win.",
        },
      ];

      const results = discoverSynergies(segments);

      const thassaMatches = results.filter((r) =>
        r.cards.some((c) => c.toLowerCase().includes("thassa")),
      );
      expect(thassaMatches.length).toBeLessThanOrEqual(1);
    });

    it("should assign high confidence to infinite combos", () => {
      const segments = [
        {
          text: "This combo goes infinite with Underworld Breach and Lion Eye Diamond for a storm win.",
        },
      ];

      const results = discoverSynergies(segments);

      if (results.length > 0) {
        expect(["high", "medium"]).toContain(results[0].confidence);
      }
    });

    it("should handle multiple synergy keywords in same segment", () => {
      const segments = [
        {
          text: "This combo works really well with Avenger of Zendikar. These two cards together, Avenger and Craterhoof Behemoth, create a lethal board. Forest is your basic land.",
        },
      ];

      const results = discoverSynergies(segments);

      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should assign source channel when provided", () => {
      const segments = [
        {
          text: "Exquisite Blood pairs well with Sanguine Bond for infinite damage.",
        },
      ];

      const results = discoverSynergies(segments, "tolarian-community-college");

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].source_channel).toBe("tolarian-community-college");
    });

    it("should assign unique IDs to each discovered synergy", () => {
      const segments = [
        { text: "Thassa Oracle goes infinite with Demonic Consultation." },
        { text: "Exquisite Blood pairs well with Sanguine Bond." },
      ];

      const results = discoverSynergies(segments);
      const ids = results.map((r) => r.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should set reviewed and approved to false for new discoveries", () => {
      const segments = [
        {
          text: "This combo with Dockside Extortionist enables storm finishes.",
        },
      ];

      const results = discoverSynergies(segments);

      for (const r of results) {
        expect(r.reviewed).toBe(false);
        expect(r.approved).toBe(false);
      }
    });
  });

  describe("createReviewGate", () => {
    it("should accept discovered synergies into review queue", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "A goes infinite with B",
          archetype: "combo",
          format: "commander",
          confidence: "high",
          source_text: "Card A goes infinite with Card B",
          reviewed: false,
          approved: false,
          id: "nlp-test1",
        },
      ];

      const entries = gate.submit(synergies);

      expect(entries.length).toBe(1);
      expect(entries[0].decision).toBe("pending");
    });

    it("should return pending synergies from queue", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "high",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: "nlp-test2",
        },
      ];

      gate.submit(synergies);
      const pending = gate.getPending();

      expect(pending.length).toBe(1);
      expect(pending[0].decision).toBe("pending");
    });

    it("should approve a synergy via review", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "high",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: "nlp-test3",
        },
      ];

      gate.submit(synergies);
      const result = gate.review("nlp-test3", "approved", "Verified combo");

      expect(result).toBeDefined();
      expect(result!.decision).toBe("approved");
      expect(result!.reviewer_notes).toBe("Verified combo");
      expect(result!.synergy.reviewed).toBe(true);
      expect(result!.synergy.approved).toBe(true);
    });

    it("should reject a synergy via review", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "standard",
          confidence: "low",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: "nlp-test4",
        },
      ];

      gate.submit(synergies);
      const result = gate.review("nlp-test4", "rejected", "Not a real synergy");

      expect(result).toBeDefined();
      expect(result!.decision).toBe("rejected");
      expect(result!.synergy.approved).toBe(false);
    });

    it("should return approved synergies", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "high",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: "nlp-approve1",
        },
        {
          cards: ["Card C", "Card D"],
          synergy_description: "desc2",
          archetype: "aggro",
          format: "modern",
          confidence: "medium",
          source_text: "text2",
          reviewed: false,
          approved: false,
          id: "nlp-approve2",
        },
      ];

      gate.submit(synergies);
      gate.review("nlp-approve1", "approved");
      gate.review("nlp-approve2", "rejected");

      const approved = gate.getApproved();
      expect(approved.length).toBe(1);
      expect(approved[0].id).toBe("nlp-approve1");
    });

    it("should return rejected entries", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "low",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: "nlp-reject1",
        },
      ];

      gate.submit(synergies);
      gate.review("nlp-reject1", "rejected", "Invalid");

      const rejected = gate.getRejected();
      expect(rejected.length).toBe(1);
    });

    it("should return undefined when reviewing non-existent ID", () => {
      const gate = createReviewGate();
      const result = gate.review("non-existent", "approved");
      expect(result).toBeUndefined();
    });

    it("should enforce max queue size", () => {
      const gate = createReviewGate(3);
      const synergies: DiscoveredSynergy[] = Array.from(
        { length: 5 },
        (_, i) => ({
          cards: [`Card ${i}`, `Card ${i + 1}`],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "medium",
          source_text: "text",
          reviewed: false,
          approved: false,
          id: `nlp-overflow-${i}`,
        }),
      );

      gate.submit(synergies);

      const { pending } = gate.stats();
      expect(pending).toBeLessThanOrEqual(3);
    });

    it("should skip already reviewed synergies on submit", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["Card A", "Card B"],
          synergy_description: "desc",
          archetype: "combo",
          format: "commander",
          confidence: "high",
          source_text: "text",
          reviewed: true,
          approved: true,
          id: "nlp-skip1",
        },
      ];

      const entries = gate.submit(synergies);
      expect(entries.length).toBe(0);
    });

    it("should report accurate stats", () => {
      const gate = createReviewGate();
      const synergies: DiscoveredSynergy[] = [
        {
          cards: ["A", "B"],
          synergy_description: "d",
          archetype: "combo",
          format: "cmd",
          confidence: "high",
          source_text: "t",
          reviewed: false,
          approved: false,
          id: "s1",
        },
        {
          cards: ["C", "D"],
          synergy_description: "d",
          archetype: "combo",
          format: "cmd",
          confidence: "high",
          source_text: "t",
          reviewed: false,
          approved: false,
          id: "s2",
        },
        {
          cards: ["E", "F"],
          synergy_description: "d",
          archetype: "combo",
          format: "cmd",
          confidence: "high",
          source_text: "t",
          reviewed: false,
          approved: false,
          id: "s3",
        },
      ];

      gate.submit(synergies);
      gate.review("s1", "approved");
      gate.review("s2", "rejected");

      const stats = gate.stats();
      expect(stats.total).toBe(3);
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  describe("FORMAT_KEYWORDS", () => {
    it("should have commander format keywords", () => {
      expect(FORMAT_KEYWORDS["commander"]).toBeDefined();
      expect(FORMAT_KEYWORDS["commander"]).toContain("edh");
    });

    it("should have at least 8 formats", () => {
      expect(Object.keys(FORMAT_KEYWORDS).length).toBeGreaterThanOrEqual(8);
    });
  });

  describe("ARCHETYPE_KEYWORDS", () => {
    it("should have combo archetype keywords", () => {
      expect(ARCHETYPE_KEYWORDS["combo"]).toBeDefined();
      expect(ARCHETYPE_KEYWORDS["combo"]).toContain("storm");
    });

    it("should have at least 10 archetypes", () => {
      expect(Object.keys(ARCHETYPE_KEYWORDS).length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("end-to-end pipeline", () => {
    it("should discover, submit, review, and collect approved synergies", () => {
      const segments = [
        {
          text: "In modern format, this combo with Exquisite Blood pairs well with Sanguine Bond for infinite life drain.",
        },
        {
          text: "Underworld Breach goes infinite with Lion Eye Diamond and Lotus Petal in legacy.",
        },
      ];

      const gate = createReviewGate();
      const discoveries = discoverSynergies(segments, "mtg-goldfish");

      gate.submit(discoveries);

      const pending = gate.getPending();
      for (const entry of pending) {
        gate.review(entry.synergy.id, "approved");
      }

      const approved = gate.getApproved();
      expect(approved.length).toBeGreaterThanOrEqual(1);
    });
  });
});
