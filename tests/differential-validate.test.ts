/**
 * Runtime-validator tests for the engine-neutral differential scenario
 * format (#2411).
 *
 * The runner suite (tests/differential-runner.test.ts) proves scenarios
 * play through the engine; this suite proves a scenario FILE is rejected
 * before it reaches the engine when it does not match the format —
 * including the strict unknown-key behaviour a type-check cannot give
 * for JSON shared with a second (reference-engine) runner.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadScenarioFile,
  validateScenario,
} from "../scripts/differential/validate";
import type { Scenario } from "../scripts/differential/scenario";

const VALID: Scenario = {
  id: "validate-fixture",
  description: "Minimal valid scenario for validator tests.",
  players: [
    { life: 20, library: 0 },
    { life: 20, library: 0 },
  ],
  phase: "precombat_main",
  actions: [{ do: "playLand", player: 0, card: "Forest" }],
  observe: ["life", "battlefield"],
  expect: [{ life: 20 }, { life: 20 }],
};

function writeTmp(value: unknown): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "diff-validate-")),
    "scenario.json",
  );
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

describe("differential scenario validator (#2411)", () => {
  it("accepts a valid scenario object", () => {
    const result = validateScenario(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scenario.id).toBe("validate-fixture");
  });

  it("loads a valid scenario file from disk", () => {
    expect(loadScenarioFile(writeTmp(VALID)).id).toBe("validate-fixture");
  });

  it("rejects an unknown top-level key instead of silently ignoring it", () => {
    const result = validateScenario({ ...VALID, life_total: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/life_total|Unrecognized/);
    }
  });

  it("rejects a misspelled player field (life_total for life)", () => {
    const result = validateScenario({
      ...VALID,
      players: [{ life_total: 20 }, { life: 20 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a scenario with fewer than two players", () => {
    const result = validateScenario({ ...VALID, players: [{ life: 20 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/players/);
    }
  });

  it("rejects an unknown phase", () => {
    const result = validateScenario({ ...VALID, phase: "cleanup" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-JSON file with a readable error", () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "diff-validate-")),
      "scenario.json",
    );
    fs.writeFileSync(file, "{not json");
    expect(() => loadScenarioFile(file)).toThrow(/not valid JSON/);
  });
});
