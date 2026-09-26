#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef, no-console */
/**
 * QA Coverage Gate — Issue #1394
 *
 * Scans qa-coverage-holes.test.ts for any `it.todo` / `test.todo` calls.
 * Exits 1 if any GS-RT-N row is still marked as todo (i.e., the regression
 * test has not yet been written).  Mirrors scripts/ratchet-coverage.js (#1099).
 *
 * Usage:  node scripts/qa-coverage-gate.js
 */

const fs = require("fs");
const path = require("path");

const TEST_FILE = path.join(
  __dirname,
  "..",
  "src",
  "lib",
  "game-state",
  "__tests__",
  "qa-coverage-holes.test.ts",
);

const EXPECTED_BLOCKS = 13;

if (!fs.existsSync(TEST_FILE)) {
  console.error(`[qa-coverage-gate] FAIL: ${TEST_FILE} does not exist`);
  process.exit(1);
}

const source = fs.readFileSync(TEST_FILE, "utf8");

// Count describe blocks (one per GS-RT-N row)
const describeCount = (source.match(/describe\("GS-RT-\d+/g) || []).length;

if (describeCount < EXPECTED_BLOCKS) {
  console.error(
    `[qa-coverage-gate] FAIL: expected ${EXPECTED_BLOCKS} GS-RT-N describe blocks, found ${describeCount}`,
  );
  process.exit(1);
}

// Check for any it.todo / test.todo (should be zero once tests are written)
const todoCount = (source.match(/\b(it|test)\.todo\(/g) || []).length;

if (todoCount > 0) {
  console.error(
    `[qa-coverage-gate] FAIL: ${todoCount} it.todo/test.todo found — all GS-RT-N rows must have real tests`,
  );
  process.exit(1);
}

// Verify each GS-RT-1 through GS-RT-13 has at least one test() / it() call
const missing = [];
for (let i = 1; i <= EXPECTED_BLOCKS; i++) {
  const blockRegex = new RegExp(`describe\\("GS-RT-${i}[\\s\\S]*?\\bit\\(`);
  if (!blockRegex.test(source)) {
    missing.push(`GS-RT-${i}`);
  }
}

if (missing.length > 0) {
  console.error(
    `[qa-coverage-gate] FAIL: missing tests for: ${missing.join(", ")}`,
  );
  process.exit(1);
}

console.log(
  `[qa-coverage-gate] OK: ${describeCount}/${EXPECTED_BLOCKS} blocks present, 0 todos, all have tests`,
);
process.exit(0);
