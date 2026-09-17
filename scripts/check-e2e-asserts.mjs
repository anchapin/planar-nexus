#!/usr/bin/env node
/**
 * E2E Assertion Guard — Issue #1786 + #1857 + #1858 + #1859
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
 * Scope: every TypeScript file under e2e/ — both `.ts` AND `.tsx` (#1857:
 * Playwright supports `.tsx` specs and the repo doesn't prohibit them, so
 * a future `.tsx` e2e test could reintroduce the forbidden visibility
 * guard while the older `.ts`-only collection would miss it).
 *
 * Also enforces the "vacuous body-length assertion" guard (#1858, #1859):
 * `expect(someText.length).toBeGreaterThan(N)` where N ≤ 200 — this is
 * the exact pattern PR #1853 introduced to make sealed-mode / draft
 * tests pass on error pages. A test that passes for any page that has
 * more than 200 characters of body text catches no real regression, so
 * the lint rejects this pattern in e2e/. Greptile flagged this in the
 * #1853 review; the fix landed via the fixture work in #1858/#1859, and
 * this guard prevents the pattern from returning.
 *
 * Implementation note: AST-based (via the workspace `typescript` package)
 * rather than regex, so multiline `if (\n await x.isVisible()\n)` chains
 * are caught and comments like "no isVisible guards here" are ignored.
 *
 * Exit codes:
 *   0 — no offenders found across both checks
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

// Body-length assertions with N <= this threshold are flagged as
// vacuous. 200 is well above any real assertion target (e.g.
// `expect(...).toHaveLength(40)` for a 40-card pool) but well below
// the length of any meaningful page body that the test should be
// reading from. Tuned to catch `>50` / `>100` / `>200` patterns while
// leaving room for future legitimate small-N assertions (none today).
const VACUOUS_BODY_LENGTH_THRESHOLD = 200;

/**
 * Recursively collect e2e TypeScript files in deterministic order.
 * Returns both `.ts` and `.tsx` (#1857).
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
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
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

/**
 * If the node is `expect(<expr>.length).toBeGreaterThan(<N>)` and N is
 * a numeric literal <= VACUOUS_BODY_LENGTH_THRESHOLD, return the N. Else null.
 * @param {ts.Node} node
 * @returns {number | null}
 */
function vacuousBodyLengthCallsite(node) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "toBeGreaterThan" ||
    node.arguments.length !== 1
  ) {
    return null;
  }
  const arg = node.arguments[0];
  if (!ts.isNumericLiteral(arg)) return null;
  const n = Number(arg.text);
  if (n > VACUOUS_BODY_LENGTH_THRESHOLD) return null;

  // expect(<inner>).toBeGreaterThan — confirm <inner> is `<name>.length`
  // where <name> is an identifier whose name matches the vacuous
  // "page body text" pattern (the regression PR #1853 introduced:
  // `const bodyText = await page.locator("body").innerText();
  // expect(bodyText.length).toBeGreaterThan(50)`). AST shape:
  //   CallExpression `expect(<inner>).toBeGreaterThan(N)`
  //     expression: PropertyAccessExpression
  //       expression: CallExpression `expect(<inner>)`
  //         expression: Identifier `expect`
  //         arguments[0]: <inner>
  //       name: Identifier `toBeGreaterThan`
  //     arguments[0]: NumericLiteral N
  //
  // This deliberately does NOT flag legitimate `.length` assertions on
  // user-generated strings (e.g. an SDP connection code's length —
  // `expect(connectionCode.length).toBeGreaterThan(50)`). Those
  // measure real values, not page-body-anything-rendered. Only the
  // page-body-named variables are vacuous.
  const expectCall = /** @type {ts.CallExpression} */ (node.expression.expression);
  if (
    !ts.isCallExpression(expectCall) ||
    expectCall.expression.kind !== ts.SyntaxKind.Identifier ||
    expectCall.expression.text !== "expect"
  ) {
    return null;
  }
  const inner = expectCall.arguments[0];
  if (
    !inner ||
    !ts.isPropertyAccessExpression(inner) ||
    inner.name.text !== "length" ||
    inner.expression.kind !== ts.SyntaxKind.Identifier
  ) {
    return null;
  }
  const name = inner.expression.text;
  if (!/^(_)?(bodyText|pageText|pageBody|pageContent|innerText)$/i.test(name)) {
    return null;
  }
  return n;
}

/** @type {{ file: string; line: number; snippet: string }[]} */
const offenders = [];
/** @type {{ file: string; line: number; snippet: string; n: number }[]} */
const vacuousOffenders = [];

for (const full of collectE2eFiles()) {
  const rel = relative(REPO_ROOT, full).split("\\").join("/");
  const source = ts.createSourceFile(
    full,
    readFileSync(full, "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const visit = (node) => {
    // Check 1: isVisible inside an `if` condition (#1786).
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
    // Check 2: vacuous body-length assertion (#1858, #1859).
    const n = vacuousBodyLengthCallsite(node);
    if (n !== null) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      vacuousOffenders.push({
        file: rel,
        line: line + 1,
        snippet: node
          .getText(source)
          .replace(/\s+/g, " ")
          .slice(0, 80),
        n,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (offenders.length === 0 && vacuousOffenders.length === 0) {
  console.log(
    `e2e-asserts: OK — no .isVisible() inside if conditions, no vacuous body-length assertions across e2e/ (.ts + .tsx; issues #1786, #1857, #1858, #1859).`,
  );
  process.exit(0);
}

let failed = false;
if (offenders.length > 0) {
  failed = true;
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
}

if (vacuousOffenders.length > 0) {
  failed = true;
  console.error(
    `\ne2e-asserts: FAILED — ${vacuousOffenders.length} vacuous body-length assertion(s) (issues #1858, #1859):`,
  );
  for (const o of vacuousOffenders) {
    console.error(
      `  ${o.file}:${o.line}  ${o.snippet}    [N=${o.n}, threshold ${VACUOUS_BODY_LENGTH_THRESHOLD}]`,
    );
  }
  console.error(
    `\nA body-length assertion with a small N (${VACUOUS_BODY_LENGTH_THRESHOLD} or less)\n` +
      `is satisfied by any rendered error page, so it cannot fail when the\n` +
      `underlying feature regresses. Assert on a real DOM element instead\n` +
      `(e.g. expect(poolHeading).toBeVisible()). For the regression this\n` +
      `pattern caused, see PR #1853 (Greptile P1 findings) and the fixture\n` +
      `fixes in PRs for #1858 (sealed) / #1859 (draft).`,
  );
}

if (failed) process.exit(1);
