import {
  predictOpponentBlocks,
  integrateBlockPredictionIntoEV,
  getArchetypeWeights,
  type OpponentArchetype,
} from "../block-prediction";

function createCreature(
  overrides: Record<string, unknown> = {},
): import("@/lib/game-state/types").AIPermanent {
  return {
    id: `creature_${Math.random().toString(36).slice(2, 8)}`,
    cardInstanceId: `ci_${Math.random().toString(36).slice(2, 8)}`,
    name: "Test Creature",
    type: "creature" as const,
    controller: "opponent",
    tapped: false,
    power: 2,
    toughness: 2,
    manaValue: 2,
    keywords: [],
    summoningSickness: false,
    damage: 0,
    ...overrides,
  } as import("@/lib/game-state/types").AIPermanent;
}

describe("predictOpponentBlocks", () => {
  it("should predict no blocks when opponent has no creatures", () => {
    const attackers = [createCreature({ id: "a1", controller: "ai" })];
    const result = predictOpponentBlocks(attackers, [], 20, "unknown");

    expect(result.predictions).toHaveLength(1);
    expect(result.predictions[0].predictedBlockerIds).toEqual([]);
    expect(result.predictions[0].blockProbability).toBe(0);
  });

  it("should predict blocks for control archetype more aggressively", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 3,
      toughness: 3,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
      manaValue: 3,
    });

    const controlResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      20,
      "control",
    );
    const aggroResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      20,
      "aggro",
    );

    expect(
      controlResult.predictions[0].blockProbability,
    ).toBeGreaterThanOrEqual(aggroResult.predictions[0].blockProbability);
  });

  it("should predict aggro archetype blocks less than control", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 3,
      toughness: 3,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 2,
      toughness: 2,
      manaValue: 2,
    });

    const controlResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      20,
      "control",
    );
    const aggroResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      20,
      "aggro",
    );

    expect(aggroResult.predictions[0].blockProbability).toBeLessThan(
      controlResult.predictions[0].blockProbability,
    );
  });

  it("should predict chump blocks when opponent is at low life", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 6,
      toughness: 6,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 1,
      toughness: 1,
      manaValue: 2,
    });

    const lowLifeResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      2,
      "midrange",
    );
    const highLifeResult = predictOpponentBlocks(
      [attacker],
      [blocker],
      20,
      "midrange",
    );

    expect(lowLifeResult.predictions[0].blockProbability).toBeGreaterThan(
      highLifeResult.predictions[0].blockProbability,
    );
  });

  it("should handle flying evasion correctly", () => {
    const flyer = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
      keywords: ["flying"],
    });
    const groundBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
    });

    const result = predictOpponentBlocks(
      [flyer],
      [groundBlocker],
      20,
      "control",
    );

    expect(result.predictions[0].predictedBlockerIds).toEqual([]);
    expect(result.predictions[0].blockProbability).toBe(0);
  });

  it("should allow flying blocker to block flying attacker", () => {
    const flyer = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
      keywords: ["flying"],
    });
    const flyingBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
      keywords: ["flying"],
    });

    const result = predictOpponentBlocks(
      [flyer],
      [flyingBlocker],
      20,
      "control",
    );

    expect(result.predictions[0].blockProbability).toBeGreaterThan(0);
  });

  it("should require 2 blockers for menace", () => {
    const menaceAttacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 3,
      toughness: 3,
      keywords: ["menace"],
    });
    const blocker1 = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
    });
    const blocker2 = createCreature({
      id: "b2",
      controller: "opponent",
      power: 2,
      toughness: 2,
    });

    const singleBlocker = predictOpponentBlocks(
      [menaceAttacker],
      [blocker1],
      20,
      "control",
    );
    const twoBlockers = predictOpponentBlocks(
      [menaceAttacker],
      [blocker1, blocker2],
      20,
      "control",
    );

    expect(
      twoBlockers.predictions[0].predictedBlockerIds.length,
    ).toBeGreaterThanOrEqual(
      singleBlocker.predictions[0].predictedBlockerIds.length,
    );
  });

  it("should predict blocker that kills attacker as favorable trade for control", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
      manaValue: 4,
    });
    const bigBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 4,
      manaValue: 4,
    });

    const result = predictOpponentBlocks(
      [attacker],
      [bigBlocker],
      20,
      "control",
    );

    expect(result.predictions[0].blockProbability).toBeGreaterThan(0.5);
    expect(result.predictions[0].predictedBlockerIds).toContain("b1");
  });

  it("should score deathtouch blocker highly against big attacker", () => {
    const bigAttacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 8,
      toughness: 8,
    });
    const deathtouchBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 1,
      toughness: 1,
      keywords: ["deathtouch"],
    });

    const result = predictOpponentBlocks(
      [bigAttacker],
      [deathtouchBlocker],
      20,
      "control",
    );

    expect(result.predictions[0].blockProbability).toBeGreaterThan(0.5);
    expect(result.predictions[0].predictedBlockerIds).toContain("b1");
  });

  it("should return archetype weights for unknown archetype by default", () => {
    const result = predictOpponentBlocks([], [], 20);

    expect(result.archetypeWeights.willingnessToBlock).toBe(0.5);
    expect(result.archetypeWeights.tradeAcceptance).toBe(0.5);
  });

  it("should handle multiple attackers independently", () => {
    const attacker1 = createCreature({
      id: "a1",
      controller: "ai",
      power: 1,
      toughness: 1,
    });
    const attacker2 = createCreature({
      id: "a2",
      controller: "ai",
      power: 5,
      toughness: 5,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
    });

    const result = predictOpponentBlocks(
      [attacker1, attacker2],
      [blocker],
      20,
      "control",
    );

    expect(result.predictions).toHaveLength(2);
    expect(result.predictions[0].attackerId).toBe("a1");
    expect(result.predictions[1].attackerId).toBe("a2");
  });

  it("should not block with tapped creatures", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
    });
    const tappedBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 3,
      toughness: 3,
      tapped: true,
    });

    const result = predictOpponentBlocks(
      [attacker],
      [tappedBlocker],
      20,
      "control",
    );

    expect(result.predictions[0].predictedBlockerIds).toEqual([]);
    expect(result.predictions[0].blockProbability).toBe(0);
  });
});

describe("integrateBlockPredictionIntoEV", () => {
  it("should boost EV when no blockers predicted", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 3,
      toughness: 3,
    });
    const prediction = {
      attackerId: "a1",
      predictedBlockerIds: [],
      blockProbability: 0,
      predictionConfidence: 0.9,
    };

    const adjusted = integrateBlockPredictionIntoEV(
      0.5,
      prediction,
      attacker,
      [],
      10,
    );

    expect(adjusted).toBeGreaterThanOrEqual(0.5);
  });

  it("should reduce EV when attacker predicted to die", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
      manaValue: 4,
    });
    const killerBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 4,
      toughness: 4,
    });
    const prediction = {
      attackerId: "a1",
      predictedBlockerIds: ["b1"],
      blockProbability: 0.8,
      predictionConfidence: 0.85,
    };

    const adjusted = integrateBlockPredictionIntoEV(
      0.6,
      prediction,
      attacker,
      [killerBlocker],
      20,
    );

    expect(adjusted).toBeLessThan(0.6);
  });

  it("should boost EV when attacker kills blocker without dying", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 5,
      toughness: 5,
    });
    const weakBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 1,
      toughness: 1,
      manaValue: 3,
    });
    const prediction = {
      attackerId: "a1",
      predictedBlockerIds: ["b1"],
      blockProbability: 0.7,
      predictionConfidence: 0.8,
    };

    const adjusted = integrateBlockPredictionIntoEV(
      0.5,
      prediction,
      attacker,
      [weakBlocker],
      20,
    );

    expect(adjusted).toBeGreaterThan(0.5);
  });

  it("should handle trample excess damage in EV calculation", () => {
    const trampler = createCreature({
      id: "a1",
      controller: "ai",
      power: 8,
      toughness: 6,
      keywords: ["trample"],
    });
    const smallBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 2,
      toughness: 2,
    });
    const prediction = {
      attackerId: "a1",
      predictedBlockerIds: ["b1"],
      blockProbability: 0.6,
      predictionConfidence: 0.8,
    };

    const adjusted = integrateBlockPredictionIntoEV(
      0.5,
      prediction,
      trampler,
      [smallBlocker],
      20,
    );

    expect(adjusted).toBeGreaterThan(0.5);
  });

  it("should clamp result between 0 and 1", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 1,
      toughness: 1,
    });
    const bigBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 10,
      toughness: 10,
    });
    const prediction = {
      attackerId: "a1",
      predictedBlockerIds: ["b1"],
      blockProbability: 1.0,
      predictionConfidence: 1.0,
    };

    const adjusted = integrateBlockPredictionIntoEV(
      0.8,
      prediction,
      attacker,
      [bigBlocker],
      20,
    );

    expect(adjusted).toBeGreaterThanOrEqual(0);
    expect(adjusted).toBeLessThanOrEqual(1);
  });
});

describe("getArchetypeWeights", () => {
  const archetypes: OpponentArchetype[] = [
    "aggro",
    "control",
    "midrange",
    "tempo",
    "combo",
    "unknown",
  ];

  it.each(archetypes)(
    "should return valid weights for %s archetype",
    (archetype) => {
      const weights = getArchetypeWeights(archetype);

      expect(weights.willingnessToBlock).toBeGreaterThanOrEqual(0);
      expect(weights.willingnessToBlock).toBeLessThanOrEqual(1);
      expect(weights.chumpBlockThreshold).toBeGreaterThanOrEqual(0);
      expect(weights.chumpBlockThreshold).toBeLessThanOrEqual(1);
      expect(weights.tradeAcceptance).toBeGreaterThanOrEqual(0);
      expect(weights.tradeAcceptance).toBeLessThanOrEqual(1);
      expect(weights.multiBlockPreference).toBeGreaterThanOrEqual(0);
      expect(weights.multiBlockPreference).toBeLessThanOrEqual(1);
      expect(weights.valueProtectionWeight).toBeGreaterThanOrEqual(0);
      expect(weights.valueProtectionWeight).toBeLessThanOrEqual(1);
      expect(weights.raceAggressionPenalty).toBeGreaterThanOrEqual(0);
      expect(weights.raceAggressionPenalty).toBeLessThanOrEqual(1);
    },
  );

  it("control should have higher willingnessToBlock than aggro", () => {
    const control = getArchetypeWeights("control");
    const aggro = getArchetypeWeights("aggro");

    expect(control.willingnessToBlock).toBeGreaterThan(
      aggro.willingnessToBlock,
    );
  });

  it("aggro should have higher raceAggressionPenalty than control", () => {
    const control = getArchetypeWeights("control");
    const aggro = getArchetypeWeights("aggro");

    expect(aggro.raceAggressionPenalty).toBeGreaterThan(
      control.raceAggressionPenalty,
    );
  });
});

describe("expert scenario accuracy", () => {
  it("should predict control does not block when it would trade down in mana value at high life", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 2,
      toughness: 2,
      manaValue: 1,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 2,
      toughness: 2,
      manaValue: 5,
    });

    const result = predictOpponentBlocks([attacker], [blocker], 18, "control");

    expect(result.predictions[0].predictedBlockerIds).not.toContain("b1");
  });

  it("should predict midrange blocks a lethal attacker even with unfavorable trade", () => {
    const lethalAttacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 10,
      toughness: 10,
    });
    const chumpBlocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 1,
      toughness: 1,
      manaValue: 1,
    });

    const result = predictOpponentBlocks(
      [lethalAttacker],
      [chumpBlocker],
      7,
      "midrange",
    );

    expect(result.predictions[0].predictedBlockerIds).toContain("b1");
  });

  it("should predict aggro races past rather than blocks at 20 life", () => {
    const attacker = createCreature({
      id: "a1",
      controller: "ai",
      power: 3,
      toughness: 3,
    });
    const blocker = createCreature({
      id: "b1",
      controller: "opponent",
      power: 2,
      toughness: 2,
      manaValue: 2,
    });

    const result = predictOpponentBlocks([attacker], [blocker], 20, "aggro");

    expect(result.predictions[0].blockProbability).toBeLessThan(0.4);
  });
});
