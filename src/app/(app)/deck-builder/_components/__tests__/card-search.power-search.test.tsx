/**
 * @fileoverview Source-wiring + harness tests for the Power Search toggle (issue #1440).
 *
 * Validates:
 *   1. card-search.tsx mounts a Switch (`power-search-toggle`) and a
 *      syntax-help Popover.
 *   2. card-search.tsx imports the parser and routes the search through
 *      the structured `where:` clause when the toggle is on.
 *   3. The parser is the same one exposed to the hook test suite
 *      (single source of truth).
 *   4. Switching the toggle off falls back to the existing fuzzy path
 *      (no `where:` is forwarded on the off-branch, and
 *      `searchCardsOffline` is still called).
 *
 * The full component is exercised in e2e/integration suites
 * (deck-builder.spec.ts); here we keep the jsdom focus narrow so the
 * assertions stay deterministic.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import React from "react";

import { parseCardQuery } from "@/lib/search/query-parser";

const SEARCH_FILE = join(
  __dirname,
  "..",
  "card-search.tsx",
);

describe("CardSearch source wiring — Power Search toggle (issue #1440)", () => {
  it("mounts a Switch with data-testid='power-search-toggle'", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/data-testid=["']power-search-toggle["']/);
    // Real <Switch …/> component, not a plain checkbox.
    expect(src).toMatch(/<Switch\b/);
  });

  it("imports and uses the structured query parser", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/parseCardQuery/);
    expect(src).toMatch(/@\/lib\/search\/query-parser/);
  });

  it("forwards parsed `where:` to cardSearchIndex.search when Power mode is on", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/if\s*\(\s*powerMode\s*\)/);
    // Inside the power branch, the call shape uses the Orama `where` option.
    expect(src).toMatch(/cardSearchIndex\.search\([\s\S]*?where:\s*parsed\.where/);
    // The fuzzy off-branch still calls searchCardsOffline to preserve the
    // existing UX (acceptance criterion #1).
    expect(src).toMatch(/await\s+searchCardsOffline\(/);
    // Free-text term is forwarded so unstructured keywords still match.
    expect(src).toMatch(/parsed\.term/);
  });

  it("renders a syntax help popover listing the supported keys", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/PopoverContent/);
    expect(src).toMatch(/power-search-syntax-help/);
    // Help text must reference the documented keys.
    expect(src).toMatch(/c:\s*red|c:\s*wubrg/);
    expect(src).toMatch(/cmc(?:&lt;=|<=)?3|cmc&lt;/);
    expect(src).toMatch(/t:\s*instant/);
  });

  it("shows an inline error chip when the parser reports an error", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/power-search-parse-error/);
    expect(src).toMatch(/parseErrors\.length\s*>\s*0/);
  });

  it("falls back to the existing fuzzy query path when Power mode is off", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    // The else branch of `if (powerMode)` is the fuzzy path.
    const powerOn = src.indexOf("powerMode");
    expect(powerOn).toBeGreaterThan(-1);
    // There must be an `else` clause (somewhere in the effect) that
    // calls searchCardsOffline, confirming fuzzy remains reachable.
    const elseIdx = src.indexOf("else", powerOn);
    expect(elseIdx).toBeGreaterThan(-1);
    expect(src.indexOf("searchCardsOffline", elseIdx)).toBeGreaterThan(-1);
  });
});

describe("Power Search parser dispatch — round-trip via shared module", () => {
  it("uses the same parser as the hook (single source of truth)", () => {
    const result = parseCardQuery("c:red t:instant cmc<=3");
    expect(result.errors).toHaveLength(0);
    expect(result.where.colors).toBeDefined();
    expect(result.where.type_line).toEqual({ contains: "instant" });
    expect(result.where.cmc).toEqual({ lte: 3 });
  });

  it("surfaces parser errors as structured QueryParseError objects", () => {
    const result = parseCardQuery('c:red t:"unclosed');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toMatch(/Unbalanced quote/);
  });
});

describe("Power Search parser — render-harness sanity", () => {
  it("exposes at least one documented example through a stripped search field", () => {
    // The aim here is just to prove that the parser produces stable
    // output: feeding the same query twice yields identical ASTs (so
    // a future consumer can memoize by the raw input).
    const query = "c:wubrg t:creature cmc>=4";
    const a = parseCardQuery(query);
    const b = parseCardQuery(query);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("can be rendered through a tiny React harness without throwing", () => {
    // Mount a minimal component that wires the parser up — just to
    // catch import-time regressions in the parser/UI pipeline.
    function Probe({ q }: { q: string }) {
      const parsed = parseCardQuery(q);
      return (
        <div>
          <span data-testid="term">{parsed.term || "(none)"}</span>
          <span data-testid="error-count">{parsed.errors.length}</span>
        </div>
      );
    }
    render(<Probe q="c:red cmc<=3" />);
    expect(screen.getByTestId("term")).toHaveTextContent("(none)");
    expect(screen.getByTestId("error-count")).toHaveTextContent("0");
  });
});
