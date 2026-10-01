#!/usr/bin/env node
/**
 * Test-Count Docs Sync Guard — Issue #1910.
 *
 * The `# Full test suite` snippet in `docs/TEST_VIDEO_FIXTURES.md`
 * documented Jest's summary line (#1397 commit, frozen at 380/7867).
 * The number drifted the same way the coverage floors did before #1712:
 * every merge added tests, the doc summary never moved, and the
 * README/#1397 verification block was reporting a number from weeks
 * ago. This guard is the drift backstop:
 *
 *   1. `scripts/ratchet-test-count.mjs` rewrites the anchored block
 *      (`<!-- TEST_COUNT:START -->` … `<!-- TEST_COUNT:END -->`) on
 *      every bump, so a normal ratchet can no longer introduce drift.
 *   2. THIS script re-measures live Jest in CI and compares the
 *      anchored block against it; exits 1 on any mismatch, missing
 *      anchor, or missing file — so a stale summary fails the build
 *      instead of shipping.
 *
 * Mirrors `scripts/check-coverage-docs-sync.mjs` (#1712) in shape
 * (plain Node, fast fail-fast guard, dedicated CI job).
 *
 * Issue #2342: two docs carry the anchored block, in two formats:
 *   - `docs/TEST_VIDEO_FIXTURES.md` — bash-comment lines inside a fenced
 *     ```bash block (`# → Test Suites: …` / `# → Tests: …`).
 *   - `docs/onboarding.md` — markdown lines (`**Test suites:** N`,
 *     `**Test cases:** N (P passed + S skipped)`, `**Snapshots:** N`).
 * The guard used to read only the first, so onboarding.md drifted with no
 * CI failure. It now checks every doc in DEFAULT_DOC_PATHS, detecting each
 * block's format from its contents, against one Jest run.
 *
 * Usage:
 *   node scripts/check-test-count-docs.mjs
 *   node scripts/check-test-count-docs.mjs --doc <path> [--doc <path> …]
 *   node scripts/check-test-count-docs.mjs --live <counts.json> --doc <path>
 *
 * Exit codes: 0 = pass, 1 = violation. `--doc` and `--live` exist for the
 * fixture-based tests in tests/test-count-docs-guard.test.ts (no flags =
 * measure live Jest and check the committed repo state, which is what CI
 * does). `--live` takes a JSON file of
 * `{ suites, total, passed, skipped, todo, snapshots, listed }` in place of
 * running Jest, so the tests do not recurse into the whole suite.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_DOC_PATHS = [
  path.join(REPO_ROOT, "docs", "TEST_VIDEO_FIXTURES.md"),
  path.join(REPO_ROOT, "docs", "onboarding.md"),
];

const START_ANCHOR = "<!-- TEST_COUNT:START -->";
const END_ANCHOR = "<!-- TEST_COUNT:END -->";

/**
 * Run a command and return merged stdout+stderr as a trimmed string.
 * Jest writes its summary line to stderr, so we have to combine the
 * two streams or the parser sees nothing.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 */
function runCmd(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, CI: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: (result.stdout + "\n" + result.stderr).trim(),
  };
}

/**
 * Issue #2353: a non-zero exit from `npm test` used to throw here, which made
 * ANY single flaky test anywhere in the repo fail this guard with
 * "npm test --silent exited with status 1" even when the doc numbers were
 * perfectly in sync. That is how the ai-proxy route flake turned the
 * `test-count-docs-guard` job red on `main` for three consecutive merges,
 * and it also blocks `ratchet-test-count.mjs` locally: a contributor who
 * hits the flake cannot regenerate the block until the retry clears.
 *
 * "Are the docs in sync?" and "is the suite healthy?" are independent
 * questions and must not be conflated. Jest prints its `Test Suites:` /
 * `Tests:` summary whether or not tests failed, so the counts are parseable
 * either way. This guard now answers only the doc-sync question; suite
 * health is the `test` job's business, and that job reports it.
 *
 * @param {number | null} status exit status of the jest run
 * @param {string} output merged stdout+stderr
 * @returns {string | null} a human-readable note when the suite was unhealthy
 */
function suiteHealthNote(status, output) {
  if (status === 0) return null;
  const failedSuites = output.match(/^Test Suites:.*?(\d+)\s+failed/m);
  const failedTests = output.match(/^Tests:.*?(\d+)\s+failed/m);
  const parts = [];
  if (failedSuites) parts.push(`${failedSuites[1]} suite(s) failed`);
  if (failedTests) parts.push(`${failedTests[1]} test(s) failed`);
  const detail = parts.length ? parts.join(", ") : `exit status ${status}`;
  return (
    `npm test exited non-zero (${detail}). This guard only checks doc sync ` +
    `and does NOT fail on it (issue #2353); the \`test\` job owns suite health.`
  );
}

/**
 * Capture live Jest numbers — same parser as the ratchet, kept
 * deliberately duplicated so the guard stays standalone (no cross-
 * module require that would need a build step or CJS/ESM bridging).
 *
 * @returns {{ suites: number; total: number; passed: number; skipped: number; todo: number }}
 */
export function captureJestCounts() {
  const { status, output: summary } = runCmd("npm", ["test", "--silent"]);
  const healthNote = suiteHealthNote(status, summary);
  const suitesMatch = summary.match(
    /^Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/m,
  );
  if (!suitesMatch) {
    // Only reachable when jest produced no summary at all (a crash, an OOM,
    // a config error). A run with failing tests still prints the summary, and
    // #2353 requires that case to be parsed rather than thrown on.
    throw new Error(
      "Could not parse `Test Suites:` line from `npm test --silent` " +
        "output. Expected a line like 'Test Suites: 539 passed, 539 total'. " +
        (status === 0
          ? ""
          : `npm test exited with status ${status} and produced no summary:\n`) +
        (status === 0 ? "" : summary.slice(-2000)),
    );
  }
  const testsMatch = summary.match(/^Tests:\s+(.+)$/m);
  if (!testsMatch) {
    throw new Error(
      "Could not parse `Tests:` line from `npm test --silent` output.",
    );
  }
  const tail = testsMatch[1];
  const totalMatch = tail.match(/(\d+)\s+total/);
  const passedMatch = tail.match(/(\d+)\s+passed/);
  const skippedMatch = tail.match(/(\d+)\s+skipped/);
  const todoMatch = tail.match(/(\d+)\s+todo/);
  if (!totalMatch || !passedMatch) {
    throw new Error(
      `Could not extract totals from Tests line: ${JSON.stringify(tail)}`,
    );
  }
  // "Snapshots:   3 passed, 3 total" (or "Snapshots:   0 total").
  const snapshotsMatch = summary.match(/^Snapshots:.*?(\d+)\s+total/m);
  return {
    suites: parseInt(suitesMatch[2], 10),
    total: parseInt(totalMatch[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
    snapshots: snapshotsMatch ? parseInt(snapshotsMatch[1], 10) : 0,
    healthNote,
  };
}

/**
 * Discover the suite-file count via `npx jest --listTests | wc -l`.
 *
 * @returns {number}
 */
export function captureListTestsCount() {
  const { status, output } = runCmd("npx", ["jest", "--listTests"]);
  if (status !== 0) {
    throw new Error(
      `npx jest --listTests exited with status ${status}:\n` +
        output.slice(0, 2000),
    );
  }
  return output
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !l.startsWith("[")).length;
}

/**
 * Parse the anchored block out of the doc.
 *
 * @param {string} source
 * @returns {{ ok: true; suites: number; total: number; passed: number; skipped: number; todo: number; listed: number } | { ok: false; error: string }}
 */
export function parseDocBlock(source) {
  const startIdx = source.indexOf(START_ANCHOR);
  const endIdx = source.indexOf(END_ANCHOR, startIdx);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return {
      ok: false,
      error:
        `missing "${START_ANCHOR}" / "${END_ANCHOR}" anchors ` +
        `around the test-count summary. Wrap the suite summary lines ` +
        `in those HTML comments so scripts/ratchet-test-count.mjs can ` +
        `keep them in sync (issue #1910).`,
    };
  }
  const inner = source.slice(startIdx + START_ANCHOR.length, endIdx);
  if (detectFormat(inner) === "markdown") return parseMarkdownBlock(inner);

  // Suites line: "# → Test Suites: 539 passed, 539 total  (--listTests: 539 files)"
  const suitesLine = inner.match(
    /(?:^|\s)Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/,
  );
  if (!suitesLine) {
    return {
      ok: false,
      error:
        `anchored block has no "Test Suites: N passed, N total" line. ` +
        `Run \`npm run ratchet:test-count\` to regenerate it.`,
    };
  }
  // Tests line: "# → Tests: 11189 passed, 14 skipped, 11203 total"
  const testsLine = inner.match(/(?:^|\s)Tests:\s+(.+)/);
  if (!testsLine) {
    return {
      ok: false,
      error: `anchored block has no "Tests:" line.`,
    };
  }
  const tail = testsLine[1];
  const totalMatch = tail.match(/(\d+)\s+total/);
  const passedMatch = tail.match(/(\d+)\s+passed/);
  const skippedMatch = tail.match(/(\d+)\s+skipped/);
  const todoMatch = tail.match(/(\d+)\s+todo/);
  if (!totalMatch || !passedMatch) {
    return {
      ok: false,
      error: `could not parse Tests breakdown from line: ${JSON.stringify(tail)}`,
    };
  }
  // Listed-count is optional but expected; treat missing as a violation.
  const listedMatch = inner.match(/--listTests:\s+(\d+)\s+files/);
  if (!listedMatch) {
    return {
      ok: false,
      error:
        `anchored block has no "--listTests: N files" suffix. ` +
        `Run \`npm run ratchet:test-count\` to regenerate it.`,
    };
  }

  return {
    ok: true,
    format: "bash",
    suites: parseInt(suitesLine[2], 10),
    total: parseInt(totalMatch[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
    listed: parseInt(listedMatch[1], 10),
  };
}

/**
 * Which renderer wrote this block. The onboarding doc uses bold markdown
 * labels; everything else uses the original bash-comment lines.
 *
 * @param {string} inner text between the anchors
 * @returns {"bash" | "markdown"}
 */
export function detectFormat(inner) {
  return /\*\*Test suites:\*\*/.test(inner) ? "markdown" : "bash";
}

/**
 * Parse the markdown-format block (docs/onboarding.md, issue #2342):
 *
 *   **Test suites:** 594
 *   **Test cases:** 12444 (12437 passed + 7 skipped)
 *   **Snapshots:** 3
 *
 * @param {string} inner
 */
function parseMarkdownBlock(inner) {
  const suites = inner.match(/\*\*Test suites:\*\*\s+(\d+)/);
  const cases = inner.match(/\*\*Test cases:\*\*\s+(\d+)\s+\(([^)]*)\)/);
  const snapshots = inner.match(/\*\*Snapshots:\*\*\s+(\d+)/);
  if (!suites || !cases || !snapshots) {
    const missing = [
      !suites && "**Test suites:** N",
      !cases && "**Test cases:** N (P passed + S skipped)",
      !snapshots && "**Snapshots:** N",
    ].filter(Boolean);
    return {
      ok: false,
      error:
        `anchored block is missing ${missing.map((m) => `"${m}"`).join(", ")}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate it.`,
    };
  }
  const breakdown = cases[2];
  const passedMatch = breakdown.match(/(\d+)\s+passed/);
  if (!passedMatch) {
    return {
      ok: false,
      error: `could not parse passed count from Test cases breakdown: ${JSON.stringify(breakdown)}`,
    };
  }
  const skippedMatch = breakdown.match(/(\d+)\s+skipped/);
  const todoMatch = breakdown.match(/(\d+)\s+todo/);
  return {
    ok: true,
    format: "markdown",
    suites: parseInt(suites[1], 10),
    total: parseInt(cases[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
    snapshots: parseInt(snapshots[1], 10),
  };
}

/**
 * Compare the parsed doc block against the freshly measured Jest totals.
 *
 * @param {ReturnType<typeof parseDocBlock>} doc
 * @param {{ suites: number; total: number; passed: number; skipped: number; todo: number }} live
 * @param {number} liveListed
 * @returns {string[]} violations (empty = pass)
 */
export function diff(doc, live, liveListed) {
  if (!doc.ok) return [doc.error];
  /** @type {string[]} */
  const errs = [];
  if (doc.suites !== live.suites) {
    errs.push(
      `Test Suites: doc=${doc.suites}, live=${live.suites}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.total !== live.total) {
    errs.push(
      `Tests total: doc=${doc.total}, live=${live.total}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.passed !== live.passed) {
    errs.push(
      `Tests passed: doc=${doc.passed}, live=${live.passed}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.skipped !== live.skipped) {
    errs.push(
      `Tests skipped: doc=${doc.skipped}, live=${live.skipped}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.todo !== live.todo) {
    errs.push(
      `Tests todo: doc=${doc.todo}, live=${live.todo}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.snapshots !== undefined && doc.snapshots !== live.snapshots) {
    errs.push(
      `Snapshots: doc=${doc.snapshots}, live=${live.snapshots}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  if (doc.listed !== undefined && doc.listed !== liveListed) {
    errs.push(
      `--listTests count: doc=${doc.listed}, live=${liveListed}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  return errs;
}

function parseArgs(argv) {
  /** @type {{ docPaths: string[]; livePath: string | null }} */
  const opts = { docPaths: [], livePath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--doc") {
      if (!next) throw new Error("--doc requires a path");
      opts.docPaths.push(path.resolve(process.cwd(), next));
      i++;
    } else if (arg === "--live") {
      if (!next) throw new Error("--live requires a path");
      opts.livePath = path.resolve(process.cwd(), next);
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (opts.docPaths.length === 0) opts.docPaths = DEFAULT_DOC_PATHS;
  return opts;
}

/**
 * Read `--live` counts from a JSON file instead of running Jest.
 *
 * @param {string} file
 */
function readLiveCounts(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const key of ["suites", "total", "passed", "listed"]) {
    if (!Number.isInteger(raw[key])) {
      throw new Error(`--live file ${file} is missing integer "${key}"`);
    }
  }
  return {
    live: {
      suites: raw.suites,
      total: raw.total,
      passed: raw.passed,
      skipped: raw.skipped ?? 0,
      todo: raw.todo ?? 0,
      snapshots: raw.snapshots ?? 0,
      healthNote: null,
    },
    liveListed: raw.listed,
  };
}

/**
 * @param {string} p
 */
function display(p) {
  return path.relative(process.cwd(), p) || p;
}

/**
 * @param {{ docPaths: string[]; livePath: string | null }} opts
 * @returns {number} exit code (0 pass, 1 fail)
 */
function runGuard(opts) {
  let live;
  let liveListed;
  try {
    if (opts.livePath) {
      ({ live, liveListed } = readLiveCounts(opts.livePath));
    } else {
      live = captureJestCounts();
      liveListed = captureListTestsCount();
    }
  } catch (err) {
    console.error(`[check-test-count-docs] FAIL: ${err.message}`);
    return 1;
  }

  if (live.healthNote) {
    console.warn(`[check-test-count-docs] WARN: ${live.healthNote}`);
  }

  let failed = false;
  for (const docPath of opts.docPaths) {
    let source;
    try {
      source = fs.readFileSync(docPath, "utf8");
    } catch (err) {
      console.error(
        `[check-test-count-docs] FAIL: could not read ${docPath}: ${err.message}`,
      );
      failed = true;
      continue;
    }

    const doc = parseDocBlock(source);
    const errs = diff(doc, live, liveListed);

    if (errs.length === 0) {
      console.log(
        `[check-test-count-docs] PASS: ${display(docPath)} ` +
          `matches live Jest (suites=${live.suites}, tests=${live.total}, ` +
          `${live.passed} passed + ${live.skipped} skipped, ` +
          `snapshots=${live.snapshots}, --listTests=${liveListed}).`,
      );
      continue;
    }

    failed = true;
    console.error(
      `[check-test-count-docs] FAIL: ${display(docPath)} is out of sync with live Jest:`,
    );
    for (const e of errs) {
      console.error(`  - ${e}`);
    }
  }

  if (failed) {
    console.error(
      "See https://github.com/anchapin/planar-nexus/issues/1910 and " +
        "https://github.com/anchapin/planar-nexus/issues/2342.",
    );
    return 1;
  }
  return 0;
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[check-test-count-docs] FAIL: ${err.message}`);
    process.exit(1);
  }
  process.exit(runGuard(opts));
}
