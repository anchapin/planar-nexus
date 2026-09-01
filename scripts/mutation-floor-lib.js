#!/usr/bin/env node
/**
 * Shared mutation-score logic for the per-module floor gate (issue #1598).
 *
 * Consumed by two entry points:
 *   • scripts/mutation-floor.js  — enforcement CLI (exits non-zero)
 *   • scripts/mutation-summary.js — Markdown table for the GH job summary
 *
 * The score math intentionally mirrors what scripts/mutation-summary.js has
 * always printed: the score is the share of "detected" mutants (Killed /
 * Timeout) over the share that count against the suite (Killed + Timeout +
 * Survived + NoCoverage + RuntimeError), i.e. Ignored and CompileError
 * mutants are excluded — the same definition Stryker uses for its aggregate
 * `thresholds` gate.
 *
 * This module is plain CommonJS with no runtime deps (see the sibling
 * mutation-floor-lib.d.ts for the typed surface consumed by tests).
 */
"use strict";

const path = require("path");

/** Default floor when a module has no explicit entry and MUTATION_FLOOR is unset. */
const DEFAULT_FLOOR = 55;
/** Stryker JSON report path, resolved relative to the current working directory. */
const REPORT_PATH = path.resolve(
  process.cwd(),
  "reports/mutation/mutation.json",
);

/** Statuses that count AGAINST the suite when computing the score. */
const COUNTED_STATUSES = [
  "Killed",
  "Timeout",
  "Survived",
  "NoCoverage",
  "RuntimeError",
];

/**
 * Read the floor config and apply the MUTATION_FLOOR env override.
 *
 * @param {Record<string, string | undefined>} [env] - defaults to process.env
 * @returns {{ defaultFloor: number, floors: Record<string, number> }}
 */
function loadFloorConfig(env) {
  const source = env === undefined ? process.env : env;
  const config = require("./mutation-floor.config.js");

  let defaultFloor = config.defaultFloor;
  if (
    typeof source.MUTATION_FLOOR === "string" &&
    source.MUTATION_FLOOR !== ""
  ) {
    const parsed = Number(source.MUTATION_FLOOR);
    if (Number.isFinite(parsed)) {
      defaultFloor = parsed;
    }
    // An unparsable MUTATION_FLOOR is ignored so a typo cannot silently
    // disable the gate (the config default keeps enforcement on).
  }

  return { defaultFloor, floors: { ...config.floors } };
}

/**
 * Resolve the floor for one module.
 * Precedence: explicit per-module entry > MUTATION_FLOOR/default.
 *
 * @param {string} normalizedPath - e.g. "src/lib/game-state/layer-system.ts"
 * @param {{ defaultFloor: number, floors: Record<string, number> }} config
 * @returns {number}
 */
function floorFor(normalizedPath, config) {
  const explicit = config.floors[normalizedPath];
  return typeof explicit === "number" ? explicit : config.defaultFloor;
}

/**
 * Compute the per-module mutation scores from a parsed Stryker JSON report.
 *
 * Stryker 9.x writes `files` as an object keyed by absolute source path;
 * older releases used an array. Both shapes are normalised here (same
 * handling as mutation-summary.js).
 *
 * @param {unknown} data - parsed contents of reports/mutation/mutation.json
 * @returns {Array<{ file: string, score: number, detected: number, considered: number, survived: number, noCoverage: number }>}
 */
function computeModuleScores(data) {
  const report = /** @type {{ files?: unknown }} */ (data);
  const rawFiles =
    report && typeof report === "object" ? report.files : undefined;

  const entries = Array.isArray(rawFiles)
    ? rawFiles.map((f) => [
        (f && (f.name || f.source)) || "?",
        (f && f.mutants) || [],
      ])
    : Object.entries(
        rawFiles && typeof rawFiles === "object" ? rawFiles : {},
      ).map(([name, f]) => [name, (f && f.mutants) || []]);

  return entries
    .map(([file, mutants]) => {
      const counts = {
        Killed: 0,
        Survived: 0,
        NoCoverage: 0,
        Timeout: 0,
        RuntimeError: 0,
        Ignored: 0,
        CompileError: 0,
      };
      for (const m of mutants) {
        const s = m && m.status;
        if (counts[s] !== undefined) counts[s]++;
      }
      const detected = counts.Killed + counts.Timeout;
      const considered = COUNTED_STATUSES.reduce(
        (sum, status) => sum + counts[status],
        0,
      );
      const score = considered > 0 ? (detected / considered) * 100 : 0;
      return {
        // Normalise absolute runner paths to repo-relative ones so the
        // config keys are portable across machines/CI.
        file: String(file).replace(/^.*src\//, "src/"),
        score,
        detected,
        considered,
        survived: counts.Survived,
        noCoverage: counts.NoCoverage,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Evaluate per-module rows against their floors.
 *
 * A module violates its floor when score < floor (strictly). Modules with
 * zero countable mutants (score 0) violate too — a mutated file whose suite
 * kills nothing must not pass silently.
 *
 * @param {Array<{ file: string, score: number }>} rows
 * @param {{ defaultFloor: number, floors: Record<string, number> }} config
 * @returns {{ violations: Array<{ file: string, score: number, floor: number }>, ok: boolean }}
 */
function evaluateFloors(rows, config) {
  const violations = [];
  for (const row of rows) {
    const floor = floorFor(row.file, config);
    if (row.score < floor) {
      violations.push({ file: row.file, score: row.score, floor });
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file));
  return { violations, ok: violations.length === 0 };
}

module.exports = {
  DEFAULT_FLOOR,
  REPORT_PATH,
  COUNTED_STATUSES,
  loadFloorConfig,
  floorFor,
  computeModuleScores,
  evaluateFloors,
};
