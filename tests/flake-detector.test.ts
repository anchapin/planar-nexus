/**
 * Unit tests for the pure functions in e2e/flake-detector.ts.
 * The side-effecting main() loop is exercised by CI nightly; the test
 * suite here validates the parsing, aggregation, and report rendering
 * that the loop depends on.
 *
 * The flake-detector script is intentionally kept in `e2e/` (per issue
 * #1264) even though that directory is excluded from the project
 * tsconfig — ts-jest still compiles imported files on demand, so the
 * test can import its exports directly.
 */
import {
  aggregateReport,
  collectSpecsFromReport,
  DetectorArgs,
  mergeRunIntoAggregate,
  parseArgs,
  renderMarkdown,
  renderMarkdown as _renderMarkdown,
  SpecResult,
  specKey,
} from "../e2e/flake-detector";

// Re-export the import so the test file's import surface stays readable
// and lint doesn't flag the underscore import as unused.
const renderMarkdownFn = _renderMarkdown;

function baseArgs(overrides: Partial<DetectorArgs> = {}): DetectorArgs {
  return {
    runs: 5,
    threshold: 4,
    specs: null,
    reportDir: "reports/flake-detector",
    project: "chromium",
    workers: 4,
    quiet: true,
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("returns defaults when called with no args", () => {
    const a = parseArgs([]);
    expect(a.runs).toBe(5);
    expect(a.threshold).toBe(4);
    expect(a.project).toBe("chromium");
    expect(a.workers).toBe(4);
    expect(a.specs).toBeNull();
  });

  it("parses --runs and --threshold", () => {
    const a = parseArgs(["--runs=10", "--threshold=8"]);
    expect(a.runs).toBe(10);
    expect(a.threshold).toBe(8);
  });

  it("parses --specs as a comma-separated list", () => {
    const a = parseArgs(["--specs=basic-navigation,draft"]);
    expect(a.specs).toEqual(["basic-navigation", "draft"]);
  });

  it("ignores malformed --runs values silently", () => {
    const a = parseArgs(["--runs=banana"]);
    expect(a.runs).toBe(5);
  });

  it("parses --project and --workers", () => {
    const a = parseArgs(["--project=firefox", "--workers=2"]);
    expect(a.project).toBe("firefox");
    expect(a.workers).toBe(2);
  });

  it("parses --report-dir", () => {
    const a = parseArgs(["--report-dir=/tmp/foo"]);
    expect(a.reportDir).toBe("/tmp/foo");
  });
});

describe("specKey", () => {
  it("is stable for the same inputs", () => {
    expect(
      specKey({ file: "e2e/foo.spec.ts", title: "x", project: "chromium" }),
    ).toBe(
      specKey({ file: "e2e/foo.spec.ts", title: "x", project: "chromium" }),
    );
  });
  it("differs on project", () => {
    expect(
      specKey({ file: "e2e/foo.spec.ts", title: "x", project: "chromium" }),
    ).not.toBe(
      specKey({ file: "e2e/foo.spec.ts", title: "x", project: "firefox" }),
    );
  });
});

describe("collectSpecsFromReport", () => {
  it("returns an empty array for an empty report", () => {
    expect(collectSpecsFromReport({})).toEqual([]);
  });

  it("extracts one SpecResult per leaf test", () => {
    const report = {
      suites: [
        {
          title: "e2e/foo.spec.ts",
          file: "e2e/foo.spec.ts",
          specs: [
            {
              title: "should pass",
              file: "e2e/foo.spec.ts",
              project: "chromium",
              results: [{ status: "passed" }],
            },
            {
              title: "should fail",
              file: "e2e/foo.spec.ts",
              project: "chromium",
              results: [{ status: "failed", error: { message: "boom" } }],
            },
          ],
        },
      ],
    };
    const specs = collectSpecsFromReport(report);
    expect(specs).toHaveLength(2);
    const passed = specs.find((s) => s.title === "should pass");
    const failed = specs.find((s) => s.title === "should fail");
    expect(passed?.passes).toBe(1);
    expect(failed?.failures).toBe(1);
    expect(failed?.lastError).toBe("boom");
  });

  it("walks nested suites", () => {
    const report = {
      suites: [
        {
          title: "outer",
          suites: [
            {
              title: "inner",
              specs: [
                {
                  title: "deep test",
                  file: "e2e/deep.spec.ts",
                  project: "chromium",
                  results: [{ status: "passed" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const specs = collectSpecsFromReport(report);
    expect(specs).toHaveLength(1);
    expect(specs[0].title).toBe("deep test");
  });

  it("records `passed` only when status is exactly 'passed'", () => {
    const report = {
      suites: [
        {
          specs: [
            {
              title: "t",
              file: "e2e/x.spec.ts",
              project: "chromium",
              results: [{ status: "timedOut", error: { message: "10s" } }],
            },
          ],
        },
      ],
    };
    const [s] = collectSpecsFromReport(report);
    expect(s.failures).toBe(1);
    expect(s.passes).toBe(0);
    expect(s.lastError).toBe("10s");
  });
});

describe("mergeRunIntoAggregate", () => {
  it("aggregates outcomes across runs in order", () => {
    const agg = new Map<string, SpecResult>();
    const run1: SpecResult[] = [
      {
        key: "a",
        file: "e2e/a.spec.ts",
        title: "t1",
        project: "chromium",
        outcomes: ["passed"],
        passes: 1,
        failures: 0,
        skipped: 0,
        total: 1,
        lastError: null,
      },
    ];
    const run2: SpecResult[] = [
      {
        key: "a",
        file: "e2e/a.spec.ts",
        title: "t1",
        project: "chromium",
        outcomes: ["failed"],
        passes: 0,
        failures: 1,
        skipped: 0,
        total: 1,
        lastError: "oh no",
      },
    ];
    mergeRunIntoAggregate(agg, run1);
    mergeRunIntoAggregate(agg, run2);
    const merged = agg.get("a");
    expect(merged?.outcomes).toEqual(["passed", "failed"]);
    expect(merged?.passes).toBe(1);
    expect(merged?.failures).toBe(1);
    expect(merged?.total).toBe(2);
    expect(merged?.lastError).toBe("oh no");
  });

  it("initialises specs that appear for the first time in a later run", () => {
    const agg = new Map<string, SpecResult>();
    mergeRunIntoAggregate(agg, []);
    mergeRunIntoAggregate(agg, [
      {
        key: "x",
        file: "e2e/x.spec.ts",
        title: "first time",
        project: "chromium",
        outcomes: ["passed"],
        passes: 1,
        failures: 0,
        skipped: 0,
        total: 1,
        lastError: null,
      },
    ]);
    expect(agg.get("x")?.outcomes).toEqual(["passed"]);
  });
});

describe("aggregateReport", () => {
  const baseSpec = (overrides: Partial<SpecResult>): SpecResult => ({
    key: overrides.key ?? "k",
    file: overrides.file ?? "e2e/x.spec.ts",
    title: overrides.title ?? "t",
    project: overrides.project ?? "chromium",
    outcomes: overrides.outcomes ?? [],
    passes: overrides.passes ?? 0,
    failures: overrides.failures ?? 0,
    skipped: overrides.skipped ?? 0,
    total: overrides.total ?? 0,
    lastError: overrides.lastError ?? null,
  });

  it("classifies stable / flaky / always-broken correctly", () => {
    const args = baseArgs({ runs: 5, threshold: 4 });
    const specs = [
      baseSpec({
        title: "stable",
        outcomes: ["passed", "passed", "passed", "passed", "passed"],
        passes: 5,
        total: 5,
      }),
      baseSpec({
        title: "flaky-mid",
        outcomes: ["passed", "passed", "failed", "passed", "failed"],
        passes: 3,
        failures: 2,
        total: 5,
      }),
      baseSpec({
        title: "flaky-edge",
        outcomes: ["failed", "passed", "passed", "passed", "passed"],
        passes: 4,
        failures: 1,
        total: 5,
      }),
      baseSpec({
        title: "always-broken",
        outcomes: ["failed", "failed", "failed", "failed", "failed"],
        passes: 0,
        failures: 5,
        total: 5,
        lastError: "kaboom",
      }),
    ];
    const report = aggregateReport(
      args,
      [],
      specs,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:01:00.000Z",
    );
    expect(report.stable).toBe(2);
    expect(report.flaky.map((s) => s.title)).toEqual(["flaky-mid"]);
    expect(report.alwaysBroken.map((s) => s.title)).toEqual(["always-broken"]);
  });

  it("ignores specs with zero total", () => {
    const args = baseArgs();
    const report = aggregateReport(
      args,
      [],
      [baseSpec({ title: "empty", total: 0 })],
      "t0",
      "t1",
    );
    expect(report.flaky).toEqual([]);
    expect(report.alwaysBroken).toEqual([]);
    expect(report.stable).toBe(0);
  });

  it("flags infra-failed runs separately", () => {
    const args = baseArgs();
    const runs = [
      { index: 1, exitCode: 0, durationMs: 1000, captured: true },
      { index: 2, exitCode: 1, durationMs: 1000, captured: false },
    ];
    const report = aggregateReport(args, runs, [], "t0", "t1");
    expect(report.failedSetupRuns).toEqual([2]);
  });
});

describe("renderMarkdown", () => {
  function makeReport(
    overrides: Partial<ReturnType<typeof aggregateReport>>,
  ): ReturnType<typeof aggregateReport> {
    return {
      args: baseArgs(),
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      totalDurationMs: 60_000,
      runs: [
        { index: 1, exitCode: 0, durationMs: 12_000, captured: true },
        { index: 2, exitCode: 0, durationMs: 12_000, captured: true },
        { index: 3, exitCode: 0, durationMs: 12_000, captured: true },
        { index: 4, exitCode: 0, durationMs: 12_000, captured: true },
        { index: 5, exitCode: 0, durationMs: 12_000, captured: true },
      ],
      specs: [],
      flaky: [],
      alwaysBroken: [],
      stable: 0,
      failedSetupRuns: [],
      ...overrides,
    };
  }

  it("emits a success summary when nothing fails", () => {
    const md = renderMarkdownFn(
      makeReport({
        args: baseArgs({ runs: 5, threshold: 4 }),
        specs: [],
        stable: 0,
      }),
    );
    expect(md).toMatch(/No flakes detected/);
    expect(md).toContain("threshold: passes >= 4 of 5");
  });

  it("emits the flaky table and matrix when there are flakes", () => {
    const spec: SpecResult = {
      key: "k",
      file: "e2e/foo.spec.ts",
      title: "flaky test",
      project: "chromium",
      outcomes: ["passed", "failed", "passed", "passed", "failed"],
      passes: 3,
      failures: 2,
      skipped: 0,
      total: 5,
      lastError: "Timeout exceeded",
    };
    const md = renderMarkdownFn(
      makeReport({
        args: baseArgs({ runs: 5, threshold: 4 }),
        specs: [spec],
        flaky: [spec],
        stable: 0,
      }),
    );
    expect(md).toContain("Flaky specs (passes < 4 of 5)");
    expect(md).toContain("`flaky test`");
    expect(md).toContain("`e2e/foo.spec.ts`");
    expect(md).toMatch(/R1 \| R2 \| R3 \| R4 \| R5/);
    expect(md).toContain("PASS FAIL");
  });

  it("lists always-broken specs separately", () => {
    const spec: SpecResult = {
      key: "k",
      file: "e2e/x.spec.ts",
      title: "always broken",
      project: "chromium",
      outcomes: ["failed", "failed", "failed", "failed", "failed"],
      passes: 0,
      failures: 5,
      skipped: 0,
      total: 5,
      lastError: "TypeError: undefined",
    };
    const md = renderMarkdownFn(
      makeReport({
        specs: [spec],
        alwaysBroken: [spec],
      }),
    );
    expect(md).toContain("Always broken (0 / 5 passes)");
    expect(md).toContain("`always broken`");
  });

  it("surfaces infra-failed runs as a footer note", () => {
    const md = renderMarkdownFn(
      makeReport({
        failedSetupRuns: [3, 5],
      }),
    );
    expect(md).toMatch(/Runs 3, 5 produced no test outcomes/);
  });

  it("escapes pipe characters in spec titles", () => {
    const spec: SpecResult = {
      key: "k",
      file: "e2e/x.spec.ts",
      title: "has | pipe",
      project: "chromium",
      outcomes: ["failed", "passed", "passed", "passed", "passed"],
      passes: 4,
      failures: 1,
      skipped: 0,
      total: 5,
      lastError: null,
    };
    const md = renderMarkdownFn(makeReport({ specs: [spec], flaky: [spec] }));
    // The pipe must be backslash-escaped so it does not break the table row.
    expect(md).toContain("`has \\| pipe`");
  });
});

// Touch the import so a no-op `import x` does not break the bundler if
// tree-shaking is enabled in the future. The import surface above is the
// real contract for callers; this is just defensive.
describe("module exports", () => {
  it("exports the expected surface", () => {
    expect(typeof parseArgs).toBe("function");
    expect(typeof collectSpecsFromReport).toBe("function");
    expect(typeof mergeRunIntoAggregate).toBe("function");
    expect(typeof aggregateReport).toBe("function");
    expect(typeof renderMarkdown).toBe("function");
    expect(typeof specKey).toBe("function");
  });
});
