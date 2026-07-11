import {
  parseCardQuery,
  compileWhere,
  stringifyParsed,
  MAX_QUERY_LENGTH,
  type QueryToken,
} from "../query-parser";

/**
 * Unit tests for the Scryfall-style structured query parser.
 *
 * Issue #1440. Each assertion exercises a documented key/operator or a
 * known failure mode; the test file contributes ≥30 assertions toward the
 * acceptance criterion of "Unit tests ≥ 30 assertions".
 */
describe("query-parser (issue #1440)", () => {
  describe("color keys (c:)", () => {
    it("parses a single-letter color include", () => {
      const result = parseCardQuery("c:red");
      expect(result.errors).toHaveLength(0);
      expect(result.where.colors).toBeDefined();
      expect(result.term).toBe("");
    });

    it("expands a multi-letter color shorthand (wubrg)", () => {
      const result = parseCardQuery("c:wubrg");
      const colorClause = result.where.colors as
        | { contains: string | string[] }
        | string
        | undefined;
      expect(colorClause).toBeDefined();
      // The shorthand is expanded; Orama receives an OR-array under
      // `colors.contains` so any-of matches.
      const values = Array.isArray((colorClause as { contains: unknown })?.contains)
        ? ((colorClause as { contains: string[] }).contains)
        : [(colorClause as { contains: string })?.contains];
      expect(values).toEqual(expect.arrayContaining(["W", "U", "B", "R", "G"]));
    });

    it("dedupes duplicate colors", () => {
      const result = parseCardQuery("c:rr");
      const colorClause = result.where.colors as
        | { contains: string | string[] }
        | string
        | undefined;
      const values = Array.isArray((colorClause as { contains: unknown })?.contains)
        ? ((colorClause as { contains: string[] }).contains)
        : [(colorClause as string | { contains: string })?.toString()];
      // Single dedup'd R should appear in the OR-array (or as a direct
      // string for the single-letter case).
      const flat = values.flat().filter(Boolean) as string[];
      expect(flat).toEqual(["R"]);
      expect(flat.length).toBe(1);
    });

    it("lowercases color letters", () => {
      const result = parseCardQuery("c:RGB");
      const colorClause = result.where.colors as
        | { contains: string | string[] }
        | string
        | undefined;
      const values = Array.isArray((colorClause as { contains: unknown })?.contains)
        ? ((colorClause as { contains: string[] }).contains)
        : [(colorClause as string | { contains: string })?.toString()];
      const flat = values.flat().filter(Boolean) as string[];
      expect(flat).toEqual(expect.arrayContaining(["R", "G", "B"]));
    });

    it("emits an error when the color spec has no pip letters", () => {
      const result = parseCardQuery("c:zzz");
      expect(result.errors.some((e) => /Unknown color spec/.test(e.message))).toBe(true);
    });

    it("emits an error when the color value is empty", () => {
      const result = parseCardQuery("c:");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("type keys (t:)", () => {
    it("parses a single-word type as a substring match", () => {
      const result = parseCardQuery("t:instant");
      expect(result.where.type_line).toEqual({ contains: "instant" });
    });

    it("ORs multi-comma types via an `or:` block", () => {
      const result = parseCardQuery("t:instant,sorcery");
      expect(result.errors).toHaveLength(0);
      // Multi-type uses Orama's `or:` envelope with one clause per type.
      const orBlock = (result.where as { or?: Array<Record<string, unknown>> })
        .or;
      expect(Array.isArray(orBlock)).toBe(true);
      const types = orBlock?.map((c) =>
        (c.type_line as { contains: string }).contains,
      );
      expect(types).toEqual(expect.arrayContaining(["instant", "sorcery"]));
    });

    it("lowercases type tokens", () => {
      const result = parseCardQuery("t:CREATURE");
      expect(result.where.type_line).toEqual({ contains: "creature" });
    });

    it("emits an error when the type value is empty", () => {
      const result = parseCardQuery("t:");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("CMC keys (cmc / mv)", () => {
    it.each([
      ["cmc=3", "eq", 3],
      ["cmc<=3", "lte", 3],
      ["cmc<3", "lt", 3],
      ["cmc>3", "gt", 3],
      ["cmc>=3", "gte", 3],
      ["cmc!=3", "neq", 3],
    ])("parses %s as a numeric CMC filter", (input, op, value) => {
      const result = parseCardQuery(input);
      const cmcClause = result.where.cmc as
        | Record<string, unknown>
        | undefined;
      expect(cmcClause).toBeDefined();
      expect(cmcClause?.[op]).toBe(value);
    });

    it("accepts the mv: alias", () => {
      const result = parseCardQuery("mv:4");
      const cmcClause = result.where.cmc as Record<string, unknown> | undefined;
      expect(cmcClause?.eq).toBe(4);
    });

    it("emits an error when cmc value is not a number", () => {
      const result = parseCardQuery("cmc=ten");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("combines multiple CMC tokens via AND block", () => {
      const result = parseCardQuery("cmc<=2 cmc>=4");
      expect(result.errors).toHaveLength(0);
      // Two CMC clauses OR'd inside an `and:` envelope — every clause
      // must match.
      expect(Array.isArray((result.where as { and?: unknown[] }).and)).toBe(
        true,
      );
    });
  });

  describe("rarity and set keys (r:, s:)", () => {
    it("flags rarity with a parse error since the index has no rarity field", () => {
      const result = parseCardQuery("r:rare");
      // The card-search index doesn't carry rarity, so the parser surfaces
      // an info-level error rather than silently dropping the term.
      expect(result.errors.some((e) => /rarity field/.test(e.message))).toBe(true);
    });

    it("compiles a set code as a contains clause", () => {
      const result = parseCardQuery("s:mh2");
      expect(result.where.set).toEqual({ contains: "mh2" });
    });
  });

  describe("free text", () => {
    it("combines unrecognised tokens into the fuzzy term", () => {
      const result = parseCardQuery("lightning bolt");
      expect(result.term).toBe("lightning bolt");
      expect(result.where).toEqual({});
    });

    it("preserves quoted strings verbatim", () => {
      const result = parseCardQuery('"forced strand"');
      expect(result.term).toBe('"forced strand"');
    });

    it("combines structured keys with free text", () => {
      const result = parseCardQuery("c:red lightning");
      expect(result.where.colors).toBeDefined();
      expect(result.term).toBe("lightning");
    });
  });

  describe("combined queries", () => {
    it("parses the documented example: c:red t:instant cmc<=3", () => {
      const result = parseCardQuery("c:red t:instant cmc<=3");
      expect(result.errors).toHaveLength(0);
      expect(result.where.colors).toBeDefined();
      expect(result.where.type_line).toEqual({ contains: "instant" });
      expect(result.where.cmc).toEqual({ lte: 3 });
    });

    it("parses a multi-condition power-query", () => {
      const result = parseCardQuery("c:r t:creature cmc>=4");
      expect(result.errors).toHaveLength(0);
      expect(result.where.colors).toBeDefined();
      expect(result.where.type_line).toEqual({ contains: "creature" });
      expect(result.where.cmc).toEqual({ gte: 4 });
    });
  });

  describe("failure modes", () => {
    it("reports unbalanced quotes as a parse error", () => {
      const result = parseCardQuery('c:red t:"unclosed');
      expect(result.errors.some((e) => /Unbalanced quote/.test(e.message))).toBe(true);
    });

    it("truncates queries longer than MAX_QUERY_LENGTH and reports it", () => {
      const long = "c:red ".repeat(60);
      expect(long.length).toBeGreaterThan(MAX_QUERY_LENGTH);
      const result = parseCardQuery(long);
      expect(result.errors.some((e) => /truncated/i.test(e.message))).toBe(true);
      expect(result.errors[0]?.message).toMatch(/200/);
    });

    it("treats unknown keys as free text instead of silently dropping them", () => {
      const result = parseCardQuery("banana:cake");
      expect(result.term).toBe("banana:cake");
      expect(result.where).toEqual({});
    });

    it("emits no errors for an empty query", () => {
      const result = parseCardQuery("");
      expect(result.errors).toHaveLength(0);
      expect(result.where).toEqual({});
      expect(result.term).toBe("");
    });

    it("emits no errors for whitespace-only input", () => {
      const result = parseCardQuery("   ");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("compileWhere direct API", () => {
    it("compiles a token array independently of parseCardQuery", () => {
      const tokens: QueryToken[] = [
        { kind: "color-include", raw: "c:red", colors: ["R"] },
        { kind: "type-include", raw: "t:instant", types: ["instant"] },
        { kind: "cmc", raw: "cmc<=3", op: "lte", value: 3 },
      ];
      const errors = [] as Parameters<typeof compileWhere>[1];
      const where = compileWhere(tokens, errors, "c:red t:instant cmc<=3");
      expect(where.colors).toBeDefined();
      expect(where.type_line).toEqual({ contains: "instant" });
      expect(where.cmc).toEqual({ lte: 3 });
      expect(errors).toHaveLength(0);
    });
  });

  describe("round-trip stringification", () => {
    it("joins tokens back into the original Scryfall-like form", () => {
      const result = parseCardQuery("c:red t:instant cmc<=3");
      expect(stringifyParsed(result)).toBe("c:red t:instant cmc<=3");
    });
  });
});
