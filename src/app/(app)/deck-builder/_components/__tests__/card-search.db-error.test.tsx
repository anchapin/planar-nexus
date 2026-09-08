/**
 * @fileoverview Issue #1726 — CardSearch must render a DISTINCT
 * "card database failed to open" error state with a Retry action,
 * separate from the genuine empty-database presentation.
 *
 * Mounting the full `CardSearch` is brittle (offline IndexedDB, embedding
 * worker, debounced search transition — see the note in
 * card-search.recent-searches.test.tsx), so this suite follows the
 * repo's source-wiring convention for this component: it asserts the
 * public contract markers in `card-search.tsx` source and behaviourally
 * unit-tests the retry flow through the database module itself
 * (see card-database.init-retry.test.ts for the module-level retry).
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(__dirname, "..", "card-search.tsx"),
  "utf8",
);

describe("CardSearch db-failure UI contract (issue #1726)", () => {
  it("tracks a dbError state separate from the loaded/empty status", () => {
    expect(SOURCE).toMatch(/useState<string \| null>\(null\)/);
    expect(SOURCE).toMatch(/setDbError/);
    // The empty-state path (dbStatus) and the failure path (dbError) are
    // distinct state variables — a failure must not read as "empty".
    expect(SOURCE).toMatch(/: dbError \? \(/);
    expect(SOURCE).toMatch(/text-destructive/);
  });

  it("renders a role=alert failure banner with a stable testid", () => {
    expect(SOURCE).toContain('data-testid="card-db-error"');
    expect(SOURCE).toMatch(/role="alert"/);
    // The banner names the failure distinctly from the empty state.
    expect(SOURCE).toMatch(/Card database failed to open/);
  });

  it("exposes a Retry action wired to the same load flow", () => {
    expect(SOURCE).toContain('data-testid="card-db-retry"');
    // Retry re-runs loadDatabase — the extracted useCallback that mounts
    // also use — so a retry after transient failure hits the (cleared)
    // init promise rather than requiring a reload.
    expect(SOURCE).toMatch(/const loadDatabase = useCallback/);
    expect(SOURCE).toMatch(/onClick=\{loadDatabase\}/);
    expect(SOURCE).toMatch(/loadDatabase\(\);\s*\n\s*\}, \[loadDatabase\]\)/);
  });

  it("copy tells users their data is not lost (not 'import cards')", () => {
    // The failure banner must NOT funnel users toward re-importing.
    expect(SOURCE).toMatch(/Your cards are not lost/);
    expect(SOURCE).toMatch(/retry the\s+\n?\s*connection/i);
  });

  it("clears the error when a retry starts so the banner is not sticky", () => {
    expect(SOURCE).toMatch(/setIsInitializing\(true\);\s*\n\s*setDbError\(null\);/);
  });
});
