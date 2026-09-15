#!/usr/bin/env node
/**
 * Mutation Config Guard — Issue #1762
 *
 * The per-PR `Mutation Test (layer-system)` Stryker job was the CI long pole:
 * ~2.5-3h per PR with 3x variance on identical code (59 vs 184 min runs on
 * the same branch content — see the duration table in #1762), while the
 * `build` job depended on it, so every PR merge waited on it. Issue #1762
 * moved that gate OFF the per-PR critical path: layer-system is mutated by
 * the NIGHTLY .github/workflows/mutation.yml run (it is in the `mutate`
 * allowlist), which enforces BOTH the aggregate `thresholds.break`
 * (Stryker's exit code) and the per-module floor
 * (scripts/mutation-floor.js → floor 55 for layer-system).
 *
 * Accepted tradeoff (#1762): a layer-system mutation-score regression now
 * surfaces on the nightly Actions run (≤24h detection latency on main)
 * instead of blocking the PR that introduced it. In exchange, per-PR CI
 * drops its single ~3h job and PR wall-clock stops tracking Stryker/runner
 * variance entirely.
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
 *   4. package.json still exposes `test:mutation` (stryker + floor gate)
 *      and the per-module `mutate:*` convenience scripts.
 *   5. .github/workflows/mutation.yml still triggers on a nightly
 *      `schedule:` and runs `npm run test:mutation` +
 *      `node scripts/mutation-floor.js` + `node scripts/mutation-summary.js`.
 *   6. .github/workflows/ci.yml does NOT invoke Stryker anywhere — the
 *      ~3h long pole cannot creep back onto the per-PR path unnoticed.
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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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
  "src/lib/game-state/layer-system.ts",
  "src/lib/game-state/replacement-effects.ts",
  "src/lib/game-state/spell-casting/*.ts",
  "src/lib/game-state/trigger-system.ts",
  "src/lib/game-state/state-based-actions.ts",
  "src/lib/game-state/combat.ts",
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
  "combat",
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
  { needle: "npm run test:mutation", why: "the full-allowlist Stryker run" },
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

// ── verdict ────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  const floorCount = Object.keys(floors).length;
  console.log(
    `mutation-config: OK — ${mutateEntries.length} allowlisted modules, ` +
      `${floorCount} per-module floors, nightly gate wired, no Stryker on ` +
      `the per-PR path (issue #1762).`,
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
