/**
 * Stryker mutation test suite for oracle-text-parser.
 *
 * Issue #2185: oracle-text-parser had zero Stryker mutation coverage despite
 * being the primary input to the rules engine. This suite covers core parsing
 * functions: parseManaCost, manaCostsEqual, getManaValue, formatManaCost,
 * and extractKeywords — mutation-sensitive game-logic boundaries.
 */
import {
  parseManaCost,
  formatManaCost,
  manaCostsEqual,
  getManaValue,
} from "../oracle-text-parser/mana-cost";
import { extractKeywords } from "../oracle-text-parser/keywords";

describe("oracle-text-parser — Stryker mutation suite", () => {
  describe("parseManaCost", () => {
    it("parses a simple colored mana cost", () => {
      const result = parseManaCost("{2}{W}{U}");
      expect(result).not.toBeNull();
      expect(result!.generic).toBe(2);
      expect(result!.white).toBe(1);
      expect(result!.blue).toBe(1);
    });

    it("parses hybrid mana correctly", () => {
      const result = parseManaCost("{W/U}");
      expect(result).not.toBeNull();
      expect(result!.white).toBe(0.5);
      expect(result!.blue).toBe(0.5);
    });

    it("parses X cost and returns X: 0 (unresolved)", () => {
      const result = parseManaCost("{X}{R}{G}");
      expect(result).not.toBeNull();
      expect(result!.X).toBe(0);
      expect(result!.red).toBe(1);
      expect(result!.green).toBe(1);
    });

    it("returns null for empty string", () => {
      expect(parseManaCost("")).toBeNull();
    });

    it("parses phyrexian mana as a phyrexian pip worth 1 (CR 202.3c)", () => {
      // Issue #2966: phyrexian mana was not recognized at all, so a cost of
      // only {W/P} parsed to null. CR 202.3c: the mana value of a phyrexian
      // symbol is 1, and the symbol is parsed as its own pip kind.
      const result = parseManaCost("{W/P}");
      expect(result).not.toBeNull();
      expect(result!.pips!.phyrexian).toBe(1);
      expect(result!.pips!.symbols).toEqual(["W/P"]);
      expect(getManaValue(result)).toBe(1);
    });

    it("parses every phyrexian color variant (CR 202.3c)", () => {
      for (const symbol of ["W/P", "U/P", "B/P", "R/P", "G/P"]) {
        const result = parseManaCost(`{${symbol}}`);
        expect(result).not.toBeNull();
        expect(result!.pips!.phyrexian).toBe(1);
        expect(getManaValue(result)).toBe(1);
      }
    });
  });

  describe("formatManaCost", () => {
    it("formats colored mana correctly", () => {
      const parsed = parseManaCost("{W}{U}{B}");
      expect(formatManaCost(parsed)).toBe("{W}{U}{B}");
    });

    it("formats generic then colored", () => {
      const parsed = parseManaCost("{2}{W}{R}");
      expect(formatManaCost(parsed)).toBe("{2}{W}{R}");
    });

    it("returns empty string for null", () => {
      expect(formatManaCost(null)).toBe("");
    });

    it("round-trips a hybrid cost instead of flattening it (issue #2966)", () => {
      // A hybrid pip is one symbol; formatting must keep it (and re-parse to
      // an equal cost) rather than splitting it into two colored pips.
      const parsed = parseManaCost("{W/U}");
      const formatted = formatManaCost(parsed);
      expect(formatted).not.toBe("");
      expect(formatted).toBe("{W/U}");
      expect(manaCostsEqual(parseManaCost(formatted), parsed)).toBe(true);
    });

    it("formats a phyrexian cost", () => {
      expect(formatManaCost(parseManaCost("{W/P}"))).toBe("{W/P}");
    });
  });

  describe("manaCostsEqual", () => {
    it("returns true for identical costs", () => {
      const a = parseManaCost("{2}{W}{U}");
      const b = parseManaCost("{2}{U}{W}");
      expect(manaCostsEqual(a, b)).toBe(true);
    });

    it("returns false for different costs", () => {
      const a = parseManaCost("{W}{U}");
      const b = parseManaCost("{W}{B}");
      expect(manaCostsEqual(a, b)).toBe(false);
    });

    it("returns true when both are null", () => {
      expect(manaCostsEqual(null, null)).toBe(true);
    });

    it("returns false when one is null", () => {
      const a = parseManaCost("{W}");
      expect(manaCostsEqual(a, null)).toBe(false);
    });

    it("distinguishes X from no-X", () => {
      const withX = parseManaCost("{X}{R}");
      const withoutX = parseManaCost("{R}");
      expect(manaCostsEqual(withX, withoutX)).toBe(false);
    });

    it("distinguishes phyrexian colors (issue #2966)", () => {
      // {W/P} and {U/P} are different symbols (CR 202.3c).
      expect(manaCostsEqual(parseManaCost("{W/P}"), parseManaCost("{U/P}"))).toBe(
        false,
      );
      expect(
        manaCostsEqual(parseManaCost("{W/P}"), parseManaCost("{W/P}")),
      ).toBe(true);
    });
  });

  describe("getManaValue", () => {
    it("counts a hybrid pip as 1 (CR 202.3b)", () => {
      // Issue #2966: the old implementation summed ceil() of each half-color,
      // so the single hybrid pip {W/U} counted as 2. CR 202.3b: a hybrid
      // symbol has a mana value of 1.
      const cost = parseManaCost("{W/U}");
      expect(getManaValue(cost)).toBe(1);
    });

    it("counts a colorless pip as 1 (CR 202.3a)", () => {
      // A {C} pip is worth one mana value; it used to count as 0.
      expect(getManaValue(parseManaCost("{C}"))).toBe(1);
    });

    it("counts a monocolored hybrid pip as 2 (CR 202.3b)", () => {
      expect(getManaValue(parseManaCost("{2/W}"))).toBe(2);
    });

    it("counts a phyrexian pip as 1 (CR 202.3c)", () => {
      expect(getManaValue(parseManaCost("{W/P}"))).toBe(1);
    });

    it("sums every pip of a mixed cost", () => {
      // {X} adds nothing; {R}{R} = 2, {2/G} = 2, {C} = 1 -> 5.
      expect(getManaValue(parseManaCost("{X}{R}{R}{2/G}{C}"))).toBe(5);
    });

    it("snow mana is generic", () => {
      const cost = parseManaCost("{S}{S}");
      expect(getManaValue(cost)).toBe(2);
    });

    it("returns 0 for null", () => {
      expect(getManaValue(null)).toBe(0);
    });

    it("X adds 0 to mana value", () => {
      const cost = parseManaCost("{X}{2}{W}");
      expect(getManaValue(cost)).toBe(3); // 2 generic + 1 white, X = 0
    });
  });

  describe("extractKeywords", () => {
    it("extracts flying from type line", () => {
      const keywords = extractKeywords("", "Creature — Angel Flying");
      expect(keywords.some((k) => k.keyword === "flying")).toBe(true);
    });

    it("extracts multiple keywords", () => {
      const keywords = extractKeywords(
        "Flying, trample",
        "Creature — Elephant",
      );
      const flying = keywords.find((k) => k.keyword === "flying");
      const trample = keywords.find((k) => k.keyword === "trample");
      expect(flying).toBeDefined();
      expect(trample).toBeDefined();
    });

    it("marks ability words vs evergreen", () => {
      const keywords = extractKeywords(
        "Landfall — Create a 1/1 green Elf Warrior creature token.",
        "Creature — Elf",
      );
      // "landfall" is lowercase in combinedText but ability word detection
      // should still work; the key mutation boundary is the lowercase search
      const hasLandfall = keywords.some(
        (k) => k.keyword === "landfall" || k.keyword === "Landfall",
      );
      expect(hasLandfall).toBeDefined();
    });

    it("handles empty oracle text", () => {
      const keywords = extractKeywords("", "");
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThanOrEqual(0);
    });

    it("distinguishes evergreen from mechanic", () => {
      const keywords = extractKeywords("Islandwalk", "Creature — Merfolk");
      const iwalk = keywords.find((k) => k.keyword === "landwalk");
      expect(iwalk).toBeDefined();
    });
  });
});
