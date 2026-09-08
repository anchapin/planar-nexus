/**
 * Integration tests for the issue #1712 coverage docs sync guard
 * (`scripts/check-coverage-docs-sync.mjs`).
 *
 * The guard is a plain-Node script invoked by CI in its own job
 * (`.github/workflows/ci.yml` → `coverage-docs-guard`, wired to
 * `npm run lint:coverage-docs`). These tests exercise it the same way CI
 * does — by spawning `node` — once against the committed repo state
 * (must PASS) and once against fixture configs/docs in a temp dir (must
 * FAIL on stale floors, missing anchors, or missing metric rows).
 *
 * Contract summary (from issue #1712):
 *   - the three committed doc tables match jest.config.js thresholds
 *   - a stale floor number in an anchored table MUST fail
 *   - a table without the start/end anchors MUST fail (ratchet cannot
 *     keep it in sync, so it must not pass silently)
 *   - an anchored table missing one of the four metric rows MUST fail
 *   - the committed repo state MUST pass — this is the state CI gates on
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-coverage-docs-sync.mjs");

interface GuardResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runGuard(args: string[] = []): GuardResult {
  const proc = cp.spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
  });
  return {
    code: proc.status ?? -1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

const CONFIG_FIXTURE = `module.exports = {
  coverageThreshold: {
    global: {
      branches: 52,
      functions: 52,
      lines: 60,
      statements: 59,
    },
  },
};
`;

function docFixture(floors: {
  lines?: string;
  functions?: string;
  statements?: string;
  branches?: string;
}): string {
  const row = (
    metric: string,
    target: string,
    floor: string | undefined,
  ): string =>
    floor === undefined
      ? ""
      : `| ${metric}      | ${target}    | ${floor}               |\n`;
  return (
    "<!-- coverage-floor:start -->\n" +
    "| Metric     | Target | CI-enforced floor |\n" +
    "| ---------- | ------ | ----------------- |\n" +
    row("Lines", "70%", floors.lines) +
    row("Functions", "70%", floors.functions) +
    row("Statements", "70%", floors.statements) +
    row("Branches", "60%", floors.branches) +
    "<!-- coverage-floor:end -->\n"
  );
}

const MATCHING = docFixture({
  lines: "60%",
  functions: "52%",
  statements: "59%",
  branches: "52%",
});

describe("check-coverage-docs-sync fixtures", () => {
  let tmp: string;
  let configPath: string;
  let docPath: string;

  function writeFixtures(docContent: string): string {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(configPath, CONFIG_FIXTURE, "utf-8");
    fs.writeFileSync(docPath, docContent, "utf-8");
    return docPath;
  }

  function runFixtures(): GuardResult {
    return runGuard(["--config", configPath, "--docs", docPath]);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-docs-guard-"));
    configPath = path.join(tmp, "jest.config.js");
    docPath = path.join(tmp, "README.md");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("passes when the anchored table matches the config thresholds", () => {
    writeFixtures(MATCHING);
    const res = runFixtures();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("PASS");
  });

  it("fails when a documented floor is stale", () => {
    writeFixtures(
      docFixture({
        lines: "29%",
        functions: "52%",
        statements: "59%",
        branches: "52%",
      }),
    );
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("lines floor is documented as 29%");
    expect(res.stderr).toContain("enforces 60%");
  });

  it("fails on every mismatching metric, not just the first", () => {
    writeFixtures(
      docFixture({
        lines: "29%",
        functions: "23%",
        statements: "29%",
        branches: "22%",
      }),
    );
    const res = runFixtures();
    expect(res.code).toBe(1);
    for (const metric of ["lines", "functions", "statements", "branches"]) {
      expect(res.stderr).toContain(metric);
    }
  });

  it("fails when the table has no anchor comments", () => {
    writeFixtures(
      MATCHING.replace("<!-- coverage-floor:start -->\n", "").replace(
        "<!-- coverage-floor:end -->\n",
        "",
      ),
    );
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("missing");
    expect(res.stderr).toContain("coverage-floor:start");
  });

  it("fails when a metric row is missing from the anchored table", () => {
    writeFixtures(
      docFixture({
        lines: "60%",
        functions: "52%",
        statements: "59%",
        // branches row omitted
      }),
    );
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('no row for "branches"');
  });

  it("fails when the doc file does not exist", () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(configPath, CONFIG_FIXTURE, "utf-8");
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("README.md");
    expect(res.stderr).toContain("missing");
  });
});

describe("check-coverage-docs-sync repo state", () => {
  it("passes against the committed repo (mirrors the CI job)", () => {
    const res = runGuard();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("PASS");
    expect(res.stdout).toContain("3 coverage-floor tables");
  });
});
