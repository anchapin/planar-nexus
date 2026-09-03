/**
 * Integration tests for the issue #1550 setup-node-npm-ci Node-version guard
 * (`scripts/check-setup-node-npm-ci-version.mjs`).
 *
 * The guard is a plain-Node script invoked by CI in its own step inside the
 * existing `workflow-lint` job (`.github/workflows/ci.yml`). These tests
 * exercise it the same way CI does — by spawning `node` against synthetic
 * workflow fixtures in a temp directory — so the contract locked in here is
 * the same one that gates a PR merge.
 *
 * Contract summary (from issue #1550):
 *   - `uses: ./.github/actions/setup-node-npm-ci` with no `with:` block PASSES
 *     (the composite default of '22' applies).
 *   - `with: node-version:` omitted in a present `with:` block PASSES (same).
 *   - `with: node-version: '22'` (or `"22"` or `22`) PASSES.
 *   - `with: node-version: ${{ env.NAME }}` PASSES iff the workflow's own
 *     workflow-level `env.NAME: '22'` entry resolves to '22'.
 *   - `with: node-version: '20'`, `'18'`, etc. FAILS with file:line report.
 *   - `with: node-version: ${{ env.NAME }}` failing to resolve to '22' FAILS.
 *   - Files that do not invoke the composite are ignored entirely.
 *
 * The four canonical fixtures (one PASS with default, one PASS with
 * explicit '22', one FAIL with '20', one PASS with no usage) cover the
 * issue-stated scenarios; the remaining tests probe edge cases that the
 * issue's acceptance criteria call out (env.NAME resolution, quote styles,
 * shape drift).
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "check-setup-node-npm-ci-version.mjs",
);
const REAL_WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(dirArg?: string): GuardResult {
  const args = dirArg ? [SCRIPT, dirArg] : [SCRIPT];
  const res = cp.spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function makeWorkflowsDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "node-version-guard-"));
}

interface FixtureFile {
  name: string;
  body: string;
}

function writeFixtures(dir: string, files: FixtureFile[]): void {
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.name), f.body);
  }
}

function expectFail(result: GuardResult, messageFragment?: string): void {
  expect(result.code).toBe(1);
  const combined = result.stdout + result.stderr;
  expect(combined).toMatch(/FAIL/i);
  if (messageFragment !== undefined) {
    expect(combined).toContain(messageFragment);
  }
}

function expectPass(result: GuardResult): void {
  if (result.code !== 0) {
    // Surface the error inline so failures aren't opaque.
    console.error("unexpected stdout:", result.stdout);
    console.error("unexpected stderr:", result.stderr);
  }
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/PASS/i);
}

describe("setup-node-npm-ci version guard (issue #1550)", () => {
  test("the actual repo state passes the guard (acceptance criterion #5)", () => {
    // Smoke check: the canonical repo workflows (after release.yml drift
    // removal is included in this PR) satisfy the guard. If this fails,
    // somebody reintroduced a Node-20 override against release.yml and the
    // build gate will block the PR.
    const result = runGuard();
    expectPass(result);
  });

  test("fixture A: usage with no `with:` block passes (composite default '22' applies)", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "a.yml",
        body: [
          "name: A",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "      - name: Build",
          "        run: npm run build",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fixture B: usage with explicit '22' (single-quoted) passes", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "b.yml",
        body: [
          "name: B",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: '22'",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fixture C: usage with '20' fails (the release.yml drift case)", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "c.yml",
        body: [
          "name: C",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: '20'",
          "",
        ].join("\n"),
      },
    ]);
    try {
      const result = runGuard(dir);
      expectFail(result, "node-version='20'");
      expect(result.stderr).toContain("setup-node-npm-ci");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fixture D: file with no usage of the composite is ignored and passes", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "d.yml",
        body: [
          "name: D",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Checkout",
          "        uses: actions/checkout@v7",
          "      - name: Build",
          "        run: npm run build",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("explicit '22' with double quotes passes (alternative YAML quote style)", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "e.yml",
        body: [
          "name: E",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          '          node-version: "22"',
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("explicit '22' unquoted scalar passes", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "f.yml",
        body: [
          "name: F",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: 22",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("'with:' present but 'node-version:' omitted passes (default applies)", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "g.yml",
        body: [
          "name: G",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          fetch-depth: 0",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node-version override via ${{ env.NAME }} where env.NAME='22' passes", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "h.yml",
        body: [
          "name: H",
          "on: [push]",
          "env:",
          "  NODE_VERSION: '22'",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: ${{ env.NODE_VERSION }}",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node-version override via ${{ env.NAME }} where env.NAME='20' fails", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "i.yml",
        body: [
          "name: I",
          "on: [push]",
          "env:",
          "  NODE_VERSION: '20'",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: ${{ env.NODE_VERSION }}",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectFail(runGuard(dir), "${{ env.NODE_VERSION }}");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("node-version '18' fails with file:line report", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "j.yml",
        body: [
          "name: J",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: '18'",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectFail(runGuard(dir), "node-version='18'");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("multiple violations are all surfaced in a single run", () => {
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "k1.yml",
        body: [
          "name: K1",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: '20'",
          "",
        ].join("\n"),
      },
      {
        name: "k2.yml",
        body: [
          "name: K2",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "        with:",
          "          node-version: '18'",
          "",
        ].join("\n"),
      },
      {
        name: "k3.yml",
        body: [
          "name: K3",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: ./.github/actions/setup-node-npm-ci",
          "",
        ].join("\n"),
      },
    ]);
    try {
      const result = runGuard(dir);
      expectFail(result);
      expect(result.stderr).toContain("k1.yml");
      expect(result.stderr).toContain("k2.yml");
      // The "PASS" message should NOT appear when any violation exists.
      expect(result.stdout).not.toMatch(/PASS/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("non-existent workflow directory fails with a clear error", () => {
    const result = runGuard("/nonexistent/workflows");
    expectFail(result, "workflow directory not found");
  });

  test("empty workflow directory fails (no .yml files at all)", () => {
    const dir = makeWorkflowsDir();
    try {
      expectFail(runGuard(dir), "no workflow files");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses line wrapped in single quotes (rare quoted form) is recognized", () => {
    // The guard accepts both the unquoted form (the dominant convention in
    // this repo) and a path wrapped in single quotes. We pin both so a
    // future contributor who adds quotes is not penalized.
    const dir = makeWorkflowsDir();
    writeFixtures(dir, [
      {
        name: "l.yml",
        body: [
          "name: L",
          "on: [push]",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: Setup",
          "        uses: './.github/actions/setup-node-npm-ci'",
          "        with:",
          "          node-version: '22'",
          "",
        ].join("\n"),
      },
    ]);
    try {
      expectPass(runGuard(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("setup-node-npm-ci composite exists at the canonical path (smoke check on the source of truth)", () => {
    // The script's COMPOSITE_PATH reference and the README/AGENTS.md
    // documentation both point at this file. If a directory rename ever
    // happens the script's pointer becomes stale, so we assert the file
    // exists here too.
    const composite = path.join(
      REPO_ROOT,
      ".github",
      "actions",
      "setup-node-npm-ci",
      "action.yml",
    );
    expect(fs.existsSync(composite)).toBe(true);
    const text = fs.readFileSync(composite, "utf8");
    // The composite's own default is the canonical Node version the guard
    // enforces. Pin it here so an accidental change to that default would
    // surface as a test failure in the same PR.
    expect(text).toMatch(/default:\s*['"]22['"]/);
  });

  test("real workflow dir (.github/workflows) exists and is non-empty so the default-arg path is exercised", () => {
    // Defensive: the default-arg code path reads DEFAULT_WORKFLOW_DIR.
    // If .github/workflows is missing or empty, the smoke test would PASS
    // only because of the 'no workflows' error. Verify the dir has files.
    expect(fs.existsSync(REAL_WORKFLOW_DIR)).toBe(true);
    const entries = fs
      .readdirSync(REAL_WORKFLOW_DIR)
      .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
    expect(entries.length).toBeGreaterThan(0);
  });
});
