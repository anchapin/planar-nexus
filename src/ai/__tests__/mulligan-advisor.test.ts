/**
 * @fileOverview Tests for mulligan advisor
 */

import { describe, it, expect } from "@jest/globals";
import {
  analyzeMulligan,
  decideOpponentMulligan,
  DIFFICULTY_MULLIGAN_SCALING,
  getDifficultyMulliganScaling,
  resolveMulliganScaling,
  getMatchingExpertRecords,
  KEEP_SHIP_DATABASE,
  type MulliganInput,
  type OpponentMulliganInput,
  type Card,
} from "../mulligan-advisor";
import {
  DIFFICULTY_LEVELS,
  type DifficultyLevel,
  type DifficultyFormat,
} from "../ai-difficulty";

function makeCard(overrides: Partial<Card> & { name: string }): Card {
  return {
    name: overrides.name,
    type_line: overrides.type_line || "Creature",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost,
    power: overrides.power,
    toughness: overrides.toughness,
  };
}

function land(name: string, color: string = ""): Card {
  return makeCard({
    name,
    type_line: "Basic Land",
    colors: color ? [color] : [],
  });
}

function creature(
  name: string,
  cmc: number,
  color: string = "",
  oracleText: string = "",
): Card {
  return makeCard({
    name,
    type_line: "Creature",
    cmc,
    colors: color ? [color] : [],
    oracle_text: oracleText,
  });
}

function spell(
  name: string,
  cmc: number,
  typeLine: string = "Instant",
  color: string = "",
  oracleText: string = "",
): Card {
  return makeCard({
    name,
    type_line: typeLine,
    cmc,
    colors: color ? [color] : [],
    oracle_text: oracleText,
  });
}

describe("mulligan-advisor", () => {
  describe("KEEP_SHIP_DATABASE", () => {
    it("should have at least 50 expert records", () => {
      expect(KEEP_SHIP_DATABASE.length).toBeGreaterThanOrEqual(50);
    });

    it("should cover land count rules", () => {
      const patterns = KEEP_SHIP_DATABASE.map((r) => r.handComposition);
      expect(patterns).toContain("0-land");
      expect(patterns.some((p) => p.includes("1-land"))).toBe(true);
      expect(patterns.some((p) => p.includes("2-land"))).toBe(true);
      expect(patterns.some((p) => p.includes("3-land"))).toBe(true);
      expect(patterns.some((p) => p.includes("5-land"))).toBe(true);
    });

    it("should cover archetype-specific rules", () => {
      const archetypes = KEEP_SHIP_DATABASE.map((r) => r.archetype);
      expect(archetypes).toContain("aggro");
      expect(archetypes).toContain("control");
      expect(archetypes).toContain("combo");
      expect(archetypes).toContain("tribal");
    });
  });

  describe("analyzeMulligan", () => {
    describe("no-lander", () => {
      it("should always ship a 0-land hand", () => {
        const hand: Card[] = [
          creature("Grizzly Bears", 2, "G"),
          creature(" Savannah Lions", 1, "W"),
          creature(" Hill Giant", 4, "R"),
          creature(" Serra Angel", 5, "W"),
          creature(" War Mammoth", 3, "G"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
          spell("Giant Growth", 1, "Instant", "G"),
        ];

        const result = analyzeMulligan({ hand, format: "limited" });
        expect(result.decision).toBe("ship");
        expect(result.analysis.landCount).toBe(0);
        expect(result.reasoning.some((r) => r.includes("No lands"))).toBe(true);
      });
    });

    describe("1-lander aggro", () => {
      it("should lean keep for a 1-land aggro hand on the play in constructed", () => {
        const hand: Card[] = [
          land("Mountain", "R"),
          creature("Goblin Guide", 1, "R"),
          creature("Monastery Swiftspear", 1, "R"),
          creature("Raging Goblin", 1, "R"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
          spell("Shock", 1, "Instant", "R", "deals 2 damage"),
          creature("Jackal Pup", 1, "R"),
        ];

        const result = analyzeMulligan({
          hand,
          archetype: "aggro",
          format: "constructed",
          onThePlay: true,
        });
        expect(result.decision).toBe("keep");
      });
    });

    describe("1-lander control", () => {
      it("should ship a 1-land control hand", () => {
        const hand: Card[] = [
          land("Island", "U"),
          spell("Cancel", 3, "Instant", "U", "counter target spell"),
          spell(
            "Essence Scatter",
            2,
            "Instant",
            "U",
            "counter target creature spell",
          ),
          spell("Divination", 3, "Sorcery", "U", "draw two cards"),
          creature("Air Elemental", 4, "U"),
          creature("Serra Angel", 5, "W"),
          spell("Concentrate", 4, "Sorcery", "U", "draw three cards"),
        ];

        const result = analyzeMulligan({
          hand,
          archetype: "control",
          format: "limited",
        });
        expect(result.decision).toBe("ship");
      });
    });

    describe("5-lander control", () => {
      it("should ship a 5-land hand with few spells", () => {
        const hand: Card[] = [
          land("Island", "U"),
          land("Island", "U"),
          land("Swamp", "B"),
          land("Plains", "W"),
          land("Mountain", "R"),
          spell("Cancel", 3, "Instant", "U", "counter target spell"),
          creature("Air Elemental", 4, "U"),
        ];

        const result = analyzeMulligan({
          hand,
          archetype: "control",
          format: "limited",
        });
        expect(result.decision).toBe("ship");
        expect(result.reasoning.some((r) => r.includes("flood"))).toBe(true);
      });
    });

    describe("3-land good curve", () => {
      it("should keep an ideal 3-land curve hand", () => {
        const hand: Card[] = [
          land("Forest", "G"),
          land("Plains", "W"),
          creature("Savannah Lions", 1, "W"),
          creature("Grizzly Bears", 2, "G"),
          creature("Glory Seeker", 2, "W"),
          spell("Giant Growth", 1, "Instant", "G"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
        ];

        const result = analyzeMulligan({ hand, format: "limited" });
        expect(result.handQualityScore).toBeGreaterThanOrEqual(40);
      });
    });

    describe("combo hand with pieces", () => {
      it("should have a good score for a combo hand with both pieces", () => {
        const hand: Card[] = [
          land("Island", "U"),
          land("Volcanic Island", ""),
          spell("Ponder", 1, "Sorcery", "U", "look at the top three cards"),
          spell("Preordain", 1, "Instant", "U", "scry 2"),
          spell("Splinter Twin", 4, "Enchantment", "R"),
          creature("Deceiver Exarch", 3, "U"),
          creature("Pestermite", 2, "U"),
        ];

        const result = analyzeMulligan({
          hand,
          archetype: "combo",
          format: "constructed",
        });
        expect(result.handQualityScore).toBeGreaterThan(50);
      });
    });

    describe("combo hand without pieces", () => {
      it("should ship a combo hand with no combo pieces", () => {
        const hand: Card[] = [
          land("Island", "U"),
          land("Island", "U"),
          land("Forest", "G"),
          land("Plains", "W"),
          creature("Grizzly Bears", 2, "G"),
          creature("Hill Giant", 4, "R"),
          spell("Cancel", 3, "Instant", "U", "counter target spell"),
          creature("Air Elemental", 4, "U"),
        ];

        const result = analyzeMulligan({
          hand,
          archetype: "combo",
          format: "constructed",
        });
        expect(result.decision).toBe("ship");
      });
    });

    describe("empty hand", () => {
      it("should ship an empty hand", () => {
        const result = analyzeMulligan({ hand: [] });
        expect(result.decision).toBe("ship");
        expect(result.confidence).toBe(1.0);
      });
    });

    describe("non-7-card hand", () => {
      it("should return ship for non-7-card hands", () => {
        const hand: Card[] = [
          land("Forest", "G"),
          land("Forest", "G"),
          creature("Grizzly Bears", 2, "G"),
        ];
        const result = analyzeMulligan({ hand });
        expect(result.decision).toBe("ship");
      });
    });

    describe("game number adjustments", () => {
      it("should be more conservative in game 3+", () => {
        const marginalHand: Card[] = [
          land("Forest", "G"),
          land("Forest", "G"),
          creature("Savannah Lions", 1, "W"),
          creature("Grizzly Bears", 2, "G"),
          creature("Hill Giant", 4, "R"),
          creature("Gray Ogre", 2, "R"),
          land("Mountain", "R"),
        ];

        const g1Result = analyzeMulligan({
          hand: marginalHand,
          format: "limited",
          gameNumber: 1,
        });
        const g3Result = analyzeMulligan({
          hand: marginalHand,
          format: "limited",
          gameNumber: 3,
        });

        expect(g3Result.handQualityScore).toBeGreaterThanOrEqual(
          g1Result.handQualityScore,
        );
      });
    });

    describe("hand analysis", () => {
      it("should correctly count lands, creatures, and spells", () => {
        const hand: Card[] = [
          land("Forest", "G"),
          land("Island", "U"),
          land("Plains", "W"),
          creature("Grizzly Bears", 2, "G"),
          creature("Savannah Lions", 1, "W"),
          creature("Air Elemental", 4, "U"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.landCount).toBe(3);
        expect(result.analysis.creatureCount).toBe(3);
        expect(result.analysis.spellCount).toBe(4);
      });

      it("should detect removal spells", () => {
        const hand: Card[] = [
          land("Mountain", "R"),
          land("Mountain", "R"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
          spell("Murder", 3, "Instant", "B", "destroy target creature"),
          spell("Shock", 1, "Instant", "R", "deals 2 damage"),
          creature("Raging Goblin", 1, "R"),
          creature("Jackal Pup", 1, "R"),
          creature("Goblin Guide", 1, "R"),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasRemoval).toBe(true);
        expect(result.analysis.removalCount).toBeGreaterThanOrEqual(2);
      });

      it("should detect card draw", () => {
        const hand: Card[] = [
          land("Island", "U"),
          land("Island", "U"),
          land("Island", "U"),
          spell("Divination", 3, "Sorcery", "U", "draw two cards"),
          spell("Ponder", 1, "Sorcery", "U", "look at the top three cards"),
          creature("Air Elemental", 4, "U"),
          creature("Serra Angel", 5, "W"),
          spell("Cancel", 3, "Instant", "U", "counter target spell"),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasCardDraw).toBe(true);
      });

      it("should detect ramp", () => {
        const hand: Card[] = [
          land("Forest", "G"),
          land("Forest", "G"),
          creature("Llanowar Elves", 1, "G", "tap: add G"),
          spell(
            "Cultivate",
            3,
            "Sorcery",
            "G",
            "search your library for a land",
          ),
          spell("Farseek", 2, "Sorcery", "G", "search your library for a land"),
          creature("Stampeding Rhino", 4, "G"),
          creature("Hill Giant", 4, "R"),
          spell("Giant Growth", 1, "Instant", "G"),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasRamp).toBe(true);
      });
    });

    describe("confidence scoring", () => {
      it("should have reasonable confidence for clear decisions", () => {
        const clearShip: Card[] = [
          land("Forest", "G"),
          creature("Grizzly Bears", 2, "G"),
          creature("Hill Giant", 4, "R"),
          creature("Air Elemental", 4, "U"),
          creature("Serra Angel", 5, "W"),
          creature("Craw Wurm", 6, "G"),
          creature("War Mammoth", 3, "G"),
        ];

        const clearKeep: Card[] = [
          land("Forest", "G"),
          land("Plains", "W"),
          land("Mountain", "R"),
          creature("Savannah Lions", 1, "W"),
          creature("Grizzly Bears", 2, "G"),
          spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
          creature("Raging Goblin", 1, "R"),
        ];

        const shipResult = analyzeMulligan({
          hand: clearShip,
          format: "limited",
        });
        const keepResult = analyzeMulligan({
          hand: clearKeep,
          format: "limited",
        });

        expect(shipResult.decision).toBe("ship");
        expect(keepResult.decision).toBe("keep");
      });
    });

    describe("color consistency", () => {
      it("should penalize 3+ color hands in limited", () => {
        const fiveColorHand: Card[] = [
          land("Forest", "G"),
          land("Island", "U"),
          land("Mountain", "R"),
          land("Swamp", "B"),
          land("Plains", "W"),
          creature("Grizzly Bears", 2, "G"),
          spell("Cancel", 3, "Instant", "U", "counter target spell"),
        ];

        const result = analyzeMulligan({
          hand: fiveColorHand,
          format: "limited",
        });
        expect(result.handQualityScore).toBeLessThan(50);
      });

      it("should be more lenient with colors in constructed", () => {
        const threeColorHand: Card[] = [
          land("Temple Garden", ""),
          land("Sacred Foundry", ""),
          land("Steam Vents", ""),
          creature("Savannah Lions", 1, "W"),
          creature("Grizzly Bears", 2, "G"),
          creature("Snapcaster Mage", 2, "U"),
          spell("Lightning Helix", 2, "Instant", "R", "deals 3 damage"),
        ];

        const result = analyzeMulligan({
          hand: threeColorHand,
          format: "constructed",
        });
        expect(result.handQualityScore).toBeGreaterThanOrEqual(35);
      });
    });

    describe("constructed vs limited thresholds", () => {
      it("should have lower threshold for constructed mulligans", () => {
        const twoLandHighCurve: Card[] = [
          land("Mountain", "R"),
          land("Swamp", "B"),
          creature("Glory Seeker", 2, "W"),
          spell("Terminate", 2, "Instant", "B", "destroy target creature"),
          spell("Damnation", 4, "Sorcery", "B", "destroy all creatures"),
          creature("Grave Titan", 6, "B"),
          spell("Sign in Blood", 2, "Sorcery", "B", "draw two cards"),
        ];

        const constructedResult = analyzeMulligan({
          hand: twoLandHighCurve,
          format: "constructed",
        });
        expect(constructedResult.handQualityScore).toBeGreaterThanOrEqual(30);
      });
    });
  });

  describe("getMatchingExpertRecords", () => {
    it("should return 0-land records for 0-land hands", () => {
      const hand: Card[] = [
        creature("Grizzly Bears", 2, "G"),
        creature("Savannah Lions", 1, "W"),
        creature("Hill Giant", 4, "R"),
        creature("Serra Angel", 5, "W"),
        creature("War Mammoth", 3, "G"),
        creature("Air Elemental", 4, "U"),
        spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
      ];

      const analysis = {
        landCount: 0,
        spellCount: 7,
        creatureCount: 6,
        removalCount: 0,
        cardDrawCount: 0,
        avgCmc: 2.86,
        colors: new Set<string>(),
        colorCount: 0,
        hasRamp: false,
        hasCardDraw: false,
        hasRemoval: false,
        hasLands: false,
      };

      const records = getMatchingExpertRecords(analysis);
      expect(records.length).toBeGreaterThan(0);
      expect(records[0].handComposition).toBe("0-land");
    });

    it("should filter by format", () => {
      const analysis = {
        landCount: 0,
        spellCount: 7,
        creatureCount: 6,
        removalCount: 0,
        cardDrawCount: 0,
        avgCmc: 2.86,
        colors: new Set<string>(),
        colorCount: 0,
        hasRamp: false,
        hasCardDraw: false,
        hasRemoval: false,
        hasLands: false,
      };

      const constructedRecords = getMatchingExpertRecords(
        analysis,
        undefined,
        "constructed",
      );
      const limitedRecords = getMatchingExpertRecords(
        analysis,
        undefined,
        "limited",
      );

      expect(constructedRecords.length).toBeGreaterThan(0);
      expect(limitedRecords.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #1063 — difficulty-scaled opponent mulligan decisions.
// ---------------------------------------------------------------------------

const TIERS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];
const FORMATS: DifficultyFormat[] = ["limited", "constructed", "commander"];

/** Deterministic seeded PRNG so per-tier blunder statistics are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A hand the expert engine clearly KEEPS (3 lands + smooth 1-2 curve). The
// existing `analyzeMulligan` confidence test asserts this exact hand is 'keep'.
function clearKeepHand(): Card[] {
  return [
    land("Forest", "G"),
    land("Plains", "W"),
    land("Mountain", "R"),
    creature("Savannah Lions", 1, "W"),
    creature("Grizzly Bears", 2, "G"),
    spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
    creature("Raging Goblin", 1, "R"),
  ];
}

// A hand the expert engine clearly SHIPS (zero lands — cannot cast anything).
function clearShipHand(): Card[] {
  return [
    creature("Grizzly Bears", 2, "G"),
    creature("Hill Giant", 4, "R"),
    creature("Air Elemental", 4, "U"),
    creature("Serra Angel", 5, "W"),
    creature("Craw Wurm", 6, "G"),
    creature("War Mammoth", 3, "G"),
    spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
  ];
}

describe("DIFFICULTY_MULLIGAN_SCALING (issue #1063)", () => {
  it("is keyed over the canonical 4-tier taxonomy", () => {
    for (const tier of TIERS) {
      expect(DIFFICULTY_MULLIGAN_SCALING[tier]).toBeDefined();
      expect(getDifficultyMulliganScaling(tier)).toBe(
        DIFFICULTY_MULLIGAN_SCALING[tier],
      );
    }
  });

  it("blunderChance is monotonic DECREASING in skill (easy worst, expert best)", () => {
    const chances = TIERS.map(
      (t) => DIFFICULTY_MULLIGAN_SCALING[t].blunderChance,
    );
    for (let i = 0; i < chances.length - 1; i++) {
      expect(chances[i]).toBeGreaterThan(chances[i + 1]);
    }
    // Bounded to [0, 1].
    for (const c of chances) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("resolveMulliganScaling (issue #1063, per-format composition)", () => {
  it("returns the base scaling when no format is supplied", () => {
    for (const tier of TIERS) {
      expect(resolveMulliganScaling(tier)).toEqual(
        DIFFICULTY_MULLIGAN_SCALING[tier],
      );
    }
  });

  it("preserves the tier ordering for every format family (no format inversion)", () => {
    for (const fmt of FORMATS) {
      const chances = TIERS.map(
        (t) => resolveMulliganScaling(t, fmt).blunderChance,
      );
      for (let i = 0; i < chances.length - 1; i++) {
        expect(chances[i]).toBeGreaterThanOrEqual(chances[i + 1]);
      }
    }
  });

  it("composes with the per-format blunderChance ratio (bounded, smooth)", () => {
    // The current FORMAT_DIFFICULTY_OVERRIDES do not change blunderChance, so
    // the resolved mulligan blunderChance equals the base. This asserts the
    // composition contract: it tracks the resolved difficulty blunderChance
    // ratio without drifting from the base when the ratio is 1.
    for (const tier of TIERS) {
      for (const fmt of FORMATS) {
        const resolved = resolveMulliganScaling(tier, fmt).blunderChance;
        const base = DIFFICULTY_MULLIGAN_SCALING[tier].blunderChance;
        expect(resolved).toBeGreaterThanOrEqual(0);
        expect(resolved).toBeLessThanOrEqual(1);
        // With no blunderChance overrides present, resolved === base.
        expect(resolved).toBeCloseTo(base, 10);
      }
    }
  });
});

describe("decideOpponentMulligan (issue #1063)", () => {
  it("expert follows the advisor: keeps a good hand, ships a bad hand", () => {
    const keep = decideOpponentMulligan({
      hand: clearKeepHand(),
      difficulty: "expert",
      format: "limited",
      rng: () => 0.99, // above expert's 0.02 blunderChance → no blunder
    });
    expect(keep.expertDecision).toBe("keep");
    expect(keep.decision).toBe("keep");
    expect(keep.blundered).toBe(false);

    const ship = decideOpponentMulligan({
      hand: clearShipHand(),
      difficulty: "expert",
      format: "limited",
      rng: () => 0.99,
    });
    expect(ship.expertDecision).toBe("ship");
    expect(ship.decision).toBe("ship");
    expect(ship.blundered).toBe(false);
  });

  it("the expert read is difficulty-agnostic (only the blunder scales)", () => {
    // On the identical hand every tier computes the SAME expert decision.
    const hand = clearKeepHand();
    const reads = TIERS.map(
      (t) =>
        decideOpponentMulligan({
          hand,
          difficulty: t,
          format: "limited",
          rng: () => 0.99,
        }).expertDecision,
    );
    expect(new Set(reads).size).toBe(1);
    expect(reads[0]).toBe("keep");
  });

  it("easy blunders (inverts the expert call) when the roll lands under blunderChance", () => {
    // roll 0 < easy's 0.45 → blunder inverts keep → ship on a good hand.
    const keepHandBlundered = decideOpponentMulligan({
      hand: clearKeepHand(),
      difficulty: "easy",
      format: "limited",
      rng: () => 0,
    });
    expect(keepHandBlundered.expertDecision).toBe("keep");
    expect(keepHandBlundered.decision).toBe("ship");
    expect(keepHandBlundered.blundered).toBe(true);

    // roll 0 → blunder inverts ship → keep on a bad hand.
    const shipHandBlundered = decideOpponentMulligan({
      hand: clearShipHand(),
      difficulty: "easy",
      format: "limited",
      rng: () => 0,
    });
    expect(shipHandBlundered.expertDecision).toBe("ship");
    expect(shipHandBlundered.decision).toBe("keep");
    expect(shipHandBlundered.blundered).toBe(true);
  });

  it("never blunders when the roll is above every tier blunderChance", () => {
    for (const tier of TIERS) {
      const d = decideOpponentMulligan({
        hand: clearShipHand(),
        difficulty: tier,
        format: "limited",
        rng: () => 0.99,
      });
      expect(d.blundered).toBe(false);
      expect(d.decision).toBe(d.expertDecision);
    }
  });

  it("a mid-range roll blunders easy/medium but not hard/expert", () => {
    // 0.10 < easy(0.45) and medium(0.18), but > hard(0.07) and expert(0.02).
    const expectBlunder: Record<DifficultyLevel, boolean> = {
      easy: true,
      medium: true,
      hard: false,
      expert: false,
    };
    for (const tier of TIERS) {
      const d = decideOpponentMulligan({
        hand: clearKeepHand(),
        difficulty: tier,
        format: "limited",
        rng: () => 0.1,
      });
      expect(d.blundered).toBe(expectBlunder[tier]);
    }
  });

  it("ships an empty hand without blundering", () => {
    const d = decideOpponentMulligan({
      hand: [],
      difficulty: "easy",
      format: "limited",
      rng: () => 0,
    });
    expect(d.decision).toBe("ship");
    expect(d.blundered).toBe(false);
  });

  // ---- Headline acceptance: per-difficulty decision quality + monotonicity ----

  it("on identical bad hands, Easy keeps (blunders) more often than Expert", () => {
    const N = 200;
    const hand = clearShipHand(); // expert ships; a blunder keeps the bad hand
    const keepCounts = TIERS.map((tier) => {
      const rng = mulberry32(20240626); // identical stream per tier
      let keeps = 0;
      for (let i = 0; i < N; i++) {
        if (
          decideOpponentMulligan({
            hand,
            difficulty: tier,
            format: "limited",
            rng,
          }).decision === "keep"
        ) {
          keeps++;
        }
      }
      return keeps;
    });

    // Easy keeps the bad hand far more often than Expert.
    expect(keepCounts[0]).toBeGreaterThan(keepCounts[3]);
    // Strong separation: Easy blunders ~45% (its blunderChance), Expert ~2%.
    expect(keepCounts[0]).toBeGreaterThan(N * 0.3);
    expect(keepCounts[3]).toBeLessThan(N * 0.1);
  });

  it("on identical good hands, Easy ships (blunders) more often than Expert", () => {
    const N = 200;
    const hand = clearKeepHand(); // expert keeps; a blunder ships the good hand
    const shipCounts = TIERS.map((tier) => {
      const rng = mulberry32(98765);
      let ships = 0;
      for (let i = 0; i < N; i++) {
        if (
          decideOpponentMulligan({
            hand,
            difficulty: tier,
            format: "limited",
            rng,
          }).decision === "ship"
        ) {
          ships++;
        }
      }
      return ships;
    });

    expect(shipCounts[0]).toBeGreaterThan(shipCounts[3]);
    // Strong separation: Easy blunders ~45%, Expert ~2%.
    expect(shipCounts[0]).toBeGreaterThan(N * 0.3);
    expect(shipCounts[3]).toBeLessThan(N * 0.1);
  });

  it("blunder rate is monotonic in skill over an identical rng stream", () => {
    const N = 300;
    const hand = clearShipHand();
    const blundersByTier = TIERS.map((tier) => {
      const rng = mulberry32(424242);
      let b = 0;
      for (let i = 0; i < N; i++) {
        if (
          decideOpponentMulligan({
            hand,
            difficulty: tier,
            format: "limited",
            rng,
          }).blundered
        ) {
          b++;
        }
      }
      return b;
    });

    // easy >= medium >= hard >= expert
    for (let i = 0; i < blundersByTier.length - 1; i++) {
      expect(blundersByTier[i]).toBeGreaterThanOrEqual(blundersByTier[i + 1]);
    }
    expect(blundersByTier[0]).toBeGreaterThan(blundersByTier[3]);
  });

  it("relaxes the keep bar for smaller post-mulligan hands (bounded)", () => {
    // A zero-land 6-card hand is still unkeepable — relief never rescues garbage.
    const zeroLandSix: Card[] = clearShipHand().slice(0, 6);
    const d = decideOpponentMulligan({
      hand: zeroLandSix,
      difficulty: "expert",
      format: "limited",
      rng: () => 0.99,
    });
    expect(d.expertDecision).toBe("ship");
    expect(d.decision).toBe("ship");

    // A reasonable 6-card hand (2 lands + a low curve) IS kept under the
    // relaxed 6-card bar (>= 33) where it would be far closer to the 7-card
    // bar (>= 40). The relaxation keeps post-mulligan hands playable.
    const playableSix: Card[] = [
      land("Plains", "W"),
      land("Mountain", "R"),
      creature("Savannah Lions", 1, "W"),
      creature("Grizzly Bears", 2, "G"),
      spell("Lightning Bolt", 1, "Instant", "R", "deals 3 damage"),
      creature("Raging Goblin", 1, "R"),
    ];
    const kept = decideOpponentMulligan({
      hand: playableSix,
      difficulty: "expert",
      format: "limited",
      rng: () => 0.99,
    });
    expect(kept.handQualityScore).toBeGreaterThanOrEqual(33);
    expect(kept.expertDecision).toBe("keep");
    expect(kept.decision).toBe("keep");
  });
});
