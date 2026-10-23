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
 *      or contains no mutated file at all (issue #2835 — a run that
 *      instrumented 0 files measured nothing and must not pass vacuously)
 */
"use strict";

const fs = require("fs");

const {
  REPORT_PATH,
  loadFloorConfig,
  computeModuleScores,
  evaluateFloors,
  evaluateUncoveredBudgets,
} = require("./mutation-floor-lib.js");

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    process.stderr.write(
      `mutation-floor: ${REPORT_PATH} not found — failing closed (issue #2295). ` +
        `A missing report means Stryker did not produce one; the floor gate ` +
        `must not silently skip and hide the upstream failure.\n`,
    );
    process.exitCode = 1;
    return;
  }

  let data;
  try {
    const raw = fs.readFileSync(REPORT_PATH, "utf8");
    if (raw.trim().length === 0) {
      process.stderr.write(
        `mutation-floor: ${REPORT_PATH} is empty — failing closed (issue #2295). ` +
          `Stryker wrote a zero-byte report; the floor gate must not silently ` +
          `skip and hide the upstream failure.\n`,
      );
      process.exitCode = 1;
      return;
    }
    data = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `mutation-floor: failed to parse ${REPORT_PATH}: ${err && err.message}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const config = loadFloorConfig();
  const rows = computeModuleScores(data);

  // Issue #2835: a stale `--mutate` path makes Stryker instrument 0 files.
  // The report then carries no mutated file at all, the aggregate score is
  // NaN and every floor comparison would pass vacuously (`NaN >= 44`).
  // The gate must fail closed instead of reporting success for a run that
  // measured nothing.
  if (rows.length === 0) {
    process.stderr.write(
      `mutation-floor: ${REPORT_PATH} contains 0 mutated files — failing ` +
        `closed (issue #2835). Stryker instrumented nothing, so the run ` +
        `measured nothing (NaN score) and the floor gate must not pass ` +
        `vacuously. Check the --mutate path of the module that was run ` +
        `(npm run mutate:<module>).\n`,
    );
    process.exitCode = 1;
    return;
  }

  const { violations, ok } = evaluateFloors(rows, config);
  // Issue #1785: stryker.config.js's ignoreStatic skips mutants that no test
  // covers, which keeps the gate inside its CI timeout but hides that debt
  // from the score. The per-module uncovered-mutant budget gates it instead.
  const uncovered = evaluateUncoveredBudgets(rows, config);

  if (ok && uncovered.ok) {
    process.stdout.write(
      `mutation-floor: all ${rows.length} mutated module(s) at or above their floors.\n`,
    );
    process.exitCode = 0;
    return;
  }

  if (!ok) {
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
  }

  if (!uncovered.ok) {
    process.stderr.write(
      `mutation-floor: ${uncovered.violations.length} module(s) exceed their uncovered-mutant budget:\n`,
    );
    for (const v of uncovered.violations) {
      process.stderr.write(
        `mutation-floor:   ${v.module} has ${v.uncovered} uncovered (static) mutant(s) (budget: ${v.budget}) — ⚠️ UNCOVERED DEBT\n`,
      );
    }
    process.stderr.write(
      "mutation-floor: gate failed — uncovered-code debt grew. Cover the module's uncovered branches with tests, or re-measure and lower the budget in scripts/mutation-floor.config.js if the baseline legitimately moved.\n",
    );
  }

  process.exitCode = 1;
}

main();
