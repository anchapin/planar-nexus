/**
 * @fileoverview Tests for the Orama card-search Web Worker logic (issue #1389).
 *
 * The worker handler (`searchWorker`) is exported as a plain object so it
 * can be exercised directly from Jest without spawning a real Worker,
 * mirroring the convention from `backup-checksum.worker.ts` and the
 * card-search-index tests.
 *
 * These tests validate:
 *   (a) worker success path — index + search returns hits
 *   (b) clear() resets the index
 *   (c) count() reflects indexed documents
 *   (d) result parity with cardSearchIndex (same schema, same hit shape)
 */
import { describe, it, expect, beforeEach } from "@jest/globals";

import {
  searchWorker,
  _resetWorkerForTesting,
} from "../search.worker";
import type { CardSearchDocument } from "../card-search-index";

// Orama is mapped to CommonJS in jest.config.js so we use the real engine.
// No mocking needed — these tests exercise real index/search behaviour.

const makeDoc = (
  id: string,
  name: string,
  extras: Partial<CardSearchDocument> = {},
): CardSearchDocument => ({
  id,
  name,
  type_line: "Creature",
  oracle_text: "",
  colors: "",
  set: "",
  cmc: 1,
  ...extras,
});

describe("search.worker (issue #1389)", () => {
  beforeEach(() => {
    _resetWorkerForTesting();
  });

  describe("init()", () => {
    it("creates an empty index when no snapshot is provided", async () => {
      const restored = await searchWorker.init();
      expect(restored).toBe(false);
      const count = await searchWorker.count();
      expect(count).toBe(0);
    });

    it("returns false for a garbage snapshot and falls back to empty index", async () => {
      const restored = await searchWorker.init({ garbage: true });
      expect(restored).toBe(false);
    });
  });

  describe("index() + search()", () => {
    it("indexes documents and returns matching hits by name", async () => {
      await searchWorker.init();
      await searchWorker.index([
        makeDoc("1", "Lightning Bolt"),
        makeDoc("2", "Lightning Strike"),
        makeDoc("3", "Counterspell"),
      ]);

      const hits = await searchWorker.search("lightning");
      expect(hits.length).toBeGreaterThanOrEqual(2);
      const names = hits.map((h) => h.name);
      expect(names).toContain("Lightning Bolt");
      expect(names).toContain("Lightning Strike");
    });

    it("returns hits in the {id, name} shape matching cardSearchIndex", async () => {
      await searchWorker.init();
      await searchWorker.index([makeDoc("42", "Sol Ring")]);

      const hits = await searchWorker.search("sol");
      expect(hits).toEqual([{ id: "42", name: "Sol Ring" }]);
    });

    it("respects the limit option", async () => {
      await searchWorker.init();
      const docs: CardSearchDocument[] = [];
      for (let i = 0; i < 10; i++) {
        docs.push(makeDoc(`${i}`, `Lightning ${i}`));
      }
      await searchWorker.index(docs);

      const hits = await searchWorker.search("lightning", { limit: 3 });
      expect(hits.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array when no documents match", async () => {
      await searchWorker.init();
      await searchWorker.index([makeDoc("1", "Lightning Bolt")]);

      const hits = await searchWorker.search("nonexistentcard");
      expect(hits).toEqual([]);
    });
  });

  describe("clear()", () => {
    it("resets the index so subsequent searches return no hits", async () => {
      await searchWorker.init();
      await searchWorker.index([makeDoc("1", "Lightning Bolt")]);
      expect(await searchWorker.count()).toBeGreaterThan(0);

      await searchWorker.clear();
      expect(await searchWorker.count()).toBe(0);

      const hits = await searchWorker.search("lightning");
      expect(hits).toEqual([]);
    });
  });

  describe("count()", () => {
    it("returns 0 before any indexing", async () => {
      expect(await searchWorker.count()).toBe(0);
    });

    it("reflects indexed document count", async () => {
      await searchWorker.init();
      await searchWorker.index([
        makeDoc("1", "Lightning Bolt"),
        makeDoc("2", "Counterspell"),
        makeDoc("3", "Sol Ring"),
      ]);
      expect(await searchWorker.count()).toBe(3);
    });
  });

  describe("result parity with cardSearchIndex", () => {
    it("returns identical {id, name}[] shape as the main-thread index", async () => {
      await searchWorker.init();
      await searchWorker.index([
        makeDoc("a", "Demonic Tutor"),
        makeDoc("b", "Diabolic Intent"),
      ]);

      const workerHits = await searchWorker.search("demonic");
      // Every hit must be an object with exactly {id, name} keys.
      for (const hit of workerHits) {
        expect(Object.keys(hit).sort()).toEqual(["id", "name"]);
        expect(typeof hit.id).toBe("string");
        expect(typeof hit.name).toBe("string");
      }
    });
  });
});
