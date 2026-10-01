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
 * Issue #2342: the block also lives in `docs/onboarding.md`, in a
 * markdown format (`**Test suites:** N` …) rather than the bash-comment
 * lines used in the fixtures doc. The ratchet rewrites every doc in
 * DOC_PATHS, keeping each block in the format it already has. If any doc
 * is missing its anchors, nothing is written.
 *
 * Usage:
 *   npm run ratchet:test-count
 *   node scripts/ratchet-test-count.mjs --live <counts.json> --doc <path> …
 *
 * `--live` / `--doc` exist for tests/test-count-docs-guard.test.ts: they
 * replace the Jest run with a JSON file of
 * `{ suites, total, passed, skipped, todo, snapshots, listed }` and the
 * repo docs with fixture paths.
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
export const DOC_PATHS = [
  path.join(REPO_ROOT, "docs", "TEST_VIDEO_FIXTURES.md"),
  path.join(REPO_ROOT, "docs", "onboarding.md"),
];

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
  const snapshotsMatch = summary.match(/^Snapshots:.*?(\d+)\s+total/m);
  return {
    suites: parseInt(suitesMatch[2], 10),
    total: parseInt(totalMatch[1], 10),
    passed: parseInt(passedMatch[1], 10),
    skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
    todo: todoMatch ? parseInt(todoMatch[1], 10) : 0,
    snapshots: snapshotsMatch ? parseInt(snapshotsMatch[1], 10) : 0,
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
 * Markdown-format block for docs/onboarding.md (issue #2342). Lines
 * outside a code fence, so no `# →` prefix (that would render as an H1).
 *
 * @param {{ suites: number; total: number; passed: number; skipped: number; todo: number; snapshots: number }} counts
 * @returns {string}
 */
export function renderMarkdownBlock(counts) {
  const parts = [`${counts.passed} passed`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.todo > 0) parts.push(`${counts.todo} todo`);
  return [
    `${START_ANCHOR}`,
    "",
    `**Test suites:** ${counts.suites}`,
    `**Test cases:** ${counts.total} (${parts.join(" + ")})`,
    `**Snapshots:** ${counts.snapshots}`,
    `${END_ANCHOR}`,
  ].join("\n");
}

/**
 * Which renderer the existing block uses. Must agree with
 * detectFormat() in scripts/check-test-count-docs.mjs.
 *
 * @param {string} source full doc
 * @returns {"bash" | "markdown"}
 */
export function detectFormat(source) {
  const startIdx = source.indexOf(START_ANCHOR);
  const endIdx = source.indexOf(END_ANCHOR, startIdx);
  const inner =
    startIdx === -1 || endIdx === -1 ? "" : source.slice(startIdx, endIdx);
  return /\*\*Test suites:\*\*/.test(inner) ? "markdown" : "bash";
}

/**
 * Render the block in whichever format `source` already uses.
 *
 * @param {string} source
 * @param {{ suites: number; total: number; passed: number; skipped: number; todo: number; snapshots: number }} counts
 * @param {number} listedCount
 */
export function renderBlockFor(source, counts, listedCount) {
  return detectFormat(source) === "markdown"
    ? renderMarkdownBlock(counts)
    : renderBlock(counts, listedCount);
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
        `(${START_ANCHOR} … ${END_ANCHOR}). ` +
        `Wrap the suite summary lines in those HTML comments so the ` +
        `ratchet can keep them in sync (issue #1910).`,
    );
  }
  const before = source.slice(0, startIdx);
  const after = source.slice(endIdx + END_ANCHOR.length);
  return before + block + after;
}

function parseArgs(argv) {
  /** @type {{ docPaths: string[]; livePath: string | null }} */
  const opts = { docPaths: [], livePath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--doc" || arg === "--live") {
      if (!next) throw new Error(`${arg} requires a path`);
      const resolved = path.resolve(process.cwd(), next);
      if (arg === "--doc") opts.docPaths.push(resolved);
      else opts.livePath = resolved;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (opts.docPaths.length === 0) opts.docPaths = DOC_PATHS;
  return opts;
}

/**
 * @param {string} p
 */
function display(p) {
  return path.relative(REPO_ROOT, p) || p;
}

/**
 * @param {{ docPaths: string[]; livePath: string | null }} opts
 * @returns {number} exit code (0 pass, 1 fail)
 */
function runRatchet(opts) {
  let counts;
  let listedCount;
  try {
    if (opts.livePath) {
      const raw = JSON.parse(fs.readFileSync(opts.livePath, "utf8"));
      counts = {
        suites: raw.suites,
        total: raw.total,
        passed: raw.passed,
        skipped: raw.skipped ?? 0,
        todo: raw.todo ?? 0,
        snapshots: raw.snapshots ?? 0,
      };
      listedCount = raw.listed;
    } else {
      counts = captureJestCounts();
      listedCount = captureListTestsCount();
    }
  } catch (err) {
    console.error(`[ratchet-test-count] FAIL: ${err.message}`);
    return 1;
  }

  // Compute every rewrite before touching any file, so a doc with missing
  // anchors leaves all of them as they were.
  /** @type {{ docPath: string; source: string; next: string }[]} */
  const planned = [];
  for (const docPath of opts.docPaths) {
    try {
      const source = fs.readFileSync(docPath, "utf8");
      const next = applyRatchet(
        source,
        renderBlockFor(source, counts, listedCount),
      );
      planned.push({ docPath, source, next });
    } catch (err) {
      console.error(
        `[ratchet-test-count] FAIL: ${display(docPath)}: ${err.message} ` +
          `No docs were rewritten.`,
      );
      return 1;
    }
  }

  for (const { docPath, source, next } of planned) {
    if (next === source) {
      console.log(
        `[ratchet-test-count] noop: ${display(docPath)} already matches live Jest ` +
          `(suites=${counts.suites}, tests=${counts.total}).`,
      );
      continue;
    }
    fs.writeFileSync(docPath, next, "utf8");
    console.log(
      `[ratchet-test-count] rewrote ${display(docPath)}: ` +
        `suites=${counts.suites}, tests=${counts.total} ` +
        `(${counts.passed} passed + ${counts.skipped} skipped), ` +
        `snapshots=${counts.snapshots}.`,
    );
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
    console.error(`[ratchet-test-count] FAIL: ${err.message}`);
    process.exit(1);
  }
  process.exit(runRatchet(opts));
}
