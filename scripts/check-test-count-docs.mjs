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
 * Usage:
 *   node scripts/check-test-count-docs.mjs
 *   node scripts/check-test-count-docs.mjs --doc <path>
 *
 * Exit codes: 0 = pass, 1 = violation. The `--doc` flag exists for the
 * fixture-based tests (no flag = check the committed repo state, which
 * is what CI does).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DOC_PATH = path.join(REPO_ROOT, "docs", "TEST_VIDEO_FIXTURES.md");

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
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited with status ${result.status}:\n` +
        (result.stderr || result.stdout || "").slice(0, 2000),
    );
  }
  return (result.stdout + "\n" + result.stderr).trim();
}

/**
 * Capture live Jest numbers — same parser as the ratchet, kept
 * deliberately duplicated so the guard stays standalone (no cross-
 * module require that would need a build step or CJS/ESM bridging).
 *
 * @returns {{ suites: number; total: number; passed: number; skipped: number; todo: number }}
 */
export function captureJestCounts() {
  const summary = runCmd("npm", ["test", "--silent"]);
  const suitesMatch = summary.match(/^Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/m);
  if (!suitesMatch) {
    throw new Error(
      "Could not parse `Test Suites:` line from `npm test --silent` " +
        "output. Expected a line like 'Test Suites: 539 passed, 539 total'.",
    );
  }
  const testsMatch = summary.match(/^Tests:\s+(.+)$/m);
  if (!testsMatch) {
    throw new Error("Could not parse `Tests:` line from `npm test --silent` output.");
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
  return {
    suites: parseInt(suitesMatch[2], 10),
    total: parseInt(totalMatch[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
  };
}

/**
 * Discover the suite-file count via `npx jest --listTests | wc -l`.
 *
 * @returns {number}
 */
export function captureListTestsCount() {
  const out = runCmd("npx", ["jest", "--listTests"]);
  return out.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
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

  // Suites line: "# → Test Suites: 539 passed, 539 total  (--listTests: 539 files)"
  const suitesLine = inner.match(/(?:^|\s)Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/);
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
    suites: parseInt(suitesLine[2], 10),
    total: parseInt(totalMatch[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
    listed: parseInt(listedMatch[1], 10),
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
  if (doc.listed !== liveListed) {
    errs.push(
      `--listTests count: doc=${doc.listed}, live=${liveListed}. ` +
        `Run \`npm run ratchet:test-count\` to regenerate.`,
    );
  }
  return errs;
}

function parseArgs(argv) {
  const opts = { docPath: DEFAULT_DOC_PATH };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--doc") {
      if (!next) throw new Error("--doc requires a path");
      opts.docPath = path.resolve(process.cwd(), next);
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * @param {{ docPath: string }} opts
 * @returns {number} exit code (0 pass, 1 fail)
 */
function runGuard(opts) {
  let live;
  let liveListed;
  try {
    live = captureJestCounts();
    liveListed = captureListTestsCount();
  } catch (err) {
    console.error(`[check-test-count-docs] FAIL: ${err.message}`);
    return 1;
  }

  let source;
  try {
    source = fs.readFileSync(opts.docPath, "utf8");
  } catch (err) {
    console.error(
      `[check-test-count-docs] FAIL: could not read ${opts.docPath}: ${err.message}`,
    );
    return 1;
  }

  const doc = parseDocBlock(source);
  const errs = diff(doc, live, liveListed);

  if (errs.length === 0) {
    console.log(
      `[check-test-count-docs] PASS: ${path.relative(process.cwd(), opts.docPath) || opts.docPath} ` +
        `matches live Jest (suites=${live.suites}, tests=${live.total}, ` +
        `${live.passed} passed + ${live.skipped} skipped, --listTests=${liveListed}).`,
    );
    return 0;
  }

  console.error(
    `[check-test-count-docs] FAIL: ${path.relative(process.cwd(), opts.docPath) || opts.docPath} ` +
      `is out of sync with live Jest:`,
  );
  for (const e of errs) {
    console.error(`  - ${e}`);
  }
  console.error(
    "See https://github.com/anchapin/planar-nexus/issues/1910 and " +
      "docs/TEST_VIDEO_FIXTURES.md § Verification.",
  );
  return 1;
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
