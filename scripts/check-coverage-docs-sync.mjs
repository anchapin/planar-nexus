#!/usr/bin/env node
/**
 * Coverage Docs Sync Guard — Issue #1712
 *
 * The coverage-floor tables in README.md, CONTRIBUTING.md, and
 * docs/TESTING.md document the CI-enforced floor that lives in
 * `jest.config.js` → `coverageThreshold.global`. That floor is ratcheted
 * upward automatically by `scripts/ratchet-coverage.js`
 * (`npm run test:coverage:ratchet`, issue #1099), and the ratchets kept
 * outrunning hand-edited doc tables (#1712: docs said 22–29% while the
 * enforced floor had ratcheted to 52–60%).
 *
 * Fixes since #1712 keep them in lockstep from two directions:
 *
 *   1. `scripts/ratchet-coverage.js` rewrites the anchored tables
 *      (`<!-- coverage-floor:start -->` … `<!-- coverage-floor:end -->`)
 *      on every bump, so a normal ratchet can no longer introduce drift.
 *   2. THIS script is the drift backstop for manual doc edits: it reads
 *      the four thresholds straight out of jest.config.js, parses the
 *      floor column (the last `N%` cell of each metric row) out of every
 *      anchored table, and exits 1 on any mismatch, missing anchor, or
 *      missing file — so stale numbers fail CI instead of shipping.
 *
 * It runs in plain Node (~1ms, no toolchain) in its own CI job
 * (`.github/workflows/ci.yml` → `coverage-docs-guard`) and locally via
 * `npm run lint:coverage-docs`, mirroring the
 * `scripts/check-tauri-updater-config.mjs` guard pattern.
 *
 * Usage:
 *   node scripts/check-coverage-docs-sync.mjs
 *   node scripts/check-coverage-docs-sync.mjs --config <jest.config.js> \
 *       --docs <doc>[,<doc>...]
 *
 * The flags exist for the fixture-based tests (tests/coverage-docs-guard.test.ts)
 * — with no flags the guard checks the committed repo state exactly like CI.
 *
 * Exits 0 on pass, 1 on violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const JEST_CONFIG = path.join(REPO_ROOT, "jest.config.js");
const DOC_PATHS = [
  path.join(REPO_ROOT, "README.md"),
  path.join(REPO_ROOT, "CONTRIBUTING.md"),
  path.join(REPO_ROOT, "docs", "TESTING.md"),
];

const METRICS = ["branches", "functions", "lines", "statements"];

const START_ANCHOR = "<!-- coverage-floor:start -->";
const END_ANCHOR = "<!-- coverage-floor:end -->";

// Mirrors BLOCK_RE from scripts/ratchet-coverage.js (kept deliberately
// duplicated so the guard stays standalone — no cross-module require that
// would need a build step or CJS/ESM bridging).
const THRESHOLD_BLOCK_RE =
  /(coverageThreshold:\s*\{\s*global:\s*\{)([\s\S]*?)(\})/;

// One data row of an anchored coverage table. The floor column is the LAST
// `N%` cell of the row in every anchored table.
const ROW_RE =
  /^\s*\|\s*(Lines|Functions|Statements|Branches)\s*\|[^\r\n]*\|\s*(\d+(?:\.\d+)?)%\s*\|\s*$/;

/**
 * Read the four global thresholds out of jest.config.js source text.
 *
 * @param {string} source - jest.config.js contents.
 * @returns {Record<string, number>} metric -> threshold value.
 */
export function readThresholds(source) {
  const match = source.match(THRESHOLD_BLOCK_RE);
  if (!match) {
    throw new Error(
      "Could not locate the coverageThreshold.global block in jest.config.js.",
    );
  }
  const values = {};
  for (const metric of METRICS) {
    const m = match[2].match(
      new RegExp(`["']?${metric}["']?\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`),
    );
    if (!m) {
      throw new Error(
        `coverageThreshold.global is missing the "${metric}" key.`,
      );
    }
    values[metric] = parseFloat(m[1]);
  }
  return values;
}

/**
 * Parse the floor column out of one anchored doc block.
 *
 * @param {string} block - text between the start/end anchors.
 * @returns {Record<string, number>} metric -> documented floor value.
 */
export function parseDocBlockFloors(block) {
  const floors = {};
  for (const line of block.split("\n")) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    floors[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  return floors;
}

/**
 * Compare one doc file against the jest.config.js thresholds.
 *
 * @param {string} docPath - absolute path to the markdown file.
 * @param {Record<string, number>} thresholds - metric -> enforced value.
 * @param {string} rootDir - repo root used for relative path display.
 * @returns {{ ok: true } | { ok: false; errors: string[] }}
 */
export function checkDocFile(docPath, thresholds, rootDir = REPO_ROOT) {
  const rel = path.relative(rootDir, docPath) || docPath;
  /** @type {string[]} */
  const errors = [];

  let source;
  try {
    source = fs.readFileSync(docPath, "utf8");
  } catch {
    return {
      ok: false,
      errors: [
        `${rel}: expected a coverage-floor table but the file is missing.`,
      ],
    };
  }

  const startIdx = source.indexOf(START_ANCHOR);
  const endIdx = startIdx === -1 ? -1 : source.indexOf(END_ANCHOR, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    return {
      ok: false,
      errors: [
        `${rel}: missing "${START_ANCHOR}" / "${END_ANCHOR}" anchors around ` +
          "the coverage-floor table. Wrap the table in those comments so " +
          "scripts/ratchet-coverage.js can keep it in sync (issue #1712).",
      ],
    };
  }

  const floors = parseDocBlockFloors(
    source.slice(startIdx + START_ANCHOR.length, endIdx),
  );

  for (const metric of METRICS) {
    if (!Object.prototype.hasOwnProperty.call(floors, metric)) {
      errors.push(
        `${rel}: anchored table has no row for "${metric}" ` +
          "(expected rows for Lines, Functions, Statements, and Branches).",
      );
      continue;
    }
    if (floors[metric] !== thresholds[metric]) {
      errors.push(
        `${rel}: ${metric} floor is documented as ${floors[metric]}% but ` +
          `jest.config.js enforces ${thresholds[metric]}%. Re-run ` +
          "`npm run test:coverage:ratchet` or update the table to match " +
          "jest.config.js coverageThreshold.global.",
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ configPath: string; docPaths: string[] }}
 */
function parseArgs(argv) {
  const opts = {
    configPath: JEST_CONFIG,
    docPaths: [...DOC_PATHS],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--config") {
      if (!next) throw new Error("--config requires a path");
      opts.configPath = path.resolve(process.cwd(), next);
      i++;
    } else if (arg === "--docs") {
      if (!next) throw new Error("--docs requires a comma-separated path list");
      opts.docPaths = next
        .split(",")
        .map((p) => path.resolve(process.cwd(), p));
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * @param {{ configPath: string; docPaths: string[] }} opts
 * @returns {number} exit code (0 pass, 1 fail)
 */
function run(opts) {
  /** @type {Record<string, number>} */
  let thresholds;
  try {
    thresholds = readThresholds(fs.readFileSync(opts.configPath, "utf8"));
  } catch (err) {
    console.error(`[check-coverage-docs-sync] FAIL: ${err.message}`);
    return 1;
  }

  const summary = Object.entries(thresholds)
    .map(([metric, pct]) => `${metric} ${pct}%`)
    .join(", ");

  /** @type {string[]} */
  const errors = [];
  for (const docPath of opts.docPaths) {
    const result = checkDocFile(
      docPath,
      thresholds,
      path.dirname(opts.configPath),
    );
    if (!result.ok) errors.push(...result.errors);
  }

  if (errors.length === 0) {
    console.log(
      `[check-coverage-docs-sync] PASS: ${opts.docPaths.length} ` +
        `coverage-floor table${opts.docPaths.length === 1 ? "" : "s"} match ` +
        `${path.relative(process.cwd(), opts.configPath) || opts.configPath} ` +
        `(${summary}).`,
    );
    return 0;
  }

  console.error(
    "[check-coverage-docs-sync] FAIL: coverage-floor doc tables are out of " +
      "sync with jest.config.js coverageThreshold.global:",
  );
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  console.error(
    "See https://github.com/anchapin/planar-nexus/issues/1712 and " +
      "docs/TESTING.md §10 (Ratcheting the coverage floor).",
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
    console.error(`[check-coverage-docs-sync] FAIL: ${err.message}`);
    process.exit(1);
  }
  process.exit(run(opts));
}
