import { generateSeedRecords, SEED_RECORD_COUNT } from "../seed-data";
import { HEURISTIC_CATEGORIES } from "../types";

describe("seed-data", () => {
  it("generates at least 500 unique heuristic records", () => {
    const records = generateSeedRecords();
    expect(records.length).toBeGreaterThanOrEqual(500);
    expect(records.length).toBe(SEED_RECORD_COUNT);
  });

  it("covers all 7 categories", () => {
    const records = generateSeedRecords();
    const categories = new Set(records.map((r) => r.category));
    for (const cat of HEURISTIC_CATEGORIES) {
      expect(categories.has(cat)).toBe(true);
    }
  });

  it("has unique IDs for all records", () => {
    const records = generateSeedRecords();
    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(records.length);
  });

  it("all records have valid confidence scores", () => {
    const records = generateSeedRecords();
    for (const record of records) {
      expect(record.confidence).toBeGreaterThanOrEqual(0);
      expect(record.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("all records have required fields", () => {
    const records = generateSeedRecords();
    for (const record of records) {
      expect(record.id).toBeTruthy();
      expect(record.category).toBeTruthy();
      expect(record.title).toBeTruthy();
      expect(record.description).toBeTruthy();
      expect(record.action).toBeTruthy();
      expect(record.reasoning).toBeTruthy();
      expect(record.state_hash).toBeTruthy();
      expect(record.game_state_signature).toBeTruthy();
    }
  });

  it("distributes records across categories meaningfully", () => {
    const records = generateSeedRecords();
    const counts: Record<string, number> = {};
    for (const cat of HEURISTIC_CATEGORIES) {
      counts[cat] = 0;
    }
    for (const record of records) {
      counts[record.category]++;
    }

    for (const cat of HEURISTIC_CATEGORIES) {
      expect(counts[cat]).toBeGreaterThan(10);
    }
  });
});
