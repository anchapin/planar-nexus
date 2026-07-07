/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.tsx",
    // Integration tests live in the repo-root <rootDir>/tests directory and
    // exercise real cross-module workflows. See issue #931.
    "<rootDir>/tests/**/*.test.ts",
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
  ],
  // Coverage thresholds — ENFORCED by CI (ci.yml "Run unit tests with coverage").
  // Values are set just below MEASURED coverage so the gate catches real
  // regressions without being flaky. Measured 2026-06-26 (jest --coverage):
  //   statements 37.66% | branches 29.97% | functions 31.09% | lines 37.98%
  // The documented project target is 70% (README/TESTING/CONTRIBUTING). This
  // floor is ratcheted upward automatically by `scripts/ratchet-coverage.js`
  // (`npm run test:coverage:ratchet`, issue #1099) — the floor moves toward 70%
  // as coverage improves and can never silently decay. DO NOT raise a threshold
  // above measured coverage or CI will fail. Re-measure with
  // `npm run test:coverage` before adjusting by hand.
  // See: https://github.com/anchapin/planar-nexus/issues/922
  coverageThreshold: {
    global: {
      branches: 28,
      functions: 30,
      lines: 36,
      statements: 36,
    },
  },
  // `json-summary` emits coverage/coverage-summary.json, consumed by
  // scripts/ratchet-coverage.js (npm run test:coverage:ratchet, issue #1099).
  coverageReporters: ["text-summary", "lcov", "html", "json-summary"],
};
