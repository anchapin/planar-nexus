/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  roots: ["<rootDir>/src", "<rootDir>/tests", "<rootDir>/e2e"],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.tsx",
    // Integration tests live in the repo-root <rootDir>/tests directory and
    // exercise real cross-module workflows. See issue #931.
    "<rootDir>/tests/**/*.test.ts",
    // E2E fixture unit tests
    "<rootDir>/e2e/**/*.test.ts",
    "<rootDir>/e2e/**/*.test.tsx",
  ],
  // The six game-state suites that were previously skipped here have been
  // repaired and re-enabled (issue #1093):
  //   src/lib/__tests__/keyword-actions.test.ts
  //   src/lib/game-state/__tests__/keyword-actions.test.ts
  //   src/lib/game-state/__tests__/evergreen-keywords.test.ts
  //   src/lib/game-state/__tests__/standard-mechanics.test.ts
  //   src/lib/game-state/__tests__/hand-targeting.test.ts
  //   src/lib/game-state/__tests__/golden-scenarios.test.ts
  testPathIgnorePatterns: ["/node_modules/"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // @orama/* ships ESM under the `browser`/`import` export conditions which
    // Jest's jsdom resolver selects by default and cannot parse. Map to the
    // prebuilt CommonJS artifacts so the test runtime can require them.
    "^@orama/orama$":
      "<rootDir>/node_modules/@orama/orama/dist/commonjs/index.js",
    "^@orama/plugin-data-persistence$":
      "<rootDir>/node_modules/@orama/plugin-data-persistence/dist/commonjs.cjs",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          rootDir: ".",
        },
        useESM: false,
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    // #1723: documentation-style example modules live here (moved out of
    // the engine); they are reference code, not production surface.
    "!src/examples/**",
    // #1860: pure prompt-data export — no test surface, not coverage-tracked.
    "!src/ai/flows/judge-call-extraction-prompt.ts",
  ],
  // Coverage thresholds — ENFORCED by CI (ci.yml "Run unit tests with coverage").
  // IMPORTANT: Jest's threshold check uses per-worker raw coverage data (~1.5pp
  // lower than the merged JSON summary). Thresholds are set conservatively
  // relative to JSON-measured values to account for this gap. The documented
  // project target is 70% (README/TESTING/CONTRIBUTING). The floor is ratcheted
  // upward automatically by `scripts/ratchet-coverage.js` (`npm run
  // test:coverage:ratchet`, issue #1099) — it moves toward 70% as coverage
  // improves and can never silently decay. DO NOT raise a threshold above
  // the per-worker measured value (run `npm test -- --coverage` and use the
  // "Coverage for X does not meet" reported values as your guide).
  // See: https://github.com/anchapin/planar-nexus/issues/922
  coverageThreshold: {
    global: {
      branches: 54,
      functions: 56,
      lines: 64,
      statements: 63,
    },
  },
  // `json-summary` emits coverage/coverage-summary.json, consumed by
  // scripts/ratchet-coverage.js (npm run test:coverage:ratchet, issue #1099).
  coverageReporters: ["text-summary", "lcov", "html", "json-summary"],
};
