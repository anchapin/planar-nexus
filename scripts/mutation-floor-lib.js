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
/**
 * Bucket key used when no uncoveredBudgets glob claims a mutated file.
 * Any uncovered mutant landing here is a configuration gap, not a debt.
 */
const UNMAPPED_MODULE = "<unmapped>";

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

  return {
    defaultFloor,
    floors: { ...config.floors },
    uncoveredBudgets: { ...(config.uncoveredBudgets || {}) },
    defaultUncoveredBudget:
      typeof config.defaultUncoveredBudget === "number"
        ? config.defaultUncoveredBudget
        : 0,
  };
}

/**
 * Resolve the floor for one module.
 * Precedence: exact per-module entry > first matching glob entry >
 * MUTATION_FLOOR/default.
 *
 * Glob entries (keys containing `*`) exist so the floors config can mirror
 * the Stryker allowlist literally — issue #1725 decomposed spell-casting.ts
 * into per-family files and `stryker.config.js` mutates the family-dir
 * glob `src/lib/game-state/spell-casting/*.ts`, so the floor key is the
 * same glob and matches each family file the report contains.
 *
 * @param {string} normalizedPath - e.g. "src/lib/game-state/layer-system.ts"
 * @param {{ defaultFloor: number, floors: Record<string, number> }} config
 * @returns {number}
 */
function floorFor(normalizedPath, config) {
  const explicit = config.floors[normalizedPath];
  if (typeof explicit === "number") return explicit;
  for (const key of Object.keys(config.floors)) {
    if (!key.includes("*")) continue;
    if (globToRegExp(key).test(normalizedPath)) {
      const floor = config.floors[key];
      if (typeof floor === "number") return floor;
    }
  }
  return config.defaultFloor;
}

/**
 * Resolve the module glob key that owns a normalised file path.
 *
 * Precedence mirrors floorFor(): an exact key wins over a glob match, and
 * the first matching glob in declaration order wins. Matching runs against
 * the uncovered-mutant budget map so a file's static-mutant count is
 * attributed to the same module its score is checked against.
 *
 * @param {string} normalizedPath - e.g. "src/lib/game-state/mana/pools.ts"
 * @param {{ uncoveredBudgets?: Record<string, number> }} config
 * @returns {string | null} the module key, or null when no module claims it
 */
function moduleFor(normalizedPath, config) {
  const budgets = config.uncoveredBudgets || {};
  if (Object.prototype.hasOwnProperty.call(budgets, normalizedPath)) {
    return normalizedPath;
  }
  for (const key of Object.keys(budgets)) {
    if (!key.includes("*")) continue;
    if (globToRegExp(key).test(normalizedPath)) return key;
  }
  return null;
}

/**
 * Aggregate ignored (static / uncovered) mutant counts per module.
 *
 * With stryker.config.js's ignoreStatic enabled, Stryker reports mutants
 * that no test covers with status "Ignored" instead of executing them. Those
 * mutants are excluded from the mutation score, so this count is the only
 * place the uncovered-code debt stays visible.
 *
 * @param {Array<{ file: string, ignored: number }>} rows
 * @param {{ uncoveredBudgets?: Record<string, number> }} config
 * @returns {Record<string, number>} module key -> ignored mutant count
 */
function computeUncoveredByModule(rows, config) {
  const totals = {};
  for (const row of rows) {
    const ignored = row.ignored || 0;
    if (ignored <= 0) continue;
    const module = moduleFor(row.file, config);
    const key = module === null ? UNMAPPED_MODULE : module;
    totals[key] = (totals[key] || 0) + ignored;
  }
  return totals;
}

/**
 * Evaluate per-module uncovered-mutant counts against their budgets.
 *
 * A module violates its budget when uncovered > budget (strictly). The
 * budget is a ceiling on uncovered-code debt: it may be lowered as coverage
 * improves, never raised.
 *
 * @param {Array<{ file: string, ignored: number }>} rows
 * @param {{ uncoveredBudgets?: Record<string, number>, defaultUncoveredBudget?: number }} config
 * @returns {{ violations: Array<{ module: string, uncovered: number, budget: number }>, ok: boolean }}
 */
function evaluateUncoveredBudgets(rows, config) {
  const totals = computeUncoveredByModule(rows, config);
  const budgets = config.uncoveredBudgets || {};
  const defaultBudget = config.defaultUncoveredBudget ?? 0;
  const violations = [];
  for (const [module, uncovered] of Object.entries(totals)) {
    const budget = Object.prototype.hasOwnProperty.call(budgets, module)
      ? budgets[module]
      : defaultBudget;
    if (uncovered > budget) {
      violations.push({ module, uncovered, budget });
    }
  }
  return { violations, ok: violations.length === 0 };
}

/**
 * Convert a repo-path glob (the limited `*` and `**` subset Stryker mutate
 * patterns use) into an anchored RegExp. A `**` path segment matches any
 * number of segments; a bare `*` matches within one segment.
 *
 * @param {string} glob - e.g. "src/lib/game-state/spell-casting/*.ts"
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.*+?^${}()|\[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "*"); // stars are glob syntax, not literals
  const source = escaped.replace(/\*\*\//g, "(?:.*/)?").replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}$`);
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
        // Static mutants that stryker.config.js's ignoreStatic skips: code no
        // test covers. Excluded from the score, so this count is the only
        // place that uncovered-code debt stays visible.
        ignored: counts.Ignored,
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
  globToRegExp,
  computeModuleScores,
  evaluateFloors,
  moduleFor,
  computeUncoveredByModule,
  evaluateUncoveredBudgets,
};
