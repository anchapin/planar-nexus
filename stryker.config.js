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
// rules). Add more modules to `mutate` below as their tests are hardened.
//
//   Run:    npm run test:mutation
//   Report: reports/mutation/index.html
//
// See issue #1097 and the "Mutation Testing" section in docs/TESTING.md.
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

  // Bounded to the three rules-engine modules called out in issue #1097.
  // Target one file at a time with `npm run test:mutation -- --mutate <path>`
  // when iterating quickly.
  mutate: [
    "src/lib/game-state/layer-system.ts",
    "src/lib/game-state/replacement-effects.ts",
    "src/lib/game-state/spell-casting.ts",
  ],

  reporters: ["html", "clear-text", "progress"],

  // Project target mutation score is >=70% (see docs/TESTING.md). `high`/`low`
  // only affect report coloring. We deliberately do NOT set `thresholds.break`
  // yet, so the run reports the score without failing — the suite is still
  // maturing. Once the baseline is consistently >=70%, set `break` to enforce
  // it (mirrors the coverage ratchet in scripts/ratchet-coverage.js, #1099).
  thresholds: {
    high: 80,
    low: 70,
  },

  // 4 workers is a reasonable default on a laptop / CI runner. Override with
  // `--concurrency` if needed.
  concurrency: 4,
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
};
