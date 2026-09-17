#!/usr/bin/env node
/**
 * Mutation Docs Sync Guard — Issue #1785
 *
 * The mutation section of `docs/TESTING.md` documents the CI-enforced
 * aggregate floor (`stryker.config.js → thresholds.break`) and the
 * per-module floors for the two modules with measured baselines
 * (`layer-system.ts` at 55, `replacement-effects.ts` at 76). Like the
 * coverage-floor tables (#1712), those numbers drifted from the actual
 * config: the previous full-allowlist Stryker run had not succeeded in
 * twelve consecutive scheduled runs (2026-09-04..09-15), leaving six of
 * seven allowlisted modules ungated and the documented 70% project
 * target unverified against `thresholds.break: 50`.
 *
 * Fix: this guard parses
 *
 *   - `thresholds.break` out of `stryker.config.js`
 *   - the "CI-enforced floor" cell of the anchored mutation table in
 *     `docs/TESTING.md`
 *   - any per-module floors documented inline (the prose blocks for
 *     `layer-system` and `replacement-effects`) out of `docs/TESTING.md`
 *   - the per-module floors out of `scripts/mutation-floor.config.js`
 *
 * and exits 1 on any drift — mirroring `scripts/check-coverage-docs-sync.mjs`
 * (#1712) for both style (input/output/exit-code conventions) and
 * placement (the dedicated `mutation-docs-guard` job in
 * `.github/workflows/ci.yml`, `npm run lint:mutation-docs` locally, ~1ms
 * plain-Node runtime).
 *
 * Usage:
 *   node scripts/check-mutation-docs-sync.mjs
 *   node scripts/check-mutation-docs-sync.mjs \
 *     --config <stryker.config.js> \
 *     --floor-config <scripts/mutation-floor.config.js> \
 *     --doc <docs/TESTING.md>
 *
 * The flags exist so the fixture-based tests
 * (`tests/mutation-docs-guard.test.ts`) can stage isolated inputs.
 *
 * Exit codes:
 *   0 — every documented floor matches the enforced floor
 *   1 — at least one drift (offenders listed on stderr)
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const STRYKER_CONFIG = join(REPO_ROOT, "stryker.config.js");
const FLOOR_CONFIG = join(REPO_ROOT, "scripts", "mutation-floor.config.js");
const DOC_PATH = join(REPO_ROOT, "docs", "TESTING.md");

const START_ANCHOR = "<!-- mutation-floor:start -->";
const END_ANCHOR = "<!-- mutation-floor:end -->";

// Mirrors `thresholds:` parsing from stryker.config.js. Kept as a small
// regex so the guard stays standalone (no Stryker runtime, no CJS/ESM
// bridging — same rationale as scripts/check-coverage-docs-sync.mjs).
const BREAK_RE = /thresholds:\s*\{[\s\S]*?break:\s*([0-9]+(?:\\.[0-9]+)?)/;

// Anchored table row in docs/TESTING.md: matches the project-target /
// CI-enforced-floor cells for the mutation-score row. Pattern kept
// deliberately close to the coverage guard's row regex so the two
// scripts feel uniform.
const ANCHORED_ROW_RE =
  /^\s*\|\s*Mutation score\s*\|\s*\*\*(\d+(?:\.\d+)?)%\s*\*\*\s*\|[^\r\n]*?\*\*(\d+(?:\.\d+)?)%\s*\*\*/m;

// Inline per-module floor mentions: docs/TESTING.md documents the two
// modules with measured baselines (`layer-system.ts` and
// `replacement-effects.ts`) as bullet items whose text closes with a
// "Per-module floor: **N**" line referencing the floor in
// `scripts/mutation-floor.config.js`. The regex anchors to the start
// of a bullet (`^- `) and the module path so the same line cannot
// accidentally capture a `*.mutation.test.ts` test-file reference. The
// non-greedy `[\s\S]*?` keeps each bullet's floor scoped to its own
// module — a "Per-module floor:" line is captured at most once per
// bullet even if more than one appears in the doc.
const INLINE_FLOOR_RE =
  /^- `src\/lib\/game-state\/([a-z0-9-]+)\.ts`[\s\S]*?Per-module floor:\s*\*\*(\d+(?:\.\d+)?)\s*\*\*/gm;

/**
 * Read the aggregate `thresholds.break` out of stryker.config.js source.
 *
 * @param {string} source
 * @returns {number}
 */
export function readBreak(source) {
  const match = source.match(BREAK_RE);
  if (!match) {
    throw new Error(
      "Could not locate thresholds.break in stryker.config.js — the " +
        "nightly mutation gate is no longer wired (see issue #1785).",
    );
  }
  return parseFloat(match[1]);
}

/**
 * Parse the documented aggregate floor out of the anchored mutation
 * table in docs/TESTING.md.
 *
 * @param {string} block - text between the start/end anchors.
 * @returns {{ target: number, floor: number }}
 */
export function parseDocBlockFloors(block) {
  const match = block.match(ANCHORED_ROW_RE);
  if (!match) {
    throw new Error(
      "Could not find a 'Mutation score' row inside the anchored block.",
    );
  }
  return {
    target: parseFloat(match[1]),
    floor: parseFloat(match[2]),
  };
}

/**
 * Read the per-module floors out of scripts/mutation-floor.config.js
 * by requiring it (it's a plain CJS module, exactly what
 * scripts/mutation-floor.js already does).
 *
 * @param {string} floorConfigPath
 * @returns {{ defaultFloor: number, floors: Record<string, number> }}
 */
export function readFloorConfig(floorConfigPath) {
  // Bust the require cache so test fixtures with swapped paths re-read.
  delete require.cache[require.resolve(floorConfigPath)];
  const cfg = require(floorConfigPath);
  return {
    defaultFloor: cfg?.defaultFloor,
    floors: { ...(cfg?.floors ?? {}) },
  };
}

/**
 * Parse the inline `Per-module floor: N` prose mentions for each
 * documented module.
 *
 * The regex's first capture group is the path basename (e.g.
 * `layer-system`) — this function rewrites it to the full repo-relative
 * path so the comparison in `run()` can do a direct lookup against
 * `scripts/mutation-floor.config.js`'s `floors` map (which is keyed by
 * the full path, not the basename).
 *
 * @param {string} source - docs/TESTING.md contents.
 * @returns {Record<string, number>} full repo-relative path → documented floor.
 */
export function parseInlinePerModuleFloors(source) {
  const out = {};
  for (const m of source.matchAll(INLINE_FLOOR_RE)) {
    out[`src/lib/game-state/${m[1]}.ts`] = parseFloat(m[2]);
  }
  return out;
}

/**
 * Run the guard against one stryker config + floor config + doc file.
 *
 * @param {{ configPath: string; floorConfigPath: string; docPath: string }} opts
 * @returns {number} exit code (0 pass, 1 fail).
 */
export function run(opts) {
  /** @type {string[]} */
  const errors = [];

  let strykerBreak;
  try {
    strykerBreak = readBreak(readFileSync(opts.configPath, "utf8"));
  } catch (err) {
    console.error(`[check-mutation-docs-sync] FAIL: ${err.message}`);
    return 1;
  }

  const floorCfg = readFloorConfig(opts.floorConfigPath);
  const floors = floorCfg.floors;

  let docSource;
  try {
    docSource = readFileSync(opts.docPath, "utf8");
  } catch (err) {
    console.error(
      `[check-mutation-docs-sync] FAIL: ${opts.docPath} is missing — ` +
        "docs/TESTING.md documents the mutation gate (issue #1785).",
    );
    return 1;
  }

  const startIdx = docSource.indexOf(START_ANCHOR);
  const endIdx =
    startIdx === -1 ? -1 : docSource.indexOf(END_ANCHOR, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    errors.push(
      `${opts.docPath}: missing "${START_ANCHOR}" / "${END_ANCHOR}" ` +
        "anchors around the mutation-score table. Wrap the table in " +
        "those comments so this guard (issue #1785) can keep it in sync " +
        "with stryker.config.js thresholds.break.",
    );
  } else {
    try {
      const parsed = parseDocBlockFloors(
        docSource.slice(startIdx + START_ANCHOR.length, endIdx),
      );
      if (parsed.floor !== strykerBreak) {
        errors.push(
          `${opts.docPath}: mutation-score floor is documented as ` +
            `${parsed.floor}% but stryker.config.js thresholds.break is ` +
            `${strykerBreak}%. Update the anchored table to match ` +
            "stryker.config.js (issue #1785 acceptance criterion 3).",
        );
      }
    } catch (err) {
      errors.push(`${opts.docPath}: ${err.message}`);
    }
  }

  // Per-module floors documented inline in docs/TESTING.md (the prose
  // blocks under "Baseline measurements"). The guard only checks the
  // modules whose prose block carries a "Per-module floor: N" marker —
  // for modules without a measurement the documented floor would be
  // greenwashing and is rejected by scripts/check-mutation-config.mjs
  // (the floors file requires every allowlisted module).
  const inlineFloors = parseInlinePerModuleFloors(docSource);
  for (const [file, documentedFloor] of Object.entries(inlineFloors)) {
    const enforced = floors[file];
    if (typeof enforced !== "number") {
      errors.push(
        `${opts.docPath}: documents a per-module floor of ${documentedFloor} ` +
          `for ${file}, but scripts/mutation-floor.config.js has no entry ` +
          "for that module — either drop the prose mention or add the " +
          "floor to mutation-floor.config.js.",
      );
      continue;
    }
    if (documentedFloor !== enforced) {
      errors.push(
        `${opts.docPath}: per-module floor for ${file} is documented as ` +
          `${documentedFloor} but scripts/mutation-floor.config.js enforces ` +
          `${enforced}. Update one to match the other (issue #1785).`,
      );
    }
  }

  if (errors.length === 0) {
    console.log(
      `[check-mutation-docs-sync] PASS: documented mutation floor ` +
        `${strykerBreak}% (aggregate) + ${Object.keys(floors).length} per-module ` +
        `floors all match stryker.config.js / scripts/mutation-floor.config.js.`,
    );
    return 0;
  }

  console.error(
    "[check-mutation-docs-sync] FAIL: mutation-floor doc tables are out of " +
      "sync with stryker.config.js / scripts/mutation-floor.config.js:",
  );
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  console.error(
    "See https://github.com/anchapin/planar-nexus/issues/1785 and the " +
      '"Mutation Testing" section in docs/TESTING.md.',
  );
  return 1;
}

function parseArgs(argv) {
  const opts = {
    configPath: STRYKER_CONFIG,
    floorConfigPath: FLOOR_CONFIG,
    docPath: DOC_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--config") {
      if (!next) throw new Error("--config requires a path");
      opts.configPath = next;
      i++;
    } else if (arg === "--floor-config") {
      if (!next) throw new Error("--floor-config requires a path");
      opts.floorConfigPath = next;
      i++;
    } else if (arg === "--doc") {
      if (!next) throw new Error("--doc requires a path");
      opts.docPath = next;
      i++;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[check-mutation-docs-sync] FAIL: ${err.message}`);
    process.exit(1);
  }
  process.exit(run(opts));
}
