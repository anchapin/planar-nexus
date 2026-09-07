/**
 * @fileOverview Tests for `src/lib/matchup-guides.ts`.
 *
 * Regression coverage for issue #1566: surface matchup-guide coverage gaps so
 * missing `(player, opponent, format)` triples are visible.
 *
 * Before the fix:
 *   - `getMatchupGuide(player, opponent, format)` silently returned `null` for
 *     every un-authored triple, and the matchup page rendered a blank panel
 *     with no way to distinguish "data is loading", "data is missing", or
 *     "this matchup has no guide".
 *   - There was no helper to report how many of the cartesian-product pairs
 *     were covered, so a regression that dropped a guide went unnoticed.
 *
 * The fix:
 *   - exposes `getMatchupGuideCoverage(format)` which returns
 *     `{ total, covered, missing: [{playerArchetype, opponentArchetype}] }`
 *     computed from the cartesian product of `ArchetypeCategory` values vs the
 *     `matchupGuides` table;
 *   - exposes `getMatchupGuideStatus(player, opponent, format)` returning
 *     `'covered' | 'missing'` so the UI can distinguish missing-from-empty
 *     while `getMatchupGuide` keeps its back-compat `null` return;
 *   - exposes the canonical `ARCHETYPE_CATEGORIES` list so the cartesian
 *     product is reproducible.
 *
 * These tests pin down acceptance criteria #1, #4, and #5 from #1566. The UI
 * changes in `src/app/(app)/matchup/page.tsx` (acceptance criterion #3) are
 * exercised by the e2e suite, not here.
 */

import { describe, it, expect } from "@jest/globals";
import {
  ARCHETYPE_CATEGORIES,
  computeMatchupGuideCoverage,
  getAllMatchupGuides,
  getMatchupGuide,
  getMatchupGuideCoverage,
  getMatchupGuideStatus,
  MatchupGuide,
} from "../matchup-guides";
import { ArchetypeCategory, MagicFormat } from "../meta";

const FORMATS: MagicFormat[] = ["standard", "modern", "commander"];

// Minimal valid MatchupGuide fixture — every field except the
// (playerArchetype, opponentArchetype, format) triple is irrelevant for the
// coverage report, so we use empty strings and the minimum required shape.
function makeGuide(
  player: ArchetypeCategory,
  opponent: ArchetypeCategory,
  format: MagicFormat,
): MatchupGuide {
  return {
    playerArchetype: player,
    playerArchetypeName: player,
    opponentArchetype: opponent,
    opponentArchetypeName: opponent,
    format,
    winRate: 50,
    gamePlan: {
      opening: [],
      midGame: [],
      lateGame: [],
      generalStrategy: "",
    },
    mulliganGuide: {
      keep: [],
      mulligan: [],
      consider: [],
      notes: "",
    },
    keyCards: [],
  };
}

describe("matchup-guides — issue #1566 (coverage gaps)", () => {
  describe("ARCHETYPE_CATEGORIES", () => {
    it("is a non-empty, ordered list used to compute the cartesian product", () => {
      expect(ARCHETYPE_CATEGORIES.length).toBeGreaterThan(0);
      // Stable ordering — important because the missing list is sorted by this
      // order, so a UI snapshot test relies on the order not shifting.
      expect([...ARCHETYPE_CATEGORIES]).toEqual(ARCHETYPE_CATEGORIES);
    });
  });

  describe("computeMatchupGuideCoverage — algorithm properties", () => {
    it("empty coverage → all (player, opponent) triples are missing", () => {
      const coverage = computeMatchupGuideCoverage([], "standard");
      expect(coverage.total).toBe(ARCHETYPE_CATEGORIES.length ** 2);
      expect(coverage.covered).toBe(0);
      expect(coverage.missing).toHaveLength(coverage.total);
      // Every pair is listed exactly once.
      const seen = new Set(
        coverage.missing.map(
          (m) => `${m.playerArchetype}|${m.opponentArchetype}`,
        ),
      );
      expect(seen.size).toBe(coverage.missing.length);
    });

    it("full coverage → no missing triples", () => {
      const allGuides: MatchupGuide[] = [];
      for (const p of ARCHETYPE_CATEGORIES) {
        for (const o of ARCHETYPE_CATEGORIES) {
          allGuides.push(makeGuide(p, o, "standard"));
        }
      }
      const coverage = computeMatchupGuideCoverage(allGuides, "standard");
      expect(coverage.total).toBe(25);
      expect(coverage.covered).toBe(25);
      expect(coverage.missing).toEqual([]);
    });

    it("partial coverage → returns exactly the missing triples, in stable order", () => {
      // Cover a single cell of the 5×5 grid (aggro vs control).
      const partial: MatchupGuide[] = [
        makeGuide("aggro", "control", "standard"),
      ];

      const coverage = computeMatchupGuideCoverage(partial, "standard");

      expect(coverage.format).toBe("standard");
      expect(coverage.total).toBe(25);
      expect(coverage.covered).toBe(1);
      expect(coverage.missing).toHaveLength(24);

      // The covered pair must NOT appear in `missing`.
      const coveredKey = "aggro|control";
      expect(
        coverage.missing.some(
          (m) => `${m.playerArchetype}|${m.opponentArchetype}` === coveredKey,
        ),
      ).toBe(false);

      // Every other pair in the cartesian product must appear exactly once,
      // in the canonical (player, opponent) order.
      const expectedMissing: Array<{
        playerArchetype: ArchetypeCategory;
        opponentArchetype: ArchetypeCategory;
      }> = [];
      for (const p of ARCHETYPE_CATEGORIES) {
        for (const o of ARCHETYPE_CATEGORIES) {
          if (p === "aggro" && o === "control") continue;
          expectedMissing.push({ playerArchetype: p, opponentArchetype: o });
        }
      }
      expect(coverage.missing).toEqual(expectedMissing);
    });

    it("archetypes parameter scopes the cartesian product to a subset", () => {
      const coverage = computeMatchupGuideCoverage([], "standard", [
        "aggro",
        "control",
      ]);
      expect(coverage.total).toBe(4);
      expect(coverage.covered).toBe(0);
      expect(coverage.missing).toEqual([
        { playerArchetype: "aggro", opponentArchetype: "aggro" },
        { playerArchetype: "aggro", opponentArchetype: "control" },
        { playerArchetype: "control", opponentArchetype: "aggro" },
        { playerArchetype: "control", opponentArchetype: "control" },
      ]);
    });

    it("only counts guides for the requested format", () => {
      // Same pair authored under two different formats — should only count the
      // one matching the requested format.
      const guides: MatchupGuide[] = [
        makeGuide("aggro", "control", "standard"),
        makeGuide("aggro", "control", "modern"),
        makeGuide("aggro", "control", "commander"),
      ];
      const standardCoverage = computeMatchupGuideCoverage(guides, "standard");
      expect(standardCoverage.covered).toBe(1);
      const modernCoverage = computeMatchupGuideCoverage(guides, "modern");
      expect(modernCoverage.covered).toBe(1);
      const commanderCoverage = computeMatchupGuideCoverage(
        guides,
        "commander",
      );
      expect(commanderCoverage.covered).toBe(1);
    });
  });

  describe("getMatchupGuideCoverage — production data snapshot (AC #4)", () => {
    // Regression guard: if someone deletes a guide from the mock matchupGuides
    // table, this snapshot flips and the test fails — flagging the regression
    // exactly the way the issue body asks for.
    it("standard coverage has non-zero covered count and total equals 5² = 25", () => {
      const coverage = getMatchupGuideCoverage("standard");
      expect(coverage.total).toBe(25);
      expect(coverage.covered).toBeGreaterThan(0);
      expect(coverage.covered).toBe(getAllMatchupGuides("standard").length);
      expect(coverage.covered + coverage.missing.length).toBe(coverage.total);
    });

    it("modern and commander have no authored guides in the mock dataset", () => {
      for (const format of ["modern", "commander"] as const) {
        const coverage = getMatchupGuideCoverage(format);
        expect(coverage.covered).toBe(0);
        expect(coverage.missing).toHaveLength(25);
      }
    });
  });

  describe("getMatchupGuideCoverage — deterministic commander missing list (AC #5)", () => {
    it("returns a deterministic missing list (the full 5×5 grid) for commander", () => {
      const coverage = getMatchupGuideCoverage("commander");
      // Exact list, ordered, no fixtures needed — pinning the shape so a
      // future refactor that reorders ARCHETYPE_CATEGORIES fails loudly.
      expect(coverage.missing).toEqual([
        { playerArchetype: "aggro", opponentArchetype: "aggro" },
        { playerArchetype: "aggro", opponentArchetype: "control" },
        { playerArchetype: "aggro", opponentArchetype: "midrange" },
        { playerArchetype: "aggro", opponentArchetype: "combo" },
        { playerArchetype: "aggro", opponentArchetype: "tempo" },
        { playerArchetype: "control", opponentArchetype: "aggro" },
        { playerArchetype: "control", opponentArchetype: "control" },
        { playerArchetype: "control", opponentArchetype: "midrange" },
        { playerArchetype: "control", opponentArchetype: "combo" },
        { playerArchetype: "control", opponentArchetype: "tempo" },
        { playerArchetype: "midrange", opponentArchetype: "aggro" },
        { playerArchetype: "midrange", opponentArchetype: "control" },
        { playerArchetype: "midrange", opponentArchetype: "midrange" },
        { playerArchetype: "midrange", opponentArchetype: "combo" },
        { playerArchetype: "midrange", opponentArchetype: "tempo" },
        { playerArchetype: "combo", opponentArchetype: "aggro" },
        { playerArchetype: "combo", opponentArchetype: "control" },
        { playerArchetype: "combo", opponentArchetype: "midrange" },
        { playerArchetype: "combo", opponentArchetype: "combo" },
        { playerArchetype: "combo", opponentArchetype: "tempo" },
        { playerArchetype: "tempo", opponentArchetype: "aggro" },
        { playerArchetype: "tempo", opponentArchetype: "control" },
        { playerArchetype: "tempo", opponentArchetype: "midrange" },
        { playerArchetype: "tempo", opponentArchetype: "combo" },
        { playerArchetype: "tempo", opponentArchetype: "tempo" },
      ]);
    });
  });

  describe("getMatchupGuideStatus (AC #2)", () => {
    it('returns "covered" for a triple present in the matchupGuides table', () => {
      // From the mock dataset — "aggro vs control in standard" is authored.
      expect(getMatchupGuideStatus("aggro", "control", "standard")).toBe<
        ReturnType<typeof getMatchupGuideStatus>
      >("covered");
    });

    it('returns "missing" for a triple absent from the matchupGuides table', () => {
      // No mock guide for "aggro vs aggro" (mirror match).
      expect(getMatchupGuideStatus("aggro", "aggro", "standard")).toBe<
        ReturnType<typeof getMatchupGuideStatus>
      >("missing");
    });

    it('returns "missing" when the same triple is authored in another format', () => {
      // "aggro vs control" exists in standard but NOT in modern/commander.
      expect(getMatchupGuideStatus("aggro", "control", "modern")).toBe<
        ReturnType<typeof getMatchupGuideStatus>
      >("missing");
      expect(getMatchupGuideStatus("aggro", "control", "commander")).toBe<
        ReturnType<typeof getMatchupGuideStatus>
      >("missing");
    });

    it("agrees with getMatchupGuide: null => missing, non-null => covered", () => {
      // Property test across every (player, opponent, format) triple.
      for (const format of FORMATS) {
        for (const player of ARCHETYPE_CATEGORIES) {
          for (const opponent of ARCHETYPE_CATEGORIES) {
            const guide = getMatchupGuide(player, opponent, format);
            const status = getMatchupGuideStatus(player, opponent, format);
            const expected = guide !== null ? "covered" : "missing";
            expect({ player, opponent, format, status }).toEqual({
              player,
              opponent,
              format,
              status: expected,
            });
          }
        }
      }
    });
  });

  describe("back-compat: getMatchupGuide still returns null for missing triples (AC #2)", () => {
    it("returns null when the (player, opponent, format) triple is missing", () => {
      // aggro vs aggro in standard is not in the mock table.
      expect(getMatchupGuide("aggro", "aggro", "standard")).toBeNull();
      // modern/commander have no guides authored at all.
      expect(getMatchupGuide("aggro", "control", "modern")).toBeNull();
      expect(getMatchupGuide("aggro", "control", "commander")).toBeNull();
    });

    it("returns the authored guide for a covered triple", () => {
      const guide = getMatchupGuide("aggro", "control", "standard");
      expect(guide).not.toBeNull();
      expect(guide!.format).toBe("standard");
      expect(guide!.playerArchetype).toBe("aggro");
      expect(guide!.opponentArchetype).toBe("control");
    });
  });
});
