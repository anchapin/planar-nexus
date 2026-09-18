#!/usr/bin/env node
/**
 * Ratcheting test-count script — Issue #1910.
 *
 * Reads the live Jest summary and rewrites the anchored test-count block
 * in `docs/TEST_VIDEO_FIXTURES.md` so the doc never carries a stale
 * `npm test` summary again. Mirrors `scripts/ratchet-coverage.js`
 * (#1099) in spirit (rewrites doc text), but never lowers any number —
 * the floor is the **current measured value** (every Jest run is the
 * new ground truth; the ratchet just keeps the doc in lockstep).
 *
 * Behavior:
 *   - Parses `Test Suites:` and `Tests:` lines from `npm test --silent`
 *     output and `npx jest --listTests | wc -l` for the file-discovered
 *     suite count (matches what CI sees via `--listTests`).
 *   - Locates the `<!-- TEST_COUNT:START -->` … `<!-- TEST_COUNT:END -->`
 *     block in the doc and rewrites ONLY its inner lines. Anything else
 *     (heading, prose, the `# → 51 test suites passed` video-derived
 *     subset line) is untouched.
 *   - On any parse error or missing anchor, exits non-zero and does not
 *     touch the file.
 *
 * The companion guard `scripts/check-test-count-docs.mjs` re-runs the
 * same measurements in CI and fails the build when the doc drifts.
 *
 * Usage:
 *   npm run ratchet:test-count
 *
 * Exit codes: 0 = success (rewritten or already current), 1 = error.
 * Built-in Node modules only — no runtime dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DOC_PATH = path.join(REPO_ROOT, "docs", "TEST_VIDEO_FIXTURES.md");

export const START_ANCHOR = "<!-- TEST_COUNT:START -->";
export const END_ANCHOR = "<!-- TEST_COUNT:END -->";

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
 * Capture live Jest numbers — both Test Suites count and Tests count
 * parsed out of the summary line.
 *
 * @returns {{ suites: number; total: number; passed: number; skipped: number; todo: number }}
 */
export function captureJestCounts() {
  const summary = runCmd("npm", ["test", "--silent"]);
  const suitesMatch = summary.match(
    /^Test Suites:\s+(\d+)\s+passed,\s+(\d+)\s+total/m,
  );
  if (!suitesMatch) {
    throw new Error(
      "Could not parse `Test Suites:` line from `npm test --silent` " +
        "output. Expected a line like 'Test Suites: 539 passed, 539 total'.",
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
 * Format the new block content. The block lives inside a fenced
 * ```bash code block; the lines MUST stay valid bash (so they start
 * with `# →`).
 *
 * @param {{ suites: number; total: number; passed: number; skipped: number; todo: number }} counts
 * @param {number} listedCount
 * @returns {string}
 */
export function renderBlock(counts, listedCount) {
  const parts = [`${counts.passed} passed`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.todo > 0) parts.push(`${counts.todo} todo`);
  parts.push(`${counts.total} total`);
  const breakdown = parts.join(", ");

  const suitePhrase = `Test Suites: ${counts.suites} passed, ${counts.suites} total`;
  return [
    `${START_ANCHOR}`,
    `# → ${suitePhrase}  (--listTests: ${listedCount} files)`,
    `# → Tests: ${breakdown}`,
    `${END_ANCHOR}`,
  ].join("\n");
}

/**
 * Replace the anchored block in the doc. Returns the new full source.
 *
 * @param {string} source
 * @param {string} block
 * @returns {string}
 */
export function applyRatchet(source, block) {
  const startIdx = source.indexOf(START_ANCHOR);
  const endIdx = source.indexOf(END_ANCHOR, startIdx);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Could not locate the anchored test-count block ` +
        `(${START_ANCHOR} … ${END_ANCHOR}) in docs/TEST_VIDEO_FIXTURES.md. ` +
        `Wrap the suite summary lines in those HTML comments so the ` +
        `ratchet can keep them in sync (issue #1910).`,
    );
  }
  const before = source.slice(0, startIdx);
  const after = source.slice(endIdx + END_ANCHOR.length);
  return before + block + after;
}

/**
 * @returns {number} exit code (0 pass, 1 fail)
 */
function runRatchet() {
  /** @type {{ suites: number; total: number; passed: number; skipped: number; todo: number }} */
  let counts;
  let listedCount;
  try {
    counts = captureJestCounts();
    listedCount = captureListTestsCount();
  } catch (err) {
    console.error(`[ratchet-test-count] FAIL: ${err.message}`);
    return 1;
  }

  const block = renderBlock(counts, listedCount);

  let source;
  try {
    source = fs.readFileSync(DOC_PATH, "utf8");
  } catch (err) {
    console.error(
      `[ratchet-test-count] FAIL: could not read ${path.relative(REPO_ROOT, DOC_PATH)}: ${err.message}`,
    );
    return 1;
  }

  let next;
  try {
    next = applyRatchet(source, block);
  } catch (err) {
    console.error(`[ratchet-test-count] FAIL: ${err.message}`);
    return 1;
  }

  if (next === source) {
    console.log(
      `[ratchet-test-count] noop: test-count block in ${path.relative(REPO_ROOT, DOC_PATH)} ` +
        `already matches live Jest (suites=${counts.suites}, tests=${counts.total}).`,
    );
    return 0;
  }

  fs.writeFileSync(DOC_PATH, next, "utf8");
  console.log(
    `[ratchet-test-count] rewrote ${path.relative(REPO_ROOT, DOC_PATH)}: ` +
      `suites=${counts.suites}, tests=${counts.total} ` +
      `(${counts.passed} passed + ${counts.skipped} skipped).`,
  );
  return 0;
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  process.exit(runRatchet());
}
