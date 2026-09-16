#!/usr/bin/env node
/**
 * E2E Assertion Guard — Issue #1786
 *
 * CI gate against the "invisible test" anti-pattern: wrapping assertions
 * (or whole functional checks) in `if (await el.isVisible())` so the spec
 * stays green even when the element NEVER renders. A blank shell passed
 * the suite before #1786 because every check was optional.
 *
 * The rule: `.isVisible()` may not appear inside an `if` condition in
 * e2e code. Visibility assertions must be unconditional —
 * `await expect(locator).toBeVisible()` auto-retries, so the assert IS
 * the waitFor. A branch with a genuinely meaningful else-side (skip with
 * reason, either/or UI variant, fallback navigation) reads the flag into
 * a const first, keeping the intent visible and auditable:
 *
 *   // FORBIDDEN
 *   if (await exportButton.isVisible()) {
 *     await expect(exportButton).toBeVisible();
 *   }
 *
 *   // REQUIRED
 *   await expect(exportButton).toBeVisible();
 *
 *   // allowed (explicit flag — reviewer can see the optional path)
 *   const hasDialog = await importDialog.isVisible();
 *   if (hasDialog) { ... } else { ... }
 *
 * Scope: every TypeScript file under e2e/ (helpers included — the pattern
 * is just as corrosive in a shared util).
 *
 * Implementation note: AST-based (via the workspace `typescript` package)
 * rather than regex, so multiline `if (\n await x.isVisible()\n)` chains
 * are caught and comments like "no isVisible guards here" are ignored.
 *
 * Exit codes:
 *   0 — no isVisible-in-if-condition occurrences
 *   1 — offenders found (file:line list on stderr)
 *
 * Usage:
 *   node scripts/check-e2e-asserts.mjs
 *
 * Wired into package.json as `lint:e2e-asserts`. CI wiring is owned by the
 * #1786 orchestrator wave (mirrors `lint:engine-size` / job
 * `engine-size-budget` in .github/workflows/ci.yml).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const E2E_DIR = join(REPO_ROOT, "e2e");

/**
 * Recursively collect e2e TypeScript files in deterministic order.
 * @returns {string[]}
 */
function collectE2eFiles() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts")) {
        out.push(full);
      }
    }
  }
  walk(E2E_DIR);
  return out;
}

/**
 * True if the node subtree contains a call to `.isVisible()`.
 * @param {ts.Node} node
 * @returns {boolean}
 */
function containsIsVisibleCall(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "isVisible"
  ) {
    return true;
  }
  for (const child of node.getChildren()) {
    if (containsIsVisibleCall(child)) return true;
  }
  return false;
}

/** @type {{ file: string; line: number; snippet: string }[]} */
const offenders = [];

for (const full of collectE2eFiles()) {
  const rel = relative(REPO_ROOT, full).split("\\").join("/");
  const source = ts.createSourceFile(
    full,
    readFileSync(full, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const visit = (node) => {
    if (ts.isIfStatement(node) && containsIsVisibleCall(node.expression)) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.expression.getStart(source),
      );
      offenders.push({
        file: rel,
        line: line + 1,
        snippet: node.expression
          .getText(source)
          .replace(/\s+/g, " ")
          .slice(0, 80),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (offenders.length === 0) {
  console.log(
    `e2e-asserts: OK — no .isVisible() inside if conditions across e2e/ (issue #1786).`,
  );
  process.exit(0);
}

console.error(
  `e2e-asserts: FAILED — ${offenders.length} if-condition(s) hide behind .isVisible() (issue #1786):`,
);
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}  if (${o.snippet})`);
}
console.error(
  `\nAssert unconditionally instead — await expect(locator).toBeVisible()\n` +
    `auto-retries and IS the waitFor. A branch with a genuinely meaningful\n` +
    `else-side (test.skip with reason, either/or variant, fallback route)\n` +
    `must read the flag into a const first:\n` +
    `  const hasX = await el.isVisible();\n` +
    `  if (hasX) { ... }`,
);
process.exit(1);
