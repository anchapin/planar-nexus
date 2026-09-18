#!/usr/bin/env node
/**
 * Test-count docs ratchet — Issue #1902.
 *
 * Rewrites the `<!-- TEST_COUNT:START --> … <!-- TEST_COUNT:END -->`
 * comment block in `docs/onboarding.md` with the current ground truth
 * from `npx jest --listTests` (suite count) and `npm test --silent`
 * (case counts via the `Tests:` / `Test Suites:` / `Snapshots:` lines).
 *
 * Mirrors the shape of `scripts/ratchet-coverage.js` (regression bumps
 * the floor, never lowers it) and `scripts/check-coverage-docs-sync.mjs`
 * (anchor-block contract). The CI counterpart is
 * `scripts/check-test-count-docs.mjs`, which fails the build if this
 * block drifts from the live Jest output (#1902).
 *
 * The block ONLY changes the four lines inside the comment fences —
 * everything else in `docs/onboarding.md` is left untouched.
 *
 * Usage:
 *   node scripts/ratchet-test-count.mjs [--docs <path>] [--dry-run]
 *
 * Exit codes: 0 = block rewritten (or already current), 1 = error.
 * Built-in Node modules + `node:child_process` + `node:fs` only — no
 * runtime dependencies, so it can run before `npm ci` is required.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const BLOCK_PATTERN =
  /<!-- TEST_COUNT:START -->[\s\S]*?<!-- TEST_COUNT:END -->/;

function parseArgs(argv) {
  const opts = { docs: undefined, dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--docs=")) opts.docs = arg.slice("--docs=".length);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/ratchet-test-count.mjs [--docs <path>] [--dry-run]",
          "",
          "Options:",
          "  --docs=<path>   Override the onboarding doc path (default: docs/onboarding.md)",
          "  --dry-run       Print the proposed block without modifying the file",
          "",
          "Rewrites the TEST_COUNT comment block in docs/onboarding.md with",
          "current `jest --listTests` and `npm test --silent` ground truth (#1902).",
        ].join("\n") + "\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`ratchet-test-count: unknown flag: ${arg}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function countSuites() {
  const out = execSync("npx --no-install jest --listTests 2>/dev/null", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function countCases() {
  const out = execSync("npm test --silent 2>&1", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const summary = {};
  for (const line of out.split("\n")) {
    const m = /^(Tests|Test Suites|Snapshots):\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    summary[m[1]] = m[2].trim();
  }
  if (!summary["Tests"]) {
    throw new Error(
      "ratchet-test-count: could not parse `Tests:` line from `npm test` output",
    );
  }
  const totalMatch = /(\d+) total/.exec(summary["Tests"]);
  const passedMatch = /(\d+) passed/.exec(summary["Tests"]);
  const skippedMatch = /(\d+) skipped/.exec(summary["Tests"]);
  if (!totalMatch || !passedMatch || !skippedMatch) {
    throw new Error(
      `ratchet-test-count: malformed Tests: line — ${JSON.stringify(summary["Tests"])}`,
    );
  }
  return {
    total: Number(totalMatch[1]),
    passed: Number(passedMatch[1]),
    skipped: Number(skippedMatch[1]),
    suitesLine: summary["Test Suites"] ?? null,
    snapshotsLine: summary["Snapshots"] ?? null,
  };
}

function buildBlock({ suites, cases }) {
  const lines = [
    "<!-- TEST_COUNT:START -->",
    `**Test suites:** ${suites}`,
    `**Test cases:** ${cases.total} (${cases.passed} passed + ${cases.skipped} skipped)`,
  ];
  if (cases.snapshotsLine) {
    const snap = /(\d+) passed,\s*(\d+) total/.exec(cases.snapshotsLine);
    if (snap) {
      lines.push(`**Snapshots:** ${snap[2]}`);
    }
  }
  lines.push("<!-- TEST_COUNT:END -->");
  return lines.join("\n");
}

function run(opts) {
  const docsPath = path.resolve(
    REPO_ROOT,
    opts.docs ?? "docs/onboarding.md",
  );
  const suites = countSuites();
  const cases = countCases();
  const block = buildBlock({ suites, cases });

  if (!fs.existsSync(docsPath)) {
    throw new Error(
      `ratchet-test-count: docs file not found at ${docsPath}`,
    );
  }
  const md = fs.readFileSync(docsPath, "utf8");
  if (!BLOCK_PATTERN.test(md)) {
    throw new Error(
      `ratchet-test-count: TEST_COUNT comment block not found in ${docsPath}`,
    );
  }
  const updated = md.replace(BLOCK_PATTERN, block);

  if (opts.dryRun) {
    process.stdout.write(
      `[dry-run] would rewrite TEST_COUNT block to:\n${block}\n`,
    );
    return { suites, cases, dryRun: true };
  }

  fs.writeFileSync(docsPath, updated);
  return { suites, cases, dryRun: false };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = run(opts);
    process.stdout.write(
      `ratchet: ${result.suites} suites, ${result.cases.total} cases (${result.cases.passed} passed + ${result.cases.skipped} skipped)\n`,
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`ratchet-test-count: ${err.message}\n`);
    process.exit(1);
  }
}

export { run, parseArgs, buildBlock, countSuites, countCases };
