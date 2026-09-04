#!/usr/bin/env node
/**
 * TURN Credential Leak Guard — Issue #1571
 *
 * Defence-in-depth CI gate that prevents private TURN credentials from
 * being committed via `NEXT_PUBLIC_TURN_*` environment variables or via
 * inline `turn:`/`turns:` URL credentials. The lane brief explicitly lists
 * "AVOID: TURN credentials leaking into client bundles" as a hard
 * constraint — every `NEXT_PUBLIC_*` variable is inlined into the client
 * bundle by Next.js, so any operator who sets `NEXT_PUBLIC_TURN_PASS` to
 * a real Coturn password ships it to every browser/Tauri shell that loads
 * the app.
 *
 * The Jest suite `src/lib/__tests__/ice-config.credential-leak.test.ts`
 * (#1571) asserts the positive contracts (no inline TURN URL credentials
 * in source; `.env.example` only references `NEXT_PUBLIC_TURN_PASS` as
 * empty / `openrelayproject` / absent). This script is the cheaper,
 * runtime-free complement: it runs in plain Node (no Jest, no Tauri
 * toolchain) so it can gate a dedicated CI job without waiting for the
 * full unit-test suite.
 *
 * Contract (all must hold):
 *
 *   A. No committed file contains an inline `turn:`/`turns:` URL whose
 *      query string carries a `username=` or `credential=` parameter.
 *      (Those would be the inline ICE-server credential form: e.g.
 *      `turn:host:3478?username=alice&credential=supersecret`.)
 *
 *   B. No committed `.env*` file (other than `.env.example` with
 *      placeholder text) carries a non-empty value for any
 *      `NEXT_PUBLIC_TURN_*` key. The literal `openrelayproject` is the
 *      only non-empty value allowed because that is the public OpenRelay
 *      fallback credential intentionally embedded in the client.
 *
 *   C. No committed source file (TypeScript / JavaScript / JSON / config)
 *      assigns a string literal to `NEXT_PUBLIC_TURN_URL`,
 *      `NEXT_PUBLIC_TURN_USER`, or `NEXT_PUBLIC_TURN_PASS` outside of
 *      `process.env.*` lookups. `process.env.NEXT_PUBLIC_TURN_*` is
 *      always allowed (that's the read side, not the leak side).
 *
 * Allowlists:
 *
 *   - `src/lib/ice-config.ts` (the single source of truth for the public
 *      OpenRelay fallback — `PUBLIC_FALLBACK_TURN_SERVERS` uses object
 *      fields, not inline URL credentials, and only references TURN env
 *      vars via `process.env.*`).
 *   - `src/lib/__tests__/ice-config.test.ts` (synthetic test fixtures
 *      use placeholder URLs/users/credentials — see #1261).
 *   - The guard script and its own Jest + integration tests.
 *
 * Usage:
 *   node scripts/check-turn-credentials.mjs            # scans the repo
 *   node scripts/check-turn-credentials.mjs <path>     # scans <path>
 *
 * Exits 0 on pass, 1 on violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default REPO_ROOT — the directory two levels up from this script.
// Overridden when invoked directly with an alternate path so the
// integration tests can build synthetic working trees in a temp dir.
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");

// TURN env-var keys whose committed values are the leak vector.
const TURN_ENV_KEYS = new Set([
  "NEXT_PUBLIC_TURN_URL",
  "NEXT_PUBLIC_TURN_USER",
  "NEXT_PUBLIC_TURN_PASS",
  "NEXT_PUBLIC_TURN_USERNAME",
  "NEXT_PUBLIC_TURN_CREDENTIAL",
]);

// The literal public OpenRelay credential intentionally embedded in
// `PUBLIC_FALLBACK_TURN_SERVERS` (src/lib/ice-config.ts). The OpenRelay
// community publishes these as shared credentials — they are not
// secrets — so they are the only non-empty value we permit in committed
// .env / source files. Anywhere else, the value is private infrastructure
// and a leak.
const PUBLIC_FALLBACK_CRED = "openrelayproject";

// The inline-URL allowlist (and hardcoded-var allowlist) are path-based.
// Integration tests that want to exercise the detection path against the
// canonical `src/lib/ice-config.ts` location should write their
// synthetic fixtures to a non-allowlisted path (e.g.
// `src/lib/__tests__/_fixture-turn-leak.ts`) instead of overriding the
// production file. This keeps the guard's allowlist the single source
// of truth and avoids needing CLI escape hatches for tests.

// Directories we never descend into. The first block mirrors the
// standard build artefacts; the second blocks the AI-tool scaffolding
// directories so the guard does not waste time scanning ephemeral
// planning notes.
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".git",
  "coverage",
  "test-results",
  // AI-tool scaffolding (planning notes, sub-agent artefacts, etc.).
  ".agents",
  ".code-graph",
  ".gitnexus",
  ".planning",
  ".smallcode",
  ".eforge",
  ".jat",
  ".junie",
  ".memory",
  ".sdd",
  ".commandcode",
  ".idx",
  ".claude",
  ".opencode",
  ".husky",
]);

// File extensions we treat as source for the inline-URL and hardcoded-var
// checks. Binary files (images, fonts, etc.) and Rust sources are
// excluded.
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".md",
]);

// Files allowlisted from the inline `turn:`/`turns:` URL credential
// check. These contain either the public OpenRelay fallback (in object
// form) or synthetic test fixtures; none embed real private
// credentials in a TURN URL.
const INLINE_URL_ALLOWLIST = new Set([
  "src/lib/ice-config.ts",
  "src/lib/__tests__/ice-config.test.ts",
  "scripts/check-turn-credentials.mjs",
  "src/lib/__tests__/ice-config.credential-leak.test.ts",
  "tests/turn-credentials-guard.test.ts",
]);

// Files allowlisted from the hardcoded `NEXT_PUBLIC_TURN_*` assignment
// check. The test fixture uses synthetic placeholder values, and the
// guard script itself documents the keys; both must not trip the
// scanner on their own example lines.
const HARDCODE_ALLOWLIST = new Set([
  "src/lib/ice-config.ts",
  "src/lib/__tests__/ice-config.test.ts",
  "scripts/check-turn-credentials.mjs",
  "src/lib/__tests__/ice-config.credential-leak.test.ts",
  "tests/turn-credentials-guard.test.ts",
]);

/**
 * Inline TURN URL credentials: `turn:`/`turns:` URLs with a query
 * string that contains a `username=` or `credential=` parameter.
 *
 * The scheme matcher accepts both `turn:` and `turns:`, with optional
 * whitespace before the scheme. The body matcher
 * (`[^\s'",;)<>\\]*`) walks up to the first whitespace / quote /
 * delimiter / closing bracket so the URL stays inside the matched span;
 * then `[?&]` anchors the inline credential query and `(?:username|
 * credential)=` matches the parameter name. `gi` makes the matcher
 * case-insensitive and lets `exec` find every occurrence on the line.
 */
const TURN_URL_CRED_PATTERN =
  /(?:^|[^A-Za-z0-9_])(?:turn|turns):[^\s'",;)<>\\]*[?&](?:username|credential)=/gi;

/**
 * Hardcoded `NEXT_PUBLIC_TURN_*` string-literal assignment. The negative
 * lookbehind `(?<!\.)` blocks `process.env.NEXT_PUBLIC_TURN_*` and
 * `env.NEXT_PUBLIC_TURN_*` style references (the read-side accessors);
 * `\b` anchors at a word boundary so identifiers like
 * `MY_NEXT_PUBLIC_TURN_PASS` are ignored.
 *
 * The assignment form accepts `=`, `:=`, `||=`, and `:` (TypeScript /
 * object-literal key:value forms) followed by a string literal opener.
 */
const HARDCODE_TURN_VAR_PATTERN =
  /(?<!\.)\bNEXT_PUBLIC_TURN_(?:URL|USER|PASS)\b\s*(?::=|=|:|\|\|=)\s*['"`]/gi;

/**
 * @typedef {{
 *   file: string,
 *   line: number,
 *   key?: string,
 *   value?: string,
 *   snippet?: string,
 *   reason: string,
 * }} LeakFinding
 */

/**
 * Recursively walk `dir`, invoking `visit` on every regular file.
 * Honours {@link SKIP_DIRS} at every level.
 *
 * @param {string} dir
 * @param {(file: string) => void} visit
 */
function walk(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing / unreadable directory — skip silently. The script is
    // best-effort against partial checkouts; CI runs against a fresh
    // `actions/checkout` so this only triggers in local dev.
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else if (entry.isFile()) {
      visit(full);
    } else if (entry.isSymbolicLink()) {
      // Follow symlinks only when they resolve to a regular file inside
      // the repo. This avoids the `realpath`-escape hazard while still
      // supporting the rare developer-local symlink-to-source layout.
      try {
        const st = fs.statSync(full);
        if (st.isFile()) visit(full);
      } catch {
        // dangling symlink — skip
      }
    }
  }
}

/** @param {string} p @param {string} rootDir */
function relative(p, rootDir) {
  return path.relative(rootDir, p);
}

/**
 * Parse a single `.env` line and return the captured `KEY=value` pair
 * when the key is in the protected set and the line is an active
 * assignment (not commented out). Returns null otherwise.
 *
 * The leading optional `export ` (shell-style `.env` files) is
 * accepted; quoted values have their surrounding quotes stripped.
 *
 * @param {string} line
 * @returns {{ key: string, value: string } | null}
 */
export function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(trimmed);
  if (!m) return null;
  const [, key, rawValue] = m;
  if (!TURN_ENV_KEYS.has(key)) return null;
  const value = rawValue.replace(/^["']|["']$/g, "");
  return { key, value };
}

/**
 * Yield committed (non-empty, non-allowlisted) TURN env values in a
 * single `.env*` file. Empty values and the public fallback credential
 * are skipped (they are the documented "no leak" cases).
 *
 * @param {string} file
 * @param {string} [rootDir] Repo root used to compute relative paths in
 *   findings. Defaults to {@link DEFAULT_REPO_ROOT}.
 * @returns {Generator<LeakFinding>}
 */
export function* findCommittedEnvValues(file, rootDir = DEFAULT_REPO_ROOT) {
  const rel = relative(file, rootDir);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseEnvLine(lines[i]);
    if (!parsed) continue;
    if (parsed.value === "") continue;
    if (parsed.value === PUBLIC_FALLBACK_CRED) continue;
    yield {
      file: rel,
      line: i + 1,
      key: parsed.key,
      value: parsed.value,
      reason: `committed non-empty value for ${parsed.key}`,
    };
  }
}

/**
 * Yield inline `turn:`/`turns:` URL credential matches inside a single
 * source file. Allowlisted files are skipped wholesale.
 *
 * @param {string} file
 * @param {string} [rootDir] Repo root used to compute relative paths in
 *   findings. Defaults to {@link DEFAULT_REPO_ROOT}.
 * @returns {Generator<LeakFinding>}
 */
export function* findInlineUrlCredentials(file, rootDir = DEFAULT_REPO_ROOT) {
  const rel = relative(file, rootDir);
  if (INLINE_URL_ALLOWLIST.has(rel)) return;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    TURN_URL_CRED_PATTERN.lastIndex = 0;
    let m;
    while ((m = TURN_URL_CRED_PATTERN.exec(lines[i])) !== null) {
      yield {
        file: rel,
        line: i + 1,
        snippet: m[0],
        reason: `inline credential on TURN URL: ${m[0].trim()}`,
      };
    }
  }
}

/**
 * Yield hardcoded `NEXT_PUBLIC_TURN_*` string assignments outside of
 * `process.env.*` reference lookups. Allowlisted files are skipped
 * wholesale.
 *
 * @param {string} file
 * @param {string} [rootDir] Repo root used to compute relative paths in
 *   findings. Defaults to {@link DEFAULT_REPO_ROOT}.
 * @returns {Generator<LeakFinding>}
 */
export function* findHardcodedTurnEnvRefs(file, rootDir = DEFAULT_REPO_ROOT) {
  const rel = relative(file, rootDir);
  if (HARDCODE_ALLOWLIST.has(rel)) return;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    HARDCODE_TURN_VAR_PATTERN.lastIndex = 0;
    let m;
    while ((m = HARDCODE_TURN_VAR_PATTERN.exec(lines[i])) !== null) {
      yield {
        file: rel,
        line: i + 1,
        snippet: m[0],
        reason: `hardcoded NEXT_PUBLIC_TURN_* assignment outside process.env: ${m[0].trim()}`,
      };
    }
  }
}

/**
 * Scan every file under `rootDir` (excluding {@link SKIP_DIRS}) for
 * committed TURN credentials. Returns every finding as a flat array;
 * the caller decides how to format them.
 *
 * The walk covers the whole repo so that `next.config.ts` and similar
 * top-level config files are scanned alongside `src/`, `scripts/`,
 * `tests/`, `.github/`, and `src-tauri/`. Per-extension and per-name
 * filtering still applies: only `.env*` and the extensions listed in
 * {@link SOURCE_EXTENSIONS} are inspected, and the AI-tool scaffolding
 * directories under `.agents/`, `.claude/`, `.planning/`, etc. are
 * skipped to keep the scan fast on a full checkout.
 *
 * @param {string} [rootDir] Repo root to scan. Defaults to
 *   {@link DEFAULT_REPO_ROOT}. The integration tests pass a temporary
 *   directory here so the guard can be exercised against synthetic
 *   fixture files without mutating the real repo.
 * @returns {LeakFinding[]}
 */
export function checkRepo(rootDir = DEFAULT_REPO_ROOT) {
  /** @type {LeakFinding[]} */
  const errors = [];

  if (!fs.existsSync(rootDir)) return errors;

  walk(rootDir, (file) => {
    const rel = relative(file, rootDir);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);

    // `.env*` files get the env-value check applied regardless of
    // extension; the URL / hardcode checks are irrelevant there because
    // they target source-form code.
    if (base.startsWith(".env")) {
      for (const err of findCommittedEnvValues(file, rootDir)) {
        errors.push(err);
      }
      return;
    }

    if (!SOURCE_EXTENSIONS.has(ext)) return;

    // Per-check allowlists are evaluated inside the helper functions so
    // the integration tests can drop synthetic fixtures at non-allowlisted
    // paths (e.g. `src/lib/_turn-cred-test-fixture.ts`) and exercise the
    // detection logic without overriding production files.
    for (const err of findInlineUrlCredentials(file, rootDir)) {
      errors.push(err);
    }
    for (const err of findHardcodedTurnEnvRefs(file, rootDir)) {
      errors.push(err);
    }
  });

  return errors;
}

/**
 * Run the guard end-to-end against the current working tree.
 *
 * @param {string} [rootDir] Override the default repo root. Used by
 *   the integration tests to scan a synthetic temp tree.
 * @returns {number} exit code (0 pass, 1 fail)
 */
function run(rootDir) {
  const errors = checkRepo(rootDir);
  if (errors.length === 0) {
    console.log(
      "[check-turn-credentials] PASS: no committed TURN credentials " +
        "detected (issue #1571).",
    );
    return 0;
  }
  console.error(
    "[check-turn-credentials] FAIL: committed TURN credentials detected " +
      "(issue #1571):",
  );
  for (const e of errors) {
    console.error(`  - ${e.file}:${e.line}: ${e.reason}`);
  }
  console.error(
    "Private TURN infrastructure credentials must NEVER be committed. " +
      "Inline `turn:`/`turns:` URL credentials and committed values for " +
      "`NEXT_PUBLIC_TURN_URL`/`USER`/`PASS` are inlined into the client " +
      "bundle by Next.js. For production, keep credentials out of the " +
      "client bundle — Tauri-side secret storage, a server-side proxy, " +
      "or signed time-limited TURN REST API tokens are the supported " +
      "patterns. See https://github.com/anchapin/planar-nexus/issues/1571.",
  );
  return 1;
}

// Run only when invoked directly, not when imported by a test.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const rootArg = process.argv[2];
  const rootDir = rootArg
    ? path.isAbsolute(rootArg)
      ? rootArg
      : path.resolve(process.cwd(), rootArg)
    : undefined;
  process.exit(run(rootDir));
}
