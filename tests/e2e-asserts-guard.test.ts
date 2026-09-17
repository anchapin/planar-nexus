/**
 * Integration tests for the issue #1786 / #1857 / #1858 / #1859 e2e
 * assertion guard (`scripts/check-e2e-asserts.mjs`).
 *
 * Mirrors the test pattern of `tests/mutation-docs-guard.test.ts` (#1785)
 * and `tests/jest-mock-boundary-guard.test.ts` (#1815): the guard is a
 * plain-Node script invoked by CI in its own job
 * (`.github/workflows/ci.yml` → `e2e-asserts-guard`, wired to
 * `npm run lint:e2e-asserts`). These tests spawn `node` against the
 * committed repo state (must PASS) and against fixture files in a temp
 * dir (must FAIL when an offender is introduced, must PASS when the
 * documented allowed-form is used).
 *
 * Contract summary (from issues #1786, #1857, #1858, #1859):
 *   - `if (await el.isVisible()) { ... }` MUST fail (the original #1786
 *     regression — the whole spec could pass on a blank shell).
 *   - `if ((await el.isVisible())) { ... }` with extra parens MUST also
 *     fail (the AST walker inspects the `IfStatement.expression`).
 *   - `const hasDialog = await el.isVisible(); if (hasDialog) { ... } else
 *     { ... }` MUST pass — the flag is read into a const first, the
 *     optional path is explicit and reviewable.
 *   - `await expect(el).toBeVisible()` outside an `if` MUST pass (that's
 *     the correct assertion — auto-retries).
 *   - `expect(bodyText.length).toBeGreaterThan(N)` with N <= 200 MUST
 *     fail (#1858, #1859) — the regression PR #1853 introduced this
 *     pattern to make sealed/draft tests pass on any error page.
 *   - `expect(connectionCode.length).toBeGreaterThan(50)` on a non-page-
 *     body identifier MUST pass (the regex filters on the identifier
 *     name, not just on `.length`).
 *   - `expect(bodyText.length).toBeGreaterThan(500)` with N > 200 MUST
 *     pass (above the threshold).
 *   - `.tsx` files under e2e/ MUST be walked too (#1857) — a future
 *     `.tsx` spec cannot reintroduce the forbidden visibility guard.
 *   - Nested directories under e2e/ MUST be walked recursively.
 *   - The committed repo state MUST pass — this is the state CI gates on.
 *
 * Implementation note: the script has no env-var override for `REPO_ROOT`
 * (unlike `check-jest-mock-boundary.mjs` which honours
 * `JEST_MOCK_BOUNDARY_REPO_ROOT`). Synthetic-fixture tests therefore COPY
 * the script into the temp dir rather than symlinking — so the script's
 * `import.meta.url` resolves to the temp location and its derived
 * `REPO_ROOT` lands inside the temp dir. `node_modules` is symlinked so
 * `import ts from "typescript"` still resolves.
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "yaml";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-e2e-asserts.mjs");

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(): GuardResult {
  const proc = cp.spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

describe("e2e-asserts guard (issues #1786, #1857, #1858, #1859)", () => {
  jest.setTimeout(60_000);

  it("passes on the committed repo state (CI baseline)", () => {
    const result = runGuard();
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/e2e-asserts: OK/);
  });
});

describe("e2e-asserts guard (issues #1786, #1857, #1858, #1859) — synthetic fixtures", () => {
  jest.setTimeout(60_000);

  /**
   * Build a throwaway project under `tmp` that mimics the real repo
   * shape well enough for the guard's directory walk. Returns the tmp
   * root and a `cleanup` thunk. The script's REPO_ROOT is derived from
   * `import.meta.url`, so the script MUST live at
   * `<tmp>/scripts/check-e2e-asserts.mjs` for the walk to find the
   * fixture e2e/ directory.
   */
  function makeTmpRepo(): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-asserts-guard-"));
    fs.mkdirSync(path.join(root, "e2e"), { recursive: true });
    // Touch a real .ts file so the walker has something to walk even
    // when the test doesn't stage any additional fixtures. Without a
    // single file in e2e/, the walker returns [] and the guard trivially
    // passes — masking bugs in the visitor.
    fs.writeFileSync(
      path.join(root, "e2e", "_placeholder.spec.ts"),
      "// placeholder\n",
    );
    return {
      root,
      cleanup: () => {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  }

  /** Stage a single file under a chosen repo-relative path. */
  function stage(root: string, relPath: string, body: string): void {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  /**
   * Copy the script (not symlink) into the temp dir so its
   * `import.meta.url` resolves to the copy. Symlink node_modules so
   * `import ts from "typescript"` resolves.
   */
  function linkDeps(root: string): void {
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(
      SCRIPT,
      path.join(root, "scripts", "check-e2e-asserts.mjs"),
    );
    fs.symlinkSync(
      path.join(REPO_ROOT, "node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
  }

  function runInTmp(root: string): GuardResult {
    const proc = cp.spawnSync(
      process.execPath,
      [path.join(root, "scripts", "check-e2e-asserts.mjs")],
      {
        encoding: "utf-8",
        cwd: root,
      },
    );
    return {
      code: proc.status ?? -1,
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  }

  it("flags if (await el.isVisible()) as a visibility-guard violation (#1786)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/visibility-violation.spec.ts",
        [
          'import { test, expect } from "@playwright/test";',
          'test("bad", async ({ page }) => {',
          '  const exportButton = page.locator("#export");',
          "  if (await exportButton.isVisible()) {",
          "    await exportButton.click();",
          "  }",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("e2e-asserts: FAILED");
      expect(result.stderr).toContain("visibility-violation.spec.ts");
      expect(result.stderr).toContain("isVisible()");
    } finally {
      cleanup();
    }
  });

  it("flags if ((await el.isVisible())) with extra parens (AST inspection, not regex)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/parens-violation.spec.ts",
        [
          'test("bad", async ({ page }) => {',
          '  const btn = page.locator("#btn");',
          "  if ((await btn.isVisible())) {",
          "    await btn.click();",
          "  }",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("parens-violation.spec.ts");
    } finally {
      cleanup();
    }
  });

  it("allows the explicit-flag const pattern (#1786 allowed form)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/allowed-flag.spec.ts",
        [
          'test("ok", async ({ page }) => {',
          '  const hasDialog = await page.locator("#dlg").isVisible();',
          "  if (hasDialog) {",
          '    await page.locator("#dlg").fill("x");',
          "  } else {",
          '    await page.locator("#other").fill("y");',
          "  }",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/e2e-asserts: OK/);
    } finally {
      cleanup();
    }
  });

  it("allows await expect(el).toBeVisible() outside an if (correct assertion)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/correct-assertion.spec.ts",
        [
          'test("ok", async ({ page }) => {',
          '  await expect(page.locator("#heading")).toBeVisible();',
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/e2e-asserts: OK/);
    } finally {
      cleanup();
    }
  });

  it("flags vacuous expect(bodyText.length).toBeGreaterThan(N<=200) (#1858, #1859)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/vacuous-body.spec.ts",
        [
          'test("bad", async ({ page }) => {',
          '  const bodyText = await page.locator("body").innerText();',
          "  expect(bodyText.length).toBeGreaterThan(50);",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("vacuous body-length");
      expect(result.stderr).toContain("vacuous-body.spec.ts");
    } finally {
      cleanup();
    }
  });

  it("flags vacuous body-length across identifier variants (pageText, pageBody, pageContent, innerText)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      // The guard's regex is /^(_)?(bodyText|pageText|pageBody|pageContent|innerText)$/i.
      // Stage each non-bodyText variant in its own assignment so we prove the
      // full alternation fires. bodyText is covered by the dedicated test above.
      stage(
        root,
        "e2e/vacuous-variants.spec.ts",
        [
          'test("bad", async ({ page }) => {',
          '  const pageText = await page.locator("body").textContent();',
          '  const pageBody = await page.locator("body").textContent();',
          '  const pageContent = await page.locator("body").textContent();',
          '  const innerText = await page.locator("body").textContent();',
          "  expect(pageText.length).toBeGreaterThan(100);",
          "  expect(pageBody.length).toBeGreaterThan(100);",
          "  expect(pageContent.length).toBeGreaterThan(100);",
          "  expect(innerText.length).toBeGreaterThan(100);",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("vacuous body-length");
      expect(result.stderr).toContain("vacuous-variants.spec.ts");
    } finally {
      cleanup();
    }
  });

  it("allows legitimate small-N length assertions on non-page-body identifiers", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/legitimate-length.spec.ts",
        [
          'test("ok", async () => {',
          "  const connectionCode = generateCode();",
          "  expect(connectionCode.length).toBeGreaterThan(50);",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/e2e-asserts: OK/);
    } finally {
      cleanup();
    }
  });

  it("allows expect(bodyText.length).toBeGreaterThan(500) (above the N<=200 threshold)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/large-body-length.spec.ts",
        [
          'test("ok", async ({ page }) => {',
          '  const bodyText = await page.locator("body").innerText();',
          "  expect(bodyText.length).toBeGreaterThan(500);",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/e2e-asserts: OK/);
    } finally {
      cleanup();
    }
  });

  it("walks .tsx e2e files too (#1857)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/tsx-violation.spec.tsx",
        [
          'test("bad", async ({ page }) => {',
          '  const btn = page.locator("#btn");',
          "  if (await btn.isVisible()) {",
          "    await btn.click();",
          "  }",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("tsx-violation.spec.tsx");
    } finally {
      cleanup();
    }
  });

  it("walks nested directories under e2e/ recursively", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      stage(
        root,
        "e2e/sub/nested-violation.spec.ts",
        [
          'test("bad", async ({ page }) => {',
          '  const x = page.locator("#x");',
          "  if (await x.isVisible()) {",
          "    await x.click();",
          "  }",
          "});",
        ].join("\n"),
      );
      const result = runInTmp(root);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("sub/nested-violation.spec.ts");
    } finally {
      cleanup();
    }
  });

  it("passes when e2e/ has only the placeholder file (no offenders)", () => {
    const { root, cleanup } = makeTmpRepo();
    linkDeps(root);
    try {
      const result = runInTmp(root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/e2e-asserts: OK/);
    } finally {
      cleanup();
    }
  });
});

describe("e2e-asserts guard CI wiring (issues #1786, #1857, #1858, #1859)", () => {
  type WorkflowStep = { name?: unknown; run?: unknown };
  type WorkflowJob = { steps?: WorkflowStep[]; needs?: unknown };
  type Workflow = { jobs: Record<string, WorkflowJob> };

  function loadWorkflow(rel: string): Workflow {
    const abs = path.join(__dirname, "..", rel);
    return yaml.parse(fs.readFileSync(abs, "utf8")) as Workflow;
  }

  it("ci.yml runs the guard in its own job and gates build on it", () => {
    const ci = loadWorkflow(".github/workflows/ci.yml");

    const guardSteps = (ci.jobs["e2e-asserts-guard"]?.steps ?? []).filter(
      (s) => s.run === "node scripts/check-e2e-asserts.mjs",
    );
    expect(guardSteps).toHaveLength(1);

    const buildNeeds = ci.jobs["build"]?.needs;
    expect(Array.isArray(buildNeeds)).toBe(true);
    expect(buildNeeds).toContain("e2e-asserts-guard");
  });

  it("package.json exposes lint:e2e-asserts and it invokes the script", () => {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["lint:e2e-asserts"]).toBe(
      "node scripts/check-e2e-asserts.mjs",
    );
  });
});
