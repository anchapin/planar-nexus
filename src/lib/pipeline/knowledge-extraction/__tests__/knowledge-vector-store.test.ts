import { KnowledgeVectorStore } from "../knowledge-vector-store";
import type { HeuristicRecord } from "../types";

jest.mock("@orama/orama", () => {
  const inserted = new Map<string, any>();
  return {
    create: jest.fn().mockResolvedValue({ mockOrama: true }),
    insert: jest.fn().mockImplementation((_orama: any, doc: any) => {
      inserted.set(doc.id, doc);
      return Promise.resolve();
    }),
    insertMultiple: jest.fn().mockImplementation((_orama: any, docs: any[]) => {
      for (const doc of docs) inserted.set(doc.id, doc);
      return Promise.resolve();
    }),
    search: jest.fn().mockImplementation((_orama: any, opts: any) => {
      const results: any[] = [];
      for (const [, doc] of inserted) {
        let score = 0.5;
        if (opts.term && typeof opts.term === "string") {
          const text =
            `${doc.title} ${doc.description} ${doc.action} ${doc.reasoning} ${doc.category}`.toLowerCase();
          const terms = opts.term.toLowerCase().split(/\s+/);
          const matchCount = terms.filter((t: string) =>
            text.includes(t),
          ).length;
          score = matchCount / terms.length;
        }
        if (opts.vector) score = 0.8;
        if (opts.where) {
          const w = opts.where;
          if (w.category && doc.category !== w.category) continue;
          if (w.AND) {
            const conditions = Array.isArray(w.AND) ? w.AND : [w.AND];
            for (const cond of conditions) {
              if (cond.category && doc.category !== cond.category) continue;
              if (cond.archetype && doc.archetype !== cond.archetype) continue;
            }
          }
        }
        if (score >= (opts.similarity ?? 0.3)) {
          results.push({ document: doc, score, id: doc.id });
        }
      }
      results.sort((a: any, b: any) => b.score - a.score);
      return Promise.resolve({
        count: results.length,
        hits: results.slice(0, opts.limit ?? 20),
      });
    }),
  };
});

jest.mock("@orama/plugin-data-persistence", () => ({
  persist: jest.fn().mockResolvedValue({ data: "mock" }),
  restore: jest.fn().mockResolvedValue({ mockOrama: true }),
}));

jest.mock("../../../db/local-intelligence-db", () => ({
  db: {
    orama_snapshots: {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

function makeRecord(overrides: Partial<HeuristicRecord> = {}): HeuristicRecord {
  return {
    id: "test-1",
    category: "attack_lines",
    title: "Test heuristic",
    description: "A test heuristic record",
    game_state_signature:
      "attack_lines | attack with all creatures | wide board | aggressive | all",
    state_hash: "abc123",
    action: "attack with all creatures",
    reasoning: "Wide board advantage",
    confidence: 0.9,
    frequency: 1,
    tags: ["test"],
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

describe("KnowledgeVectorStore", () => {
  let store: KnowledgeVectorStore;

  beforeEach(() => {
    store = new KnowledgeVectorStore();
  });

  describe("addRecord and getRecord", () => {
    it("stores and retrieves a record", async () => {
      await store.init();
      const record = makeRecord({ id: "r1" });
      await store.addRecord(record);

      const retrieved = store.getRecord("r1");
      expect(retrieved).toEqual(record);
    });

    it("increments record count", async () => {
      await store.init();
      await store.addRecord(makeRecord({ id: "r1" }));
      await store.addRecord(makeRecord({ id: "r2" }));
      await store.addRecord(makeRecord({ id: "r3" }));

      expect(store.getRecordCount()).toBe(3);
    });
  });

  describe("addRecords batch", () => {
    it("stores multiple records at once", async () => {
      await store.init();
      const records = [
        makeRecord({ id: "b1" }),
        makeRecord({ id: "b2" }),
        makeRecord({ id: "b3" }),
      ];
      await store.addRecords(records);

      expect(store.getRecordCount()).toBe(3);
      expect(store.getRecord("b2")).toBeTruthy();
    });
  });

  describe("searchByTerm", () => {
    it("returns relevant results for a text query", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({
          id: "s1",
          title: "Wide board alpha strike",
          description:
            "Attack with all creatures when you have a wide board advantage",
          action: "attack with all creatures",
          reasoning: "Wide board means opponent needs board wipe",
        }),
        makeRecord({
          id: "s2",
          title: "Hold back for counterspell",
          description: "Save counter for the most threatening spell",
          action: "hold counterspell",
          reasoning: "Limited counter resources",
          category: "counterspell_decisions",
        }),
      ]);

      const results = await store.searchByTerm("wide board attack creatures");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.record.id === "s1")).toBe(true);
    });

    it("filters by category", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({
          id: "c1",
          category: "attack_lines",
          title: "Attack pattern",
        }),
        makeRecord({
          id: "c2",
          category: "counterspell_decisions",
          title: "Counter pattern",
        }),
      ]);

      const results = await store.searchByTerm("pattern", {
        category: "attack_lines",
      });
      expect(results.every((r) => r.record.category === "attack_lines")).toBe(
        true,
      );
    });
  });

  describe("searchByGameState", () => {
    it("returns results for a game state signature query", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({
          id: "gs1",
          game_state_signature:
            "attack_lines | attack all | low life | aggressive | standard",
        }),
        makeRecord({
          id: "gs2",
          game_state_signature:
            "block_assignments | block with deathtouch | midrange | modern",
          category: "block_assignments",
        }),
      ]);

      const results = await store.searchByGameState(
        "attack_lines | attack all | low life | aggressive",
      );
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("findSimilar", () => {
    it("finds records similar to a given record", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({
          id: "sim1",
          title: "Attack with everything",
          description: "Wide board advantage means attack all",
          action: "attack with all creatures",
          reasoning: "Close the game before stabilization",
        }),
        makeRecord({
          id: "sim2",
          title: "Alpha strike",
          description: "Commit all attackers for maximum damage",
          action: "attack with all creatures",
          reasoning: "Pressure before opponent can respond",
        }),
        makeRecord({
          id: "sim3",
          title: "Counter the game-ending spell",
          description: "Always counter spells that end the game",
          action: "cast counterspell",
          reasoning: "Preventing game loss is paramount",
          category: "counterspell_decisions",
        }),
      ]);

      const similar = await store.findSimilar("sim1");
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((r) => r.record.id !== "sim1")).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns correct stats", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({ id: "st1", category: "attack_lines" }),
        makeRecord({ id: "st2", category: "attack_lines", confidence: 0.8 }),
        makeRecord({
          id: "st3",
          category: "block_assignments",
          confidence: 0.6,
        }),
      ]);

      const stats = store.getStats();
      expect(stats.total_records).toBe(3);
      expect(stats.by_category.attack_lines).toBe(2);
      expect(stats.by_category.block_assignments).toBe(1);
      expect(stats.avg_confidence).toBeCloseTo((0.9 + 0.8 + 0.6) / 3);
    });

    it("returns zero stats for empty store", () => {
      const stats = store.getStats();
      expect(stats.total_records).toBe(0);
      expect(stats.avg_confidence).toBe(0);
    });
  });

  describe("clear", () => {
    it("clears all records", async () => {
      await store.init();
      await store.addRecords([
        makeRecord({ id: "cl1" }),
        makeRecord({ id: "cl2" }),
      ]);

      await store.clear();
      expect(store.getRecordCount()).toBe(0);
    });
  });

  describe("getAllRecords", () => {
    it("returns all stored records", async () => {
      await store.init();
      const records = [makeRecord({ id: "ga1" }), makeRecord({ id: "ga2" })];
      await store.addRecords(records);

      const all = store.getAllRecords();
      expect(all).toHaveLength(2);
    });
  });
});
