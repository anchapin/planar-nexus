/**
 * Unit tests for the per-module mutation-score floor gate (issue #1598).
 *
 * Covers scripts/mutation-floor-lib.js (pure helpers, imported directly —
 * same approach as tests/ratchet-coverage.test.ts) and the two CLIs
 * (scripts/mutation-floor.js, scripts/mutation-summary.js) driven as child
 * processes against SYNTHETIC reports/mutation/mutation.json fixtures. No
 * real Stryker run is needed (full mutation testing takes ~40 min), which is
 * the point of the gate design: it only parses the JSON report Stryker
 * already emits.
 */

import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";

import {
  computeModuleScores,
  evaluateFloors,
  floorFor,
  loadFloorConfig,
  type FloorConfig,
} from "../scripts/mutation-floor-lib";
// CJS configs imported as ES defaults (esModuleInterop) and narrowed — the
// .js sources are outside tsc's checked surface (no checkJs).
import floorConfigModule from "../scripts/mutation-floor.config";
import strykerConfigModule from "../stryker.config";

const floorConfigSource = floorConfigModule as {
  defaultFloor: number;
  floors: Record<string, number>;
};
const strykerConfig = strykerConfigModule as { mutate: string[] };

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────

type MutantStatus =
  | "Killed"
  | "Survived"
  | "NoCoverage"
  | "Timeout"
  | "RuntimeError"
  | "Ignored"
  | "CompileError";

/** Build a mutant list whose score is `detected/considered * 100` exactly. */
function mutants(
  detected: number,
  considered: number,
): Array<{ status: MutantStatus }> {
  const out: Array<{ status: MutantStatus }> = [];
  for (let i = 0; i < detected; i++) out.push({ status: "Killed" });
  const survived = considered - detected;
  for (let i = 0; i < survived; i++) out.push({ status: "Survived" });
  return out;
}

const RUNNER_PREFIX = "/home/runner/work/planar-nexus/planar-nexus/";

function reportObject(files: Record<string, Array<{ status: MutantStatus }>>) {
  return {
    schemaVersion: "1.0",
    files: Object.fromEntries(
      Object.entries(files).map(([name, ms]) => [
        RUNNER_PREFIX + name,
        { mutants: ms },
      ]),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// computeModuleScores — the shared score math
// ─────────────────────────────────────────────────────────────────────────

describe("mutation-floor-lib computeModuleScores", () => {
  it("computes per-module scores from a Stryker 9.x object-shaped report", () => {
    const rows = computeModuleScores(
      reportObject({
        "src/lib/game-state/trigger-system.ts": mutants(7, 20), // 35%
        "src/lib/game-state/replacement-effects.ts": mutants(16, 20), // 80%
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.file)).toEqual([
      "src/lib/game-state/replacement-effects.ts",
      "src/lib/game-state/trigger-system.ts",
    ]);
    const trigger = rows[1]!;
    expect(trigger.score).toBeCloseTo(35, 5);
    expect(trigger.detected).toBe(7);
    expect(trigger.considered).toBe(20);
    expect(trigger.survived).toBe(13);
  });

  it("normalises absolute runner paths to repo-relative src/ paths", () => {
    const rows = computeModuleScores(
      reportObject({ "src/lib/game-state/layer-system.ts": mutants(1, 1) }),
    );
    expect(rows[0]?.file).toBe("src/lib/game-state/layer-system.ts");
  });

  it("counts Timeout as detected and excludes Ignored/CompileError from the score", () => {
    const data = {
      files: {
        [RUNNER_PREFIX + "src/lib/game-state/layer-system.ts"]: {
          mutants: [
            { status: "Killed" },
            { status: "Timeout" }, // detected
            { status: "Survived" },
            { status: "NoCoverage" }, // counted, not detected
            { status: "RuntimeError" }, // counted, not detected
            { status: "Ignored" }, // excluded entirely
            { status: "CompileError" }, // excluded entirely
          ],
        },
      },
    };
    const rows = computeModuleScores(data);
    expect(rows[0]?.detected).toBe(2);
    expect(rows[0]?.considered).toBe(5);
    expect(rows[0]?.score).toBeCloseTo(40, 5);
  });

  it("supports the legacy array-shaped files field", () => {
    const data = {
      files: [
        {
          name: RUNNER_PREFIX + "src/lib/game-state/layer-system.ts",
          mutants: [{ status: "Killed" }, { status: "Survived" }],
        },
      ],
    };
    const rows = computeModuleScores(data);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.file).toBe("src/lib/game-state/layer-system.ts");
    expect(rows[0]?.score).toBeCloseTo(50, 5);
  });

  it("scores a file with zero countable mutants as 0 (vacuous suite)", () => {
    const data = {
      files: {
        [RUNNER_PREFIX + "src/lib/game-state/layer-system.ts"]: {
          mutants: [{ status: "Ignored" }, { status: "CompileError" }],
        },
      },
    };
    expect(computeModuleScores(data)[0]?.score).toBe(0);
  });

  it("returns an empty list for reports without files", () => {
    expect(computeModuleScores({})).toEqual([]);
    expect(computeModuleScores(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// loadFloorConfig / floorFor — precedence: explicit > MUTATION_FLOOR > default
// ─────────────────────────────────────────────────────────────────────────

describe("mutation-floor-lib loadFloorConfig", () => {
  it("falls back to the config default when MUTATION_FLOOR is unset", () => {
    const config = loadFloorConfig({});
    expect(config.defaultFloor).toBe(floorConfigSource.defaultFloor);
    expect(config.floors).toEqual(floorConfigSource.floors);
  });

  it("honours a numeric MUTATION_FLOOR override for unlisted modules", () => {
    expect(loadFloorConfig({ MUTATION_FLOOR: "40" }).defaultFloor).toBe(40);
    expect(loadFloorConfig({ MUTATION_FLOOR: "90" }).defaultFloor).toBe(90);
  });

  it("ignores an unparsable MUTATION_FLOOR instead of silently disabling the gate", () => {
    expect(
      loadFloorConfig({ MUTATION_FLOOR: "not-a-number" }).defaultFloor,
    ).toBe(floorConfigSource.defaultFloor);
    expect(loadFloorConfig({ MUTATION_FLOOR: "" }).defaultFloor).toBe(
      floorConfigSource.defaultFloor,
    );
  });
});

describe("mutation-floor-lib floorFor", () => {
  const config: FloorConfig = {
    defaultFloor: 55,
    floors: { "src/lib/game-state/layer-system.ts": 55 },
  };

  it("prefers the explicit per-module floor over the env/default floor", () => {
    expect(floorFor("src/lib/game-state/layer-system.ts", config)).toBe(55);
  });

  it("falls back to the (possibly env-overridden) default for unlisted modules", () => {
    expect(floorFor("src/lib/game-state/some-new-module.ts", config)).toBe(55);
  });
});

describe("floor config sanity", () => {
  it("has an explicit floor for every module on the Stryker allowlist", () => {
    for (const module of strykerConfig.mutate) {
      expect(typeof floorConfigSource.floors[module]).toBe("number");
    }
  });

  it("has no orphan floor keys (a typo'd key would silently fall back to the default)", () => {
    for (const key of Object.keys(floorConfigSource.floors)) {
      expect(strykerConfig.mutate).toContain(key);
      expect(key.startsWith("src/")).toBe(true);
    }
  });

  it("keeps every floor at or above the aggregate break (lower floors would be dead letters)", () => {
    // Below `break: 50` Stryker's own gate already fails first, so a
    // per-module floor under 50 could never be the deciding signal.
    for (const floor of Object.values(floorConfigSource.floors)) {
      expect(floor).toBeGreaterThanOrEqual(50);
    }
    expect(floorConfigSource.defaultFloor).toBeGreaterThanOrEqual(50);
  });

  it("pins the documented baselines to the derivation rule floor(measured − 1pt)", () => {
    // Measured baselines from stryker.config.js ("THRESHOLDS" section).
    // If this test fails, either the measurement moved (re-measure, then
    // update BOTH the config comment and the floor) or the floor was hand-
    // raised above measured − 1pt — which breaks the nightly immediately.
    expect(floorConfigSource.floors["src/lib/game-state/layer-system.ts"]).toBe(
      Math.floor(56.65 - 1),
    ); // 55
    expect(
      floorConfigSource.floors["src/lib/game-state/replacement-effects.ts"],
    ).toBe(Math.floor(77.78 - 1)); // 76
  });
});

// ─────────────────────────────────────────────────────────────────────────
// evaluateFloors — the gate decision
// ─────────────────────────────────────────────────────────────────────────

describe("mutation-floor-lib evaluateFloors", () => {
  const config: FloorConfig = {
    defaultFloor: 55,
    floors: {
      "src/lib/game-state/trigger-system.ts": 50,
      "src/lib/game-state/replacement-effects.ts": 76,
    },
  };

  it("passes when every module is at or above its floor", () => {
    const rows = [
      { file: "src/lib/game-state/replacement-effects.ts", score: 80 },
      { file: "src/lib/game-state/trigger-system.ts", score: 50 }, // exactly at floor
    ];
    const { violations, ok } = evaluateFloors(rows, config);
    expect(ok).toBe(true);
    expect(violations).toEqual([]);
  });

  it("fails the synthetic regression scenario: one module at 35% beside four at 80%", () => {
    // The Stryker aggregate would be 71% here — comfortably above the
    // aggregate `break: 50` — but the 35% module must still fail the gate.
    const rows = [
      { file: "src/lib/game-state/trigger-system.ts", score: 35 },
      { file: "src/lib/game-state/replacement-effects.ts", score: 80 },
      { file: "src/lib/game-state/layer-system.ts", score: 80 },
      { file: "src/lib/game-state/spell-casting.ts", score: 80 },
      { file: "src/lib/game-state/state-based-actions.ts", score: 80 },
    ];
    const aggregate = rows.reduce((s, r) => s + r.score, 0) / rows.length;
    expect(aggregate).toBeGreaterThanOrEqual(50); // Stryker break would pass

    const { violations, ok } = evaluateFloors(rows, config);
    expect(ok).toBe(false);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("src/lib/game-state/trigger-system.ts");
    expect(violations[0]?.score).toBeCloseTo(35, 5);
  });

  it("fails a module just below its floor", () => {
    const { ok, violations } = evaluateFloors(
      [{ file: "src/lib/game-state/replacement-effects.ts", score: 75.9 }],
      config,
    );
    expect(ok).toBe(false);
    expect(violations[0]?.floor).toBe(76);
  });

  it("fails a module with zero countable mutants (score 0)", () => {
    const { ok } = evaluateFloors(
      [{ file: "src/lib/game-state/trigger-system.ts", score: 0 }],
      config,
    );
    expect(ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CLI: scripts/mutation-floor.js against synthetic report fixtures
// ─────────────────────────────────────────────────────────────────────────

describe("mutation-floor.js CLI", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "mutation-floor-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeReport(
    files: Record<string, Array<{ status: MutantStatus }>>,
  ): void {
    mkdirSync(path.join(workDir, "reports", "mutation"), { recursive: true });
    writeFileSync(
      path.join(workDir, "reports", "mutation", "mutation.json"),
      JSON.stringify(reportObject(files)),
    );
  }

  /** All floors pass: 4 modules at 80% + layer-system at 56% (floor 55). */
  function passingFiles(): Record<string, Array<{ status: MutantStatus }>> {
    return {
      "src/lib/game-state/layer-system.ts": mutants(56, 100), // 56% >= 55
      "src/lib/game-state/replacement-effects.ts": mutants(80, 100), // 80% >= 76
      "src/lib/game-state/spell-casting.ts": mutants(80, 100), // 80% >= 50
      "src/lib/game-state/trigger-system.ts": mutants(80, 100), // 80% >= 50
      "src/lib/game-state/state-based-actions.ts": mutants(80, 100), // 80% >= 50
    };
  }

  function runCli(extraEnv: Record<string, string> = {}): {
    status: number;
    stdout: string;
    stderr: string;
  } {
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...extraEnv,
    };
    delete env.MUTATION_FLOOR; // default cases must not inherit a local override
    Object.assign(env, extraEnv);
    // spawnSync (not execFileSync): captures stdout AND stderr regardless of
    // the exit code, so the exit-0 "skip note" path is assertable too.
    const res = spawnSync(
      "node",
      [path.join(__dirname, "..", "scripts", "mutation-floor.js")],
      { cwd: workDir, env: env as NodeJS.ProcessEnv, encoding: "utf8" },
    );
    return {
      status: res.status ?? 1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  }

  it("exits 0 when every mutated module is at or above its floor", () => {
    writeReport(passingFiles());
    const res = runCli();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("at or above their floors");
  });

  it("exits 1 and names the regressed module when one module hits 35% while others sit at 80%", () => {
    // Aggregate = 71% — Stryker's `break: 50` would PASS; the per-module
    // floor is the only gate that catches this (issue #1598 acceptance).
    const files = passingFiles();
    files["src/lib/game-state/trigger-system.ts"] = mutants(35, 100);
    writeReport(files);

    const res = runCli();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("src/lib/game-state/trigger-system.ts");
    expect(res.stderr).toContain("35.0%");
    expect(res.stderr).toContain("BELOW FLOOR");
    // The passing modules must NOT be reported as offenders.
    expect(res.stderr).not.toContain("replacement-effects");
  });

  it("honours the MUTATION_FLOOR env override", () => {
    writeReport(passingFiles());
    // 56% layer-system passes its explicit floor of 55, but MUTATION_FLOOR
    // only overrides the DEFAULT for unlisted modules — explicit entries win.
    expect(runCli({ MUTATION_FLOOR: "90" }).status).toBe(0);

    // A module WITHOUT an explicit entry is governed by the env default.
    const files = passingFiles();
    files["src/lib/game-state/brand-new-module.ts"] = mutants(80, 100); // 80%
    writeReport(files);
    expect(runCli({ MUTATION_FLOOR: "90" }).status).toBe(1);
    expect(runCli({ MUTATION_FLOOR: "90" }).stderr).toContain(
      "src/lib/game-state/brand-new-module.ts",
    );
    expect(runCli({ MUTATION_FLOOR: "30" }).status).toBe(0);
  });

  it("exits 0 with a skip note when the report is absent (Stryker's own gate covers hard failures)", () => {
    const res = runCli();
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("not found");
  });

  it("exits 1 on a malformed report instead of silently passing", () => {
    mkdirSync(path.join(workDir, "reports", "mutation"), { recursive: true });
    writeFileSync(
      path.join(workDir, "reports", "mutation", "mutation.json"),
      "{nope",
    );
    const res = runCli();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("failed to parse");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CLI: scripts/mutation-summary.js — the ⚠️ BELOW FLOOR annotation (issue #1598)
// ─────────────────────────────────────────────────────────────────────────

describe("mutation-summary.js below-floor annotation", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "mutation-summary-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runSummary(
    files: Record<string, Array<{ status: MutantStatus }>>,
  ): string {
    mkdirSync(path.join(workDir, "reports", "mutation"), { recursive: true });
    writeFileSync(
      path.join(workDir, "reports", "mutation", "mutation.json"),
      JSON.stringify(reportObject(files)),
    );
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY; // keep the table on stdout only
    delete env.MUTATION_FLOOR;
    const res = spawnSync(
      "node",
      [path.join(__dirname, "..", "scripts", "mutation-summary.js")],
      { cwd: workDir, env: env as NodeJS.ProcessEnv, encoding: "utf8" },
    );
    return res.stdout ?? "";
  }

  it("annotates only the below-floor rows, distinct from the emoji buckets", () => {
    const markdown = runSummary({
      "src/lib/game-state/trigger-system.ts": mutants(35, 100), // floor 50 → below
      "src/lib/game-state/replacement-effects.ts": mutants(80, 100), // floor 76 → above
    });

    const triggerRow = markdown
      .split("\n")
      .find((l) => l.includes("src/lib/game-state/trigger-system.ts"));
    const replacementRow = markdown
      .split("\n")
      .find((l) => l.includes("src/lib/game-state/replacement-effects.ts"));

    expect(triggerRow).toContain("⚠️ BELOW FLOOR");
    expect(replacementRow).not.toContain("⚠️ BELOW FLOOR");
    // The existing emoji buckets are unchanged: 35% is 🔴, 80% is 🟢.
    expect(triggerRow).toContain("🔴");
    expect(replacementRow).toContain("🟢");
  });
});
