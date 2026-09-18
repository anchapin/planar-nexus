#!/usr/bin/env node
/**
 * Test-count docs sync guard — Issue #1902.
 *
 * The `<!-- TEST_COUNT:START --> … <!-- TEST_COUNT:END -->` comment
 * block in `docs/onboarding.md` documents four counts:
 *   - **Test suites**     — `npx jest --listTests | wc -l`
 *   - **Test cases**      — totals parsed from `npm test --silent` `Tests:` line
 *                           (formatted as `<total> (<passed> passed + <skipped> skipped)`)
 *   - **Snapshots**       — totals parsed from `npm test --silent` `Snapshots:` line
 *
 * `scripts/ratchet-test-count.mjs` rewrites the block on every bump, so
 * a normal contributor run cannot introduce drift. THIS guard is the
 * backstop for any hand-edit, stale branch, or `main` cherry-pick that
 * lands a test-count change without re-running the ratchet. It runs in
 * plain Node (~100ms + the ~100s of `npm test --silent` it shells out
 * to for ground truth) and exits 1 on any drift, missing anchor, or
 * missing file. Mirrors the contract of `scripts/check-broken-links.mjs`
 * (#1896) and `scripts/check-coverage-docs-sync.mjs` (#1712) —
 * read-then-compare, fail fast in its own CI job.
 *
 * CI wiring: `.github/workflows/ci.yml` →
 *   `test-count-docs-guard`. Local equivalent: `npm run lint:test-count-docs`.
 *
 * Usage:
 *   node scripts/check-test-count-docs.mjs [--docs <path>] [--dry-run] [--json]
 *
 * Flags:
 *   --docs=<path>   Override the onboarding doc path (default: docs/onboarding.md)
 *   --dry-run       Print the violation report that WOULD fire but always exit 0
 *   --json          Emit a JSON envelope on stdout for tooling
 *
 * Exit codes: 0 = clean, 1 = drift / missing anchor / missing file.
 * Built-in Node modules + `node:child_process` + `node:fs` only.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const BLOCK_PATTERN =
  /<!-- TEST_COUNT:START -->\n([\s\S]*?)\n<!-- TEST_COUNT:END -->/;

const LINE_PATTERNS = {
  suites: /^\*\*Test suites:\*\*\s+(\d+)\s*$/m,
  cases:
    /^\*\*Test cases:\*\*\s+(\d+)\s+\((\d+)\s+passed\s+\+\s+(\d+)\s+skipped\)\s*$/m,
  snapshots: /^\*\*Snapshots:\*\*\s+(\d+)\s*$/m,
};

function parseArgs(argv) {
  const opts = { docs: undefined, dryRun: false, json: false };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--json") opts.json = true;
    else if (arg.startsWith("--docs=")) opts.docs = arg.slice("--docs=".length);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/check-test-count-docs.mjs [--docs <path>] [--dry-run] [--json]",
          "",
          "Options:",
          "  --docs=<path>   Override the onboarding doc path (default: docs/onboarding.md)",
          "  --dry-run       Print the violation report that WOULD fire but always exit 0",
          "  --json          Emit a JSON envelope on stdout for tooling",
          "",
          "Reads the <!-- TEST_COUNT:START --> ... <!-- TEST_COUNT:END --> anchor",
          "block in docs/onboarding.md and compares it against",
          "`npx jest --listTests` and `npm test --silent` (#1902).",
        ].join("\n") + "\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`check-test-count-docs: unknown flag: ${arg}\n`);
      process.exit(2);
    }
  }
  return opts;
}

function readGroundTruth() {
  const suitesOut = execSync(
    "npx --no-install jest --listTests 2>/dev/null",
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const suites = suitesOut
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;

  const testOut = execSync("npm test --silent 2>&1", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const summary = {};
  for (const line of testOut.split("\n")) {
    const m = /^(Tests|Test Suites|Snapshots):\s+(.+)$/.exec(line.trim());
    if (m) summary[m[1]] = m[2].trim();
  }
  if (!summary["Tests"]) {
    throw new Error(
      "check-test-count-docs: could not parse `Tests:` line from `npm test` output",
    );
  }
  const totalMatch = /(\d+) total/.exec(summary["Tests"]);
  const passedMatch = /(\d+) passed/.exec(summary["Tests"]);
  const skippedMatch = /(\d+) skipped/.exec(summary["Tests"]);
  if (!totalMatch || !passedMatch || !skippedMatch) {
    throw new Error(
      `check-test-count-docs: malformed Tests: line — ${JSON.stringify(summary["Tests"])}`,
    );
  }
  const cases = {
    total: Number(totalMatch[1]),
    passed: Number(passedMatch[1]),
    skipped: Number(skippedMatch[1]),
  };

  let snapshots = null;
  if (summary["Snapshots"]) {
    const snap = /(\d+) passed,\s*(\d+) total/.exec(summary["Snapshots"]);
    if (snap) snapshots = Number(snap[2]);
  }

  return { suites, cases, snapshots };
}

function readDocBlock(docsPath) {
  if (!fs.existsSync(docsPath)) {
    return { error: `docs file not found: ${docsPath}` };
  }
  const md = fs.readFileSync(docsPath, "utf8");
  const match = BLOCK_PATTERN.exec(md);
  if (!match) {
    return { error: "TEST_COUNT comment block not found" };
  }
  const inner = match[1];

  const suitesMatch = LINE_PATTERNS.suites.exec(inner);
  const casesMatch = LINE_PATTERNS.cases.exec(inner);
  const snapshotsMatch = LINE_PATTERNS.snapshots.exec(inner);

  if (!suitesMatch || !casesMatch) {
    return {
      error:
        "TEST_COUNT block is missing or malformed (need `**Test suites:** N` and `**Test cases:** T (P passed + S skipped)` lines)",
    };
  }

  return {
    error: null,
    suites: Number(suitesMatch[1]),
    cases: {
      total: Number(casesMatch[1]),
      passed: Number(casesMatch[2]),
      skipped: Number(casesMatch[3]),
    },
    snapshots: snapshotsMatch ? Number(snapshotsMatch[1]) : null,
  };
}

function run(opts) {
  const docsPath = path.resolve(REPO_ROOT, opts.docs ?? "docs/onboarding.md");
  const truth = readGroundTruth();
  const doc = readDocBlock(docsPath);

  const violations = [];
  if (doc.error) {
    violations.push({ kind: "missing-block", message: doc.error });
  } else {
    if (doc.suites !== truth.suites) {
      violations.push({
        kind: "suites-drift",
        field: "Test suites",
        doc: doc.suites,
        truth: truth.suites,
        message: `Test suites drift: doc=${doc.suites}, ground truth=${truth.suites}`,
      });
    }
    if (doc.cases.total !== truth.cases.total) {
      violations.push({
        kind: "cases-total-drift",
        field: "Test cases (total)",
        doc: doc.cases.total,
        truth: truth.cases.total,
        message: `Test cases total drift: doc=${doc.cases.total}, ground truth=${truth.cases.total}`,
      });
    }
    if (doc.cases.passed !== truth.cases.passed) {
      violations.push({
        kind: "cases-passed-drift",
        field: "Test cases (passed)",
        doc: doc.cases.passed,
        truth: truth.cases.passed,
        message: `Test cases passed drift: doc=${doc.cases.passed}, ground truth=${truth.cases.passed}`,
      });
    }
    if (doc.cases.skipped !== truth.cases.skipped) {
      violations.push({
        kind: "cases-skipped-drift",
        field: "Test cases (skipped)",
        doc: doc.cases.skipped,
        truth: truth.cases.skipped,
        message: `Test cases skipped drift: doc=${doc.cases.skipped}, ground truth=${truth.cases.skipped}`,
      });
    }
    if (truth.snapshots !== null && doc.snapshots !== truth.snapshots) {
      violations.push({
        kind: "snapshots-drift",
        field: "Snapshots",
        doc: doc.snapshots,
        truth: truth.snapshots,
        message: `Snapshots drift: doc=${doc.snapshots}, ground truth=${truth.snapshots}`,
      });
    }
  }

  return { violations, truth, doc, docsPath };
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/check-test-count-docs.mjs [--docs <path>] [--dry-run] [--json]",
    ].join("\n") + "\n",
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  printUsage();
  const result = run(opts);

  if (opts.json) {
    const envelope = {
      ok: result.violations.length === 0,
      violations: result.violations,
      truth: result.truth,
      doc: result.doc,
      docsPath: result.docsPath,
    };
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    process.exit(opts.dryRun ? 0 : envelope.ok ? 0 : 1);
  }

  if (result.violations.length === 0) {
    process.stdout.write(
      `test-count-docs: OK — docs/onboarding.md matches jest --listTests (${result.truth.suites} suites, ${result.truth.cases.total} cases).\n`,
    );
    process.exit(0);
  }

  const header = opts.dryRun
    ? `test-count-docs: DRY-RUN — ${result.violations.length} violation(s) WOULD FAIL (not gating):`
    : `test-count-docs: FAILED — ${result.violations.length} violation(s):`;
  process.stderr.write(`${header}\n`);
  for (const v of result.violations) {
    process.stderr.write(`  ${result.docsPath}  ${v.message}\n`);
  }
  process.stderr.write(
    `\nFix: run \`npm run ratchet:test-count\` locally and re-commit the updated docs/onboarding.md block — the ratchet rewrites ONLY the comment fences and leaves the rest of the file untouched (#1902).\n`,
  );

  process.exit(opts.dryRun ? 0 : 1);
}

export { run, parseArgs, readGroundTruth, readDocBlock };
