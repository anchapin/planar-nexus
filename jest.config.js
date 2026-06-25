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
  testPathIgnorePatterns: [
    "/src/lib/__tests__/keyword-actions.test.ts",
    "/src/lib/game-state/__tests__/keyword-actions.test.ts",
    "/src/lib/game-state/__tests__/evergreen-keywords.test.ts",
    "/src/lib/game-state/__tests__/standard-mechanics.test.ts",
    "/src/lib/game-state/__tests__/hand-targeting.test.ts",
    "/src/lib/game-state/__tests__/golden-scenarios.test.ts",
  ],
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
  // regressions without being flaky. Measured 2026-06-24 (jest --coverage):
  //   statements 32.86% | branches 25.58% | functions 26.99% | lines 33.19%
  // These ~double the previous 15/17/22 floor. The documented project target
  // is 70% (README/TESTING/CONTRIBUTING); raising toward 70% is tracked as
  // follow-up work — DO NOT raise a threshold above measured coverage or CI
  // will fail. Re-measure with `npm run test:coverage` before adjusting.
  // See: https://github.com/anchapin/planar-nexus/issues/922
  coverageThreshold: {
    global: {
      branches: 22,
      functions: 23,
      lines: 29,
      statements: 29,
    },
  },
  coverageReporters: ["text-summary", "lcov", "html"],
};
