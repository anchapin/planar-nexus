/**
 * Card-script coverage and errata-drift helpers for the gap report (#2492).
 * No network: snapshots are built inline.
 */
import {
  normalizeOracle,
  oracleMatches,
  scriptCoverage,
  scryfallOracle,
  type ScriptOracleSnapshot,
} from "../scripts/card-scripts/coverage";

const snapshot: ScriptOracleSnapshot = {
  generatedAt: "2026-10-05T00:00:00Z",
  standardCardCount: 100,
  cards: {
    "Anthem of Champions": {
      standard: true,
      oracle: "Creatures you control get +1/+1.",
    },
    Guttersnipe: {
      standard: false,
      oracle:
        "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.",
    },
    "Errata Bear": { standard: true, oracle: "Vigilance, trample" },
    "Unknown Card": { standard: false, oracle: null },
  },
};

describe("scryfallOracle", () => {
  it("uses top-level oracle text when present", () => {
    expect(scryfallOracle({ name: "X", oracle_text: "Flying" })).toBe("Flying");
  });

  it("joins face oracle text for double-faced cards", () => {
    expect(
      scryfallOracle({
        name: "A // B",
        card_faces: [{ oracle_text: "Front" }, { oracle_text: "Back" }],
      }),
    ).toBe("Front\n//\nBack");
  });
});

describe("normalizeOracle / oracleMatches", () => {
  it("ignores line endings, extra spaces and curly quotes", () => {
    expect(normalizeOracle("  It\u2019s  here.\r\nNext  ")).toBe(
      "It's here.\nNext",
    );
    expect(oracleMatches("Flying\r\n", "Flying")).toBe(true);
  });

  it("treats a wording change as drift", () => {
    expect(oracleMatches("Vigilance", "Vigilance, trample")).toBe(false);
  });
});

describe("scriptCoverage", () => {
  const result = scriptCoverage(
    [
      {
        name: "Anthem of Champions",
        oracle: "Creatures you control get +1/+1.",
      },
      {
        name: "Guttersnipe",
        oracle:
          "Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.",
      },
      { name: "Errata Bear", oracle: "Vigilance" },
      { name: "Unknown Card", oracle: "Flying" },
      { name: "Brand New Script", oracle: "Haste" },
    ],
    snapshot,
  );

  it("counts Standard-legal scripted cards against the pool", () => {
    expect(result.scripts).toBe(5);
    expect(result.standardCardCount).toBe(100);
    expect(result.standardScripted).toBe(2);
    expect(result.nonStandard).toEqual(["Guttersnipe"]);
  });

  it("lists scripts the snapshot has no oracle for", () => {
    expect(result.missing).toEqual(["Brand New Script", "Unknown Card"]);
  });

  it("flags scripts whose oracle copy drifted from Scryfall", () => {
    expect(result.drift).toEqual([
      {
        name: "Errata Bear",
        script: "Vigilance",
        current: "Vigilance, trample",
      },
    ]);
  });
});
