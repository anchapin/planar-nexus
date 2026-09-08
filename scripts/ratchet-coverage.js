#!/usr/bin/env node
/**
 * Ratcheting coverage-threshold script (issue #1099).
 *
 * Reads `coverage/coverage-summary.json` (emitted by Jest's `json-summary`
 * reporter), compares the measured global coverage against the
 * `coverageThreshold.global` block in `jest.config.js`, and rewrites that
 * block up to `floor(measured - margin)` per metric.
 *
 * Behavior:
 *   - measured < current threshold -> REGRESSION: print a clear report and
 *     exit non-zero (CI fails). jest.config.js is NOT modified.
 *   - measured > threshold         -> BUMP: raise the floor (monotonically;
 *     it is never lowered) and rewrite jest.config.js, preserving formatting.
 *     The anchored coverage-floor tables in README.md, CONTRIBUTING.md, and
 *     docs/TESTING.md are rewritten too (issue #1712).
 *   - measured == ratcheted floor  -> NO-OP (idempotent; second run is a nop).
 *
 * The floor for each metric is `max(current, floor(measured - margin))`, so the
 * ratchet only ever moves up and always leaves `margin` headroom to avoid
 * flapping. Default margin = 1 percentage point; override with `--margin <n>`
 * or the `RATCHET_MARGIN` env var.
 *
 * Usage:
 *   npm run test:coverage            # produce coverage/coverage-summary.json
 *   node scripts/ratchet-coverage.js [--margin <n>] [--coverage <path>]
 *                                    [--config <path>] [--dry-run]
 *
 * Exit codes: 0 = success (bump applied or already at floor), 1 = regression
 * or error. Built-in Node modules only — no runtime dependencies.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const METRICS = ["branches", "functions", "lines", "statements"];
const DEFAULT_MARGIN = 1;

/**
 * Matches the `coverageThreshold.global { ... }` block in jest.config.js.
 * group 1 = prefix ending at the `{` that opens `global`,
 * group 2 = the inner property list (captured lazily up to global's `}`),
 * group 3 = global's closing `}`.
 * Tolerant of whitespace; the first `}` after `global: {` is always global's
 * own close because its direct children are scalar key/value pairs.
 */
const BLOCK_RE = /(coverageThreshold:\s*\{\s*global:\s*\{)([\s\S]*?)(\})/;

function pad(name) {
  return String(name).padEnd(10);
}

function parseArgs(argv) {
  const opts = {
    margin: DEFAULT_MARGIN,
    coveragePath: "coverage/coverage-summary.json",
    configPath: "jest.config.js",
    dryRun: false,
  };
  let marginSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--margin") {
      opts.margin = parseFloat(next);
      if (!Number.isFinite(opts.margin)) {
        throw new Error("--margin requires a numeric value, e.g. --margin 1.5");
      }
      marginSet = true;
      i++;
    } else if (arg === "--coverage") {
      if (!next) throw new Error("--coverage requires a path");
      opts.coveragePath = next;
      i++;
    } else if (arg === "--config") {
      if (!next) throw new Error("--config requires a path");
      opts.configPath = next;
      i++;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/ratchet-coverage.js [options]",
          "",
          "Options:",
          "  --margin <n>      Safety margin in percentage points (default: 1).",
          "                    Floor is computed as floor(measured - margin).",
          "  --coverage <path> Path to coverage-summary.json",
          "                    (default: coverage/coverage-summary.json).",
          "  --config <path>   Path to jest.config.js (default: jest.config.js).",
          "  --dry-run         Print the planned change without writing.",
          "  --help, -h        Show this help.",
          "",
          "Env: RATCHET_MARGIN overrides the default margin (ignored if --margin set).",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg} (see --help)`);
    }
  }
  if (!marginSet && process.env.RATCHET_MARGIN != null) {
    const envMargin = parseFloat(process.env.RATCHET_MARGIN);
    if (Number.isFinite(envMargin)) opts.margin = envMargin;
  }
  return opts;
}

function readCoverageSummary(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Coverage summary not found at ${filePath}.\n` +
          `Run "npm run test:coverage" first — Jest must enable the "json-summary" ` +
          `reporter (see coverageReporters in jest.config.js).`,
      );
    }
    throw new Error(
      `Failed to read coverage summary (${filePath}): ${err.message}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Coverage summary is not valid JSON (${filePath}): ${err.message}`,
    );
  }
  return parsed;
}

function extractMeasured(summary) {
  const total = summary && summary.total;
  if (!total || typeof total !== "object") {
    throw new Error("coverage-summary.json is missing the 'total' object.");
  }
  const measured = {};
  for (const metric of METRICS) {
    const entry = total[metric];
    const pct = entry && entry.pct;
    if (typeof pct !== "number" || !Number.isFinite(pct)) {
      throw new Error(
        `coverage-summary.json has no numeric total.${metric}.pct ` +
          `(got ${JSON.stringify(pct)}). Re-run coverage before ratcheting.`,
      );
    }
    measured[metric] = pct;
  }
  return measured;
}

function readCurrentValues(inner) {
  const values = {};
  for (const metric of METRICS) {
    const re = new RegExp(`["']?${metric}["']?\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`);
    const match = inner.match(re);
    if (!match) {
      throw new Error(
        `coverageThreshold.global is missing the "${metric}" key.`,
      );
    }
    values[metric] = parseFloat(match[1]);
  }
  return values;
}

/**
 * Compute the ratcheted floor for each metric plus the change report.
 * Floors are monotonic: a floor is never lowered below the current value.
 * Returns { floors, regressions, bumps }.
 */
function computeFloors(measured, current, margin) {
  const floors = {};
  const regressions = [];
  const bumps = [];
  for (const metric of METRICS) {
    const meas = measured[metric];
    const cur = current[metric];
    if (meas < cur) {
      regressions.push({ metric, measured: meas, current: cur });
      floors[metric] = cur; // never lower
    } else {
      const target = Math.max(cur, Math.floor(meas - margin));
      floors[metric] = target;
      if (target > cur) {
        bumps.push({ metric, from: cur, to: target, measured: meas });
      }
    }
  }
  return { floors, regressions, bumps };
}

function detectIndents(inner) {
  const propMatch = inner.match(/\n([ \t]*)\S/);
  const closeMatch = inner.match(/([ \t]*)$/);
  return {
    propIndent: propMatch ? propMatch[1] : "      ",
    closeIndent: closeMatch ? closeMatch[1] : "    ",
  };
}

function renderInner(floors, propIndent, closeIndent) {
  const lines = METRICS.map((m) => `${propIndent}${m}: ${floors[m]},`);
  return "\n" + lines.join("\n") + "\n" + closeIndent;
}

/**
 * Compute the ratchet result for a jest.config.js source string.
 * Returns { kind, current, floors, bumps, regressions, nextSource } where
 * nextSource is null unless kind === "bump" (the rewritten, byte-stable source).
 */
function applyRatchet(configSource, measured, margin) {
  const match = configSource.match(BLOCK_RE);
  if (!match) {
    throw new Error(
      "Could not locate the coverageThreshold.global block in jest.config.js.",
    );
  }
  const prefix = match[1];
  const inner = match[2];
  const close = match[3];
  const current = readCurrentValues(inner);
  const { floors, regressions, bumps } = computeFloors(
    measured,
    current,
    margin,
  );

  if (regressions.length > 0) {
    return {
      kind: "regression",
      current,
      floors,
      bumps,
      regressions,
      nextSource: null,
    };
  }
  if (bumps.length === 0) {
    return {
      kind: "noop",
      current,
      floors,
      bumps,
      regressions,
      nextSource: configSource,
    };
  }

  const { propIndent, closeIndent } = detectIndents(inner);
  const newInner = renderInner(floors, propIndent, closeIndent);
  const nextSource =
    configSource.slice(0, match.index) +
    prefix +
    newInner +
    close +
    configSource.slice(match.index + match[0].length);
  return { kind: "bump", current, floors, bumps, regressions, nextSource };
}

/**
 * Doc-table sync (issue #1712).
 *
 * The coverage-floor tables in README.md, CONTRIBUTING.md, and
 * docs/TESTING.md are wrapped in HTML anchor comments:
 *
 *   <!-- coverage-floor:start --> ... <!-- coverage-floor:end -->
 *
 * After a bump rewrites jest.config.js, these helpers rewrite the floor
 * column (the last `N%` cell of each metric row) inside every anchored
 * block so the docs can never drift behind the config again. A separate
 * guard (scripts/check-coverage-docs-sync.mjs, `npm run
 * lint:coverage-docs`) fails CI when a doc is edited by hand with stale
 * numbers; the ratchet only rewrites docs that carry the anchors and
 * reports the rest as skipped (it never fails because of a doc).
 */
const DOC_START_ANCHOR = "<!-- coverage-floor:start -->";
const DOC_END_ANCHOR = "<!-- coverage-floor:end -->";
const DOC_PATHS = ["README.md", "CONTRIBUTING.md", "docs/TESTING.md"];

/**
 * Matches one data row of an anchored coverage table, e.g.
 *   | Lines      | 70%    | 29%               |
 * group 1 = leading whitespace + opening pipe,
 * group 2 = metric name (case-insensitive),
 * group 3 = everything up to the final cell's number,
 * group 4 = the floor number (final numeric % cell in the row),
 * group 5 = whitespace + closing pipe.
 * The floor column is the LAST column in every anchored table, so this is
 * robust against extra leading columns (e.g. the Target column).
 */
const DOC_ROW_RE =
  /^(\s*\|\s*)(Lines|Functions|Statements|Branches)(\s*\|[^\r\n]*\|\s*)(\d+(?:\.\d+)?)%(\s*\|)[ \t]*$/;

/** Rewrite the floor cells inside one anchored block, preserving alignment. */
function applyFloorsToDocBlock(block, floors) {
  return block
    .split("\n")
    .map((line) => {
      const m = line.match(DOC_ROW_RE);
      if (!m) return line;
      const metric = m[2].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(floors, metric)) return line;
      const next = String(floors[metric]);
      // Keep the rendered row width stable when the digit count changes by
      // moving padding spaces in front of the closing pipe.
      const delta = m[4].length - next.length;
      let tail = m[5];
      if (delta !== 0) {
        const innerSpaces = tail.length - 1; // minus the "|" itself
        tail = " ".repeat(Math.max(0, innerSpaces + delta)) + "|";
      }
      return m[1] + m[2] + m[3] + next + "%" + tail;
    })
    .join("\n");
}

/**
 * Sync every anchored coverage table in `docPaths` to `floors`.
 * Returns [{ docPath, status }] where status is "updated", "in-sync",
 * "missing", or "unanchored". Never throws for a doc problem.
 */
function syncCoverageDocTables(floors, docPaths) {
  const results = [];
  for (const docPath of docPaths) {
    let source;
    try {
      source = fs.readFileSync(docPath, "utf-8");
    } catch {
      results.push({ docPath, status: "missing" });
      continue;
    }
    const startIdx = source.indexOf(DOC_START_ANCHOR);
    const endIdx =
      startIdx === -1 ? -1 : source.indexOf(DOC_END_ANCHOR, startIdx);
    if (startIdx === -1 || endIdx === -1) {
      results.push({ docPath, status: "unanchored" });
      continue;
    }
    const after = startIdx + DOC_START_ANCHOR.length;
    const block = source.slice(after, endIdx);
    const nextBlock = applyFloorsToDocBlock(block, floors);
    if (nextBlock === block) {
      results.push({ docPath, status: "in-sync" });
      continue;
    }
    fs.writeFileSync(
      docPath,
      source.slice(0, after) + nextBlock + source.slice(endIdx),
      "utf-8",
    );
    results.push({ docPath, status: "updated" });
  }
  return results;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[ratchet] ${err.message}`);
    process.exit(1);
  }

  const root = process.cwd();
  const coveragePath = path.resolve(root, opts.coveragePath);
  const configPath = path.resolve(root, opts.configPath);

  let summary;
  try {
    summary = readCoverageSummary(coveragePath);
  } catch (err) {
    console.error(`[ratchet] ${err.message}`);
    process.exit(1);
  }

  let measured;
  try {
    measured = extractMeasured(summary);
  } catch (err) {
    console.error(`[ratchet] ${err.message}`);
    process.exit(1);
  }

  let source;
  try {
    source = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    console.error(
      `[ratchet] Could not read Jest config at ${configPath}: ${err.message}`,
    );
    process.exit(1);
  }

  let result;
  try {
    result = applyRatchet(source, measured, opts.margin);
  } catch (err) {
    console.error(`[ratchet] ${err.message}`);
    process.exit(1);
  }

  const fmt = (n) => `${n.toFixed(1)}%`;

  if (result.kind === "regression") {
    console.error(
      "[ratchet] Coverage regression detected — thresholds NOT lowered.",
    );
    console.error("[ratchet] Metrics below the current floor:");
    for (const r of result.regressions) {
      const delta = (r.measured - r.current).toFixed(1);
      console.error(
        `  ${pad(r.metric)} measured ${fmt(r.measured)} < floor ${fmt(r.current)} (${delta})`,
      );
    }
    console.error(
      "\n[ratchet] Restore coverage above the floor, then re-run. CI will fail until then.",
    );
    process.exit(1);
  }

  if (result.kind === "noop") {
    console.info(
      "[ratchet] Thresholds already at the ratcheted floor — no change.",
    );
    for (const m of METRICS) {
      console.info(
        `  ${pad(m)} floor ${result.floors[m]}% (measured ${fmt(measured[m])})`,
      );
    }
    process.exit(0);
  }

  console.info(
    `[ratchet] Bumping coverage floor — floor(measured - ${opts.margin}pp margin):`,
  );
  for (const b of result.bumps) {
    console.info(
      `  ${pad(b.metric)} ${b.from}% -> ${b.to}% (measured ${fmt(b.measured)})`,
    );
  }
  const unchanged = METRICS.filter(
    (m) => !result.bumps.some((b) => b.metric === m),
  );
  if (unchanged.length) {
    console.info(
      `[ratchet] Already at floor (unchanged): ${unchanged.join(", ")}`,
    );
  }

  if (opts.dryRun) {
    console.info("\n[ratchet] --dry-run set: jest.config.js not modified.");
    console.info(
      "[ratchet] Doc tables (README/CONTRIBUTING/TESTING) would also be " +
        "synced on a real run (issue #1712).",
    );
    process.exit(0);
  }

  try {
    fs.writeFileSync(configPath, result.nextSource, "utf-8");
  } catch (err) {
    console.error(`[ratchet] Failed to write Jest config: ${err.message}`);
    process.exit(1);
  }
  console.info(
    `\n[ratchet] Updated ${path.relative(root, configPath) || "jest.config.js"}.`,
  );

  // Issue #1712: keep the documented floor tables in lockstep with the bump.
  let docResults;
  try {
    docResults = syncCoverageDocTables(
      result.floors,
      DOC_PATHS.map((p) => path.resolve(root, p)),
    );
  } catch (err) {
    console.error(
      `[ratchet] Failed to sync coverage doc tables: ${err.message}`,
    );
    process.exit(1);
  }
  for (const r of docResults) {
    const rel = path.relative(root, r.docPath) || r.docPath;
    if (r.status === "updated") {
      console.info(`[ratchet] Synced coverage-floor table in ${rel}.`);
    } else if (r.status !== "in-sync") {
      console.info(
        `[ratchet] Note: ${rel} not synced (${r.status} — no anchored ` +
          `coverage-floor table). Run "npm run lint:coverage-docs" to check.`,
      );
    }
  }
  process.exit(0);
}

module.exports = {
  METRICS,
  DEFAULT_MARGIN,
  BLOCK_RE,
  DOC_START_ANCHOR,
  DOC_END_ANCHOR,
  DOC_PATHS,
  DOC_ROW_RE,
  parseArgs,
  readCoverageSummary,
  extractMeasured,
  readCurrentValues,
  computeFloors,
  applyRatchet,
  applyFloorsToDocBlock,
  syncCoverageDocTables,
  main,
};

if (require.main === module) {
  main();
}
