import { describe, test, expect } from "@jest/globals";

import {
  getCounterspellProbability,
  isOpponentLikelyToCounterspell,
  classifyManaTier,
  classifyStackPressure,
  getFrequencyRecord,
  COUNTERSPELL_FREQUENCY_TABLE,
} from "../counterspell-frequency-model";
import type { StackAction } from "../stack-interaction-ai";

function makeStackAction(
  name: string,
  manaValue: number,
  controller: string = "player2",
): StackAction {
  return {
    id: `stack_${name}`,
    cardId: name,
    name,
    controller,
    type: "spell",
    manaValue,
    isInstantSpeed: false,
    timestamp: Date.now(),
  };
}

describe("classifyManaTier", () => {
  test("returns low for 0-1 mana", () => {
    expect(classifyManaTier({ blue: 1 })).toBe("low");
    expect(classifyManaTier({ red: 0, colorless: 0 })).toBe("low");
    expect(classifyManaTier({})).toBe("low");
  });

  test("returns medium for 2-3 mana", () => {
    expect(classifyManaTier({ blue: 2 })).toBe("medium");
    expect(classifyManaTier({ blue: 1, red: 1, colorless: 1 })).toBe("medium");
  });

  test("returns high for 4+ mana", () => {
    expect(classifyManaTier({ blue: 4 })).toBe("high");
    expect(classifyManaTier({ blue: 2, red: 2, colorless: 3 })).toBe("high");
  });
});

describe("classifyStackPressure", () => {
  test("returns none for empty stack", () => {
    expect(classifyStackPressure([])).toBe("none");
  });

  test("returns none for low-value single spell", () => {
    const stack = [makeStackAction("Grizzly Bears", 2)];
    expect(classifyStackPressure(stack)).toBe("none");
  });

  test("returns low for moderate total mana value", () => {
    const stack = [makeStackAction("Rampant Growth", 2), makeStackAction("Elvish Mystic", 2), makeStackAction("Bears", 3)];
    expect(classifyStackPressure(stack)).toBe("low");
  });

  test("returns moderate for single threat", () => {
    const stack = [makeStackAction("Wrath of God", 4)];
    expect(classifyStackPressure(stack)).toBe("moderate");
  });

  test("returns high for multiple threats", () => {
    const stack = [
      makeStackAction("Counterspell", 2),
      makeStackAction("Primeval Titan", 6),
    ];
    expect(classifyStackPressure(stack)).toBe("high");
  });

  test("includes currentAction when provided", () => {
    const stack = [makeStackAction("Rampant Growth", 2)];
    const current = makeStackAction("Primeval Titan", 6);
    expect(classifyStackPressure(stack, current)).toBe("moderate");
  });
});

describe("getCounterspellProbability", () => {
  test("returns high probability for control with high mana and high pressure", () => {
    const result = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      [makeStackAction("Counterspell", 2)],
      makeStackAction("Primeval Titan", 6),
    );

    expect(result.probability).toBeGreaterThanOrEqual(0.7);
    expect(result.source).toBe("table");
    expect(result.archetype).toBe("control");
    expect(result.manaTier).toBe("high");
    expect(result.stackPressure).toBe("high");
  });

  test("returns low probability for aggro with low mana and no pressure", () => {
    const result = getCounterspellProbability(
      "aggro",
      { red: 1 },
      [],
      makeStackAction("Gray Ogre", 2),
    );

    expect(result.probability).toBeLessThanOrEqual(0.05);
    expect(result.source).toBe("table");
    expect(result.archetype).toBe("aggro");
  });

  test("returns conservative default for unknown archetype", () => {
    const result = getCounterspellProbability(
      "unknown",
      { blue: 5, colorless: 2 },
      [makeStackAction("Counterspell", 2)],
      makeStackAction("Exsanguinate", 6),
    );

    expect(result.probability).toBe(0.15);
    expect(result.source).toBe("default");
    expect(result.confidence).toBe("low");
  });

  test("returns moderate probability for midrange", () => {
    const result = getCounterspellProbability(
      "midrange",
      { black: 2, green: 1, colorless: 1 },
      [makeStackAction("Terminate", 2)],
      makeStackAction("Thragtusk", 5),
    );

    expect(result.probability).toBeLessThanOrEqual(0.30);
    expect(result.probability).toBeGreaterThan(0);
    expect(result.source).toBe("table");
  });

  test("returns moderate probability for combo with high pressure", () => {
    const result = getCounterspellProbability(
      "combo",
      { blue: 2, black: 2, colorless: 1 },
      [makeStackAction("Counterspell", 2)],
      makeStackAction("Exsanguinate", 6),
    );

    expect(result.probability).toBeGreaterThan(0.5);
    expect(result.source).toBe("table");
  });

  test("confidence is high for large sample sizes", () => {
    const result = getCounterspellProbability(
      "control",
      { blue: 2, colorless: 1 },
      [],
      makeStackAction("Grizzly Bears", 2),
    );

    if (result.source === "table") {
      expect(result.confidence).toBe("high");
    }
  });
});

describe("Control vs Aggro counterspell probability differences", () => {
  const scenarios = [
    { mana: { blue: 2, colorless: 1 }, stack: [], action: "Grizzly Bears", pressure: "none" as const },
    { mana: { blue: 2, colorless: 1 }, stack: [], action: "Primeval Titan", pressure: "moderate" as const },
    { mana: { blue: 4, colorless: 2 }, stack: [], action: "Exsanguinate", pressure: "high" as const },
  ];

  for (const scenario of scenarios) {
    test(`control counters more than aggro (mana=${JSON.stringify(scenario.mana)}, action=${scenario.action})`, () => {
      const controlResult = getCounterspellProbability(
        "control",
        scenario.mana,
        scenario.stack,
        makeStackAction(scenario.action, 4),
      );
      const aggroResult = getCounterspellProbability(
        "aggro",
        scenario.mana,
        scenario.stack,
        makeStackAction(scenario.action, 4),
      );

      expect(controlResult.probability).toBeGreaterThan(aggroResult.probability);
    });
  }
});

describe("isOpponentLikelyToCounterspell", () => {
  test("returns true for control with high mana and pressure", () => {
    expect(
      isOpponentLikelyToCounterspell(
        "control",
        { blue: 4, colorless: 2 },
        [makeStackAction("Counterspell", 2)],
        makeStackAction("Primeval Titan", 6),
      ),
    ).toBe(true);
  });

  test("returns false for aggro with low mana and no pressure", () => {
    expect(
      isOpponentLikelyToCounterspell(
        "aggro",
        { red: 1 },
        [],
        makeStackAction("Gray Ogre", 2),
      ),
    ).toBe(false);
  });

  test("respects custom threshold", () => {
    const result = isOpponentLikelyToCounterspell(
      "control",
      { blue: 2, colorless: 1 },
      [],
      makeStackAction("Grizzly Bears", 2),
      0.9,
    );
    expect(result).toBe(false);
  });

  test("unknown archetype uses default probability", () => {
    expect(
      isOpponentLikelyToCounterspell(
        "unknown",
        { blue: 2, colorless: 1 },
        [],
        makeStackAction("Grizzly Bears", 2),
      ),
    ).toBe(false);
  });
});

describe("getFrequencyRecord", () => {
  test("returns record for valid lookup", () => {
    const record = getFrequencyRecord("control", "high", "high");
    expect(record).toBeDefined();
    expect(record!.counterProbability).toBe(0.88);
    expect(record!.opponentArchetype).toBe("control");
  });

  test("returns undefined for unknown archetype", () => {
    const record = getFrequencyRecord("unknown", "high", "high");
    expect(record).toBeUndefined();
  });
});

describe("COUNTERSPELL_FREQUENCY_TABLE integrity", () => {
  test("has entries for all archetype-mana-pressure combos", () => {
    const archetypes = ["control", "tempo", "midrange", "aggro", "combo"] as const;
    const manaTiers = ["low", "medium", "high"] as const;
    const pressures = ["none", "low", "moderate", "high"] as const;

    for (const archetype of archetypes) {
      for (const manaTier of manaTiers) {
        for (const pressure of pressures) {
          const record = getFrequencyRecord(archetype, manaTier, pressure);
          expect(record).toBeDefined();
          expect(record!.counterProbability).toBeGreaterThanOrEqual(0);
          expect(record!.counterProbability).toBeLessThanOrEqual(1);
          expect(record!.sampleSize).toBeGreaterThan(0);
        }
      }
    }
  });

  test("control always counters more than aggro for same conditions", () => {
    const manaTiers = ["low", "medium", "high"] as const;
    const pressures = ["none", "low", "moderate", "high"] as const;

    for (const manaTier of manaTiers) {
      for (const pressure of pressures) {
        const control = getFrequencyRecord("control", manaTier, pressure)!;
        const aggro = getFrequencyRecord("aggro", manaTier, pressure)!;
        expect(control.counterProbability).toBeGreaterThan(
          aggro.counterProbability,
        );
      }
    }
  });

  test("higher stack pressure increases probability within each archetype", () => {
    const archetypes = ["control", "tempo", "midrange", "aggro", "combo"] as const;
    const manaTiers = ["low", "medium", "high"] as const;

    for (const archetype of archetypes) {
      for (const manaTier of manaTiers) {
        const none = getFrequencyRecord(archetype, manaTier, "none")!.counterProbability;
        const low = getFrequencyRecord(archetype, manaTier, "low")!.counterProbability;
        const moderate = getFrequencyRecord(archetype, manaTier, "moderate")!.counterProbability;
        const high = getFrequencyRecord(archetype, manaTier, "high")!.counterProbability;

        expect(none).toBeLessThanOrEqual(low);
        expect(low).toBeLessThanOrEqual(moderate);
        expect(moderate).toBeLessThanOrEqual(high);
      }
    }
  });

  test("table has expected number of entries", () => {
    expect(COUNTERSPELL_FREQUENCY_TABLE.length).toBe(60);
  });
});
