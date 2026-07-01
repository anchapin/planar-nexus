#!/usr/bin/env tsx
/**
 * Playwright flake-detector (issue #1264).
 *
 * Runs the Playwright suite N times (default 5) against a single project
 * (default `chromium`), counts each spec's pass rate, and fails (exit 1)
 * if any spec passes fewer than K of N runs (default 4 of 5). Emits a
 * markdown report and a JSON summary so the nightly CI job can post a
 * PR comment.
 *
 * Why the suite is run 5× instead of relying on Playwright's `--retries`:
 *   - `retries: 1` in the regular e2e job masks flakiness; a spec that
 *     fails once and passes once is reported green. (#1264 acceptance
 *     criteria explicitly call this out.)
 *   - 5 independent runs with `--retries=0` give a stable signal: a
 *     spec that passes ≥4/5 is reliable; <4/5 is genuinely flaky.
 *
 * Usage:
 *   tsx e2e/flake-detector.ts                        # default: 5 runs, threshold 4
 *   tsx e2e/flake-detector.ts --runs=3               # quick mode
 *   tsx e2e/flake-detector.ts --runs=10 --threshold=8
 *   tsx e2e/flake-detector.ts --specs=basic-navigation
 *   tsx e2e/flake-detector.ts --report-dir=reports/flake-detector
 *   tsx e2e/flake-detector.ts --help
 *
 * Notes:
 *   - Playwright does not expose a `--seed` flag (the issue body mentions
 *     `--seed=1`); tests in this suite are expected to be deterministic,
 *     and ordering is stable across runs. If randomness is added in the
 *     future, pin a fixed seed in a fixture rather than relying on the
 *     runner.
 *   - Runs use `--retries=0` so the detector — not Playwright's built-in
 *     retry — is what measures flakiness.
 *   - The Playwright `webServer` block is left at its default
 *     (`reuseExistingServer: !process.env.CI`), so each of the N runs
 *     spins up a fresh `next dev` instance. That is the conservative
 *     choice for an honest signal: a flaky spec should be flaky on a
 *     freshly-spawned server, not on a warmed one.
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

export type SpecStatus =
  | "passed"
  | "failed"
  | "timedOut"
  | "interrupted"
  | "skipped";

export interface SpecResult {
  /** Stable key — file::project::title */
  key: string;
  file: string;
  title: string;
  project: string;
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
}

export interface DetectorArgs {
  runs: number;
  threshold: number;
  specs: string[] | null;
  reportDir: string;
  project: string;
  workers: number;
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

interface PlaywrightJsonTestOutcome {
  status?: SpecStatus | string;
  duration?: number;
  retry?: number;
  error?: { message?: string } | null;
}

interface PlaywrightJsonSpec {
  title?: string;
  file?: string;
  project?: string;
  line?: number;
  column?: number;
  results?: PlaywrightJsonTestOutcome[];
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSpec[];
}

interface PlaywrightJsonReport {
  config?: { rootDir?: string };
  suites?: PlaywrightJsonSpec[];
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
  };
}

// ---------- Arg parsing ----------

export function parseArgs(argv: string[]): DetectorArgs {
  const args: DetectorArgs = {
    runs: 5,
    threshold: 4,
    specs: null,
    reportDir: "reports/flake-detector",
    project: "chromium",
    workers: 4,
    quiet: !!process.env.CI,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(`
Playwright flake-detector (issue #1264).

Runs the Playwright suite N times and fails if any spec passes <K of N runs.

Options:
  --runs=N              number of runs (default 5)
  --threshold=K         minimum pass count to count as stable (default 4)
  --specs=A,B,C         only include these spec files (comma-separated basenames, no .spec.ts)
  --project=NAME        Playwright project name (default chromium)
  --workers=N           Playwright workers per run (default 4)
  --report-dir=PATH     output directory (default reports/flake-detector)
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
    } else if (arg.startsWith("--specs=")) {
      args.specs = arg
        .slice(8)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--report-dir=")) {
      args.reportDir = arg.slice(13);
    } else if (arg.startsWith("--project=")) {
      args.project = arg.slice(10);
    } else if (arg.startsWith("--workers=")) {
      const n = parseInt(arg.slice(10), 10);
      if (Number.isFinite(n) && n >= 1) args.workers = n;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--no-quiet") {
      args.quiet = false;
    }
  }
  return args;
}

// ---------- Pure helpers (exported for jest) ----------

export function specKey(spec: {
  file: string;
  title: string;
  project: string;
}): string {
  return `${spec.file}::${spec.project}::${spec.title}`;
}

/** Coerce a raw Playwright status string into our SpecStatus union. */
function asStatus(raw: string | undefined): SpecStatus {
  switch (raw) {
    case "passed":
    case "failed":
    case "timedOut":
    case "interrupted":
    case "skipped":
      return raw;
    default:
      return "skipped";
  }
}

/**
 * Walk the recursive Playwright JSON report and collect one row per
 * (file, project, title) tuple. With `--retries=0` we expect exactly one
 * result per spec, so the last result is the only meaningful one — but
 * we still tolerate a single row being an array.
 */
export function collectSpecsFromReport(
  report: PlaywrightJsonReport,
): SpecResult[] {
  const out = new Map<string, SpecResult>();

  const visit = (nodes: PlaywrightJsonSpec[] | undefined): void => {
    if (!nodes) return;
    for (const node of nodes) {
      // A spec row has `title` + `results`; a suite row has `specs` or `suites`.
      if (node.title && node.results && node.file) {
        const file = node.file;
        const project = node.project ?? "chromium";
        const title = node.title;
        const key = specKey({ file, title, project });
        const finalResult = node.results[node.results.length - 1];
        const status = asStatus(finalResult?.status);
        if (!out.has(key)) {
          out.set(key, {
            key,
            file,
            title,
            project,
            outcomes: [],
            passes: 0,
            failures: 0,
            skipped: 0,
            total: 0,
            lastError: null,
          });
        }
        const rec = out.get(key);
        if (!rec) continue;
        rec.outcomes.push(status);
        rec.total += 1;
        if (status === "passed") rec.passes += 1;
        else if (status === "failed" || status === "timedOut") {
          rec.failures += 1;
          const msg = finalResult?.error?.message;
          if (msg) rec.lastError = msg;
        } else if (status === "skipped" || status === "interrupted") {
          rec.skipped += 1;
        }
      }
      if (node.specs) visit(node.specs);
      if (node.suites) visit(node.suites);
    }
  };

  visit(report.suites);
  return Array.from(out.values());
}

/**
 * Merge per-run SpecResult[] lists into the running aggregate keyed by
 * spec.key. Each run produces at most one outcome per spec.
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
        project: r.project,
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
    // Each run contributes a single outcome for this spec.
    const outcome = r.outcomes[r.outcomes.length - 1] ?? "skipped";
    acc.outcomes.push(outcome);
    acc.total += 1;
    if (outcome === "passed") acc.passes += 1;
    else if (outcome === "failed" || outcome === "timedOut") {
      acc.failures += 1;
      if (r.lastError) acc.lastError = r.lastError;
    } else if (outcome === "skipped" || outcome === "interrupted") {
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
    if (s.passes === 0) {
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

function escapeCell(s: string): string {
  // Markdown-table-cell escape: only `|` (column separator) and newlines
  // (which would break the row) need escaping. Backslash and other
  // characters are literal in Markdown cell text and do not require
  // escaping here. (`codeql[js/incomplete-multi-character-sanitization]`
  // flags any non-trivial replace chain; the chain is intentional and
  // minimal — only `|` and `\n` are Markdown-significant in this context.)
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function outcomeGlyph(o: SpecStatus): string {
  switch (o) {
    case "passed":
      return "PASS";
    case "failed":
      return "FAIL";
    case "timedOut":
      return "TIMEOUT";
    case "interrupted":
      return "INTERRUPTED";
    case "skipped":
      return "SKIP";
  }
}

export function renderMarkdown(report: AggregatedReport): string {
  const lines: string[] = [];
  const { args } = report;
  lines.push(`# Playwright flake-detector report`);
  lines.push(``);
  lines.push(
    `- **Runs**: ${args.runs} (threshold: passes >= ${args.threshold} of ${args.runs})`,
  );
  lines.push(`- **Project**: \`${args.project}\``);
  lines.push(`- **Started**: ${report.startedAt}`);
  lines.push(`- **Finished**: ${report.finishedAt}`);
  lines.push(`- **Total duration**: ${fmtMs(report.totalDurationMs)}`);
  lines.push(`- **Total specs observed**: ${report.specs.length}`);
  lines.push(
    `- **Stable**: ${report.stable} | **Flaky**: ${report.flaky.length} | **Always broken**: ${report.alwaysBroken.length}`,
  );
  lines.push(``);

  if (report.flaky.length === 0 && report.alwaysBroken.length === 0) {
    lines.push(`## No flakes detected`);
    lines.push(``);
    lines.push(
      `All ${report.specs.length} spec(s) passed at least ${args.threshold} of ${args.runs} runs.`,
    );
    lines.push(``);
  }

  if (report.flaky.length > 0) {
    lines.push(`## Flaky specs (passes < ${args.threshold} of ${args.runs})`);
    lines.push(``);
    lines.push(`| Spec | File | Passes | Outcomes |`);
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
      `These specs failed in every run. They will also be caught by the regular e2e job on every PR; they are listed here for completeness.`,
    );
    lines.push(``);
    lines.push(`| Spec | File | Last error |`);
    lines.push(`| --- | --- | --- |`);
    for (const s of report.alwaysBroken) {
      const err = (s.lastError ?? "").slice(0, 200);
      lines.push(
        `| \`${escapeCell(s.title)}\` | \`${escapeCell(s.file)}\` | ${escapeCell(err) || "—"} |`,
      );
    }
    lines.push(``);
  }

  // Full pass/fail matrix, sorted by instability (most failures first).
  const sortedSpecs = [...report.specs].sort(
    (a, b) =>
      b.failures - a.failures ||
      b.skipped - a.skipped ||
      a.title.localeCompare(b.title),
  );
  if (sortedSpecs.length > 0) {
    lines.push(`## Pass/fail matrix (all observed specs)`);
    lines.push(``);
    const runHeaders = Array.from(
      { length: args.runs },
      (_, i) => `R${i + 1}`,
    ).join(" | ");
    const runDashes = Array.from({ length: args.runs }, () => "---").join(
      " | ",
    );
    lines.push(`| Spec | File | ${runHeaders} |`);
    lines.push(`| --- | --- | ${runDashes} |`);
    for (const s of sortedSpecs) {
      const cells: string[] = [];
      for (let i = 0; i < args.runs; i += 1) {
        cells.push(s.outcomes[i] ? outcomeGlyph(s.outcomes[i]) : "—");
      }
      lines.push(
        `| \`${escapeCell(s.title)}\` | \`${escapeCell(s.file)}\` | ${cells.join(" | ")} |`,
      );
    }
    lines.push(``);
  }

  if (report.failedSetupRuns.length > 0) {
    lines.push(
      `> Runs ${report.failedSetupRuns.join(", ")} produced no test outcomes — likely an infrastructure failure (dev server did not start, browser crashed, or test glob matched nothing). Re-run the job before treating this report as authoritative.`,
    );
    lines.push(``);
  }

  return lines.join("\n");
}

// ---------- Runner (side-effects) ----------

function buildPlaywrightArgs(args: DetectorArgs): string[] {
  const cliArgs = [
    "playwright",
    "test",
    `--project=${args.project}`,
    "--reporter=json",
    "--retries=0",
    `--workers=${args.workers}`,
  ];
  if (args.specs && args.specs.length > 0) {
    for (const s of args.specs) cliArgs.push(`e2e/${s}.spec.ts`);
  }
  return cliArgs;
}

function runPlaywrightOnce(
  args: DetectorArgs,
  runIndex: number,
  reportDir: string,
): Promise<RunResult> {
  return new Promise<RunResult>((resolveRun) => {
    const cliArgs = buildPlaywrightArgs(args);
    const t0 = Date.now();
    if (!args.quiet) {
      console.log(`\n[run ${runIndex}/${args.runs}] npx ${cliArgs.join(" ")}`);
    } else {
      process.stdout.write(`.`);
    }
    const child = spawn("npx", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      console.error(`[run ${runIndex}] failed to spawn:`, err);
    });
    child.on("close", (code) => {
      const durationMs = Date.now() - t0;
      try {
        writeFileSync(join(reportDir, `run-${runIndex}.json`), stdout);
        if (stderr)
          writeFileSync(join(reportDir, `run-${runIndex}.stderr.log`), stderr);
      } catch (e) {
        console.warn(`[run ${runIndex}] failed to persist output:`, e);
      }
      // A run is "captured" if we got a parseable JSON report with at
      // least one test outcome. Anything else is treated as an infra
      // failure (browser missing, dev server down, etc.).
      let captured = false;
      try {
        const parsed = JSON.parse(stdout) as PlaywrightJsonReport;
        const specs = collectSpecsFromReport(parsed);
        if (specs.length > 0) captured = true;
      } catch {
        captured = false;
      }
      resolveRun({
        index: runIndex,
        exitCode: code ?? 0,
        durationMs,
        captured,
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
    const result = await runPlaywrightOnce(args, i, reportDir);
    runResults.push(result);
    if (!args.quiet) {
      console.log(
        `[run ${i}/${args.runs}] exit=${result.exitCode} duration=${fmtMs(result.durationMs)} captured=${result.captured}`,
      );
    }
    if (!result.captured) {
      console.warn(
        `[run ${i}] no test outcomes captured — treating as infra failure.`,
      );
      continue;
    }
    const jsonPath = join(reportDir, `run-${i}.json`);
    let report: PlaywrightJsonReport;
    try {
      report = JSON.parse(
        readFileSync(jsonPath, "utf8"),
      ) as PlaywrightJsonReport;
    } catch (e) {
      console.warn(`[run ${i}] failed to parse JSON output:`, e);
      continue;
    }
    const specs = collectSpecsFromReport(report);
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
      `\n${failing} spec(s) below stability threshold (${agg.flaky.length} flaky, ${agg.alwaysBroken.length} always broken) — exiting 1.`,
    );
    process.exit(1);
  }
  console.log(`\nAll specs stable.`);
  process.exit(0);
}

// Auto-run only when the file is invoked directly (`tsx e2e/flake-detector.ts`).
// When the file is `import`-ed (e.g. by the jest suite at
// tests/flake-detector.test.ts), the pure-function exports are the
// contract — the side-effecting main() loop must not run.
if (require.main === module) {
  main().catch((err) => {
    console.error("flake-detector failed:", err);
    process.exit(2);
  });
}
