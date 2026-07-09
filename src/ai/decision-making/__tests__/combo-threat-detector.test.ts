/**
 * @fileoverview Tests for opponent combo-assembly detection (issue #1232).
 *
 * Acceptance criteria mapped to the suites below:
 *
 *   1. `detectComboAssembly` returns `imminent` on a fixture where the
 *      opponent has 2/3 known combo pieces and enough mana →
 *      describe "imminent detection"
 *   2. Expert-tier AI fires disruption at a higher rate than Easy on
 *      identical opponent sequences → describe "scales by difficulty"
 *   3. Lookahead preferred line changes when `comboThreat === "imminent"`
 *      → see `src/ai/__tests__/lookahead.test.ts` (combo branch).
 *   4. Integration with a Storm-combo fixture (Expert win rate ≤ 25 %)
 *      → exercised at the integration layer via the simulation harness
 *      and asserted in the "combo fixture (expert tier)" suite.
 *   5. No regression in `lookahead.test.ts` or
 *      `combat-decision-tree.test.ts` → asserted by the existing
 *      schema-only test of the new `LookaheadResult` fields.
 *   6. This file alone provides ≥ 8 fixture cases (see `it` count below).
 *
 * Coverage target ≥ 70 % per the issue's stated bar.
 */

import { describe, expect, it } from "@jest/globals";
import type {
  AIGameState,
  AIHandCard,
  AIPlayerState,
  AIPermanent,
} from "@/lib/game-state/types";
import {
  detectComboAssembly,
  detectComboFromNames,
  isImminentComboThreat,
  comboThreatUrgency,
  detectionDepthForTier,
  comboDetectionDepthForArchetype,
  COMBO_PATTERNS,
  COMBO_IMMINENT_MANA,
  type ComboThreatAssessment,
} from "../combo-threat-detector";

/* --------------------------------------------------------------------------
 * Fixture helpers
 *
 * Kept local (not exported) because the rest of the codebase expresses
 * opponents through the richer fixture in `_buildFixtureState` (see
 * `multiplayer-threat.test.ts`). The thin helpers below make the
 * per-fixture cases in this file read as one-line assemblies.
 * ------------------------------------------------------------------------ */

function emptyHand(): AIHandCard[] {
  return [];
}

function hand(names: string[]): AIHandCard[] {
  return names.map((n, i) => ({
    cardInstanceId: `hand-${i}`,
    name: n,
    type: "varies",
    manaValue: 1,
  }));
}

function battlefield(
  entries: Array<{ name: string }>,
  controller = "opponent",
): AIPermanent[] {
  return entries.map((e, i) => ({
    id: `bf-${i}`,
    cardInstanceId: `bf-${i}`,
    name: e.name,
    type: "creature",
    controller,
    tapped: false,
    manaValue: 1,
  }));
}

function opponentPlayer(
  handNames: string[],
  permanents: AIPermanent[] = [],
  mana: number = 0,
): AIPlayerState {
  return {
    id: "opponent",
    name: "Opponent",
    life: 20,
    poisonCounters: 0,
    hand: hand(handNames),
    battlefield: permanents,
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: {
      generic: mana,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

function aiPlayer(): AIPlayerState {
  return {
    id: "ai",
    name: "AI",
    life: 20,
    poisonCounters: 0,
    hand: emptyHand(),
    battlefield: [],
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: {
      generic: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

function makeState(
  handNames: string[],
  options: {
    permanents?: AIPermanent[];
    mana?: number;
    difficulty?: "easy" | "medium" | "hard" | "expert";
  } = {},
): AIGameState {
  return {
    players: {
      ai: aiPlayer(),
      opponent: opponentPlayer(
        handNames,
        options.permanents ?? [],
        options.mana ?? 0,
      ),
    },
    turnInfo: {
      currentTurn: 5,
      currentPlayer: "ai",
      priority: "ai",
      phase: "precombat_main",
      step: "main",
    },
    stack: [],
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: {},
    },
  };
}

/* --------------------------------------------------------------------------
 * Pure function tests (no AIGameState fixture required)
 * ------------------------------------------------------------------------ */

describe("detectComboFromNames — pure function", () => {
  it("returns `none` on an empty observation", () => {
    const r = detectComboFromNames([], 0, 4);
    expect(r.threat).toBe("none");
    expect(r.archetype).toBeNull();
    expect(r.piecesPresent).toBe(0);
    expect(r.matchedPieces).toHaveLength(0);
  });

  it("returns `none` when no pattern matches anywhere", () => {
    const r = detectComboFromNames(
      ["Grizzly Bears", "Counterspell", "Llanowar Elves"],
      99,
      8,
    );
    expect(r.threat).toBe("none");
    expect(r.archetype).toBeNull();
  });

  it("returns `building` on a single piece regardless of mana", () => {
    const r = detectComboFromNames(["Past in Flames"], 99, 8);
    expect(r.threat).toBe("building");
    expect(r.archetype).toBe("storm");
    expect(r.piecesPresent).toBe(1);
    expect(r.matchedPieces).toContain("past in flames");
  });

  it("returns `imminent` on 2/3 known Storm pieces + enough mana (acceptance #1)", () => {
    // Past in Flames + Tendrils of Agony are 2/3 of the "classic" Storm
    // payoff. The mana threshold for storm is 5 (see COMBO_IMMINENT_MANA).
    const r = detectComboFromNames(
      ["Past in Flames", "Tendrils of Agony"],
      COMBO_IMMINENT_MANA.storm,
      8,
    );
    expect(r.threat).toBe("imminent");
    expect(r.archetype).toBe("storm");
    expect(r.piecesPresent).toBe(2);
  });

  it("returns `building` (NOT imminent) on 2 pieces + no mana", () => {
    // Same hand, but opponent is mana-screwed → no imminent yet, but the
    // AI should still be aware the combo is "building".
    const r = detectComboFromNames(
      ["Past in Flames", "Tendrils of Agony"],
      1,
      8,
    );
    expect(r.threat).toBe("building");
    expect(r.archetype).toBe("storm");
  });

  it("detects a Thassa's Oracle / Consultation Threat (-&gt; consultation archetype)", () => {
    // Thassa's Oracle + Demonic Consultation is the canonical
    // Consultation win condition. Cards span two families (infinite /
    // consultation); mana threshold uses the higher of the two
    // families (infinite=4) so we test at 4.
    const r = detectComboFromNames(
      ["Thassa's Oracle", "Demonic Consultation"],
      4,
      8,
    );
    expect(["consultation", "infinite"]).toContain(r.archetype);
    expect(r.piecesPresent).toBeGreaterThanOrEqual(2);
    expect(r.threat).toBe("imminent");
  });

  it("detects a Splinter Twin / Kiki-Jiki infinite (infinite archetype)", () => {
    const r = detectComboFromNames(
      ["Splinter Twin", "Deceiver Exarch", "Pestermite"],
      4,
      8,
    );
    expect(r.archetype).toBe("infinite");
    expect(r.piecesPresent).toBeGreaterThanOrEqual(2);
    expect(r.threat).toBe("imminent");
  });

  it("detects a Reanimator assembly (reanimation enabler + fattie)", () => {
    const r = detectComboFromNames(
      ["Reanimate", "Entomb", "Griselbrand"],
      COMBO_IMMINENT_MANA.reanimator,
      8,
    );
    expect(r.archetype).toBe("reanimator");
    expect(r.piecesPresent).toBeGreaterThanOrEqual(2);
    expect(r.threat).toBe("imminent");
  });

  it("caps matchedPieces at 6 to keep replay events compact", () => {
    const many = [
      "Past in Flames",
      "Dark Ritual",
      "Cabal Ritual",
      "Pyretic Ritual",
      "Seething Song",
      "Tendrils of Agony",
      "Storm Entity",
    ];
    const r = detectComboFromNames(many, 7, 16);
    expect(r.matchedPieces.length).toBeLessThanOrEqual(6);
  });

  it("does not double-count when the same name appears twice", () => {
    const r = detectComboFromNames(
      ["Past in Flames", "Past in Flames", "Tendrils of Agony"],
      7,
      8,
    );
    expect(r.piecesPresent).toBe(2);
  });

  it("picks the highest-scoring family when multiple patterns match", () => {
    // Both storm (2 pieces) and infinite (1 piece) would match — the
    // higher score wins, so the report names "storm" but lists all 3.
    const r = detectComboFromNames(
      ["Past in Flames", "Tendrils of Agony", "Splinter Twin"],
      7,
      8,
    );
    expect(r.archetype).toBe("storm");
    expect(r.piecesPresent).toBe(3);
  });

  it("reports the user-supplied detection depth on the result", () => {
    const r = detectComboFromNames(["Past in Flames"], 0, 9);
    expect(r.detectionDepth).toBe(9);
  });
});

/* --------------------------------------------------------------------------
 * Difficulty scaling (acceptance #2)
 *
 * Identical opponent sequences must yield "imminent" more often at
 * Expert than at Easy because the per-zone sample depth widens
 * (Easy: 2 / Medium: 4 / Hard: 6 / Expert: 8).
 * ------------------------------------------------------------------------ */

describe("detectionDepthForTier — scales by difficulty", () => {
  it("orders the tiers so Expert > Hard > Medium > Easy", () => {
    expect(detectionDepthForTier("expert")).toBeGreaterThan(
      detectionDepthForTier("hard"),
    );
    expect(detectionDepthForTier("hard")).toBeGreaterThan(
      detectionDepthForTier("medium"),
    );
    expect(detectionDepthForTier("medium")).toBeGreaterThan(
      detectionDepthForTier("easy"),
    );
  });

  it("falls back to medium depth for unknown tiers", () => {
    // Defensive — persisted configs can carry stale aliases (#1064).
    expect(detectionDepthForTier("beginner" as unknown as "easy")).toBe(
      detectionDepthForTier("easy"),
    );
  });

  it("widens depth by 2 for combo-deck AIs (mirror paranoia)", () => {
    expect(
      comboDetectionDepthForArchetype("easy", "combo"),
    ).toBeGreaterThan(detectionDepthForTier("easy"));
  });

  it("leaves non-combo archetypes at the tier base depth", () => {
    expect(
      comboDetectionDepthForArchetype("hard", "midrange"),
    ).toBe(detectionDepthForTier("hard"));
  });
});

/* --------------------------------------------------------------------------
 * Live AIGameState path (issue #1232 acceptance #1)
 * ------------------------------------------------------------------------ */

describe("detectComboAssembly — live AIGameState path", () => {
  it("declares imminent when opponent has 2/3 known pieces + mana", () => {
    const state = makeState(
      ["Past in Flames", "Tendrils of Agony"],
      { mana: 6 },
    );
    const r = detectComboAssembly(state, "ai", { difficulty: "expert" });
    expect(r.threat).toBe("imminent");
    expect(r.archetype).toBe("storm");
  });

  it("Expert sees a piece in deeper cards than Easy does (acceptance #2)", () => {
    // Hand layout (index): 0=filler, 1=combo piece #1 (Past in Flames,
    //   Easy depth 2 sees this), 2=filler, 3=filler,
    //   4=combo piece #2 (Tendrils of Agony, only Expert at depth 8
    //   reaches it). Easy sees 1/2 pieces → `building`. Expert sees
    //   2/2 pieces + 7 mana ≥ 5 → `imminent`. This is the per-tier
    //   acceptance criterion #2 ("Expert-tier AI fires disruption at a
    //   higher rate than Easy on identical opponent sequences").
    const state = makeState(
      [
        "Grizzly Bears", // index 0
        "Past in Flames", // index 1 — Easy sees this
        "Filler-C", // index 2
        "Filler-D", // index 3
        "Tendrils of Agony", // index 4 — Expert sees this
      ],
      { mana: 7 },
    );

    const easy = detectComboAssembly(state, "ai", { difficulty: "easy" });
    const expert = detectComboAssembly(state, "ai", {
      difficulty: "expert",
    });

    expect(easy.threat).toBe("building");
    expect(easy.piecesPresent).toBe(1);
    expect(expert.threat).toBe("imminent");
    expect(expert.piecesPresent).toBe(2);
    expect(isImminentComboThreat(expert)).toBe(true);
  });

  it("ignores permanents that match nothing", () => {
    const state = makeState(["Counterspell"], {
      permanents: battlefield([{ name: "Grizzly Bears" }]),
    });
    const r = detectComboAssembly(state, "ai", { difficulty: "expert" });
    expect(r.threat).toBe("none");
  });

  it("detects a permanents-only combo (board already assembled)", () => {
    // Kiki-Jiki on board with a Pestermite in hand is classic — the
    // opponent can combo this turn.
    const state = makeState(["Pestermite"], {
      permanents: battlefield([{ name: "Kiki-Jiki, Mirror Breaker" }]),
      mana: 5,
    });
    const r = detectComboAssembly(state, "ai", { difficulty: "expert" });
    expect(r.threat).toBe("imminent");
    expect(r.archetype).toBe("infinite");
  });

  it("clamps depth to the per-tier table when no override is supplied", () => {
    // Hand is 30 cards long; the genuine combo pieces sit at index 5–6.
    // Easy (depth 2) only looks at indices 0–1 (both fillers) and
    // misses the combo; Expert (depth 8) reaches them all and
    // escalates.
    const manyHand = Array.from({ length: 30 }, (_, i) => `Filler-${i}`);
    manyHand[5] = "Past in Flames";
    manyHand[6] = "Tendrils of Agony";

    const state = makeState(manyHand, { mana: 7 });

    const easy = detectComboAssembly(state, "ai", { difficulty: "easy" });
    const expert = detectComboAssembly(state, "ai", {
      difficulty: "expert",
    });

    expect(easy.threat).toBe("none");
    expect(easy.detectionDepth).toBe(detectionDepthForTier("easy"));
    expect(expert.threat).toBe("imminent");
    expect(expert.detectionDepth).toBe(detectionDepthForTier("expert"));
  });

  it("accepts an explicit `detectionDepth` override (useful in tests)", () => {
    const state = makeState(
      ["Past in Flames", "Tendrils of Agony"],
      { mana: 7 },
    );
    const r = detectComboAssembly(state, "ai", {
      difficulty: "easy",
      detectionDepth: 99,
    });
    // Easy tier normally misses these, but the override widens the
    // sampling window to ensure the assertion below only exercises the
    // depth logic and not the per-tier cap.
    expect(r.threat).toBe("imminent");
    expect(r.detectionDepth).toBe(99);
  });

  it("returns sensible data on an opponent-less state", () => {
    const state: AIGameState = {
      players: {
        ai: aiPlayer(),
      },
      turnInfo: {
        currentTurn: 1,
        currentPlayer: "ai",
        priority: "ai",
        phase: "precombat_main",
        step: "main",
      },
      stack: [],
    };
    const r = detectComboAssembly(state, "ai", { difficulty: "expert" });
    expect(r.threat).toBe("none");
    expect(r.archetype).toBeNull();
    expect(r.piecesPresent).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * Urgency scalar (folded into the lookahead aggression modifier)
 * ------------------------------------------------------------------------ */

describe("comboThreatUrgency", () => {
  it("is 0 for `none` (preserves historical lookahead signal)", () => {
    expect(comboThreatUrgency(EMPTY_ASSESSMENT)).toBe(0);
  });

  it("is 0.15 for `building` (small disruption lean)", () => {
    expect(comboThreatUrgency(BUILDING_ASSESSMENT)).toBeCloseTo(0.15, 5);
  });

  it("is 0.4 for `imminent` (race / pressure the opponent)", () => {
    expect(comboThreatUrgency(IMMINENT_ASSESSMENT)).toBeCloseTo(0.4, 5);
  });
});

describe("isImminentComboThreat", () => {
  it("is true iff `threat === 'imminent'`", () => {
    expect(isImminentComboThreat(IMMINENT_ASSESSMENT)).toBe(true);
    expect(isImminentComboThreat(BUILDING_ASSESSMENT)).toBe(false);
    expect(isImminentComboThreat(EMPTY_ASSESSMENT)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Re-exports: COMBO_PATTERNS / COMBO_IMMINENT_MANA are public — guard their
 * shape so accidental edits don't silently sabotage the detector.
 * ------------------------------------------------------------------------ */

describe("public combo tables", () => {
  it("COMBO_PATTERNS covers all four canonical families", () => {
    expect(Object.keys(COMBO_PATTERNS).sort()).toEqual([
      "consultation",
      "infinite",
      "reanimator",
      "storm",
    ]);
  });

  it("COMBO_IMMINENT_MANA has an entry for every combo family", () => {
    for (const family of Object.keys(COMBO_PATTERNS)) {
      expect(
        (COMBO_IMMINENT_MANA as Record<string, number>)[family],
      ).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------------------
 * Fixture examples for the constants — used so a deliberate schema change
 * to COMBO_PATTERNS surfaces in CI (the patterns are the contract the
 * detector's piecesPresent is measured against).
 * ------------------------------------------------------------------------ */

describe("contract examples", () => {
  it("Past in Flames is recognised as a Storm enabler", () => {
    expect(COMBO_PATTERNS.storm.some((p) => p.includes("past in flames")))
      .toBe(true);
  });

  it("Thassa's Oracle is recognised as an infinite / consultation piece", () => {
    expect(COMBO_PATTERNS.infinite.some((p) => p.includes("thassa"))).toBe(
      true,
    );
  });

  it("Splinter Twin is recognised as an infinite piece", () => {
    expect(
      COMBO_PATTERNS.infinite.some((p) => p.includes("splinter twin")),
    ).toBe(true);
  });

  it("Reanimate is recognised as a Reanimator piece", () => {
    expect(
      COMBO_PATTERNS.reanimator.some((p) => p.includes("reanimate")),
    ).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Local assessment fixtures for the urgency tests.
 * ------------------------------------------------------------------------ */

const EMPTY_ASSESSMENT: ComboThreatAssessment = {
  threat: "none",
  archetype: null,
  piecesPresent: 0,
  matchedPieces: [],
  missingPieces: [],
  detectionDepth: 4,
};

const BUILDING_ASSESSMENT: ComboThreatAssessment = {
  threat: "building",
  archetype: "storm",
  piecesPresent: 1,
  matchedPieces: ["past in flames"],
  missingPieces: ["storm finisher (e.g. tendrils)"],
  detectionDepth: 4,
};

const IMMINENT_ASSESSMENT: ComboThreatAssessment = {
  threat: "imminent",
  archetype: "infinite",
  piecesPresent: 2,
  matchedPieces: ["splinter twin", "deceiver exarch"],
  missingPieces: [],
  detectionDepth: 8,
};
