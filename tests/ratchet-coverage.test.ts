/**
 * Unit tests for scripts/ratchet-coverage.js (issue #1099).
 *
 * The ratchet is a build/dev tool (plain CommonJS, no runtime deps), so these
 * tests exercise its pure helpers directly rather than spawning a process.
 * Focus: floor math (monotonic, never lowers), regression detection,
 * idempotency, and byte-stable formatting of jest.config.js.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  computeFloors,
  applyRatchet,
  readCurrentValues,
  applyFloorsToDocBlock,
  syncCoverageDocTables,
} from "../scripts/ratchet-coverage";

type Metrics = {
  branches: number;
  functions: number;
  lines: number;
  statements: number;
};

const MEASURED: Metrics = {
  branches: 25.58,
  functions: 26.99,
  lines: 33.19,
  statements: 32.86,
};

const CURRENT: Metrics = {
  branches: 22,
  functions: 23,
  lines: 29,
  statements: 29,
};

// Mirrors the real jest.config.js layout so the indent detection is realistic.
const SAMPLE_CONFIG = `/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  coverageThreshold: {
    global: {
      branches: 22,
      functions: 23,
      lines: 29,
      statements: 29,
    },
  },
  coverageReporters: ["text-summary", "lcov", "html", "json-summary"],
};
`;

describe("ratchet-coverage computeFloors", () => {
  it("bumps each floor to floor(measured - margin)", () => {
    const { floors, bumps, regressions } = computeFloors(MEASURED, CURRENT, 1);
    expect(regressions).toHaveLength(0);
    expect(floors).toEqual({
      branches: 24,
      functions: 25,
      lines: 32,
      statements: 31,
    });
    expect(bumps).toHaveLength(4);
    expect(bumps.map((b: { metric: string }) => b.metric).sort()).toEqual([
      "branches",
      "functions",
      "lines",
      "statements",
    ]);
  });

  it("is monotonic: never lowers a floor below the current value", () => {
    // measured just above current, so floor(measured - margin) would dip below
    // current — the ratchet must keep the current floor instead.
    const measured: Metrics = {
      branches: 22.4,
      functions: 23.3,
      lines: 29.5,
      statements: 29.2,
    };
    const { floors, bumps, regressions } = computeFloors(measured, CURRENT, 1);
    expect(regressions).toHaveLength(0);
    expect(floors).toEqual(CURRENT);
    expect(bumps).toHaveLength(0);
  });

  it("flags regressions when measured < current and does not lower the floor", () => {
    const measured: Metrics = {
      branches: 21,
      functions: 26.99,
      lines: 33.19,
      statements: 32.86,
    };
    const { floors, regressions, bumps } = computeFloors(measured, CURRENT, 1);
    expect(regressions.map((r: { metric: string }) => r.metric)).toEqual([
      "branches",
    ]);
    expect(floors.branches).toBe(22); // unchanged, not lowered
    // other metrics still computed normally
    expect(bumps.map((b: { metric: string }) => b.metric).sort()).toEqual([
      "functions",
      "lines",
      "statements",
    ]);
  });

  it("honours a custom margin", () => {
    const { floors } = computeFloors(MEASURED, CURRENT, 2);
    // branches: floor(25.58 - 2) = 23, functions: floor(26.99 - 2) = 24,
    // lines: floor(33.19 - 2) = 31, statements: floor(32.86 - 2) = 30
    expect(floors).toEqual({
      branches: 23,
      functions: 24,
      lines: 31,
      statements: 30,
    });
  });
});

describe("ratchet-coverage readCurrentValues", () => {
  it("parses the four thresholds out of the global block body", () => {
    const inner = `
      branches: 22,
      functions: 23,
      lines: 29,
      statements: 29,
    `;
    expect(readCurrentValues(inner)).toEqual(CURRENT);
  });
});

describe("ratchet-coverage applyRatchet", () => {
  it("rewrites the threshold block on a bump", () => {
    const res = applyRatchet(SAMPLE_CONFIG, MEASURED, 1);
    expect(res.kind).toBe("bump");
    expect(res.nextSource).not.toBeNull();
    expect(res.nextSource).toContain("branches: 24,");
    expect(res.nextSource).toContain("functions: 25,");
    expect(res.nextSource).toContain("lines: 32,");
    expect(res.nextSource).toContain("statements: 31,");
  });

  it("is idempotent: re-running on the rewritten config is a no-op", () => {
    const first = applyRatchet(SAMPLE_CONFIG, MEASURED, 1);
    if (!first.nextSource) throw new Error("expected a bump on first run");
    const second = applyRatchet(first.nextSource, MEASURED, 1);
    expect(second.kind).toBe("noop");
    // Byte-stable: applying again produces an identical string.
    expect(second.nextSource).toBe(first.nextSource);
  });

  it("leaves the surrounding config untouched (only threshold numbers change)", () => {
    const res = applyRatchet(SAMPLE_CONFIG, MEASURED, 1);
    if (!res.nextSource) throw new Error("expected a bump");
    const normalize = (s: string) =>
      s.replace(/(branches|functions|lines|statements): \d+,/g, "X");
    expect(normalize(res.nextSource)).toBe(normalize(SAMPLE_CONFIG));
    // structural anchors still present
    expect(res.nextSource).toContain('preset: "ts-jest"');
    expect(res.nextSource).toContain('"json-summary"]');
    expect(res.nextSource.trim().endsWith("};")).toBe(true);
  });

  it("reports a regression and does not modify the config", () => {
    const regressed: Metrics = {
      branches: 21,
      functions: 26.99,
      lines: 33.19,
      statements: 32.86,
    };
    const res = applyRatchet(SAMPLE_CONFIG, regressed, 1);
    expect(res.kind).toBe("regression");
    expect(res.nextSource).toBeNull();
    expect(res.regressions.map((r: { metric: string }) => r.metric)).toEqual([
      "branches",
    ]);
  });

  it("throws when the threshold block is absent", () => {
    const broken = "module.exports = { preset: 'ts-jest' };\n";
    expect(() => applyRatchet(broken, MEASURED, 1)).toThrow(
      /coverageThreshold\.global/,
    );
  });
});

// ---------------------------------------------------------------------------
// Doc-table sync (issue #1712)
// ---------------------------------------------------------------------------

const DOC_BLOCK = [
  "<!-- coverage-floor:start -->",
  "| Metric     | Target | CI-enforced floor |",
  "| ---------- | ------ | ----------------- |",
  "| Lines      | 70%    | 29%               |",
  "| Functions  | 70%    | 23%               |",
  "| Statements | 70%    | 29%               |",
  "| Branches   | 60%    | 22%               |",
  "<!-- coverage-floor:end -->",
].join("\n");

const BUMPED_FLOORS = {
  branches: 52,
  functions: 52,
  lines: 60,
  statements: 59,
};

describe("ratchet-coverage applyFloorsToDocBlock", () => {
  it("rewrites only the floor column of metric rows", () => {
    const out = applyFloorsToDocBlock(DOC_BLOCK, BUMPED_FLOORS);
    expect(out).toContain("| Lines      | 70%    | 60%               |");
    expect(out).toContain("| Functions  | 70%    | 52%               |");
    expect(out).toContain("| Statements | 70%    | 59%               |");
    expect(out).toContain("| Branches   | 60%    | 52%               |");
    // anchors, headers, and target column untouched
    expect(out).toContain("<!-- coverage-floor:start -->");
    expect(out).toContain("| Metric     | Target | CI-enforced floor |");
  });

  it("keeps the rendered row width stable when the digit count grows", () => {
    const floors = { ...BUMPED_FLOORS, lines: 100 };
    const out = applyFloorsToDocBlock(DOC_BLOCK, floors);
    const row = out.split("\n").find((l: string) => l.includes("| Lines"));
    expect(row).toBe("| Lines      | 70%    | 100%              |");
    expect(row).toHaveLength(DOC_BLOCK.split("\n")[3].length);
  });

  it("is idempotent: applying the same floors twice changes nothing", () => {
    const once = applyFloorsToDocBlock(DOC_BLOCK, BUMPED_FLOORS);
    expect(applyFloorsToDocBlock(once, BUMPED_FLOORS)).toBe(once);
  });
});

describe("ratchet-coverage syncCoverageDocTables", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ratchet-docs-"));

  function writeDoc(name: string, content: string): string {
    const p = path.join(tmp, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf-8");
    return p;
  }

  it("updates anchored docs, skips in-sync/unanchored/missing ones", () => {
    const stale = writeDoc("stale.md", DOC_BLOCK + "\n");
    const fresh = applyFloorsToDocBlock(DOC_BLOCK, BUMPED_FLOORS);
    const inSync = writeDoc("in-sync.md", fresh);
    const noAnchors = writeDoc(
      "no-anchors.md",
      "| Metric | Floor |\n| ------ | ----- |\n| Lines  | 1%    |\n",
    );
    const missing = path.join(tmp, "does-not-exist.md");

    const results = syncCoverageDocTables(BUMPED_FLOORS, [
      stale,
      inSync,
      noAnchors,
      missing,
    ]);

    expect(results).toEqual([
      { docPath: stale, status: "updated" },
      { docPath: inSync, status: "in-sync" },
      { docPath: noAnchors, status: "unanchored" },
      { docPath: missing, status: "missing" },
    ]);
    expect(fs.readFileSync(stale, "utf-8")).toBe(fresh + "\n");
    expect(fs.readFileSync(inSync, "utf-8")).toBe(fresh);
    // second run over the updated doc is a no-op
    const second = syncCoverageDocTables(BUMPED_FLOORS, [stale]);
    expect(second).toEqual([{ docPath: stale, status: "in-sync" }]);
  });
});
