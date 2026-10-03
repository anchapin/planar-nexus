/**
 * Differential rules harness, planar-nexus side (#2411).
 *
 * Runs every scenario in scripts/differential/scenarios through the engine
 * with the committed card snapshot (no network) and checks each against its
 * rules-derived `expect` block. KNOWN_MISMATCHES is a ratchet: when an engine
 * fix makes a scenario match, this test fails until the entry is removed.
 */
import { describe, it, expect } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { runScenario } from "../scripts/differential/planar-nexus-runner";
import { diffExpected, diffOutcomes } from "../scripts/differential/diff";
import {
  scenarioCardNames,
  type Scenario,
} from "../scripts/differential/scenario";

const DIR = path.join(__dirname, "..", "scripts", "differential");
const cards = JSON.parse(
  fs.readFileSync(path.join(DIR, "cards.snapshot.json"), "utf-8"),
);
const scenarios: Scenario[] = fs
  .readdirSync(path.join(DIR, "scenarios"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) =>
    JSON.parse(fs.readFileSync(path.join(DIR, "scenarios", f), "utf-8")),
  );

/** Scenario id -> the issue tracking the engine gap it exposes. */
const KNOWN_MISMATCHES: Record<string, string> = {};

describe("differential scenarios: planar-nexus runner", () => {
  it("has at least 8 scenarios, each with card data and an expect block", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(8);
    for (const s of scenarios) {
      expect(s.expect).toHaveLength(2);
      for (const name of scenarioCardNames(s)) {
        expect([s.id, name, Boolean(cards[name])]).toEqual([s.id, name, true]);
      }
    }
  });

  it.each(scenarios.map((s) => [s.id, s] as const))(
    "%s runs and matches its expectation unless it is a known gap",
    (_id, scenario) => {
      const outcome = runScenario(scenario, cards);
      expect(outcome.status).toBe("ok");
      const row = diffExpected(scenario, outcome);
      const known = scenario.id in KNOWN_MISMATCHES;
      expect([scenario.id, row.verdict]).toEqual([
        scenario.id,
        known ? "mismatch" : "match",
      ]);
    },
  );

  it("reports a scenario naming a card with no data as couldn't express", () => {
    const s: Scenario = {
      id: "missing-card",
      description: "",
      players: [{ hand: ["No Such Card"] }, {}],
      actions: [{ do: "cast", player: 0, card: "No Such Card" }],
      expect: [{}, {}],
    };
    const outcome = runScenario(s, cards);
    expect(outcome.status).toBe("unsupported");
    expect(diffExpected(s, outcome).verdict).toBe("couldn't express");
  });

  it("diffs two engines' outcomes field by field", () => {
    const s = scenarios.find((x) => x.id === "etb-land-scoured-barrens")!;
    const a = runScenario(s, cards);
    const b = {
      ...a,
      engine: "forge",
      players: [{ ...a.players[0], life: 20 }, a.players[1]],
    };
    expect(diffOutcomes(a, a).verdict).toBe("match");
    const row = diffOutcomes(a, b);
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["P0 life: forge 20, planar-nexus 21"]);
  });
});
