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
  type ScenarioOutcome,
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
  it("has 15 scenarios, each with card data and an expect block", () => {
    expect(scenarios.length).toBe(15);
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

describe("diffExpected: ok-path errors (#2928)", () => {
  const base: Scenario = {
    id: "error-fixture",
    description: "Scenario whose outcome reports an engine error.",
    players: [{ life: 20 }, { life: 20 }],
    actions: [],
    expect: [{ life: 20 }, { life: 20 }],
  };

  const outcomeWith = (errors: string[]): ScenarioOutcome => ({
    scenario: base.id,
    engine: "planar-nexus",
    status: "ok",
    players: [{ life: 20 }, { life: 20 }],
    errors,
  });

  it("fails the verdict when an ok-path outcome carries errors", () => {
    const row = diffExpected(base, outcomeWith(["cast Shock: no mana"]));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["error: cast Shock: no mana"]);
  });

  it("matches when an ok-path outcome carries no errors", () => {
    const row = diffExpected(base, outcomeWith([]));
    expect(row.verdict).toBe("match");
    expect(row.differences).toEqual([]);
  });

  it("treats errors as differences on either engine in diffOutcomes", () => {
    const a = outcomeWith([]);
    const b: ScenarioOutcome = {
      ...outcomeWith([]),
      engine: "forge",
      errors: ["stack did not empty"],
    };
    expect(diffOutcomes(a, a).verdict).toBe("match");
    const row = diffOutcomes(a, b);
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["error: forge: stack did not empty"]);
  });
});

describe("diffExpected: expectStack (#2920)", () => {
  const base: Scenario = {
    id: "stack-fixture",
    description: "Scenario whose expect block asserts the stack.",
    players: [{ life: 20 }, { life: 20 }],
    actions: [],
    expectStack: ["Shock"],
    expect: [{ life: 20 }, { life: 20 }],
  };

  const outcomeWith = (stack?: string[]): ScenarioOutcome => ({
    scenario: base.id,
    engine: "planar-nexus",
    status: "ok",
    players: [{ life: 20 }, { life: 20 }],
    ...(stack === undefined ? {} : { stack }),
    errors: [],
  });

  it("matches when the observed stack agrees, ignoring order", () => {
    const row = diffExpected(base, outcomeWith(["Shock"]));
    expect(row.verdict).toBe("match");
    expect(row.differences).toEqual([]);
  });

  it("reports a mismatch with a readable stack line when it differs", () => {
    const row = diffExpected(base, outcomeWith(["Bolt"]));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual([
      'stack: expected ["Shock"], got ["Bolt"]',
    ]);
  });

  it("treats a missing observed stack as a mismatch, not a silent pass", () => {
    const row = diffExpected(base, outcomeWith(undefined));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual([
      'stack: expected ["Shock"], got undefined',
    ]);
  });

  it("does not check the stack when the scenario omits expectStack", () => {
    const s: Scenario = { ...base, expectStack: undefined };
    expect(diffExpected(s, outcomeWith(undefined)).verdict).toBe("match");
  });

  it("runs the new stack scenarios and matches their expectations", () => {
    for (const id of ["stack-shock-unresolved", "stack-shock-resolved"]) {
      const s = scenarios.find((x) => x.id === id)!;
      expect(s).toBeDefined();
      const outcome = runScenario(s, cards);
      expect(outcome.status).toBe("ok");
      // The stack is reported even though "stack" is not in `observe`.
      expect(outcome.stack).toBeDefined();
      const row = diffExpected(s, outcome);
      expect([id, row.verdict, row.differences]).toEqual([id, "match", []]);
    }
    const unresolved = scenarios.find(
      (x) => x.id === "stack-shock-unresolved",
    )!;
    expect(runScenario(unresolved, cards).stack).toEqual(["Shock"]);
    const resolved = scenarios.find((x) => x.id === "stack-shock-resolved")!;
    expect(runScenario(resolved, cards).stack).toEqual([]);
  });
});

describe("diffExpected: mana pool expectations (#2937)", () => {
  const base: Scenario = {
    id: "mana-fixture",
    description: "Scenario whose expect block asserts a mana pool.",
    players: [{ life: 20 }, { life: 20 }],
    actions: [],
    expect: [{ life: 20, manaPool: { R: 1 } }, { life: 20 }],
  };

  const outcomeWith = (
    pool?: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>,
  ): ScenarioOutcome => ({
    scenario: base.id,
    engine: "planar-nexus",
    status: "ok",
    players: [
      { life: 20, ...(pool === undefined ? {} : { manaPool: pool }) },
      { life: 20 },
    ],
    errors: [],
  });

  it("matches when the observed pool agrees, counting an omitted letter as zero", () => {
    const row = diffExpected(
      base,
      outcomeWith({ W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 }),
    );
    expect(row.verdict).toBe("match");
    expect(row.differences).toEqual([]);
  });

  it("reports a mismatch with a readable line when a pip is left over", () => {
    const row = diffExpected(base, outcomeWith({ R: 1, C: 1 }));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["P0 manaPool C: expected 0, got 1"]);
  });

  it("asserts an empty pool for an expectation of {}", () => {
    const s: Scenario = {
      ...base,
      expect: [{ life: 20, manaPool: {} }, { life: 20 }],
    };
    expect(diffExpected(s, outcomeWith({})).verdict).toBe("match");
    const row = diffExpected(s, outcomeWith({ C: 1 }));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["P0 manaPool C: expected 0, got 1"]);
  });

  it("treats a missing observed pool as a mismatch, not a silent pass", () => {
    const row = diffExpected(base, outcomeWith(undefined));
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual([
      'P0 manaPool: expected {"W":0,"U":0,"B":0,"R":1,"G":0,"C":0}, got undefined',
    ]);
  });

  it("does not check the pool when the scenario omits the expectation", () => {
    const s: Scenario = { ...base, expect: [{ life: 20 }, { life: 20 }] };
    expect(diffExpected(s, outcomeWith(undefined)).verdict).toBe("match");
    expect(diffExpected(s, outcomeWith({ C: 1 })).verdict).toBe("match");
  });
});

describe("observe(): the mana pool (#2937)", () => {
  const seeded: Scenario = {
    id: "mana-observe",
    description: "Scenario with a seeded mana pool.",
    players: [{ life: 20, manaPool: { R: 1, C: 1 } }, { life: 20 }],
    actions: [],
    observe: ["manaPool"],
  };

  it("reports the six mana letters when the scenario observes them", () => {
    const outcome = runScenario(seeded, cards);
    expect(outcome.status).toBe("ok");
    expect(outcome.players[0].manaPool).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 1,
      G: 0,
      C: 1,
    });
  });

  it("does not report the pool when the scenario does not observe it", () => {
    const outcome = runScenario({ ...seeded, observe: ["life"] }, cards);
    expect(outcome.status).toBe("ok");
    expect(outcome.players[0].manaPool).toBeUndefined();
  });
});

describe("the #2870 guard scenario (#2937)", () => {
  const scenario = scenarios.find(
    (x) => x.id === "mana-pool-colorless-spent",
  )!;

  it("seeds {R:1, C:1} for a {1}{C} spell and expects the pool spent", () => {
    expect(scenario).toBeDefined();
    expect(scenario.players[0].manaPool).toEqual({ R: 1, C: 1 });
    // `{}` means every letter is expected to be zero: the pool must be
    // completely empty once the {1}{C} spell has been paid for.
    expect(scenario.expect?.[0].manaPool).toEqual({});
    expect(scenario.observe).toContain("manaPool");
  });

  it("spends the whole pool and matches its expectation", () => {
    const outcome = runScenario(scenario, cards);
    expect(outcome.status).toBe("ok");
    expect(outcome.errors).toEqual([]);
    expect(outcome.players[0].manaPool).toEqual({
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      C: 0,
    });
    const row = diffExpected(scenario, outcome);
    expect([row.verdict, row.differences]).toEqual(["match", []]);
  });

  it("fails when a pip is left in the pool (the #2876 regression)", () => {
    // The same scenario with the leftover pip the engine would keep if the
    // {C} pip were dropped from the spell's cost again.
    const outcome = runScenario(scenario, cards);
    const withLeftover: ScenarioOutcome = {
      ...outcome,
      players: [
        { ...outcome.players[0], manaPool: { ...outcome.players[0].manaPool, C: 1 } },
        outcome.players[1],
      ],
    };
    const row = diffExpected(scenario, withLeftover);
    expect(row.verdict).toBe("mismatch");
    expect(row.differences).toEqual(["P0 manaPool C: expected 0, got 1"]);
  });

  it("diffs the pool between two engines", () => {
    const a = runScenario(scenario, cards);
    const b: ScenarioOutcome = {
      ...a,
      engine: "forge",
      players: [
        { ...a.players[0], manaPool: { ...a.players[0].manaPool, C: 1 } },
        a.players[1],
      ],
    };
    expect(diffOutcomes(a, b).verdict).toBe("mismatch");
    expect(diffOutcomes(a, a).verdict).toBe("match");
  });
});
