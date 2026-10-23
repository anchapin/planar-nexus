#!/usr/bin/env node
/**
 * Mutation Config Guard — Issues #1762 + #1785
 *
 * The per-PR `Mutation Test (layer-system)` Stryker job was the CI long pole:
 * ~2.5-3h per PR with 3x variance on identical code (59 vs 184 min runs on
 * the same branch content — see the duration table in #1762), while the
 * `build` job depended on it, so every PR merge waited on it. Issue #1762
 * moved that gate OFF the per-PR critical path: every rules-engine module
 * is mutated by the NIGHTLY .github/workflows/mutation.yml run (it is in
 * the `mutate` allowlist), which enforces BOTH the aggregate
 * `thresholds.break` (Stryker's exit code) and the per-module floor
 * (scripts/mutation-floor.js → floor 55 for layer-system, floor 76 for
 * replacement-effects, conservative 50 for the rest until each first
 * successful nightly run records its baseline, see
 * scripts/mutation-floor.config.js).
 *
 * Accepted tradeoff (#1762): a per-module mutation-score regression now
 * surfaces on the nightly Actions run (≤24h detection latency on main)
 * instead of blocking the PR that introduced it. In exchange, per-PR CI
 * drops its single ~3h job and PR wall-clock stops tracking Stryker/runner
 * variance entirely.
 *
 * Issue #1785 follow-up: the single nightly Stryker job had not succeeded
 * in twelve consecutive scheduled runs (2026-09-04..09-15) because the
 * full-allowlist mutation took longer than GitHub Actions' default 6h job
 * timeout and 1128+ mutants per run were timing out (suite hangs on
 * specific mutations). The workflow was split into per-module matrix
 * jobs, each running a single `npm run mutate:<module>` against a 90-min
 * per-job timeout. This guard now also asserts the per-module matrix
 * shape so a future refactor cannot silently regress to the broken
 * single-job shape that left six of seven rules-engine modules ungated.
 *
 * This guard is the per-PR replacement (~50ms, plain Node, no Stryker run)
 * and keeps that tradeoff honest. It fails the PR if any marker that makes
 * the nightly-only gate safe is removed:
 *
 *   1. stryker.config.js `mutate` allowlist still contains every expected
 *      rules-engine module (layer-system included).
 *   2. stryker.config.js `concurrency` is explicitly pinned to a number —
 *      worker count must not silently become runner-CPU-count-dependent
 *      again (the #1762 variance hypothesis).
 *   3. scripts/mutation-floor.config.js defines a floor entry for EVERY
 *      allowlisted module, so the nightly per-module gate cannot silently
 *      lose a module.
 *   4. package.json still exposes `test:mutation` (full-suite Stryker for
 *      local dev — slower but useful for reproducing a nightly failure
 *      end-to-end) and the per-module `mutate:*` convenience scripts
 *      used by the nightly per-module matrix (#1785).
 *   5. .github/workflows/mutation.yml still triggers on a nightly
 *      `schedule:` and runs `npm run mutate:<module>` (per-module matrix
 *      invocation) + `node scripts/mutation-floor.js` +
 *      `node scripts/mutation-summary.js` (issue #1785 split).
 *   6. The nightly mutation.yml matrix JSON contains a quoted entry for
 *      every allowlisted module — a per-module job that doesn't run is
 *      the same regression as removing the per-module floor (#1785).
 *   7. scripts/mutation-floor.config.js defines an uncovered-mutant budget
 *      for EVERY allowlisted module. stryker.config.js's `ignoreStatic`
 *      excludes uncovered-code mutants from the score, so this budget is
 *      the only thing keeping that debt gated (#1785).
 *   7. .github/workflows/ci.yml does NOT invoke Stryker anywhere — the
 *      ~3h long pole cannot creep back onto the per-PR path unnoticed.
 *   8. Every `--mutate` path (in the package.json `mutate:*` scripts and
 *      in the stryker.config.js allowlist) resolves to at least one real
 *      file — issue #2835: six of the eight `mutate:*` scripts pointed at
 *      files that had been refactored into directories, so Stryker
 *      instrumented 0 files, scored NaN and the floor gate passed
 *      vacuously (`NaN >= 44`) while the nightly measured nothing.
 *
 * Exit codes:
 *   0 — all markers present, nightly gate wiring intact
 *   1 — at least one marker missing (offenders listed on stderr)
 *
 * Usage:
 *   node scripts/check-mutation-config.mjs
 *   npm run lint:mutation-config
 *
 * Wired into .github/workflows/ci.yml as the `mutation-smoke` job, which
 * the `build` job depends on — removing a marker blocks merge.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const failures = [];

/**
 * Strip YAML comments (full-line and inline) so marker checks only see
 * executable content — comments mentioning `mutate:` must not count as
 * wiring any more than they should trigger the no-Stryker check.
 */
function stripYamlComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      // A '#' inside a quote could be legit command content; none of the
      // markers checked below ever contain '#', so cutting at the first
      // '#' cannot hide a marker we care about.
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join("\n");
}

// ── 1 + 2. stryker.config.js: allowlist + pinned concurrency ───────────────
const EXPECTED_MUTATE_ENTRIES = [
  "src/lib/game-state/layer-system/*.ts",
  "src/lib/game-state/replacement-effects/*.ts",
  "src/lib/game-state/spell-casting/*.ts",
  "src/lib/game-state/trigger-system/*.ts",
  "src/lib/game-state/state-based-actions.ts",
  // combat excluded: issue #1989 + #2055 (40+ min Stryker runtime)
  "src/lib/game-state/mana/*.ts",
];

const strykerConfig = require(join(REPO_ROOT, "stryker.config.js"));

const mutateEntries = strykerConfig.mutate ?? [];
for (const entry of EXPECTED_MUTATE_ENTRIES) {
  if (!mutateEntries.includes(entry)) {
    failures.push(
      `stryker.config.js: allowlist entry missing: ${entry} — the nightly ` +
        `mutation gate no longer mutates this module (issue #1762 assumes ` +
        `all ${EXPECTED_MUTATE_ENTRIES.length} allowlisted modules).`,
    );
  }
}

if (
  typeof strykerConfig.concurrency !== "number" ||
  strykerConfig.concurrency < 1
) {
  failures.push(
    "stryker.config.js: `concurrency` must be explicitly pinned to a " +
      "number (issue #1762: an unset/defaulting worker count made runtime " +
      "track runner CPU count and drove the 59↔184 min variance).",
  );
}

// ── 3. per-module floors cover every allowlisted entry ─────────────────────
const floorConfig = require(
  join(REPO_ROOT, "scripts", "mutation-floor.config.js"),
);
const floors = floorConfig?.floors ?? {};
for (const entry of mutateEntries) {
  if (!(entry in floors)) {
    failures.push(
      `scripts/mutation-floor.config.js: no floor entry for allowlisted ` +
        `module ${entry} — the nightly per-module gate (issue #1598) ` +
        `cannot catch this module regressing below defaultFloor ` +
        `(${floorConfig?.defaultFloor}).`,
    );
  }
}

// ── 3b. uncovered-mutant budgets (issue #1785) ────────────────────────────
// stryker.config.js sets `ignoreStatic`, so mutants that no test covers are
// reported as "Ignored" and excluded from the mutation score. The per-module
// uncovered-mutant budget is the only thing keeping that debt gated, so
// every allowlisted module needs one — without it, adding a module to the
// allowlist would silently drop its uncovered-code debt out of the gate.
const uncoveredBudgets = floorConfig?.uncoveredBudgets ?? {};
for (const entry of mutateEntries) {
  if (!(entry in uncoveredBudgets)) {
    failures.push(
      `scripts/mutation-floor.config.js: no uncovered-mutant budget for ` +
        `allowlisted module ${entry} — stryker.config.js's ignoreStatic ` +
        `drops that module's uncovered-code mutants from the score, so ` +
        `without a budget the debt is ungated (issue #1785).`,
    );
  }
}
for (const entry of Object.keys(uncoveredBudgets)) {
  if (resolveMutatePattern(entry).length === 0) {
    failures.push(
      `scripts/mutation-floor.config.js: uncovered-mutant budget "${entry}" ` +
        `matches no real source file — the budget can never be enforced ` +
        `(issue #1785).`,
    );
  }
}

// ── 4. package.json scripts ────────────────────────────────────────────────
const pkg = require(join(REPO_ROOT, "package.json"));
const scripts = pkg.scripts ?? {};
if (
  typeof scripts["test:mutation"] !== "string" ||
  !scripts["test:mutation"].includes("stryker") ||
  !scripts["test:mutation"].includes("mutation-floor.js")
) {
  failures.push(
    "package.json: `test:mutation` must run Stryker AND the per-module " +
      "floor gate (scripts/mutation-floor.js) — it is the nightly gate's " +
      "entrypoint (.github/workflows/mutation.yml).",
  );
}
const MUTATE_MODULE_NAMES = [
  "layer-system",
  "replacement-effects",
  "spell-casting",
  "trigger-system",
  "state-based-actions",
  // combat excluded: issue #1989 + #2055 (40+ min Stryker runtime)
  "mana",
  // Issue #2186: keyword-actions and abilities added to Stryker coverage
  "keyword-actions",
  "oracle-text-parser-abilities",
];
for (const name of MUTATE_MODULE_NAMES) {
  const script = `mutate:${name}`;
  if (typeof scripts[script] !== "string") {
    failures.push(`package.json: convenience script missing: ${script}.`);
  }
}

// ── 5. nightly mutation.yml keeps schedule + both gates ────────────────────
const mutationYml = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "mutation.yml"),
  "utf8",
);
const mutationYmlCode = stripYamlComments(mutationYml);
const NIGHTLY_MARKERS = [
  { needle: "schedule:", why: "the nightly cron trigger" },
  // Issue #1785: the nightly workflow was split into per-module matrix
  // jobs (`npm run mutate:${{ matrix.module }}`) after 12 consecutive
  // runs (2026-09-04..09-15) hit GitHub Actions' 6h job timeout running
  // the full allowlist serially. Assert the per-module invocation
  // pattern, not the old `npm run test:mutation` entry point, so a future
  // refactor cannot silently regress back to the broken single-job shape.
  {
    needle: "npm run mutate:",
    why: "a per-module Stryker invocation (issue #1785 split)",
  },
  {
    needle: "node scripts/mutation-floor.js",
    why: "the per-module floor gate (issue #1598)",
  },
  {
    needle: "node scripts/mutation-summary.js",
    why: "the per-module score table on the Actions summary",
  },
];
for (const { needle, why } of NIGHTLY_MARKERS) {
  if (!mutationYmlCode.includes(needle)) {
    failures.push(
      `.github/workflows/mutation.yml: marker missing: "${needle}" (${why}) — ` +
        `since per-PR Stryker was removed (#1762), this nightly workflow is ` +
        `the ONLY mutation gate; deleting this marker disables it silently.`,
    );
  }
}
// Issue #1785: every allowlisted module's short name must appear in the
// matrix JSON of mutation.yml so removing a per-module job (e.g. by
// shrinking the matrix array) cannot silently disable a module's gate.
// The matrix expression is a JSON array of short names: ["layer-system",
// "replacement-effects", ...]. We assert each short name is wrapped in
// quotes somewhere in the YAML so a manual edit to the matrix list
// either keeps all seven entries or fails this guard.
//
// `shortName` extraction handles both the literal-file entries
// (`src/lib/game-state/layer-system.ts` → `layer-system`) and the
// family-dir glob entry from issue #1725
// (`src/lib/game-state/spell-casting/*.ts` → `spell-casting`). The
// Stryker allowlist is rooted under `src/lib/game-state/`, so stripping
// that prefix leaves either `<file>.ts` or `<dir>/*.ts` — both reduce to
// the same per-module npm script suffix (`mutate:<name>`).
function shortModuleName(entry) {
  return entry
    .replace(/^src\/lib\/game-state\//, "")
    .replace(/\.ts$/, "")
    .replace(/\*\.ts$/, "")
    .replace(/\*+$/, "")
    .replace(/\/+$/, "")
    // Handle nested paths like src/lib/game-state/oracle-text-parser/abilities.ts
    // → oracle-text-parser/abilities → oracle-text-parser-abilities
    .replace(/\//g, "-");
}
for (const entry of mutateEntries) {
  const shortName = shortModuleName(entry);
  const quoted = `"${shortName}"`;
  if (!mutationYmlCode.includes(quoted)) {
    failures.push(
      `.github/workflows/mutation.yml: matrix entry missing for ${entry} ` +
        `(looked for ${quoted}) — issue #1785 split the nightly run into ` +
        `per-module matrix jobs; removing an entry from the matrix silently ` +
        `disables that module's nightly gate.`,
    );
  }
}

// ── 6. ci.yml must not run Stryker on the per-PR path ──────────────────────
const ciYml = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);
const ciYmlCode = stripYamlComments(ciYml);
const STRYKER_INVOCATIONS = [/\bstryker run\b/, /\bnpm run (?:test:)?mutate\b/];
for (const pattern of STRYKER_INVOCATIONS) {
  const match = ciYmlCode.match(pattern);
  if (match) {
    failures.push(
      `.github/workflows/ci.yml: Stryker invocation "${match[0]}" found on ` +
        `the per-PR path — issue #1762 removed per-PR Stryker because a ` +
        `single module took ~2.5-3h with 3x variance and blocked every ` +
        `merge via build.needs. Gate the change with the nightly ` +
        `.github/workflows/mutation.yml run instead.`,
    );
  }
}

// ── 7. every `--mutate` path must resolve to at least one real file ────────
//
// Issue #2835: six of the eight `mutate:*` scripts pointed `--mutate` at
// files that had been refactored into directories with an `index.ts` barrel.
// Stryker then instrumented 0 files, reported a NaN score and the floor
// gate passed vacuously (`NaN >= 44`) — the nightly measured nothing while
// still looking green. A stale path must fail CI instead of silently
// scoring NaN.
const MUTATE_FLAG_RE = /--mutate\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;

/** Extract every `--mutate <path>` pattern from a script body. */
function mutatePatterns(scriptBody) {
  const patterns = [];
  for (const match of scriptBody.matchAll(MUTATE_FLAG_RE)) {
    patterns.push(match[1] ?? match[2] ?? match[3]);
  }
  return patterns;
}

/**
 * Convert a repo-path glob into an anchored RegExp. Only the `*` / `**`
 * subset Stryker's mutate patterns use is supported (same shape as
 * scripts/mutation-floor-lib.js `globToRegExp`).
 */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "*"); // stars are glob syntax, not literals
  const source = escaped
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${source}$`);
}

/** Recursively list the files below `dir` (missing dir → empty list). */
function listFilesRecursively(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursively(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Resolve one `--mutate` pattern to the repo-relative files it selects.
 * Returns an empty array when the path selects nothing (stale file,
 * renamed module, typo) — the failure mode issue #2835 is about.
 */
function resolveMutatePattern(pattern) {
  const segments = pattern.split("/");
  const baseSegments = [];
  for (const segment of segments) {
    if (segment.includes("*")) break;
    baseSegments.push(segment);
  }
  const base = join(REPO_ROOT, ...baseSegments);
  let candidates;
  try {
    const stats = statSync(base);
    candidates = stats.isDirectory() ? listFilesRecursively(base) : [base];
  } catch {
    candidates = [];
  }
  const matcher = globToRegExp(pattern);
  return candidates
    .map((file) => relative(REPO_ROOT, file).split(sep).join("/"))
    .filter((file) => matcher.test(file))
    .sort();
}

// 7a. every `mutate:*` script must select at least one real file.
const mutateScriptNames = Object.keys(scripts).filter((name) =>
  name.startsWith("mutate:"),
);
const resolvedScriptFiles = new Map();
for (const name of mutateScriptNames) {
  const body = scripts[name];
  const patterns = mutatePatterns(body);
  if (patterns.length === 0) {
    failures.push(
      `package.json: script "${name}" has no --mutate <path> — the nightly ` +
        `per-module job runs this script, so it must state which files ` +
        `Stryker should instrument.`,
    );
    continue;
  }
  const files = new Set();
  for (const pattern of patterns) {
    const resolved = resolveMutatePattern(pattern);
    if (resolved.length === 0) {
      failures.push(
        `package.json: script "${name}" points --mutate at "${pattern}", ` +
          `which resolves to 0 files — Stryker would instrument nothing, ` +
          `report a NaN score and pass the floor gate vacuously ` +
          `(\`NaN >= 44\`, issue #2835). Point it at the real module ` +
          `files (e.g. "src/lib/game-state/<module>/*.ts").`,
      );
      continue;
    }
    for (const file of resolved) files.add(file);
  }
  resolvedScriptFiles.set(name, files);
}

// 7b. every allowlist entry must select at least one real file, and the
//     per-module script must cover exactly the same files as the
//     allowlist entry (the nightly matrix runs the script, the full
//     allowlist run uses the config — they must not drift apart).
for (const entry of mutateEntries) {
  const resolved = resolveMutatePattern(entry);
  if (resolved.length === 0) {
    failures.push(
      `stryker.config.js: mutate allowlist entry "${entry}" resolves to 0 ` +
        `files — the full-allowlist run would instrument nothing and score ` +
        `NaN (issue #2835). Point it at the real module files.`,
    );
    continue;
  }
  const scriptName = `mutate:${shortModuleName(entry)}`;
  const scriptFiles = resolvedScriptFiles.get(scriptName);
  if (!scriptFiles) continue; // missing script is reported by check 4
  const missing = resolved.filter((file) => !scriptFiles.has(file));
  if (missing.length > 0) {
    failures.push(
      `package.json: script "${scriptName}" does not cover ` +
        `${missing.join(", ")} — the Stryker allowlist entry "${entry}" ` +
        `does. The nightly per-module job and the full-allowlist run must ` +
        `mutate the same files (issue #2835).`,
    );
  }
}

// ── verdict ────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  const floorCount = Object.keys(floors).length;
  console.log(
    `mutation-config: OK — ${mutateEntries.length} allowlisted modules, ` +
      `${floorCount} per-module floors, nightly per-module matrix wired ` +
      `(issue #1785), no Stryker on the per-PR path (issue #1762), all ` +
      `${mutateScriptNames.length} mutate:* paths resolve to real files ` +
      `(issue #2835).`,
  );
  process.exit(0);
}

console.error(
  `mutation-config: FAILED — ${failures.length} marker(s) of the ` +
    `nightly-only mutation gate are missing/broken (issue #1762):`,
);
for (const f of failures) {
  console.error(`  - ${f}`);
}
console.error(
  `\nPer-PR Stryker was deliberately removed in #1762 (~3h long pole). If\n` +
    `you intended to change the mutation gates, update this guard's\n` +
    `expectations in scripts/check-mutation-config.mjs in the same PR so\n` +
    `the safety-net contract stays explicit.`,
);
process.exit(1);
