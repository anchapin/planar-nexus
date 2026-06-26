/**
 * Unit tests for scripts/ratchet-coverage.js (issue #1099).
 *
 * The ratchet is a build/dev tool (plain CommonJS, no runtime deps), so these
 * tests exercise its pure helpers directly rather than spawning a process.
 * Focus: floor math (monotonic, never lowers), regression detection,
 * idempotency, and byte-stable formatting of jest.config.js.
 */

import {
  computeFloors,
  applyRatchet,
  readCurrentValues,
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
