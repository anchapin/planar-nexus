#!/usr/bin/env tsx
/**
 * Jest flake-detector (issue #1719).
 *
 * The Jest counterpart of e2e/flake-detector.ts (#1264). Runs the unit
 * suite N times (default 5) and fails (exit 1) if any test passes fewer
 * than K of N runs (default 4 of 5). Emits a markdown report and a JSON
 * summary so the nightly CI job can upload an artifact and post a PR
 * comment — the same visibility contract the Playwright detector has.
 *
 * Why a separate N-run detector instead of jest `--retry`:
 *   - Retries mask flakiness: a test that fails once and passes on retry
 *     is reported green. N independent runs measure the actual pass rate.
 *
 * Deliberately NO --forceExit on the spawned jest runs (#1719): the
 * merge-gating Test job dropped --forceExit so hanging timers and
 * unresolved handles fail the run instead of being masked. The detector
 * must hold the same line — a suite that hangs without --forceExit
 * surfaces here as a per-run wall-clock timeout (kill + infra-failed
 * run), never as a silently-green result.
 *
 * Randomization (#1719 "randomized seeds where applicable"): each run
 * passes `--randomize --seed=<random>` so the test order inside every
 * file differs per run, exposing order-dependent state bleed between
 * tests (shared module state, Date.now/Math.random mocking leaks, uncleared
 * fake timers). The per-run seeds are recorded in report.json and printed
 * in the report so a failure is reproducible with
 * `npx jest --randomize --seed=<seed>`.
 *
 * Usage:
 *   tsx scripts/jest-flake-detector.ts                    # 5 runs, threshold 4
 *   tsx scripts/jest-flake-detector.ts --runs=3           # quick mode
 *   tsx scripts/jest-flake-detector.ts --runs=5 --threshold=4
 *   tsx scripts/jest-flake-detector.ts --testPathPattern=layer-system
 *   tsx scripts/jest-flake-detector.ts --report-dir=reports/jest-flake-detector
 *   tsx scripts/jest-flake-detector.ts --help
 *
 * Notes:
 *   - No --coverage: the coverage thresholds in jest.config.js only apply
 *     when coverage is collected, and gating them here would fail the run
 *     on a coverage dip unrelated to flakiness.
 *   - Suite-level failures (a test file that fails to even run — e.g. a
 *     compile error or an afterAll throwing) are recorded as a synthetic
 *     `(suite failed to run)` spec for that file so they are reported,
 *     not dropped.
 *   - Exit codes: 0 = all tests stable; 1 = flakes/always-broken found;
 *     2 = detector itself errored.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

// ---------- Public types (exported for jest) ----------

export type SpecStatus = "passed" | "failed" | "skipped";

export interface SpecResult {
  /** Stable key — file::title */
  key: string;
  file: string;
  title: string;
  /** One outcome per run, in run order. */
  outcomes: SpecStatus[];
  passes: number;
  failures: number;
  skipped: number;
  total: number;
  /** Most-recent failure error message, if any. */
  lastError: string | null;
}

export interface RunResult {
  index: number;
  exitCode: number;
  durationMs: number;
  /** True if the run captured any test outcomes. */
  captured: boolean;
  /** The --randomize seed used for this run (null when randomize off). */
  seed: number | null;
  /** True when the run exceeded the wall-clock budget and was killed. */
  timedOut: boolean;
}

export interface DetectorArgs {
  runs: number;
  threshold: number;
  testPathPattern: string | null;
  reportDir: string;
  workers: number;
  /** Per-run wall-clock budget in minutes (default 45). */
  runTimeoutMin: number;
  /** Pass --randomize --seed=<n> per run (default true, #1719). */
  randomize: boolean;
  /** When true, suppress per-run output (CI mode). */
  quiet: boolean;
}

export interface AggregatedReport {
  args: DetectorArgs;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  runs: RunResult[];
  specs: SpecResult[];
  /** Specs with 0 < passes < threshold (genuinely flaky). */
  flaky: SpecResult[];
  /** Specs with 0 passes (always broken — also fails the job). */
  alwaysBroken: SpecResult[];
  /** Specs with passes >= threshold. */
  stable: number;
  /** Run indices that produced no test outcomes (likely infra failure). */
  failedSetupRuns: number[];
}

// ---------- Jest --json report shapes ----------

interface JestJsonAssertion {
  status?: string;
  fullName?: string;
  title?: string;
  failureMessages?: string[];
}

interface JestJsonTestResult {
  name?: string;
  status?: string;
  message?: string;
  assertionResults?: JestJsonAssertion[];
}

interface JestJsonReport {
  success?: boolean;
  wasInterrupted?: boolean;
  testResults?: JestJsonTestResult[];
}

// ---------- Arg parsing ----------

export function parseArgs(argv: string[]): DetectorArgs {
  const args: DetectorArgs = {
    runs: 5,
    // -1 = "derive from runs" (runs - 1): the default 5-run detector
    // tolerates one failure (threshold 4), and a --runs=3 quick mode
    // tolerates one failure (threshold 2) instead of misclassifying
    // every test as flaky because a hardcoded 4 exceeds the run count.
    threshold: -1,
    testPathPattern: null,
    reportDir: "reports/jest-flake-detector",
    workers: 2,
    runTimeoutMin: 45,
    randomize: true,
    quiet: !!process.env.CI,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(`
Jest flake-detector (issue #1719).

Runs the Jest suite N times and fails if any test passes <K of N runs.

Options:
  --runs=N              number of runs (default 5)
  --threshold=K         minimum pass count to count as stable (default runs - 1)
  --testPathPattern=P   forward a jest --testPathPatterns to subset the suite
  --workers=N           jest --maxWorkers per run (default 2, mirrors CI Test job)
  --run-timeout-min=M   per-run wall-clock budget in minutes (default 45)
  --report-dir=PATH     output directory (default reports/jest-flake-detector)
  --no-randomize        run in deterministic jest order instead of random seeds
  --quiet               suppress per-run output (default: true under CI)
  -h, --help            show this help
`);
      process.exit(0);
    } else if (arg.startsWith("--runs=")) {
      const n = parseInt(arg.slice(7), 10);
      if (Number.isFinite(n) && n >= 1) args.runs = n;
    } else if (arg.startsWith("--threshold=")) {
      const n = parseInt(arg.slice(12), 10);
      if (Number.isFinite(n) && n >= 0) args.threshold = n;
    } else if (arg.startsWith("--testPathPattern=")) {
      args.testPathPattern = arg.slice("--testPathPattern=".length);
    } else if (arg.startsWith("--workers=")) {
      const n = parseInt(arg.slice(10), 10);
      if (Number.isFinite(n) && n >= 1) args.workers = n;
    } else if (arg.startsWith("--run-timeout-min=")) {
      const n = parseInt(arg.slice("--run-timeout-min=".length), 10);
      if (Number.isFinite(n) && n >= 1) args.runTimeoutMin = n;
    } else if (arg.startsWith("--report-dir=")) {
      args.reportDir = arg.slice(13);
    } else if (arg === "--no-randomize") {
      args.randomize = false;
    } else if (arg === "--randomize") {
      args.randomize = true;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--no-quiet") {
      args.quiet = false;
    }
  }
  if (args.threshold < 0) {
    args.threshold = Math.max(1, args.runs - 1);
  }
  if (args.threshold > args.runs) {
    // An explicit threshold above the run count would flag every test as
    // flaky; clamp with a warning instead of producing a nonsense report.
    console.warn(
      `threshold ${args.threshold} > runs ${args.runs} — clamping threshold to ${args.runs}.`,
    );
    args.threshold = args.runs;
  }
  return args;
}

// ---------- Pure helpers (exported for jest) ----------

export function specKey(spec: { file: string; title: string }): string {
  return `${spec.file}::${spec.title}`;
}

/** Coerce a raw jest assertion status into our SpecStatus union. */
function asStatus(raw: string | undefined): SpecStatus {
  // jest --json assertion statuses: passed | failed | skipped | pending |
  // todo. Anything pending/todo counts as skipped for stability math.
  switch (raw) {
    case "passed":
    case "failed":
      return raw;
    default:
      return "skipped";
  }
}

function relativeFilePath(absFile: string | undefined): string {
  if (!absFile) return "(unknown file)";
  const cwd = process.cwd();
  return absFile.startsWith(cwd + "/")
    ? absFile.slice(cwd.length + 1)
    : absFile;
}

/**
 * Walk a jest --json report and collect one SpecResult per
 * (file, test-name) tuple — a single run contributes exactly one outcome
 * per test. A test file that failed to run at all (empty assertionResults
 * with a non-passed suite status, e.g. a compile error) contributes a
 * synthetic "(suite failed to run)" spec so suite-level breakage is
 * reported instead of silently dropped.
 */
export function collectTestsFromJestJson(report: JestJsonReport): SpecResult[] {
  const out = new Map<string, SpecResult>();

  const push = (
    file: string,
    title: string,
    status: SpecStatus,
    err: string | null,
  ): void => {
    const key = specKey({ file, title });
    if (!out.has(key)) {
      out.set(key, {
        key,
        file,
        title,
        outcomes: [],
        passes: 0,
        failures: 0,
        skipped: 0,
        total: 0,
        lastError: null,
      });
    }
    const rec = out.get(key);
    if (!rec) return;
    rec.outcomes.push(status);
    rec.total += 1;
    if (status === "passed") rec.passes += 1;
    else if (status === "failed") {
      rec.failures += 1;
      if (err) rec.lastError = err;
    } else {
      rec.skipped += 1;
    }
  };

  for (const suite of report.testResults ?? []) {
    const file = relativeFilePath(suite.name);
    const assertions = suite.assertionResults ?? [];
    if (assertions.length === 0) {
      // Suite-level failure: the file itself did not run.
      if (suite.status === "failed") {
        const msg = (suite.message ?? "").trim().slice(0, 2000) || null;
        push(file, "(suite failed to run)", "failed", msg);
      }
      continue;
    }
    for (const assertion of assertions) {
      const status = asStatus(assertion.status);
      const msg = assertion.failureMessages?.join("\n") ?? null;
      push(
        file,
        assertion.fullName ?? assertion.title ?? "(untitled)",
        status,
        msg,
      );
    }
  }
  return Array.from(out.values());
}

/**
 * Merge per-run SpecResult[] lists into the running aggregate keyed by
 * spec.key. Each run produces at most one outcome per test.
 */
export function mergeRunIntoAggregate(
  aggregate: Map<string, SpecResult>,
  runResults: SpecResult[],
): void {
  for (const r of runResults) {
    if (!aggregate.has(r.key)) {
      aggregate.set(r.key, {
        key: r.key,
        file: r.file,
        title: r.title,
        outcomes: [],
        passes: 0,
        failures: 0,
        skipped: 0,
        total: 0,
        lastError: null,
      });
    }
    const acc = aggregate.get(r.key);
    if (!acc) continue;
    // Each run contributes a single outcome for this test.
    const outcome = r.outcomes[r.outcomes.length - 1] ?? "skipped";
    acc.outcomes.push(outcome);
    acc.total += 1;
    if (outcome === "passed") acc.passes += 1;
    else if (outcome === "failed") {
      acc.failures += 1;
      if (r.lastError) acc.lastError = r.lastError;
    } else {
      acc.skipped += 1;
    }
  }
}

export function aggregateReport(
  args: DetectorArgs,
  runResults: RunResult[],
  specs: SpecResult[],
  startedAt: string,
  finishedAt: string,
): AggregatedReport {
  const flaky: SpecResult[] = [];
  const alwaysBroken: SpecResult[] = [];
  let stable = 0;
  for (const s of specs) {
    if (s.total === 0) continue;
    if (s.failures === 0) {
      // Never failed in any run — stable. This deliberately includes specs
      // that were SKIPPED in every run (#1938): a deterministically absent
      // test (conditionally skipped live-integration / simulation suites)
      // is not breakage. The previous `passes === 0 → always broken` bucket
      // swallowed them and kept the nightly permanently red on a healthy
      // suite.
      stable += 1;
    } else if (s.passes === 0) {
      alwaysBroken.push(s);
    } else if (s.passes < args.threshold) {
      flaky.push(s);
    } else {
      stable += 1;
    }
  }
  const totalDurationMs = runResults.reduce((acc, r) => acc + r.durationMs, 0);
  const failedSetupRuns = runResults
    .filter((r) => !r.captured)
    .map((r) => r.index);
  return {
    args,
    startedAt,
    finishedAt,
    totalDurationMs,
    runs: runResults,
    specs,
    flaky,
    alwaysBroken,
    stable,
    failedSetupRuns,
  };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m${s}s`;
}

// Markdown-table-cell escape: backslash first (so we don't double-escape
// our own pipe escape), then the column separator `|`, then collapse
// newlines/tabs that would otherwise break the GFM table row.
// GitHub-Flavored-Markdown spec defines `\|` as the table-cell escape
// (https://github.github.com/gfm/#example-468); backslash escaping is
// included so the CodeQL `incomplete-multi-character-sanitization` query
// does not flag this function as failing to handle backslashes.
function escapeCell(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\n\r\t]/g, " ");
}

function outcomeGlyph(o: SpecStatus): string {
  switch (o) {
    case "passed":
      return "PASS";
    case "failed":
      return "FAIL";
    case "skipped":
      return "SKIP";
  }
}

export function renderMarkdown(report: AggregatedReport): string {
  const lines: string[] = [];
  const { args } = report;
  lines.push(`# Jest flake-detector report`);
  lines.push(``);
  lines.push(
    `- **Runs**: ${args.runs} (threshold: passes >= ${args.threshold} of ${args.runs})`,
  );
  lines.push(
    `- **Randomized order**: ${args.randomize ? "on (--randomize, per-run seed below)" : "off"}`,
  );
  lines.push(`- **Started**: ${report.startedAt}`);
  lines.push(`- **Finished**: ${report.finishedAt}`);
  lines.push(`- **Total duration**: ${fmtMs(report.totalDurationMs)}`);
  lines.push(`- **Total tests observed**: ${report.specs.length}`);
  lines.push(
    `- **Stable**: ${report.stable} | **Flaky**: ${report.flaky.length} | **Always broken**: ${report.alwaysBroken.length}`,
  );
  lines.push(``);
  lines.push(`## Per-run details`);
  lines.push(``);
  lines.push(`| Run | Seed | Exit | Duration | Outcomes |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const r of report.runs) {
    lines.push(
      `| ${r.index} | ${r.seed ?? "—"} | ${r.exitCode}${r.timedOut ? " (killed: wall-clock timeout)" : ""} | ${fmtMs(r.durationMs)} | ${r.captured ? "yes" : "NO"} |`,
    );
  }
  lines.push(``);

  if (report.flaky.length === 0 && report.alwaysBroken.length === 0) {
    lines.push(`## No flakes detected`);
    lines.push(``);
    lines.push(
      `All ${report.specs.length} test(s) passed at least ${args.threshold} of ${args.runs} runs.`,
    );
    lines.push(``);
  }

  if (report.flaky.length > 0) {
    lines.push(`## Flaky tests (passes < ${args.threshold} of ${args.runs})`);
    lines.push(``);
    lines.push(`| Test | File | Passes | Outcomes |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const s of report.flaky) {
      const outcomes = s.outcomes.map(outcomeGlyph).join(" ");
      lines.push(
        `| \`${escapeCell(s.title)}\` | \`${escapeCell(s.file)}\` | ${s.passes}/${s.total} | ${outcomes} |`,
      );
    }
    lines.push(``);
    for (const s of report.flaky) {
      if (s.lastError) {
        lines.push(
          `<details><summary>${escapeCell(s.title)} — last error</summary>`,
        );
        lines.push(``);
        lines.push("```");
        lines.push(s.lastError.slice(0, 2000));
        lines.push("```");
        lines.push(``);
        lines.push(`</details>`);
        lines.push(``);
      }
    }
  }

  if (report.alwaysBroken.length > 0) {
    lines.push(`## Always broken (0 / ${args.runs} passes)`);
    lines.push(``);
    lines.push(
      `These tests failed in every run. They will also be caught by the per-PR Test job; they are listed here for completeness.`,
    );
    lines.push(``);
    lines.push(`| Test | File | Last error |`);
    lines.push(`| --- | --- | --- |`);
    for (const s of report.alwaysBroken) {
      const err = (s.lastError ?? "").slice(0, 200);
      lines.push(
        `| \`${escapeCell(s.title)}\` | \`${escapeCell(s.file)}\` | ${escapeCell(err) || "—"} |`,
      );
    }
    lines.push(``);
  }

  if (report.failedSetupRuns.length > 0) {
    lines.push(
      `> Runs ${report.failedSetupRuns.join(", ")} produced no test outcomes — likely an infrastructure failure (suite hung and was killed by the wall-clock timeout, jest crashed, or the pattern matched nothing). Re-run the job before treating this report as authoritative.`,
    );
    lines.push(``);
  }

  lines.push(`## Reproducing a failing run`);
  lines.push(``);
  lines.push("```");
  lines.push(
    `npx jest --ci --maxWorkers=2 --randomize --seed=<seed from the table above>`,
  );
  lines.push("```");
  lines.push(``);

  return lines.join("\n");
}

// ---------- Runner (side-effects) ----------

function buildJestArgs(args: DetectorArgs, seed: number | null): string[] {
  const cliArgs = [
    "jest",
    "--ci",
    `--maxWorkers=${args.workers}`,
    "--workerIdleMemoryLimit=512MB",
    "--json",
    // NOTE (#1719): deliberately no --forceExit here either — a hanging
    // handle must fail the run (via the wall-clock timeout below), not be
    // masked like the per-PR Test job used to do.
  ];
  if (args.randomize && seed !== null) {
    cliArgs.push("--randomize", `--seed=${seed}`, "--showSeed");
  }
  if (args.testPathPattern) {
    // Jest 30 renamed --testPathPattern to --testPathPatterns.
    cliArgs.push(`--testPathPatterns=${args.testPathPattern}`);
  }
  return cliArgs;
}

function killTree(child: {
  pid?: number;
  kill: (s: NodeJS.Signals) => void;
}): void {
  if (child.pid === undefined) return;
  try {
    // Negative pid targets the whole process group (npx → jest → workers),
    // so worker processes do not linger as orphans.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function runJestOnce(
  args: DetectorArgs,
  runIndex: number,
  reportDir: string,
): Promise<RunResult> {
  return new Promise<RunResult>((resolveRun) => {
    const seed = args.randomize ? Math.floor(Math.random() * 0x7fffffff) : null;
    const cliArgs = buildJestArgs(args, seed);
    const jsonPath = join(reportDir, `run-${runIndex}.json`);
    cliArgs.push(`--outputFile=${jsonPath}`);
    const t0 = Date.now();
    if (!args.quiet) {
      console.log(`\n[run ${runIndex}/${args.runs}] npx ${cliArgs.join(" ")}`);
    } else {
      process.stdout.write(`.`);
    }
    const child = spawn("npx", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so the whole npx→jest→worker tree is killable
      // on wall-clock timeout.
      detached: true,
      env: { ...process.env, CI: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    let timedOut = false;
    const timeoutMs = args.runTimeoutMin * 60_000;
    const timer = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[run ${runIndex}] exceeded the ${args.runTimeoutMin}m wall-clock budget — killing (this is the #1719 signal for a hanging handle: the run is marked infra-failed, not green).`,
      );
      killTree(child);
      // Belt and braces: hard-kill anything still alive after a grace
      // period so the detector itself always terminates.
      setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, 30_000).unref();
    }, timeoutMs);
    timer.unref();

    child.on("error", (err) => {
      console.error(`[run ${runIndex}] failed to spawn:`, err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      try {
        if (stdout)
          writeFileSync(join(reportDir, `run-${runIndex}.stdout.log`), stdout);
        if (stderr)
          writeFileSync(join(reportDir, `run-${runIndex}.stderr.log`), stderr);
      } catch (e) {
        console.warn(`[run ${runIndex}] failed to persist output:`, e);
      }
      // A run is "captured" if jest wrote a parseable JSON report with at
      // least one test outcome. Anything else (including a wall-clock
      // timeout kill) is treated as an infra failure.
      let captured = false;
      if (!timedOut) {
        try {
          const parsed = JSON.parse(
            readFileSync(jsonPath, "utf8"),
          ) as JestJsonReport;
          if ((parsed.testResults ?? []).length > 0) captured = true;
        } catch {
          captured = false;
        }
      }
      resolveRun({
        index: runIndex,
        exitCode: code ?? (timedOut ? 124 : 0),
        durationMs,
        captured,
        seed,
        timedOut,
      });
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const reportDir = resolve(args.reportDir);
  if (existsSync(reportDir)) {
    rmSync(reportDir, { recursive: true, force: true });
  }
  mkdirSync(reportDir, { recursive: true });

  const aggregate = new Map<string, SpecResult>();
  const runResults: RunResult[] = [];
  const startedAt = new Date().toISOString();

  for (let i = 1; i <= args.runs; i += 1) {
    const result = await runJestOnce(args, i, reportDir);
    runResults.push(result);
    if (!args.quiet) {
      console.log(
        `[run ${i}/${args.runs}] seed=${result.seed} exit=${result.exitCode} duration=${fmtMs(result.durationMs)} captured=${result.captured}`,
      );
    }
    if (!result.captured) {
      console.warn(
        `[run ${i}] no test outcomes captured — treating as infra failure.`,
      );
      continue;
    }
    const jsonPath = join(reportDir, `run-${i}.json`);
    let report: JestJsonReport;
    try {
      report = JSON.parse(readFileSync(jsonPath, "utf8")) as JestJsonReport;
    } catch (e) {
      console.warn(`[run ${i}] failed to parse JSON output:`, e);
      continue;
    }
    const specs = collectTestsFromJestJson(report);
    mergeRunIntoAggregate(aggregate, specs);
  }

  const finishedAt = new Date().toISOString();
  const agg = aggregateReport(
    args,
    runResults,
    Array.from(aggregate.values()),
    startedAt,
    finishedAt,
  );

  const md = renderMarkdown(agg);
  writeFileSync(join(reportDir, "report.md"), md);
  writeFileSync(join(reportDir, "report.json"), JSON.stringify(agg, null, 2));

  if (args.quiet) process.stdout.write("\n");
  console.log("\n" + "=".repeat(72));
  console.log(md);
  console.log("=".repeat(72));
  console.log(`\nMarkdown report: ${join(reportDir, "report.md")}`);
  console.log(`JSON report:     ${join(reportDir, "report.json")}`);

  const failing = agg.flaky.length + agg.alwaysBroken.length;
  if (failing > 0) {
    console.log(
      `\n${failing} test(s) below stability threshold (${agg.flaky.length} flaky, ${agg.alwaysBroken.length} always broken) — exiting 1.`,
    );
    process.exit(1);
  }
  if (agg.failedSetupRuns.length > 0) {
    console.log(
      `\nNo flaky tests recorded, but runs ${agg.failedSetupRuns.join(", ")} produced no outcomes (infra failure / wall-clock timeout) — exiting 1 so the signal is not lost.`,
    );
    process.exit(1);
  }
  console.log(`\nAll tests stable.`);
  process.exit(0);
}

// Auto-run only when the file is invoked directly (`tsx scripts/jest-flake-detector.ts`).
// When the file is `import`-ed (e.g. by the jest suite at
// tests/jest-flake-detector.test.ts), the pure-function exports are the
// contract — the side-effecting main() loop must not run.
if (require.main === module) {
  main().catch((err) => {
    console.error("jest-flake-detector failed:", err);
    process.exit(2);
  });
}
