#!/usr/bin/env node
/**
 * Module Size Budget Guard — Issues #1725 (game-state), #1808 (src/ai)
 *
 * CI gate that keeps the rules-engine modules under `src/lib/game-state/`
 * AND the AI opponent/consumption modules under `src/ai/` from regrowing
 * into four-digit monoliths. Size × churn is the standard proxy for
 * change risk: every merge touching a monolith risks regressing the
 * layer/replacement/trigger behavior the mutation gates protect, and
 * per-module mutation suites grow slower as unrelated concerns accrete
 * in one file (#1725).
 *
 * BUDGETS:
 *   - src/lib/game-state/: 2,000 lines (issue #1725 — see rationale below)
 *   - src/ai/:            3,500 lines (issue #1808 — see rationale below)
 *
 * Scope per module:
 *   - every TypeScript file under the scope root (recursively)
 *   - EXCLUDES test suites under any __tests__ directory (they scale with
 *     coverage, not with module cohesion)
 *   - EXCLUDES the public barrel `index.ts` (a pure re-export +
 *     collision-disambiguation surface; its length tracks the number of
 *     modules in the scope, not module complexity)
 *
 * Threshold rationale — src/lib/game-state/ (measured after the #1725
 * decomposition):
 *   - current max: layer-system.ts at 1,934 lines — deliberately NOT
 *     decomposed; it implements a single algorithm (CR 613 continuous
 *     layer application) and carries the repo's mutation-testing gates.
 *     2,000 keeps it legal with ~3% headroom.
 *   - the four decomposed churn offenders now max out at 1,221 lines
 *     (`spell-casting/cast.ts`: canCastSpell + the single castSpell
 *     pipeline, which cannot be split mechanically).
 *   - a flat 2,000 with NO per-file exceptions was chosen over the
 *     issue's illustrative 1,500 because an exception list is a slippery
 *     slope (every future monolith would add itself); the flat budget
 *     still blocks any regrowth toward monolith scale.
 *
 * Threshold rationale — src/ai/ (measured after the #1808 audit):
 *   - the AI layer is structurally larger than the engine: it carries
 *     feature tables (archetype-signatures, synergy-database), lookup
 *     weights (counterpell-frequency-model, weight-learning), and the
 *     model-side state translators that the engine correctness
 *     properties do not require (CR 613-style layer logic stays in
 *     game-state).
 *   - current top: stack-interaction-ai.ts at 3,295 lines, followed by
 *     decision-making/combat-decision-tree.ts at 2,561, ai-turn-loop.ts
 *     at 2,425, game-state-evaluator.ts at 2,134, synergy-detector.ts
 *     at 1,876.
 *   - 3,500 captures the four top offenders with ~6% headroom and
 *     blocks any further regrowth without forcing immediate
 *     decomposition. A decomposition sweep is tracked separately if
 *     the slimmer-machine team decides it has payoff.
 *   - a flat budget with NO per-file exceptions preserves the
 *     precedent: the only escape hatch is to raise the scope's
 *     SIZE_BUDGET_LINES with a documented rationale (see the
 *     trailing error message).
 *
 * Exit codes:
 *   0 — all scopes pass (every module within its scope's budget)
 *   1 — at least one scope has offenders (listed on stderr)
 *
 * Usage:
 *   node scripts/check-engine-size-budget.mjs          # gate
 *   node scripts/check-engine-size-budget.mjs --report # list top-10 per scope
 *
 * Wired into package.json as `lint:engine-size` and run by the CI job
 * `engine-size-budget` (.github/workflows/ci.yml), which the `build` job
 * depends on — an oversized module blocks merge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/**
 * A budgeted scope. Each scope is a directory tree walked recursively for
 * TypeScript files; each file must fit within `budgetLines`.
 *
 * @typedef {Object} Scope
 * @property {string} name       Human-readable label used in messages.
 * @property {string} dir        Absolute path to the scope root.
 * @property {string} rootRel    Path relative to REPO_ROOT used when
 *                               reporting the file (POSIX-style).
 * @property {number} budgetLines Maximum allowed line count for files
 *                               inside this scope.
 * @property {Set<string>} excludedFiles Absolute paths exempted (e.g.
 *                               the public barrel). Substring match for
 *                               portability across OS path separators.
 * @property {string[]} excludedDirSegments Directory names that abort a
 *                               recursive walk (e.g. `__tests__`).
 */

/** @type {Scope[]} */
const SCOPES = [
  {
    name: "engine",
    dir: join(REPO_ROOT, "src", "lib", "game-state"),
    rootRel: "src/lib/game-state",
    budgetLines: 2000,
    excludedFiles: new Set([
      join(REPO_ROOT, "src", "lib", "game-state", "index.ts"),
    ]),
    excludedDirSegments: ["__tests__"],
  },
  {
    name: "ai",
    dir: join(REPO_ROOT, "src", "ai"),
    rootRel: "src/ai",
    budgetLines: 3500,
    // No `index.ts` exemption: the ai barrel is content-free at the
    // time of #1808 (the AI surface is a tightly named set of files
    // that re-export nothing). If a barrel lands later the same
    // exemption pattern from the engine scope applies — add it here.
    excludedFiles: new Set(),
    excludedDirSegments: ["__tests__"],
  },
];

/**
 * Recursively collect TypeScript files for one scope, deterministic order.
 * @param {Scope} scope
 * @returns {string[]} Absolute paths.
 */
function collectScopeModules(scope) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (scope.excludedDirSegments.includes(entry)) continue;
        walk(full);
      } else if (
        entry.endsWith(".ts") &&
        ![...scope.excludedFiles].some((excluded) => full === excluded)
      ) {
        out.push(full);
      }
    }
  }
  walk(scope.dir);
  return out;
}

/**
 * Count lines of a file (wc -l semantics: newline-terminated lines).
 * @param {string} absPath
 * @returns {number}
 */
function lineCount(absPath) {
  const contents = readFileSync(absPath, "utf8");
  const count = contents.split("\n").length;
  // A trailing newline produces one empty split tail; mirror `wc -l`.
  return contents.endsWith("\n") ? count - 1 : count;
}

/**
 * @typedef {Object} ScannedModule
 * @property {string} scopeName
 * @property {string} scopeBudgetLines
 * @property {string} file   POSIX-style absolute path (relative to
 *                           REPO_ROOT for reporting).
 * @property {number} lines
 */

/**
 * Scan a single scope and return one record per file.
 * @param {Scope} scope
 * @returns {ScannedModule[]}
 */
function scanScope(scope) {
  return collectScopeModules(scope).map((abs) => ({
    scopeName: scope.name,
    scopeBudgetLines: String(scope.budgetLines),
    file: relative(REPO_ROOT, abs).split("\\").join("/"),
    lines: lineCount(abs),
  }));
}

const modules = SCOPES.flatMap(scanScope);

if (process.argv.includes("--report")) {
  console.log("module-size budget report (per scope):");
  for (const scope of SCOPES) {
    const inScope = modules
      .filter((m) => m.scopeName === scope.name)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10);
    console.log(
      `  ${scope.name} (budget: ${scope.budgetLines} lines) — top ${inScope.length}:`
    );
    for (const m of inScope) {
      const over = Number(m.lines) > Number(m.scopeBudgetLines) ? "  ⚠ OVER" : "";
      console.log(
        `    ${String(m.lines).padStart(5)}  ${m.file}${over}`
      );
    }
  }
  process.exit(0);
}

const offenders = modules.filter(
  (m) => Number(m.lines) > Number(m.scopeBudgetLines)
);

if (offenders.length === 0) {
  const engineMax = modules
    .filter((m) => m.scopeName === "engine")
    .reduce((a, m) => Math.max(a, m.lines), 0);
  const aiMax = modules
    .filter((m) => m.scopeName === "ai")
    .reduce((a, m) => Math.max(a, m.lines), 0);
  const total = modules.length;
  console.log(
    `module-size-budget: OK — ${total} files within budget ` +
      `(engine max: ${engineMax}, ai max: ${aiMax}).`
  );
  process.exit(0);
}

console.error(
  `module-size-budget: FAILED — ${offenders.length} file(s) exceed their scope budget (issue #1725/#1808):`
);
for (const o of offenders) {
  console.error(
    `  ${o.scopeName.padEnd(8)}  ${String(o.lines).padStart(5)}  ` +
      `${o.file} (+${o.lines - Number(o.scopeBudgetLines)} over budget ${o.scopeBudgetLines})`
  );
}
console.error(
  `\nDecompose the offender along its ability/Concern families (see the\n` +
    `keyword-actions/, oracle-text-parser/, spell-casting/, types/ dirs for\n` +
    `the established pattern in src/lib/game-state/, mirrored by\n` +
    `src/ai/decision-making/ for the AI surface) or, if the file is\n` +
    `genuinely cohesive, raise SIZE_BUDGET_LINES in\n` +
    `scripts/check-engine-size-budget.mjs with a documented rationale.`
);
process.exit(1);
