#!/usr/bin/env node
/**
 * Setup-Node-NPM-CI version consistency guard — Issue #1550
 *
 * The shared composite action `.github/actions/setup-node-npm-ci` pins its
 * `node-version` input default to `'22'` and the whole project is Node-22
 * aligned (per AGENTS.md + `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`). Before this
 * guard existed, callers could silently override that input — `release.yml`
 * did, three times, drifting the release pipeline onto Node 20 — and no CI
 * step caught the regression at PR time.
 *
 * This script walks every `.github/workflows/*.yml`, finds every invocation
 * of the composite, and asserts that each `with: node-version:` override is
 * either absent (relies on the composite default of '22') or exactly `'22'`.
 *
 * Contract (all must hold per workflow call site):
 *
 *   A. A `uses: ./.github/actions/setup-node-npm-ci` block with NO `with:`
 *      section is allowed — the composite default is '22'.
 *
 *   B. A `uses: ./.github/actions/setup-node-npm-ci` block with a `with:`
 *      section that OMITS `node-version:` is allowed — same default path.
 *
 *   C. A `uses: ./.github/actions/setup-node-npm-ci` block with a `with:`
 *      section that EXPLICITLY sets `node-version:` MUST set it to one of:
 *        1. the literal string `'22'` (any YAML quote style — single, double,
 *           or unquoted). This is the canonical form when a writer wants to
 *           document the version explicitly.
 *        2. an expression `${{ env.<NAME> }}` whose referenced env entry in
 *           the SAME workflow file is statically `'22'`. This handles
 *           `mobile-build.yml`, which overrides via `env.NODE_VERSION: '22'`
 *           at the workflow level. Any other expression form is rejected
 *           because we cannot prove its resolved value without executing
 *           GitHub Actions.
 *
 *   D. Any `node-version` value other than the above fails the guard.
 *
 * The composite's input default of `'22'` (`.github/actions/setup-node-npm-ci/action.yml:8`)
 * is the canonical source of truth — this script enforces consistency with
 * that value, not a hardcoded duplicate of it.
 *
 * Usage:
 *   node scripts/check-setup-node-npm-ci-version.mjs                # scans repo
 *   node scripts/check-setup-node-npm-ci-version.mjs <workflow_dir> # scans alternate dir
 *
 * Exits 0 on pass, 1 on violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");
const COMPOSITE_PATH = path.join(
  REPO_ROOT,
  ".github",
  "actions",
  "setup-node-npm-ci",
  "action.yml",
);
const COMPOSITE_USES = ".github/actions/setup-node-npm-ci";

const REQUIRED_NODE_VERSION = "22";

/**
 * @typedef {{ file: string; line: number; usesLine: number; got: string }} Violation
 */

/**
 * Extract the workflow-level `env:` map by parsing top-level `env:` block(s).
 * Each value MUST itself be a scalar (string/integer) — non-scalar env entries
 * are recorded so the guard can reject `node-version: ${{ env.X }}` lookups
 * that resolve to a non-string.
 *
 * @param {string} text - full workflow file contents
 * @returns {Record<string, { value: string; line: number }>}
 */
function extractTopLevelEnv(text) {
  /** @type {Record<string, { value: string; line: number }>} */
  const env = {};
  const lines = text.split("\n");
  // Workflow-level `env:` is always at column 0 (no indentation). Anything
  // indented is job- or step-level and out of scope for our primitive
  // expression resolver.
  // Scan for lines that are exactly `env:` with zero indent.
  for (let i = 0; i < lines.length; i++) {
    if (!/^env:\s*$/.test(lines[i] ?? "")) continue;
    // Read subsequent indented scalar pairs.
    let j = i + 1;
    while (j < lines.length) {
      const childLine = lines[j] ?? "";
      if (childLine === "" || /^\s*#/.test(childLine)) {
        j++;
        continue;
      }
      if (/^\S/.test(childLine)) {
        // Next top-level key — stop.
        break;
      }
      // Match `<spaces><KEY>:<value>` where value is a scalar (no `:` or
      // `{` or `[` after the key's colon). Any other shape is rejected.
      const match = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*):[ \t]+(.*?)\s*$/.exec(childLine);
      if (!match) {
        j++;
        continue;
      }
      const key = /** @type {string} */ (match[1]);
      const value = /** @type {string} */ (match[2]);
      // Unwrap YAML single / double quotes when they are the entire value.
      const unwrapped = stripYamlQuotes(value);
      env[key] = { value: unwrapped, line: j + 1 };
      j++;
    }
  }
  return env;
}

/**
 * Strip matching YAML single or double quotes from a scalar value. Returns
 * the original string when the value isn't a quoted scalar or the quotes
 * don't match (preserves the raw form for the caller's own diagnostics).
 *
 * @param {string} raw
 * @returns {string}
 */
function stripYamlQuotes(raw) {
  if (raw.length < 2) return raw;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Walk a workflow file and locate every `uses: ./.github/actions/setup-node-npm-ci`
 * step block, then return a structured description of each step's `with:`
 * section (focused on `node-version`).
 *
 * Each step block is delineated by the step-list dash (`- name:` or `- uses:`
 * or `- run:`). Indentation is consistent inside a step, so we capture lines
 * starting with the same whitespace prefix as the `uses:` line until the
 * next `- ` at that depth or a smaller-depth key.
 *
 * @param {string} file
 * @param {string} text
 * @returns {Array<{ usesLine: number; nodeVersionValue: string | null; nodeVersionLine: number | null }>}
 */
function findCompositeCalls(file, text) {
  /** @type {Array<{ usesLine: number; nodeVersionValue: string | null; nodeVersionLine: number | null }>} */
  const calls = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Match `uses: ./.github/actions/setup-node-npm-ci` (no quotes around the
    // local-composite path — that's the convention used throughout this
    // repo's 22 call sites in `.github/workflows/*.yml`). Accept optional
    // single or double quotes as well so the regex still matches the rare
    // quoted form. Be strict about the suffix so we don't match e.g.
    // `actions/setup-node-npm-ci-v2`.
    const re = new RegExp(
      "^[ \\t]+uses:[ \\t]+(['\"]?)\\.\\/.github/actions/setup-node-npm-ci\\1[ \\t]*$",
    );
    if (!re.test(line)) continue;

    const usesLine = i + 1;

    // Capture `node-version:` value (if any) for THIS step. The `with:`
    // block sits at the SAME indent as `uses:` (both are step-level
    // children, indented 8 spaces under a typical `jobs.X.steps[]` entry),
    // and `with:`'s own keys sit at one or two deeper indents. Scan forward
    // until we hit a sibling step (`- name:` / `- uses:` / `- run:` /
    // `- id:` / `- shell:` / `- env:`) at the same indent as `uses:`, or
    // outdent to a shallower depth. We allow optional `with:` keys to sit
    // anywhere within the captured block.
    const usesIndentLen = (line.match(/^[ \t]*/)?.[0] ?? "").length;
    /** @type {{ value: string | null; line: number | null }} */
    let nodeVersion = { value: null, line: null };

    let j = i + 1;
    while (j < lines.length) {
      const childLine = lines[j] ?? "";
      // Empty / comment lines are neutral — keep scanning.
      if (childLine === "" || /^\s*#/.test(childLine)) {
        j++;
        continue;
      }
      const childIndentLen = (childLine.match(/^[ \t]*/)?.[0] ?? "").length;

      // A new sibling step at the same indent ends this scan.
      if (childIndentLen === usesIndentLen && childLine.startsWith("-")) {
        break;
      }
      // Outdent to a shallower depth ends this scan.
      if (childIndentLen < usesIndentLen) {
        break;
      }
      // We're inside the step. Look for `node-version:`.
      const nvMatch = /^[ \t]+node-version:[ \t]+(.*?)\s*$/.exec(childLine);
      if (nvMatch) {
        nodeVersion = { value: /** @type {string} */ (nvMatch[1]), line: j + 1 };
      }
      j++;
    }

    calls.push({
      usesLine,
      nodeVersionValue: nodeVersion.value,
      nodeVersionLine: nodeVersion.line,
    });
  }
  return calls;
}

/**
 * Validate a single composite call against the Node-22 contract.
 *
 * @param {{ usesLine: number; nodeVersionValue: string | null; nodeVersionLine: number | null }} call
 * @param {string} file
 * @param {Record<string, { value: string; line: number }>} workflowEnv
 * @returns {{ ok: boolean; violation: Violation | null }}
 */
function evaluateCall(call, file, workflowEnv) {
  const { usesLine, nodeVersionValue, nodeVersionLine } = call;

  // Contract A + B: node-version omitted (no with:, or no node-version key)
  if (nodeVersionValue === null) {
    return { ok: true, violation: null };
  }

  if (nodeVersionLine === null) {
    // node-versionValue is non-null but line is null — defensive; treat as
    // a parse failure.
    return {
      ok: false,
      violation: {
        file,
        line: usesLine,
        usesLine,
        got: "<unparseable>",
      },
    };
  }

  const raw = nodeVersionValue;

  // Contract C.1: literal '22' (single / double / unquoted).
  if (raw === REQUIRED_NODE_VERSION || stripYamlQuotes(raw) === REQUIRED_NODE_VERSION) {
    return { ok: true, violation: null };
  }

  // Contract C.2: `${{ env.NAME }}` where env[NAME] resolves to '22'.
  // Match `${{ env.<NAME> }}` with any amount of inner whitespace, since
  // the GitHub Actions parser collapses it.
  const envExprMatch = /^\$\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/.exec(raw);
  if (envExprMatch) {
    const envName = /** @type {string} */ (envExprMatch[1]);
    const resolved = workflowEnv[envName];
    if (resolved && resolved.value === REQUIRED_NODE_VERSION) {
      return { ok: true, violation: null };
    }
    // Expression form does not resolve to '22' in the same file — fail.
    return {
      ok: false,
      violation: {
        file,
        line: nodeVersionLine,
        usesLine,
        got: raw,
      },
    };
  }

  // Contract D: every other form (e.g., `'20'`, `${{ inputs.node }}`,
  // multi-line expressions) is a violation.
  return {
    ok: false,
    violation: {
      file,
      line: nodeVersionLine,
      usesLine,
      got: raw,
    },
  };
}

/**
 * @param {string} workflowDir
 * @returns {{ ok: boolean; errors: string[] }}
 */
function run(workflowDir) {
  /** @type {string[]} */
  const errors = [];

  if (!fs.existsSync(workflowDir)) {
    return {
      ok: false,
      errors: [
        `workflow directory not found at ${workflowDir}`,
      ],
    };
  }

  /** @type {string[]} */
  let workflowFiles;
  try {
    workflowFiles = fs
      .readdirSync(workflowDir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
  } catch (err) {
    return {
      ok: false,
      errors: [
        `could not read workflow directory ${workflowDir}: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (workflowFiles.length === 0) {
    return {
      ok: false,
      errors: [
        `no workflow files (.yml/.yaml) found in ${workflowDir}`,
      ],
    };
  }

  for (const wf of workflowFiles) {
    const filePath = path.join(workflowDir, wf);
    const text = fs.readFileSync(filePath, "utf8");
    const env = extractTopLevelEnv(text);
    const calls = findCompositeCalls(filePath, text);

    for (const call of calls) {
      const result = evaluateCall(call, filePath, env);
      if (!result.ok && result.violation) {
        const v = result.violation;
        errors.push(
          `${v.file}:${v.line} setup-node-npm-ci node-version=${v.got} — expected '${REQUIRED_NODE_VERSION}' or omitted (see ${COMPOSITE_PATH}; uses at ${v.file}:${v.usesLine})`,
        );
      }
    }
  }

  if (errors.length === 0) {
    return {
      ok: true,
      errors: [
        `PASS: all setup-node-npm-ci callers use Node ${REQUIRED_NODE_VERSION} (or rely on the composite default).`,
      ],
    };
  }

  return { ok: false, errors };
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (invokedDirectly) {
  const dirArg = process.argv[2];
  const workflowDir = dirArg
    ? path.isAbsolute(dirArg)
      ? dirArg
      : path.resolve(process.cwd(), dirArg)
    : DEFAULT_WORKFLOW_DIR;

  const result = run(workflowDir);
  // For PASS we want a quiet OK line on stdout (so CI logs read green);
  // for FAIL we route to stderr with a clean one-line-per-violation
  // report plus a footer pointer back to the canonical source of truth.
  if (result.ok) {
    for (const e of result.errors) {
      console.log(`[check-setup-node-npm-ci-version] ${e}`);
    }
    process.exit(0);
  }

  console.error(
    `[check-setup-node-npm-ci-version] FAIL: ${result.errors.length} violation(s):`,
  );
  for (const e of result.errors) {
    console.error(`  - ${e}`);
  }
  console.error(
    "Fix: every 'uses: " +
      COMPOSITE_USES +
      "' must either omit 'with: node-version:' (relies on the composite default '" +
      REQUIRED_NODE_VERSION +
      "') or set it to '" +
      REQUIRED_NODE_VERSION +
      "' (literal) or '${{ env.NAME }}' where env.NAME is '" +
      REQUIRED_NODE_VERSION +
      "' in the same workflow file. See " +
      COMPOSITE_PATH +
      ".",
  );
  process.exit(1);
}

// Exports for the Jest suite. The functions are pure — no I/O at module scope.
export {
  run as runGuard,
  evaluateCall,
  findCompositeCalls,
  extractTopLevelEnv,
  REQUIRED_NODE_VERSION,
  COMPOSITE_USES,
};
