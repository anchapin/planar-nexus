#!/usr/bin/env node
/**
 * Per-module mutation-score breakdown.
 *
 * Reads Stryker's JSON report (`reports/mutation/mutation.json`, produced by
 * the `json` reporter in stryker.config.js) and emits a Markdown table with one
 * row per mutated module. Designed to feed the GitHub Actions job summary via
 * `$GITHUB_STEP_SUMMARY` (issue #1395) so a future regression surfaces which
 * module slipped below the gate.
 *
 *   node scripts/mutation-summary.js                 # prints Markdown to stdout
 *   GITHUB_STEP_SUMMARY=... node scripts/mutation-summary.js
 *
 * Status buckets follow Stryker's mutation-score definition: the score is the
 * share of "detected" mutants (Killed / Timeout) over the share that count
 * against the suite (Killed + Timeout + Survived + NoCoverage + RuntimeError),
 * i.e. Ignored and CompileError mutants are excluded.
 *
 * Issue #1598: rows below their per-module floor (see
 * scripts/mutation-floor.config.js) are additionally annotated with a
 * "⚠️ BELOW FLOOR" marker, distinct from the emoji buckets — the same floors
 * the mutation-floor.js gate enforces right after this step in the nightly
 * workflow.
 */

"use strict";

const fs = require("fs");

const {
  REPORT_PATH,
  loadFloorConfig,
  floorFor,
  computeModuleScores,
} = require("./mutation-floor-lib.js");

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    process.stderr.write(
      `mutation-summary: ${REPORT_PATH} not found — skipping.\n`,
    );
    process.exitCode = 0;
    return;
  }

  const data = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  const config = loadFloorConfig();

  const rows = computeModuleScores(data);

  const lines = [
    "### Mutation score breakdown",
    "",
    "| Module | Score | Killed/Detected | Survived | No coverage |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    const mark = r.score >= 70 ? "🟢" : r.score >= 50 ? "🟡" : "🔴";
    const floor = floorFor(r.file, config);
    // Issue #1598: flag rows whose module would fail the per-module floor
    // gate. Distinct from the emoji buckets so the two signals stay readable.
    const belowFloor = r.score < floor ? " ⚠️ BELOW FLOOR" : "";
    lines.push(
      `| ${mark} \`${r.file}\`${belowFloor} | ${r.score.toFixed(1)}% | ${r.detected}/${r.considered} | ${r.survived} | ${r.noCoverage} |`,
    );
  }

  const markdown = lines.join("\n") + "\n";
  process.stdout.write(markdown);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(summary, markdown);
  }
}

main();
