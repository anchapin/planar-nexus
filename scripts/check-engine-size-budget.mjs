#!/usr/bin/env node
/**
 * Engine Module Size Budget Guard — Issue #1725
 *
 * CI gate that keeps the rules-engine modules under `src/lib/game-state/`
 * from regrowing into four-digit monoliths. Size × churn is the standard
 * proxy for change risk: every merge touching a monolith risks regressing
 * the layer/replacement/trigger behavior the mutation gates protect, and
 * per-module mutation suites grow slower as unrelated concerns accrete in
 * one file (#1725).
 *
 * BUDGET: no engine module may exceed SIZE_BUDGET_LINES (2,000) lines.
 *
 * Scope:
 *   - every TypeScript file under src/lib/game-state/ (recursively)
 *   - EXCLUDES test suites under any __tests__ directory (they scale with
 *     coverage, not with module cohesion)
 *   - EXCLUDES the public barrel `src/lib/game-state/index.ts` (a pure
 *     re-export + collision-disambiguation surface; its length tracks the
 *     number of engine modules, not module complexity)
 *
 * Threshold rationale (measured after the #1725 decomposition):
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
 * Exit codes:
 *   0 — all engine modules within budget
 *   1 — at least one module over budget (offenders listed on stdout)
 *
 * Usage:
 *   node scripts/check-engine-size-budget.mjs          # gate
 *   node scripts/check-engine-size-budget.mjs --report # list top-10 by size
 *
 * Wired into package.json as `lint:engine-size` and run by the CI job
 * `engine-size-budget` (.github/workflows/ci.yml), which the `build` job
 * depends on — an oversized module blocks merge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const ENGINE_DIR = join(REPO_ROOT, "src", "lib", "game-state");

/** Maximum allowed line count per engine module (see header rationale). */
const SIZE_BUDGET_LINES = 2000;

/** Files/dirs exempt from the budget (see header rationale). */
const EXCLUDED_FILES = new Set([join(ENGINE_DIR, "index.ts")]);
const EXCLUDED_DIR_SEGMENTS = new Set(["__tests__"]);

/**
 * Recursively collect engine TypeScript files in deterministic order.
 * @returns {string[]}
 */
function collectEngineModules() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = relative(ENGINE_DIR, full);
      if (statSync(full).isDirectory()) {
        if (EXCLUDED_DIR_SEGMENTS.has(entry)) continue;
        walk(full);
      } else if (entry.endsWith(".ts") && !EXCLUDED_FILES.has(full)) {
        out.push(rel);
      }
    }
  }
  walk(ENGINE_DIR);
  return out;
}

/**
 * Count lines of a file (wc -l semantics: newline-terminated lines).
 * @param {string} relPath
 * @returns {number}
 */
function lineCount(relPath) {
  const contents = readFileSync(join(ENGINE_DIR, relPath), "utf8");
  const count = contents.split("\n").length;
  // A trailing newline produces one empty split tail; mirror `wc -l`.
  return contents.endsWith("\n") ? count - 1 : count;
}

const modules = collectEngineModules().map((rel) => ({
  file: `src/lib/game-state/${rel.split("\\").join("/")}`,
  lines: lineCount(rel),
}));

if (process.argv.includes("--report")) {
  console.log(`engine module sizes (budget: ${SIZE_BUDGET_LINES} lines) — top 10:`);
  for (const m of [...modules].sort((a, b) => b.lines - a.lines).slice(0, 10)) {
    const over = m.lines > SIZE_BUDGET_LINES ? "  ⚠ OVER BUDGET" : "";
    console.log(`  ${String(m.lines).padStart(5)}  ${m.file}${over}`);
  }
  process.exit(0);
}

const offenders = modules.filter((m) => m.lines > SIZE_BUDGET_LINES);

if (offenders.length === 0) {
  const max = modules.reduce((a, m) => Math.max(a, m.lines), 0);
  console.log(
    `engine-size-budget: OK — ${modules.length} modules within ${SIZE_BUDGET_LINES} lines (max: ${max}).`
  );
  process.exit(0);
}

console.error(
  `engine-size-budget: FAILED — ${offenders.length}/${modules.length} module(s) exceed the ${SIZE_BUDGET_LINES}-line budget (issue #1725):`
);
for (const o of offenders) {
  console.error(
    `  ${String(o.lines).padStart(5)}  ${o.file} (+${o.lines - SIZE_BUDGET_LINES} over)`
  );
}
console.error(
  `\nDecompose the module along its ability/Concern families (see the\n` +
    `keyword-actions/, oracle-text-parser/, spell-casting/, types/ dirs for\n` +
    `the established pattern) or, if the file is genuinely cohesive, raise\n` +
    `SIZE_BUDGET_LINES in scripts/check-engine-size-budget.mjs with a\n` +
    `documented rationale.`
);
process.exit(1);
