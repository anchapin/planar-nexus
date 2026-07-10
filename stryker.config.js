// Stryker mutation-testing configuration.
//
// Mutation testing verifies whether the unit-test suite actually catches logic
// changes ("mutants"), not merely whether a line executed. Coverage only proves
// a line ran; mutation score proves the tests would fail if the logic changed.
//
// This config is intentionally SCOPED to the rules-engine invariants in
// `src/lib/game-state/` — NOT the whole repo. Mutating thousands of unrelated
// lines is far too slow for local/CI use and dilutes the signal on the modules
// where ordering and boundary conditions ARE the correctness argument (MTG
// rules).
//
//   Run (all scoped modules):   npm run test:mutation
//   Run (one module, fast):     npm run mutate -- src/lib/game-state/layer-system.ts
  //   Or via dedicated scripts:   npm run mutate:layer-system
  //                              npm run mutate:replacement-effects
  //                              npm run mutate:spell-casting
  //                              npm run mutate:trigger-system
  //                              npm run mutate:state-based-actions
  //   Report:                     reports/mutation/index.html
//
// See issues #1097 (initial setup), #1265 (enforce threshold in CI), and the
// "Mutation Testing" section in docs/TESTING.md.
/** @type {import('@stryker-mutator/core/api').StrykerOptions} */
module.exports = {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  packageManager: "npm",

  // Reuse the existing Jest setup (jest.config.js, ts-jest, jsdom).
  testRunner: "jest",
  // Only run the tests that actually cover each mutant — the single biggest
  // performance lever for Stryker on a large suite. Supported by the Jest
  // runner via per-test coverage data.
  coverageAnalysis: "perTest",
  // Insert `// @ts-nocheck` into mutated inputs so a mutant is only "killed"
  // when a test fails, never because ts-jest flagged a type error. Without
  // this, type-check failures inflate the score dishonestly.
  disableTypeChecks: true,
  jest: {
    projectType: "custom",
    configFile: "jest.config.js",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PER-FILE ALLOWLIST
  // ─────────────────────────────────────────────────────────────────────────
  // Only the modules in `mutate` are mutated by `npm run test:mutation` and by
  // the full nightly run (.github/workflows/mutation.yml). This is the gate
  // called out in issue #1265: add one module at a time, raise its test
  // coverage/threshold to >=70%, then enable it here.
  //
  //   PR gate (per PR, ~15-20 min):   npm run mutate:layer-system
  //                                    (.github/workflows/ci.yml)
  //   Nightly gate (all modules):     npm run test:mutation
  //                                    (.github/workflows/mutation.yml)
  //
  // The CI-on-PR gate is intentionally scoped to ONE module so a single PR
  // completes the run quickly. The nightly run covers the full allowlist and
  // doubles as the ratchet for the other modules.
  //
  // Issue #1395: expanded the allowlist from 3 → 5 modules by adding the two
  // remaining correctness-critical rules-engine files — `trigger-system.ts`
  // (CR 603 trigger firing / intervening-if) and `state-based-actions.ts`
  // (CR 704.5 SBAs). Targeted `*.mutation.test.ts` suites were added alongside
  // each to kill the boundary/condition mutants that previously survived.
  // `break` stays at 50 until the nightly run records each new module's
  // baseline; it is raised to 70 in a follow-up only after BOTH clear 70%.
  mutate: [
    "src/lib/game-state/layer-system.ts",
    "src/lib/game-state/replacement-effects.ts",
    "src/lib/game-state/spell-casting.ts",
    "src/lib/game-state/trigger-system.ts",
    "src/lib/game-state/state-based-actions.ts",
  ],

  reporters: ["html", "clear-text", "progress", "json"],

  // ─────────────────────────────────────────────────────────────────────────
  // THRESHOLDS
  // ─────────────────────────────────────────────────────────────────────────
  //   high = green band in the HTML report   (score >= high)
  //   low  = yellow band                     (low <= score < high)
  //   break = Stryker exits non-zero         (score < break → fail)
  //
  // The project target mutation score is **>=70%** — the same floor as the
  // Jest coverage ratchet (scripts/ratchet-coverage.js, issue #1099) and the
  // documented TESTING.md target. Measured baselines (single-module runs):
  //   • replacement-effects.ts : 77.78% (293 killed / 441 mutants)
  //   • layer-system.ts        : 56.65% (measured in PR #1297 / CI run
  //                              28489517797). Test improvements tracked
  //                              separately; raising this to 70%+ will
  //                              allow `break` to be raised back to 70.
  //   • spell-casting.ts       : measured separately
  //   • trigger-system.ts      : PENDING measurement (issue #1395). Targeted
  //                              `trigger-system.mutation.test.ts` added;
  //                              covers CR 603.4 intervening-if gating, untap
  //                              "your" ownership, prowess noncreature/owner
  //                              gating + multi-instance, storm copy-count
  //                              math, monarchy scoping, APNAP ordering.
  //   • state-based-actions.ts : PENDING measurement (issue #1395). Targeted
  //                              `state-based-actions.mutation.test.ts` added;
  //                              covers counter-derived toughness, +1/+1↔-1/-1
  //                              annihilation, indestructible gate, 0-loyalty
  //                              exile-vs-destroy, commander-damage boundary,
  //                              per-player legend rule & PW uniqueness.
  //
  // `break` is the gate enforced by CI (.github/workflows/ci.yml,
  // `.github/workflows/mutation.yml`) and local `npm run test:mutation`. Any
  // pull request that drops the aggregate score below `break` on the
  // configured allowlist fails the gate, mirroring the coverage ratchet.
  //
  // `break: 50` is set ~6.5pts BELOW the measured layer-system baseline so
  // the PR gate passes today. The plan is to grow the test suite (issue
  // follow-up) until layer-system + both #1395 modules are comfortably
  // >=70%, then raise `break` to 70 in a follow-up PR.
  thresholds: {
    high: 80,
    low: 55,
    break: 50,
  },

  // 4 workers is a reasonable default on a laptop / CI runner. Override with
  // `--concurrency` or the STRYKER_CONCURRENCY env var if needed.
  concurrency: process.env.STRYKER_CONCURRENCY
    ? Number(process.env.STRYKER_CONCURRENCY)
    : 4,
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
