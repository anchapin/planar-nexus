/**
 * @fileOverview Tests for `src/lib/meta.ts`.
 *
 * Regression coverage for issue #1446. Before the fix:
 *   - `getMetaData(format, dateRange)` accepted a `dateRange` argument but the
 *     only thing it did with it was echo it back into the returned object —
 *     `risingArchetypes`, `decliningArchetypes`, `cardTrends`, and
 *     `lastUpdated` were identical across `'7days' | '30days' | 'alltime'`.
 *   - `generateCardTrends()` built every inclusion-rate point with
 *     `Math.random()`, so two successive `getMetaData` calls with the same
 *     args returned different `cardTrends`, breaking React/SSR hydration
 *     stability and any chance of stable snapshot tests.
 *
 * The fix:
 *   - makes `cardTrends` and the rising/declining trend deltas range-dependent,
 *     so the dashboard toggle actually changes the rendered output;
 *   - replaces `Math.random()` with a seeded mulberry32 PRNG, so repeated calls
 *     with the same `dateRange` return deep-equal output;
 *   - exposes an optional `{ now, random }` dependency-injection seam so tests
 *     can pin `lastUpdated` and/or the noise band.
 *
 * These tests pin down all four acceptance criteria from #1446.
 *
 * A later describe block adds regression coverage for issue #1562, which made
 * `getCardInclusionRates` format-aware so archetype ids that recur across the
 * independently-authored standard/modern/commander datasets can no longer
 * cross-contaminate each other's card-inclusion rates.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  getMetaData,
  getCardInclusionRates,
  registerArchetypesForTesting,
  MagicFormat,
  DateRange,
  DeckArchetype,
  MetaData,
} from "../meta";

const FORMATS: MagicFormat[] = ["standard", "modern", "commander"];
const RANGES: DateRange[] = ["7days", "30days", "alltime"];

describe("meta — issue #1446 (dateRange + deterministic card trends)", () => {
  describe("AC1: 7days vs alltime produce observably different output", () => {
    for (const format of FORMATS) {
      it(`${format}: getMetaData(f, '7days').cardTrends differs from getMetaData(f, 'alltime').cardTrends`, () => {
        const sevenDays = getMetaData(format, "7days");
        const allTime = getMetaData(format, "alltime");

        // Window length is the cheapest, most reliable range signal.
        expect(sevenDays.cardTrends[0].data.length).not.toBe(
          allTime.cardTrends[0].data.length,
        );

        // Per-card slopes also scale with dateRange, so even at week index 0
        // the delver/reclamation/etc. inclusion rate should differ.
        const sevenDelver = sevenDays.cardTrends.find(
          (c) => c.cardName === "Delver of Secrets",
        )!;
        const allTimeDelver = allTime.cardTrends.find(
          (c) => c.cardName === "Delver of Secrets",
        )!;
        const sevenFinal = sevenDelver.data.at(-1)!.inclusionRate;
        const allTimeFinal = allTimeDelver.data.at(-1)!.inclusionRate;
        expect(sevenFinal).not.toBe(allTimeFinal);
      });

      it(`${format}: risingArchetypes differ between '7days' and 'alltime'`, () => {
        const sevenDays = getMetaData(format, "7days");
        const allTime = getMetaData(format, "alltime");

        // The rising/declining deltas scale with dateRange, so every rising
        // archetype's `change` should be observably different.
        expect(sevenDays.risingArchetypes.length).toBeGreaterThan(0);
        for (let i = 0; i < sevenDays.risingArchetypes.length; i++) {
          const s = sevenDays.risingArchetypes[i];
          const a = allTime.risingArchetypes[i];
          expect(s.archetypeId).toBe(a.archetypeId);
          expect(s.change).not.toBe(a.change);
          expect(s.previousMetaShare).not.toBe(a.previousMetaShare);
        }
      });

      it(`${format}: decliningArchetypes differ between '7days' and 'alltime'`, () => {
        const sevenDays = getMetaData(format, "7days");
        const allTime = getMetaData(format, "alltime");

        expect(sevenDays.decliningArchetypes.length).toBeGreaterThan(0);
        for (let i = 0; i < sevenDays.decliningArchetypes.length; i++) {
          const s = sevenDays.decliningArchetypes[i];
          const a = allTime.decliningArchetypes[i];
          expect(s.archetypeId).toBe(a.archetypeId);
          expect(s.change).not.toBe(a.change);
          expect(s.previousMetaShare).not.toBe(a.previousMetaShare);
        }
      });

      it(`${format}: dateRange is reflected in the returned MetaData.dateRange`, () => {
        expect(getMetaData(format, "7days").dateRange).toBe("7days");
        expect(getMetaData(format, "30days").dateRange).toBe("30days");
        expect(getMetaData(format, "alltime").dateRange).toBe("alltime");
      });
    }
  });

  describe("AC2: Two successive calls with identical args return deep-equal cardTrends", () => {
    for (const format of FORMATS) {
      for (const range of RANGES) {
        it(`${format}/${range}: cardTrends are deep-equal across two calls`, () => {
          const first = getMetaData(format, range);
          const second = getMetaData(format, range);
          expect(second.cardTrends).toEqual(first.cardTrends);
        });

        it(`${format}/${range}: rising/declining trends are deep-equal across two calls`, () => {
          const first = getMetaData(format, range);
          const second = getMetaData(format, range);
          expect(second.risingArchetypes).toEqual(first.risingArchetypes);
          expect(second.decliningArchetypes).toEqual(first.decliningArchetypes);
        });
      }
    }
  });

  describe("AC3: generateCardTrends contains no Math.random() call", () => {
    it("source file has no Math.random outside of comments", () => {
      const source = readFileSync(resolve(__dirname, "..", "meta.ts"), "utf8");
      // Strip block + line comments so we only assert against executable code.
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(stripped).not.toMatch(/Math\.random\s*\(/);
    });
  });

  describe("AC4: lastUpdated can be supplied deterministically", () => {
    it("uses the injected `now` factory for lastUpdated", () => {
      const pinned = new Date("2026-01-15T12:00:00.000Z");
      const data = getMetaData("standard", "30days", { now: () => pinned });
      expect(data.lastUpdated).toBe(pinned.toISOString());
    });

    it("different now() calls produce different lastUpdated", () => {
      const a = getMetaData("standard", "30days", {
        now: () => new Date("2026-01-15T12:00:00.000Z"),
      });
      const b = getMetaData("standard", "30days", {
        now: () => new Date("2026-02-20T08:30:00.000Z"),
      });
      expect(a.lastUpdated).not.toBe(b.lastUpdated);
    });

    it("without an injected clock, lastUpdated is still a valid ISO string", () => {
      const data = getMetaData("standard", "30days");
      // Round-trip through Date to confirm it's a real ISO timestamp.
      expect(Number.isNaN(Date.parse(data.lastUpdated))).toBe(false);
    });
  });

  describe("bonus: injectable PRNG lets tests assert on the noise band", () => {
    it("a fixed `random` produces a fixed cardTrends noise band", () => {
      const fixedRandom = () => 0.5;
      const a = getMetaData("standard", "30days", { random: fixedRandom });
      const b = getMetaData("standard", "30days", { random: fixedRandom });
      expect(b.cardTrends).toEqual(a.cardTrends);

      // With random() === 0.5 the noise band adds exactly 1.0 to every value,
      // so a Delver W1 point must equal `65 + 0*3.5*0.7 + 1.0` rounded to 1dp.
      const delver = a.cardTrends.find(
        (c) => c.cardName === "Delver of Secrets",
      )!;
      expect(delver.data[0].inclusionRate).toBe(66);
    });

    it("different `random` injections produce different cardTrends", () => {
      const allZeros = getMetaData("standard", "30days", { random: () => 0 });
      const allOnes = getMetaData("standard", "30days", { random: () => 1 });
      expect(allZeros.cardTrends).not.toEqual(allOnes.cardTrends);
    });
  });

  describe("range-dependent week window length", () => {
    it("7days → 4 weeks, 30days → 8 weeks, alltime → 12 weeks", () => {
      for (const format of FORMATS) {
        expect(getMetaData(format, "7days").cardTrends[0].data.length).toBe(4);
        expect(getMetaData(format, "30days").cardTrends[0].data.length).toBe(8);
        expect(getMetaData(format, "alltime").cardTrends[0].data.length).toBe(
          12,
        );
      }
    });

    it("every card has the same week-window length within a single call", () => {
      for (const format of FORMATS) {
        for (const range of RANGES) {
          const data: MetaData = getMetaData(format, range);
          const lengths = new Set(data.cardTrends.map((c) => c.data.length));
          expect(lengths.size).toBe(1);
        }
      }
    });
  });
});

describe("meta — issue #1562 (format-aware getCardInclusionRates)", () => {
  /**
   * Fixture: a minimal archetype whose id is IDENTICAL across formats, with a
   * format-distinctive card payload so tests can assert exactly which dataset
   * a lookup resolved from. This simulates the future Scryfall-derived ids
   * that #1562 guarantees will collide across formats.
   */
  const collidingArchetype = (
    format: MagicFormat,
    cardName: string,
  ): DeckArchetype => ({
    id: "colliding-archetype",
    name: `Colliding (${format})`,
    category: "aggro",
    format,
    winRate: 50,
    metaShare: 5,
    colorIdentity: ["R"],
    description: "test fixture for #1562",
    topCards: [
      { cardName, inclusionRate: 99, trend: "stable", trendChange: 0 },
    ],
  });

  let undoFns: Array<() => void>;

  beforeEach(() => {
    undoFns = [];
    // Silence deprecation warnings emitted by legacy (no-format) calls so test
    // output stays clean; individual tests re-acquire the spy to assert on it.
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    while (undoFns.length > 0) {
      const undo = undoFns.pop();
      undo?.();
    }
    jest.restoreAllMocks();
  });

  const inject = (format: MagicFormat, archetype: DeckArchetype) => {
    undoFns.push(registerArchetypesForTesting(format, archetype));
  };

  it("AC1: an id colliding across all three formats returns each format’s distinct topCards", () => {
    inject("standard", collidingArchetype("standard", "Standard-Only Payload"));
    inject("modern", collidingArchetype("modern", "Modern-Only Payload"));
    inject(
      "commander",
      collidingArchetype("commander", "Commander-Only Payload"),
    );

    expect(
      getCardInclusionRates("colliding-archetype", "standard").map(
        (c) => c.cardName,
      ),
    ).toEqual(["Standard-Only Payload"]);
    expect(
      getCardInclusionRates("colliding-archetype", "modern").map(
        (c) => c.cardName,
      ),
    ).toEqual(["Modern-Only Payload"]);
    expect(
      getCardInclusionRates("colliding-archetype", "commander").map(
        (c) => c.cardName,
      ),
    ).toEqual(["Commander-Only Payload"]);
  });

  it("AC1: a colliding id never bleeds another format’s cards into the requested format", () => {
    inject("standard", collidingArchetype("standard", "Standard-Only Payload"));
    inject("modern", collidingArchetype("modern", "Modern-Only Payload"));

    const modernRates = getCardInclusionRates("colliding-archetype", "modern");
    expect(modernRates.map((c) => c.cardName)).not.toContain(
      "Standard-Only Payload",
    );
  });

  it("AC2: an id that exists in only one format still resolves with any format argument", () => {
    // 'edh-aggro-1' exists only in the commander dataset.
    expect(() =>
      getCardInclusionRates("edh-aggro-1", "standard"),
    ).not.toThrow();
    expect(getCardInclusionRates("edh-aggro-1", "standard")).toEqual(
      getCardInclusionRates("edh-aggro-1", "commander"),
    );
    expect(
      getCardInclusionRates("edh-aggro-1", "commander").length,
    ).toBeGreaterThan(0);
  });

  it("format-scoped lookup resolves every existing archetype to its own dataset", () => {
    for (const format of FORMATS) {
      for (const archetype of getMetaData(format, "alltime").archetypes) {
        expect(getCardInclusionRates(archetype.id, format)).toEqual(
          archetype.topCards,
        );
      }
    }
  });

  it("AC3: a format-less call logs a deprecation warning and falls back to the legacy search", () => {
    const warnSpy = jest.spyOn(console, "warn");

    const legacy = getCardInclusionRates("std-aggro-1");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("deprecated");
    // Legacy result matches the format-scoped result for a non-colliding id.
    expect(legacy).toEqual(getCardInclusionRates("std-aggro-1", "standard"));
  });

  it("legacy (no-format) search remains deterministic first-match-wins across formats", () => {
    const warnSpy = jest.spyOn(console, "warn");
    inject("standard", collidingArchetype("standard", "Standard-Only Payload"));
    inject("modern", collidingArchetype("modern", "Modern-Only Payload"));

    // standard is declared first, so the legacy search resolves to standard.
    expect(
      getCardInclusionRates("colliding-archetype").map((c) => c.cardName),
    ).toEqual(["Standard-Only Payload"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("unknown ids resolve to an empty array without throwing (scoped and legacy)", () => {
    expect(() =>
      getCardInclusionRates("does-not-exist", "standard"),
    ).not.toThrow();
    expect(getCardInclusionRates("does-not-exist", "standard")).toEqual([]);
    expect(getCardInclusionRates("does-not-exist")).toEqual([]);
  });

  it("registerArchetypesForTesting undo removes injected entries and restores lookups", () => {
    const undo = registerArchetypesForTesting(
      "modern",
      collidingArchetype("modern", "X"),
    );

    expect(
      getCardInclusionRates("colliding-archetype", "modern").map(
        (c) => c.cardName,
      ),
    ).toEqual(["X"]);
    undo();
    expect(getCardInclusionRates("colliding-archetype", "modern")).toEqual([]);
  });
});
