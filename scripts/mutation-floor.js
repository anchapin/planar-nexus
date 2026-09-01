#!/usr/bin/env node
/**
 * Per-module mutation-score floor gate (issue #1598).
 *
 * Stryker's `thresholds.break` in stryker.config.js only gates the AGGREGATE
 * score across every allowlisted module combined, so a single module can
 * regress silently (e.g. one module at 35% while the rest sit at 80% still
 * clears break: 50). This script parses the SAME report
 * (`reports/mutation/mutation.json`) that scripts/mutation-summary.js renders
 * and exits non-zero if ANY module drops below its floor in
 * scripts/mutation-floor.config.js.
 *
 *   node scripts/mutation-floor.js                 # gate against the config floors
 *   MUTATION_FLOOR=40 node scripts/mutation-floor.js  # blunt env override
 *
 * Wired in:
 *   • .github/workflows/mutation.yml — nightly job, after mutation-summary.js
 *   • package.json `test:mutation`   — so the gate is locally discoverable
 *
 * Exit codes:
 *   0  every mutated module scored >= its floor (or the report is absent —
 *      Stryker's own `break` gate covers hard failures, and in the
 *      `test:mutation` chain this script only runs after a successful run)
 *   1  at least one module scored below its floor, or the report is malformed
 */
"use strict";

const fs = require("fs");

const {
  REPORT_PATH,
  loadFloorConfig,
  computeModuleScores,
  evaluateFloors,
} = require("./mutation-floor-lib.js");

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    process.stderr.write(
      `mutation-floor: ${REPORT_PATH} not found — skipping (nothing to gate).\n`,
    );
    process.exitCode = 0;
    return;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  } catch (err) {
    process.stderr.write(
      `mutation-floor: failed to parse ${REPORT_PATH}: ${err && err.message}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const config = loadFloorConfig();
  const rows = computeModuleScores(data);
  const { violations, ok } = evaluateFloors(rows, config);

  if (ok) {
    process.stdout.write(
      `mutation-floor: all ${rows.length} mutated module(s) at or above their floors.\n`,
    );
    process.exitCode = 0;
    return;
  }

  process.stderr.write(
    `mutation-floor: ${violations.length}/${rows.length} mutated module(s) below the mutation-score floor:\n`,
  );
  for (const v of violations) {
    process.stderr.write(
      `mutation-floor:   ${v.file} scored ${v.score.toFixed(1)}% (floor: ${v.floor}) — ⚠️ BELOW FLOOR\n`,
    );
  }
  process.stderr.write(
    "mutation-floor: gate failed — raise the tests for the offending module(s) or re-measure and adjust scripts/mutation-floor.config.js if the baseline legitimately moved.\n",
  );
  process.exitCode = 1;
}

main();
