/**
 * Integration tests for the issue #1785 mutation docs sync guard
 * (`scripts/check-mutation-docs-sync.mjs`).
 *
 * Mirrors `tests/coverage-docs-guard.test.ts` (issue #1712): the guard is
 * a plain-Node script invoked by CI in its own job
 * (`.github/workflows/ci.yml` → `mutation-docs-guard`, wired to
 * `npm run lint:mutation-docs`). These tests spawn `node` against the
 * committed repo state (must PASS) and against fixture configs/docs in a
 * temp dir (must FAIL on drift, missing anchors, or stale inline
 * per-module floors).
 *
 * Contract summary (from issue #1785 acceptance criterion 4):
 *   - `stryker.config.js` `thresholds.break` matches the documented
 *     mutation-score floor in the anchored table
 *   - a stale `thresholds.break` number in the anchored table MUST fail
 *   - a table without the start/end anchors MUST fail (the ratchet
 *     cannot keep it in sync, so it must not pass silently)
 *   - the committed repo state MUST pass — this is the state CI gates on
 *   - an inline `Per-module floor: N` mention that disagrees with
 *     `scripts/mutation-floor.config.js` MUST fail
 *   - an inline mention for a module that has no floor in the config
 *     MUST fail (would be greenwashing)
 */

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-mutation-docs-sync.mjs");

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

const STRYKER_FIXTURE = `module.exports = {
  thresholds: {
    high: 80,
    low: 55,
    break: 50,
  },
  mutate: [
    "src/lib/game-state/layer-system.ts",
    "src/lib/game-state/replacement-effects.ts",
    "src/lib/game-state/combat.ts",
  ],
};
`;

const FLOOR_FIXTURE = `module.exports = {
  defaultFloor: 55,
  floors: {
    "src/lib/game-state/layer-system.ts": 55,
    "src/lib/game-state/replacement-effects.ts": 76,
    "src/lib/game-state/combat.ts": 50,
  },
};
`;

function docFixture(opts: {
  aggregateFloor?: string;
  includeLayerFloor?: boolean;
  layerFloor?: string;
  includeReplacementFloor?: boolean;
  replacementFloor?: string;
  includeUnmeasured?: boolean;
}): string {
  const aggregate =
    opts.aggregateFloor === undefined ? "50%" : opts.aggregateFloor;
  const layerFloor =
    opts.includeLayerFloor === false
      ? ""
      : `  Per-module floor: **${opts.layerFloor ?? "55"}** (\`scripts/mutation-floor.config.js\`).\n`;
  const replacementFloor =
    opts.includeReplacementFloor === false
      ? ""
      : `  Per-module floor: **${opts.replacementFloor ?? "76"}** (\`scripts/mutation-floor.config.js\`).\n`;
  const unmeasured = opts.includeUnmeasured
    ? "- `src/lib/game-state/combat.ts`: measured on each nightly run.\n"
    : "";
  return (
    "Some prose before.\n" +
    "<!-- mutation-floor:start -->\n" +
    "| Metric         | Project target | CI-enforced floor |\n" +
    "| -------------- | -------------- | ----------------- |\n" +
    `| Mutation score | **70%**        | **${aggregate}** |\n` +
    "<!-- mutation-floor:end -->\n" +
    "Some prose after.\n\n" +
    "#### Baseline measurements\n\n" +
    "- `src/lib/game-state/replacement-effects.ts`: **77.78%**. " +
    replacementFloor +
    "- `src/lib/game-state/layer-system.ts`: **56.65%**. " +
    layerFloor +
    unmeasured
  );
}

const MATCHING = docFixture({});

describe("check-mutation-docs-sync fixtures", () => {
  let tmp: string;
  let strykerPath: string;
  let floorPath: string;
  let docPath: string;

  function writeFixtures(docContent: string): string {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(strykerPath, STRYKER_FIXTURE, "utf-8");
    fs.writeFileSync(floorPath, FLOOR_FIXTURE, "utf-8");
    fs.writeFileSync(docPath, docContent, "utf-8");
    return docPath;
  }

  function runFixtures(): GuardResult {
    return runGuard([
      "--config",
      strykerPath,
      "--floor-config",
      floorPath,
      "--doc",
      docPath,
    ]);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-docs-guard-"));
    strykerPath = path.join(tmp, "stryker.config.js");
    floorPath = path.join(tmp, "mutation-floor.config.js");
    docPath = path.join(tmp, "TESTING.md");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("passes when the anchored floor and inline floors all match the config", () => {
    writeFixtures(MATCHING);
    const res = runFixtures();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("PASS");
  });

  it("fails when the documented aggregate floor is stale", () => {
    writeFixtures(docFixture({ aggregateFloor: "70%" }));
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("documented as 70%");
    expect(res.stderr).toContain("thresholds.break is 50");
  });

  it("fails when the anchored block is missing", () => {
    writeFixtures(MATCHING.replace("<!-- mutation-floor:start -->\n", "").replace(
      "<!-- mutation-floor:end -->\n",
      "",
    ));
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("missing");
    expect(res.stderr).toContain("mutation-floor:start");
  });

  it("fails when the inline layer-system floor disagrees with the config", () => {
    writeFixtures(docFixture({ layerFloor: "70" }));
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("layer-system");
    expect(res.stderr).toContain("documented as 70");
    expect(res.stderr).toContain("enforces 55");
  });

  it("fails when the inline replacement-effects floor disagrees with the config", () => {
    writeFixtures(docFixture({ replacementFloor: "50" }));
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("replacement-effects");
    expect(res.stderr).toContain("documented as 50");
    expect(res.stderr).toContain("enforces 76");
  });

  it("fails when the inline floor mentions a module that has no config entry (would be greenwashing)", () => {
    // Override the floor fixture: drop replacement-effects. The doc still
    // mentions it, so the guard must flag the missing config entry.
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(strykerPath, STRYKER_FIXTURE, "utf-8");
    fs.writeFileSync(
      floorPath,
      FLOOR_FIXTURE.replace(
        '"src/lib/game-state/replacement-effects.ts": 76,\n',
        "",
      ),
      "utf-8",
    );
    fs.writeFileSync(docPath, MATCHING, "utf-8");
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("replacement-effects");
    expect(res.stderr).toContain("no entry");
  });

  it("passes when no inline per-module floors are documented (only the aggregate gate is checked)", () => {
    writeFixtures(
      docFixture({
        includeLayerFloor: false,
        includeReplacementFloor: false,
      }),
    );
    const res = runFixtures();
    expect(res.code).toBe(0);
  });

  it("fails when the doc file does not exist", () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(strykerPath, STRYKER_FIXTURE, "utf-8");
    fs.writeFileSync(floorPath, FLOOR_FIXTURE, "utf-8");
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("missing");
  });

  it("fails when stryker.config.js has no thresholds.break", () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      strykerPath,
      STRYKER_FIXTURE.replace(/\s*break:\s*50,\n/, ""),
      "utf-8",
    );
    fs.writeFileSync(floorPath, FLOOR_FIXTURE, "utf-8");
    fs.writeFileSync(docPath, MATCHING, "utf-8");
    const res = runFixtures();
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("thresholds.break");
  });
});

describe("check-mutation-docs-sync repo state", () => {
  it("passes against the committed repo (mirrors the CI job)", () => {
    const res = runGuard();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("PASS");
    expect(res.stdout).toContain("stryker.config.js");
  });
});
