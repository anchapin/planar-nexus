/**
 * Jest-Mock Boundary Guard — Issue #1815
 *
 * The #1710 barrel rule (eslint `no-restricted-imports`) ensures production
 * code reaches the rules engine ONLY through `@/lib/game-state` (the barrel).
 * That rule sees `import` / `export-from` statements and nothing else. Jest
 * test helpers — `jest.mock("path")`, `jest.requireActual("path")`,
 * `jest.doMock(...)`, inline `import("path")` — slip past it because they
 * are string-literal function calls, not module-specifier imports.
 *
 * The bypass is real and the failure mode is silent: a mock whose path no
 * longer matches what the code under test actually resolves (after a
 * future rename, split, or barrel re-export change — issue #1725's
 * decomposition just shipped one such rename wave) intercepts nothing and
 * the test runs against the real implementation while still asserting
 * "this thing was mocked". Green CI, broken code.
 *
 * This guard mirrors the same approach as `check-e2e-asserts.mjs` and
 * `check-mutation-docs-sync.mjs`: it parses test files with the
 * TypeScript AST, extracts the string-literal module specifier from every
 * `jest.mock` / `jest.requireActual` / `jest.doMock` / inline `import()`
 * callsite, and rejects any specifier that reaches DEEP into
 * `@/lib/game-state/<submodule>` from outside the engine tree. The barrel
 * itself (`@/lib/game-state` with no `/<submodule>` suffix) is always OK.
 *
 * A small allowlist (`config/jest-mock-boundary-allowlist.json`) carves out
 * specific call expressions for tests that genuinely need fine-grained
 * submodule-level mock isolation. Each entry documents the seam being
 * mocked and why the barrel is insufficient. New deep mocks land here only
 * with a written reason — the default is "use the barrel or don't mock".
 *
 * Scope: every `*.test.ts` / `*.test.tsx` under `src/` and `tests/`.
 * Excluded: `src/lib/game-state/**` (the engine itself; its own files can
 * obviously reach into its own submodules).
 *
 * Usage:
 *   node scripts/check-jest-mock-boundary.mjs            # gate (default)
 *   node scripts/check-jest-mock-boundary.mjs --list     # also print allowed entries
 *
 * Exit codes:
 *   0 — no offenders (allowlist honoured)
 *   1 — one or more deep engine `jest.mock` / dynamic `import` calls outside
 *       the engine tree without an allowlist entry
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT =
  process.env.JEST_MOCK_BOUNDARY_REPO_ROOT ??
  join(fileURLToPath(import.meta.url), "..", "..");
const ALLOWLIST_FILE = join(
  REPO_ROOT,
  "config",
  "jest-mock-boundary-allowlist.json",
);

// ---------------------------------------------------------------------------
// Patterns we scan for
// ---------------------------------------------------------------------------

/**
 * Jest helpers that take a module specifier as their FIRST argument and
 * would silently fall back to the real implementation if the path no
 * longer resolves. Each must be a property access on the global `jest`
 * identifier — bare `mock("…")` calls are out of scope (they wouldn't
 * intercept anything anyway).
 */
const JEST_HELPERS = new Set([
  "mock",
  "doMock",
  "dontMock",
  "requireActual",
  "requireMock",
  "unmock",
]);

/**
 * Deep engine paths look like `@/lib/game-state/<submodule>` or
 * `@/lib/game-state/<submodule>/<anything>`. The barrel import
 * (`@/lib/game-state` with NO `/<submodule>` suffix) is always fine and is
 * intentionally excluded.
 */
const DEEP_ENGINE_PATH_RE = /^@\/lib\/game-state\/[^/]/;

/**
 * @param {string | null | undefined} s
 * @returns {boolean}
 */
function isEngineDeepPath(s) {
  if (!s) return false;
  return DEEP_ENGINE_PATH_RE.test(s);
}

/**
 * Extract the first string-literal argument from a `jest.<helper>(spec, …)`
 * call. Returns `null` if the call shape doesn't match (no specifier, or
 * the specifier isn't a literal — both indicate dynamic mocking that the
 * guard can't statically analyse, and the eslint rule + human review
 * cover those).
 *
 * @param {import("typescript").CallExpression} node
 * @returns {string | null}
 */
function extractJestMockSpecifier(node) {
  // Shape: jest.<helper>(<specifier>, <factory?>)
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  if (node.arguments.length < 1) return null;
  const helperName = node.expression.name.text;
  if (!JEST_HELPERS.has(helperName)) return null;
  // The receiver must be the bare `jest` identifier (not `expect.extend` or
  // similar property chains). `jest.something.foo()` is not a module mock
  // helper; `something.jest.mock()` isn't either.
  if (!ts.isIdentifier(node.expression.expression)) return null;
  if (node.expression.expression.text !== "jest") return null;
  const first = node.arguments[0];
  if (!ts.isStringLiteralLike(first)) return null;
  return first.text;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Recursively walk `src/` and `tests/` and return every `.test.ts` /
 * `.test.tsx` path. Deterministic order (sorted at every level) so the
 * output is reproducible across machines.
 * @returns {string[]}
 */
function collectTestFiles() {
  const roots = [join(REPO_ROOT, "src"), join(REPO_ROOT, "tests")];
  /** @type {string[]} */
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    /** @param {string} dir */
    function walk(dir) {
      for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (
            entry === "node_modules" ||
            entry === ".next" ||
            entry === "dist"
          )
            continue;
          walk(full);
        } else if (
          (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) &&
          !entry.endsWith(".d.ts")
        ) {
          out.push(full);
        }
      }
    }
    walk(root);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AllowlistFile
 * @property {string} reason  Why this file's deep engine mocks are an exception to #1710.
 *
 * @typedef {Object} Allowlist
 * @property {Record<string, AllowlistFile>} files  Path (POSIX, repo-root-relative) → entry.
 */

/** @type {Allowlist} */
let allowlist = { files: {} };

if (existsSync(ALLOWLIST_FILE)) {
  try {
    allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8"));
    if (
      !allowlist ||
      typeof allowlist !== "object" ||
      !allowlist.files
    ) {
      console.error(
        `jest-mock-boundary: malformed allowlist at ${relative(REPO_ROOT, ALLOWLIST_FILE)} — expected { files: { ... } }, got ${JSON.stringify(allowlist)}.`,
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `jest-mock-boundary: failed to parse ${relative(REPO_ROOT, ALLOWLIST_FILE)}:`,
      error,
    );
    process.exit(1);
  }
}

const showAllowlist = process.argv.includes("--list");

// ---------------------------------------------------------------------------
// AST scan
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Offender
 * @property {string} file
 * @property {number} line
 * @property {string} snippet
 * @property {string} helper
 * @property {string} specifier
 */

/**
 * Find every `jest.<helper>("path")` and `import("path")` call expression
 * in the source file whose specifier is a deep engine path. Returns the
 * offending nodes with their file-relative location.
 *
 * @param {string} sourceFile
 * @param {import("typescript").SourceFile} source
 * @returns {Offender[]}
 */
function findOffenders(sourceFile, source) {
  const rel = relative(REPO_ROOT, sourceFile).split(sep).join("/");
  const isInsideEngine = rel.startsWith("src/lib/game-state/");

  /** @type {Offender[]} */
  const offenders = [];

  const visit = (node) => {
    // Case 1: jest.<helper>(<string>) — the standard mock call shape.
    if (ts.isCallExpression(node)) {
      const helperSpec = extractJestMockSpecifier(node);
      if (helperSpec !== null && isEngineDeepPath(helperSpec)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        offenders.push({
          file: rel,
          line: line + 1,
          snippet: node.getText(source).replace(/\s+/g, " ").slice(0, 100),
          helper: node.expression.name.text,
          specifier: helperSpec,
        });
        return; // Don't double-count the same node as a dynamic import.
      }
    }

    // Case 2: dynamic `import("…")` expression — usually type-only or used
    // to assert module shape, but the specifier still has to be the
    // barrel, not a deep path, to honour the engine boundary contract.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const first = node.arguments[0];
      if (ts.isStringLiteralLike(first) && isEngineDeepPath(first.text)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        offenders.push({
          file: rel,
          line: line + 1,
          snippet: node.getText(source).replace(/\s+/g, " ").slice(0, 100),
          helper: "import",
          specifier: first.text,
        });
      }
    }

    // Case 3: type-only inline `import("…").Type` qualifier — TypeScript
    // parses this as an `ImportTypeNode`, not a CallExpression, so the
    // runtime-import check above misses it. The eslint #1710 rule's
    // `no-restricted-imports` covers regular `import type` statements but
    // not this inline qualifier form, so we close the gap here.
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      isEngineDeepPath(node.argument.literal.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      offenders.push({
        file: rel,
        line: line + 1,
        snippet: node
          .getText(source)
          .replace(/\s+/g, " ")
          .slice(0, 100),
        helper: "import-type",
        specifier: node.argument.literal.text,
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  // Engine-internal tests (`src/lib/game-state/__tests__/**`) are exempt —
  // they ARE the engine and naturally reach its submodules. Any allowlist
  // entries for files inside the engine are still consulted and would
  // fire on stale paths, but the guard doesn't flag engine-internal files
  // by default.
  return isInsideEngine ? [] : offenders;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** @type {Map<string, Offender[]>} */
const grouped = new Map();

for (const full of collectTestFiles()) {
  const source = ts.createSourceFile(
    full,
    readFileSync(full, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  for (const offender of findOffenders(full, source)) {
    const list = grouped.get(offender.file) ?? [];
    list.push(offender);
    grouped.set(offender.file, list);
  }
}

// Drop offenders from allowlisted files. The allowlist is a per-file (not
// per-mock) carve-out — every deep engine mock in that file is covered,
// which is the smallest unit of justification that makes sense (tests that
// want fine-grained submodule isolation typically mock several).
const effective = [];
const allowedFiles = [];
for (const [file, list] of grouped) {
  if (allowlist.files[file]) {
    allowedFiles.push(file);
    continue;
  }
  effective.push(...list);
}

if (showAllowlist) {
  console.log(
    `jest-mock-boundary: ${allowedFiles.length} allowlisted file(s) — engine-deep mocks permitted without error:`,
  );
  for (const file of allowedFiles) {
    console.log(
      `  ${file} — ${allowlist.files[file]?.reason ?? "(no reason recorded)"}`,
    );
  }
}

if (effective.length === 0) {
  console.log(
    `jest-mock-boundary: OK — no deep engine jest.mock / dynamic import specifiers across src/ + tests/ (.test.ts + .test.tsx; issue #1815).`,
  );
  process.exit(0);
}

console.error(
  `jest-mock-boundary: FAILED — ${effective.length} deep engine jest.mock / dynamic import call(s) (issue #1815):`,
);
for (const o of effective) {
  console.error(
    `  ${o.file}:${o.line}  ${o.helper}("${o.specifier}")  ${o.snippet}`,
  );
}
console.error(
  `\nThe #1710 barrel rule applies to production imports — these callsites\n` +
    `bypass it because jest.mock / dynamic import() take string literals\n` +
    `that ESLint cannot statically analyse. After an engine-internal rename\n` +
    `(e.g. issue #1725's decomposition), a stale path here silently stops\n` +
    `intercepting and the test asserts against the real implementation\n` +
    `while reporting "this was mocked".\n\n` +
    `Two fixes:\n` +
    `  1. Mock via the barrel: jest.mock("@/lib/game-state", …) — coarse\n` +
    `     but refactor-safe.\n` +
    `  2. Add the file to config/jest-mock-boundary-allowlist.json with a\n` +
    `     written reason for the seam being mocked (each entry should\n` +
    `     name the submodule and explain why the barrel is insufficient).\n` +
    `A path that matches /^@\\/lib\\/game-state\\/[^/]/ but is the barrel\n` +
    `itself (@/lib/game-state with NO /<submodule>) is always accepted.`,
);

process.exit(1);