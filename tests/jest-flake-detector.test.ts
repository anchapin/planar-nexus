/**
 * Unit tests for the pure functions in scripts/jest-flake-detector.ts.
 * The side-effecting main() loop is exercised by the nightly CI job; the
 * test suite here validates the parsing, aggregation, and report rendering
 * that the loop depends on (mirrors tests/flake-detector.test.ts, #1264).
 *
 * The detector script is TypeScript run via tsx; ts-jest compiles imported
 * files on demand, so the test can import its exports directly.
 */
import {
  aggregateReport,
  collectTestsFromJestJson,
  DetectorArgs,
  mergeRunIntoAggregate,
  parseArgs,
  renderMarkdown,
  SpecResult,
  specKey,
} from "../scripts/jest-flake-detector";

function baseArgs(overrides: Partial<DetectorArgs> = {}): DetectorArgs {
  return {
    runs: 5,
    threshold: 4,
    testPathPattern: null,
    reportDir: "reports/jest-flake-detector",
    workers: 2,
    runTimeoutMin: 45,
    randomize: true,
    quiet: true,
    ...overrides,
  };
}

function jestReportFixture(): Parameters<typeof collectTestsFromJestJson>[0] {
  // Suite paths must start with the REAL process.cwd() to exercise the
  // cwd-stripping in collectTestsFromJestJson (jest reports absolute
  // suite paths).
  const cwd = process.cwd();
  return {
    success: false,
    testResults: [
      {
        name: `${cwd}/src/lib/game-state/__tests__/layer-system.test.ts`,
        status: "passed",
        assertionResults: [
          {
            status: "passed",
            fullName: "Layer System should apply effects in order",
            title: "should apply effects in order",
            failureMessages: [],
          },
          {
            status: "failed",
            fullName: "Layer System should stack counters",
            title: "should stack counters",
            failureMessages: ["Error: expected 2, got 1"],
          },
        ],
      },
      {
        // A suite that failed to even run (e.g. compile error) — must
        // surface as a synthetic spec, not be dropped (#1719).
        name: `${cwd}/src/lib/__tests__/broken.test.ts`,
        status: "failed",
        message: "TS2322: type error",
        assertionResults: [],
      },
      {
        name: `${cwd}/src/lib/__tests__/skips.test.ts`,
        status: "passed",
        assertionResults: [
          {
            status: "pending",
            fullName: "skips suite is todo",
            title: "is todo",
            failureMessages: [],
          },
        ],
      },
      {
        // Absolute path OUTSIDE cwd must pass through unchanged.
        name: "/outside-repo/vendored.test.ts",
        status: "passed",
        assertionResults: [
          {
            status: "passed",
            fullName: "vendored still runs",
            title: "still runs",
            failureMessages: [],
          },
        ],
      },
    ],
  };
}

describe("parseArgs", () => {
  it("returns defaults when called with no args", () => {
    const a = parseArgs([]);
    expect(a.runs).toBe(5);
    expect(a.threshold).toBe(4);
    expect(a.workers).toBe(2);
    expect(a.runTimeoutMin).toBe(45);
    expect(a.randomize).toBe(true);
    expect(a.testPathPattern).toBeNull();
    expect(a.reportDir).toBe("reports/jest-flake-detector");
  });

  it("parses --runs and --threshold", () => {
    const a = parseArgs(["--runs=3", "--threshold=2"]);
    expect(a.runs).toBe(3);
    expect(a.threshold).toBe(2);
  });

  it("parses --testPathPattern, --workers and --run-timeout-min", () => {
    const a = parseArgs([
      "--testPathPattern=layer-system",
      "--workers=4",
      "--run-timeout-min=10",
    ]);
    expect(a.testPathPattern).toBe("layer-system");
    expect(a.workers).toBe(4);
    expect(a.runTimeoutMin).toBe(10);
  });

  it("parses --no-randomize and --report-dir", () => {
    const a = parseArgs(["--no-randomize", "--report-dir=/tmp/x"]);
    expect(a.randomize).toBe(false);
    expect(a.reportDir).toBe("/tmp/x");
  });

  it("ignores malformed numeric values", () => {
    const a = parseArgs(["--runs=zero", "--threshold=-1"]);
    // runs stays 5, so the derived threshold is 5 - 1 = 4.
    expect(a.runs).toBe(5);
    expect(a.threshold).toBe(4);
  });

  it("derives the default threshold as runs - 1", () => {
    expect(parseArgs(["--runs=3"]).threshold).toBe(2);
    expect(parseArgs(["--runs=5"]).threshold).toBe(4);
    // A single run cannot tolerate any failure.
    expect(parseArgs(["--runs=1"]).threshold).toBe(1);
  });

  it("keeps an explicit threshold but clamps it to the run count", () => {
    expect(parseArgs(["--runs=5", "--threshold=3"]).threshold).toBe(3);
    expect(parseArgs(["--runs=2", "--threshold=9"]).threshold).toBe(2);
  });
});

describe("specKey", () => {
  it("joins file and title with ::", () => {
    expect(specKey({ file: "a.test.ts", title: "does x" })).toBe(
      "a.test.ts::does x",
    );
  });
});

describe("collectTestsFromJestJson", () => {
  it("collects one row per assertion keyed by fullName with pass/fail counts", () => {
    const specs = collectTestsFromJestJson(jestReportFixture());
    const stacked = specs.find(
      (s) => s.title === "Layer System should stack counters",
    );
    expect(stacked).toBeDefined();
    expect(stacked?.passes).toBe(0);
    expect(stacked?.failures).toBe(1);
    expect(stacked?.lastError).toContain("expected 2, got 1");
    const ordered = specs.find(
      (s) => s.title === "Layer System should apply effects in order",
    );
    expect(ordered?.passes).toBe(1);
  });

  it("records a suite that failed to run as a synthetic failing spec", () => {
    const specs = collectTestsFromJestJson(jestReportFixture());
    const suiteErr = specs.find((s) => s.title === "(suite failed to run)");
    expect(suiteErr).toBeDefined();
    expect(suiteErr?.file).toContain("broken.test.ts");
    expect(suiteErr?.failures).toBe(1);
    expect(suiteErr?.lastError).toContain("TS2322");
  });

  it("counts pending/todo assertions as skipped, not failed", () => {
    const specs = collectTestsFromJestJson(jestReportFixture());
    const todo = specs.find((s) => s.title === "skips suite is todo");
    expect(todo?.skipped).toBe(1);
    expect(todo?.failures).toBe(0);
  });

  it("strips the process cwd prefix from suite paths", () => {
    const specs = collectTestsFromJestJson(jestReportFixture());
    expect(specs[0]?.file).toBe(
      "src/lib/game-state/__tests__/layer-system.test.ts",
    );
    // Absolute paths outside cwd pass through unchanged.
    const vendored = specs.find((s) => s.title === "vendored still runs");
    expect(vendored?.file).toBe("/outside-repo/vendored.test.ts");
  });

  it("returns an empty list for an empty report", () => {
    expect(collectTestsFromJestJson({ testResults: [] })).toEqual([]);
  });
});

describe("mergeRunIntoAggregate", () => {
  it("accumulates outcomes across runs keyed by spec key", () => {
    const aggregate = new Map<string, SpecResult>();
    const mk = (
      title: string,
      status: SpecResult["outcomes"][number],
    ): SpecResult => ({
      key: `a.test.ts::${title}`,
      file: "a.test.ts",
      title,
      outcomes: [status],
      passes: status === "passed" ? 1 : 0,
      failures: status === "failed" ? 1 : 0,
      skipped: status === "skipped" ? 1 : 0,
      total: 1,
      lastError: status === "failed" ? "boom" : null,
    });
    mergeRunIntoAggregate(aggregate, [mk("t", "passed")]);
    mergeRunIntoAggregate(aggregate, [mk("t", "failed")]);
    mergeRunIntoAggregate(aggregate, [mk("t", "passed")]);
    const acc = aggregate.get("a.test.ts::t");
    expect(acc?.total).toBe(3);
    expect(acc?.passes).toBe(2);
    expect(acc?.failures).toBe(1);
    expect(acc?.outcomes).toEqual(["passed", "failed", "passed"]);
    expect(acc?.lastError).toBe("boom");
  });
});

describe("aggregateReport", () => {
  const mkSpec = (
    title: string,
    outcomes: SpecResult["outcomes"],
  ): SpecResult => {
    const passes = outcomes.filter((o) => o === "passed").length;
    const failures = outcomes.filter((o) => o === "failed").length;
    const skipped = outcomes.filter((o) => o === "skipped").length;
    return {
      key: `f.test.ts::${title}`,
      file: "f.test.ts",
      title,
      outcomes,
      passes,
      failures,
      skipped,
      total: outcomes.length,
      lastError: failures > 0 ? "err" : null,
    };
  };

  it("buckets specs into stable / flaky / always broken at the threshold", () => {
    const args = baseArgs({ runs: 5, threshold: 4 });
    const specs = [
      mkSpec("stable", ["passed", "passed", "passed", "passed", "passed"]),
      mkSpec("flaky", ["passed", "failed", "passed", "passed", "failed"]),
      mkSpec("broken", ["failed", "failed", "failed", "failed", "failed"]),
    ];
    const agg = aggregateReport(args, [], specs, "t0", "t1");
    expect(agg.stable).toBe(1);
    expect(agg.flaky.map((s) => s.title)).toEqual(["flaky"]);
    expect(agg.alwaysBroken.map((s) => s.title)).toEqual(["broken"]);
  });

  it("marks runs without captured outcomes as failed setup runs", () => {
    const agg = aggregateReport(
      baseArgs(),
      [
        {
          index: 1,
          exitCode: 0,
          durationMs: 1000,
          captured: true,
          seed: 42,
          timedOut: false,
        },
        {
          index: 2,
          exitCode: 124,
          durationMs: 2700000,
          captured: false,
          seed: 43,
          timedOut: true,
        },
      ],
      [],
      "t0",
      "t1",
    );
    expect(agg.failedSetupRuns).toEqual([2]);
    expect(agg.runs[1]?.timedOut).toBe(true);
  });
});

describe("renderMarkdown", () => {
  it("renders a no-flakes summary when everything is stable", () => {
    const args = baseArgs({ runs: 3, threshold: 3 });
    const spec: SpecResult = {
      key: "f.test.ts::t",
      file: "f.test.ts",
      title: "t",
      outcomes: ["passed", "passed", "passed"],
      passes: 3,
      failures: 0,
      skipped: 0,
      total: 3,
      lastError: null,
    };
    const md = renderMarkdown(aggregateReport(args, [], [spec], "t0", "t1"));
    expect(md).toContain("# Jest flake-detector report");
    expect(md).toContain("## No flakes detected");
    expect(md).not.toContain("## Flaky tests");
  });

  it("renders flaky and always-broken tables with outcome glyphs", () => {
    const args = baseArgs({ runs: 5, threshold: 4 });
    const flaky: SpecResult = {
      key: "f.test.ts::flaky",
      file: "f.test.ts",
      title: "flaky",
      outcomes: ["passed", "failed", "passed", "passed", "failed"],
      passes: 3,
      failures: 2,
      skipped: 0,
      total: 5,
      lastError: "Error: interleaved state",
    };
    const broken: SpecResult = {
      key: "g.test.ts::broken",
      file: "g.test.ts",
      title: "broken",
      outcomes: ["failed", "failed", "failed", "failed", "failed"],
      passes: 0,
      failures: 5,
      skipped: 0,
      total: 5,
      lastError: "Error: always dies",
    };
    const md = renderMarkdown(
      aggregateReport(args, [], [flaky, broken], "t0", "t1"),
    );
    expect(md).toContain("## Flaky tests (passes < 4 of 5)");
    expect(md).toContain("3/5");
    expect(md).toContain("PASS FAIL PASS PASS FAIL");
    expect(md).toContain("## Always broken (0 / 5 passes)");
  });

  it("escapes pipes and newlines in table cells", () => {
    const args = baseArgs({ runs: 1, threshold: 1 });
    const nasty: SpecResult = {
      key: "f.test.ts::nasty",
      file: "f.test.ts",
      title: "has | pipe and\nnewline",
      outcomes: ["failed"],
      passes: 0,
      failures: 1,
      skipped: 0,
      total: 1,
      lastError: null,
    };
    const md = renderMarkdown(aggregateReport(args, [], [nasty], "t0", "t1"));
    expect(md).toContain("has \\| pipe and newline");
  });

  it("documents per-run seeds and the reproduce command", () => {
    const args = baseArgs({ runs: 2, threshold: 2 });
    const agg = aggregateReport(
      args,
      [
        {
          index: 1,
          exitCode: 0,
          durationMs: 5000,
          captured: true,
          seed: 123,
          timedOut: false,
        },
        {
          index: 2,
          exitCode: 1,
          durationMs: 6000,
          captured: true,
          seed: 456,
          timedOut: false,
        },
      ],
      [],
      "t0",
      "t1",
    );
    const md = renderMarkdown(agg);
    expect(md).toContain("| 1 | 123 | 0 | 5.0s | yes |");
    expect(md).toContain("npx jest --ci --maxWorkers=2 --randomize --seed=");
  });

  it("flags infra-failed runs prominently", () => {
    const args = baseArgs({ runs: 1, threshold: 1 });
    const agg = aggregateReport(
      args,
      [
        {
          index: 1,
          exitCode: 124,
          durationMs: 2700000,
          captured: false,
          seed: 7,
          timedOut: true,
        },
      ],
      [],
      "t0",
      "t1",
    );
    const md = renderMarkdown(agg);
    expect(md).toContain("Runs 1 produced no test outcomes");
    expect(md).toContain("(killed: wall-clock timeout)");
  });
});
