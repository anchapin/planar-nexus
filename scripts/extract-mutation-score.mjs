#!/usr/bin/env node
/**
 * Extract mutation score from Stryker JSON report.
 *
 * Reads `reports/mutation/mutation.json` and emits structured data via
 * GitHub Actions `set-output` (written to `$GITHUB_OUTPUT`) so downstream
 * steps can consume the values without re-parsing.
 *
 * Outputs (all via GITHUB_OUTPUT):
 *   score        — overall mutation score as a string, e.g. "56.5"
 *                  Empty string if the report does not exist (timed out run).
 *   status       — one of: "pass", "fail", "timeout", "error"
 *   detected     — number of killed+timeout mutants
 *   considered   — number of mutants counted in the denominator
 *   below-floor  — "true" if score < floor for this module, "false" otherwise
 *
 * Usage:
 *   node scripts/extract-mutation-score.mjs
 *
 * Consumed by:
 *   .github/workflows/mutation-pr.yml  (mutation-score job)
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/** Statuses that count against the suite for the mutation score denominator. */
const COUNTED_STATUSES = new Set([
  "Killed",
  "Timeout",
  "Survived",
  "NoCoverage",
  "RuntimeError",
]);

const REPORT_PATH = join(REPO_ROOT, "reports/mutation/mutation.json");
const FLOOR_CONFIG = require(join(REPO_ROOT, "scripts", "mutation-floor.config.js"));

/** Per-module floor, matching the nightly mutation.yml logic. */
const LAYER_SYSTEM_FLOOR =
  FLOOR_CONFIG.floors?.["src/lib/game-state/layer-system.ts"] ??
  FLOOR_CONFIG.defaultFloor ??
  55;

const outputs = {
  score: "",
  status: "error",
  detected: "0",
  considered: "0",
  "below-floor": "false",
};

function writeOutput(key, value) {
  // GitHub Actions set-output pattern: write to $GITHUB_OUTPUT
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `${key}=${value}\n`);
  }
  // Also echo for visibility in the Actions log
  console.log(`::set-output name=${key}::${value}`);
}

function computeScore(report) {
  // Stryker JSON: report.result is an array of per-file objects.
  // Each file has a `metrics` object with totals.
  const files = report.results ?? [];
  let totalDetected = 0;
  let totalConsidered = 0;

  for (const file of files) {
    const metrics = file.metrics ?? {};
    // Use the totals section which aggregates all test frameworks
    const totals = metrics.totals ?? {};
    const escape = totals.escape ?? 0;
    const killed = totals.killed ?? 0;
    const timeout = totals.timeout ?? 0;
    const survived = totals.survived ?? 0;
    const noCoverage = totals.noCoverage ?? 0;
    const runtimeErrors = totals.runtimeError ?? 0;
    const ignored = totals.ignored ?? 0;
    const compileErrors = totals.compileErrors ?? 0;

    const detected = killed + timeout;
    const counted = survived + noCoverage + runtimeErrors;
    const excluded = ignored + compileErrors;

    totalDetected += detected;
    totalConsidered += detected + counted;
  }

  if (totalConsidered === 0) return null;

  return {
    detected: totalDetected,
    considered: totalConsidered,
    score: (totalDetected / totalConsidered) * 100,
  };
}

function main() {
  try {
    if (!readFileSync(REPORT_PATH, "utf8")) {
      // File empty or missing — treat as timeout
      outputs.status = "timeout";
      writeOutput("score", outputs.score);
      writeOutput("status", outputs.status);
      writeOutput("detected", outputs.detected);
      writeOutput("considered", outputs.considered);
      writeOutput("below-floor", outputs["below-floor"]);
      return;
    }

    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    const result = computeScore(report);

    if (!result) {
      outputs.status = "error";
      writeOutput("score", outputs.score);
      writeOutput("status", outputs.status);
      writeOutput("detected", outputs.detected);
      writeOutput("considered", outputs.considered);
      writeOutput("below-floor", outputs["below-floor"]);
      return;
    }

    outputs.detected = String(result.detected);
    outputs.considered = String(result.considered);
    outputs.score = result.score.toFixed(1);

    // status: compare against the layer-system floor (same floor used by
    // the nightly per-module gate in mutation.yml)
    outputs.status = result.score >= LAYER_SYSTEM_FLOOR ? "pass" : "fail";
    outputs["below-floor"] =
      result.score < LAYER_SYSTEM_FLOOR ? "true" : "false";
  } catch (err) {
    if (err.code === "ENOENT" || err.message?.includes("Unexpected end")) {
      outputs.status = "timeout";
    } else {
      outputs.status = "error";
      console.error("extract-mutation-score:", err.message);
    }
  }

  writeOutput("score", outputs.score);
  writeOutput("status", outputs.status);
  writeOutput("detected", outputs.detected);
  writeOutput("considered", outputs.considered);
  writeOutput("below-floor", outputs["below-floor"]);
}

main();
