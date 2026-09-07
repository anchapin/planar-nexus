/**
 * @fileOverview Tests for the derived `FormatHealth` (issue #1563).
 *
 * Before the fix, `FormatHealth.score` / `diversityScore` were hardcoded
 * literals per format (standard 72/68, modern 78/75, commander 65/58) that
 * never moved when `DeckArchetype[].metaShare` changed — the gauge was
 * decorative. The fix derives them deterministically from the archetype
 * shares:
 *
 *   diversityScore = round1((1 - (Σ share² + remainder²)) * 100)
 *                    — normalized Herfindahl–Hirschman index, where `share`
 *                      is metaShare/100 and `remainder` is the untracked
 *                      portion of the meta acting as one implicit bucket.
 *   score          = round1(0.6 * diversityScore + 0.4 * evenness)
 *                    — evenness is the same normalized-HHI formula applied to
 *                      the five ArchetypeCategory aggregate shares.
 *
 * These tests pin all five acceptance criteria from the issue:
 *   AC1 — the HHI formula itself (exact hand-computed values).
 *   AC2 — the 60/40 blend plus colorDistribution/archetypeBalance aggregation.
 *   AC3 — mock scores stay within ±10 of the retired literals (+ snapshot).
 *   AC4 — a 100%-metaShare monopoly scores diversity 0 and overall < 30.
 *   AC5 — FormatHealthGauge announces the derived number, not a stale literal.
 */

import { describe, it, expect } from "@jest/globals";
import { render } from "@testing-library/react";
import {
  computeFormatHealth,
  getFormatHealth,
  getMetaData,
  type DeckArchetype,
  type MagicFormat,
} from "../meta";
import FormatHealthGauge from "@/components/meta/FormatHealthGauge";

/**
 * Minimal archetype fixture. Defaults describe a format-"standard" deck so
 * `computeFormatHealth(list, "standard")` sees every entry; tests override
 * fields via the single `overrides` argument.
 */
const archetype = (overrides: Partial<DeckArchetype> = {}): DeckArchetype => ({
  id: "test-archetype",
  name: "Test Archetype",
  category: "aggro",
  format: "standard",
  winRate: 50,
  metaShare: 20,
  colorIdentity: ["R"],
  description: "format-health test fixture (#1563)",
  topCards: [],
  ...overrides,
});

const withIds = (archetypes: DeckArchetype[]): DeckArchetype[] =>
  archetypes.map((a, i) => ({ ...a, id: `${a.id}-${i}` }));

describe("meta — issue #1563 (derived FormatHealth)", () => {
  describe("AC1: diversityScore is the normalized Herfindahl–Hirschman index", () => {
    it("five fully-tracked uniform archetypes at 20% score exactly 80", () => {
      const uniform = withIds(
        (["aggro", "control", "midrange", "combo", "tempo"] as const).map(
          (category) => archetype({ category, metaShare: 20 }),
        ),
      );
      // HHI = 5 * 0.2² = 0.2 → (1 - 0.2) * 100 = 80.
      expect(computeFormatHealth(uniform, "standard").diversityScore).toBe(80);
    });

    it("two archetypes at 50/50 score exactly 50", () => {
      const pair = withIds([
        archetype({ category: "aggro", metaShare: 50 }),
        archetype({ category: "control", metaShare: 50 }),
      ]);
      // HHI = 0.5² + 0.5² = 0.5 → (1 - 0.5) * 100 = 50.
      expect(computeFormatHealth(pair, "standard").diversityScore).toBe(50);
    });

    it("untracked meta participates as one implicit bucket, not free diversity", () => {
      const partial = withIds([
        archetype({ category: "aggro", metaShare: 25 }),
        archetype({ category: "control", metaShare: 25 }),
      ]);
      // Tracked = 0.5, remainder = 0.5. HHI = 0.25² + 0.25² + 0.5² = 0.375
      // → (1 - 0.375) * 100 = 62.5. Neither ignoring the untracked half
      // (which would report 87.5) nor renormalizing the pair to 50/50 (which
      // would report 50) is correct: the missing half behaves as one bucket.
      expect(computeFormatHealth(partial, "standard").diversityScore).toBe(
        62.5,
      );
    });

    it("over-summed malformed shares clamp to 0 instead of going negative", () => {
      const malformed = withIds([
        archetype({ category: "aggro", metaShare: 100 }),
        archetype({ category: "control", metaShare: 100 }),
      ]);
      expect(computeFormatHealth(malformed, "standard").diversityScore).toBe(0);
    });

    it("diversity falls monotonically as the meta concentrates", () => {
      const uniform = withIds(
        (["aggro", "control", "midrange", "combo", "tempo"] as const).map(
          (category) => archetype({ category, metaShare: 20 }),
        ),
      );
      const skewed = withIds([
        archetype({ category: "aggro", metaShare: 40 }),
        archetype({ category: "control", metaShare: 30 }),
        archetype({ category: "midrange", metaShare: 15 }),
        archetype({ category: "combo", metaShare: 10 }),
        archetype({ category: "tempo", metaShare: 5 }),
      ]);
      const monopoly = [archetype({ category: "aggro", metaShare: 100 })];

      const scores = [uniform, skewed, monopoly].map(
        (list) => computeFormatHealth(list, "standard").diversityScore,
      );
      // 80 > 71.5 > 0 — hand-computed: skewed HHI = 0.16+0.09+0.0225+0.01+0.0025.
      expect(scores[0]).toBe(80);
      expect(scores[1]).toBe(71.5);
      expect(scores[2]).toBe(0);
      expect(scores[0]).toBeGreaterThan(scores[1]);
      expect(scores[1]).toBeGreaterThan(scores[2]);
    });
  });

  describe("AC2: score is a 60/40 blend; aggregations come from the list", () => {
    it("blends 60% archetype diversity with 40% category evenness (hand-computed)", () => {
      const list = withIds([
        archetype({ category: "aggro", metaShare: 30 }),
        archetype({ category: "aggro", metaShare: 30 }),
        archetype({ category: "control", metaShare: 40 }),
      ]);
      const health = computeFormatHealth(list, "standard");

      // Archetype shares .3/.3/.4 → HHI .34 → diversity 66.
      expect(health.diversityScore).toBe(66);
      // Category shares aggro .6 / control .4 → evenness HHI .52 → 48.
      // score = round1(0.6 * 66 + 0.4 * 48) = round1(58.8).
      expect(health.score).toBe(58.8);
      // The identity must hold exactly on the reported (rounded) components.
      expect(health.score).toBe(
        Math.round((0.6 * health.diversityScore + 0.4 * 48) * 10) / 10,
      );
    });

    it("archetypeBalance aggregates metaShare per category, normalized to ~100", () => {
      const list = withIds([
        archetype({ category: "aggro", metaShare: 30 }),
        archetype({ category: "aggro", metaShare: 30 }),
        archetype({ category: "control", metaShare: 40 }),
      ]);
      expect(computeFormatHealth(list, "standard").archetypeBalance).toEqual({
        aggro: 60,
        control: 40,
        midrange: 0,
        combo: 0,
        tempo: 0,
      });
    });

    it("colorDistribution buckets by colorIdentity with count-based percentages", () => {
      const list = withIds([
        archetype({ colorIdentity: ["R"] }),
        archetype({ colorIdentity: ["R"] }),
        archetype({ colorIdentity: ["W", "U"] }),
        archetype({ colorIdentity: [] }),
      ]);
      const { colorDistribution } = computeFormatHealth(list, "standard");

      // Fixed canonical bucket order, zero-count buckets omitted.
      expect(colorDistribution).toEqual([
        { color: "Red", count: 2, percentage: 50 },
        { color: "Multicolor", count: 1, percentage: 25 },
        { color: "Colorless", count: 1, percentage: 25 },
      ]);
    });

    it("mono-color identities map to their named bucket", () => {
      const list = withIds([
        archetype({ colorIdentity: ["U"] }),
        archetype({ colorIdentity: ["G"] }),
      ]);
      expect(computeFormatHealth(list, "standard").colorDistribution).toEqual([
        { color: "Blue", count: 1, percentage: 50 },
        { color: "Green", count: 1, percentage: 50 },
      ]);
    });

    it("only archetypes matching the requested format contribute (#1562 parity)", () => {
      const foreign = [archetype({ format: "modern", metaShare: 100 })];
      const health = computeFormatHealth(foreign, "standard");
      expect(health.score).toBe(0);
      expect(health.diversityScore).toBe(0);
      expect(health.colorDistribution).toEqual([]);
      expect(health.archetypeBalance).toEqual({
        aggro: 0,
        control: 0,
        midrange: 0,
        combo: 0,
        tempo: 0,
      });
    });
  });

  describe("determinism (the core of #1563)", () => {
    it("same input shares → deep-equal output across repeated calls", () => {
      const list = withIds([
        archetype({ category: "aggro", metaShare: 30 }),
        archetype({ category: "control", metaShare: 25 }),
        archetype({ category: "midrange", metaShare: 20 }),
      ]);
      expect(computeFormatHealth(list, "standard")).toEqual(
        computeFormatHealth(list, "standard"),
      );
    });

    it("different share distributions → different scores", () => {
      const uniform = withIds(
        (["aggro", "control", "midrange", "combo", "tempo"] as const).map(
          (category) => archetype({ category, metaShare: 20 }),
        ),
      );
      const concentrated = withIds([
        archetype({ category: "aggro", metaShare: 60 }),
        archetype({ category: "control", metaShare: 15 }),
        archetype({ category: "midrange", metaShare: 10 }),
        archetype({ category: "combo", metaShare: 10 }),
        archetype({ category: "tempo", metaShare: 5 }),
      ]);
      const a = computeFormatHealth(uniform, "standard");
      const b = computeFormatHealth(concentrated, "standard");
      expect(a.score).not.toBe(b.score);
      expect(a).not.toEqual(b);
    });

    it("getMetaData derives formatHealth from the same dataset for every dateRange", () => {
      for (const format of ["standard", "modern", "commander"] as const) {
        for (const range of ["7days", "30days", "alltime"] as const) {
          expect(getMetaData(format, range).formatHealth).toEqual(
            getFormatHealth(format),
          );
        }
      }
    });
  });

  describe("AC3: mock scores stay within ±10 of the retired literals", () => {
    const LEGACY_SCORES: Record<MagicFormat, number> = {
      standard: 72,
      modern: 78,
      commander: 65,
    };

    for (const format of Object.keys(LEGACY_SCORES) as MagicFormat[]) {
      it(`${format}: derived score is within ±10 of ${LEGACY_SCORES[format]}`, () => {
        const { score } = getFormatHealth(format);
        expect(Math.abs(score - LEGACY_SCORES[format])).toBeLessThanOrEqual(10);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });

      it(`${format}: derived report snapshot`, () => {
        expect(getFormatHealth(format)).toMatchSnapshot();
      });
    }
  });

  describe("AC4: a 100%-metaShare monopoly is punished", () => {
    const monopoly = [
      archetype({ category: "aggro", metaShare: 100, colorIdentity: ["R"] }),
    ];

    it("diversityScore is 0 and the overall score is below 30", () => {
      const health = computeFormatHealth(monopoly, "standard");
      expect(health.diversityScore).toBe(0);
      expect(health.score).toBeLessThan(30);
      expect(health.score).toBe(0);
    });

    it("the monopoly category owns the entire archetypeBalance", () => {
      expect(
        computeFormatHealth(monopoly, "standard").archetypeBalance,
      ).toEqual({
        aggro: 100,
        control: 0,
        midrange: 0,
        combo: 0,
        tempo: 0,
      });
    });
  });

  describe("AC5: FormatHealthGauge announces the derived number", () => {
    for (const format of ["standard", "modern", "commander"] as const) {
      it(`${format}: aria-valuenow / aria-valuetext match the computed score`, () => {
        const health = getFormatHealth(format);
        const { container } = render(
          <FormatHealthGauge score={health.score} />,
        );
        const gauge = container.querySelector('[role="progressbar"]');
        expect(gauge).not.toBeNull();
        expect(gauge?.getAttribute("aria-valuenow")).toBe(String(health.score));
        expect(gauge?.getAttribute("aria-valuetext")).toContain(
          `${health.score} out of 100`,
        );
      });
    }
  });
});
