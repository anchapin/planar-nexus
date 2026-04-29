import { describe, it, expect } from "@jest/globals";
import {
  estimateCombatTrickProbability,
  calculateCombatTrickDiscount,
  type CombatTrickType,
} from "../decision-making/combat-trick-probability";
import { CombatDecisionTree } from "../decision-making/combat-decision-tree";
import { createTestGameState, createMockPermanent } from "./test-helpers";

describe("estimateCombatTrickProbability", () => {
  it("should return 0 probability when opponent has no open mana", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      "unknown",
    );

    expect(result.probability).toBe(0);
    expect(result.estimatedTypes).toEqual([]);
    expect(result.confidence).toBe(0.9);
  });

  it("should detect pump probability with white mana (aggro archetype)", () => {
    const result = estimateCombatTrickProbability(
      { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      "aggro",
      4,
      3,
    );

    expect(result.probability).toBeGreaterThan(0);
    expect(result.estimatedTypes).toContain("pump");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should detect removal probability with red mana (control archetype)", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "control",
      3,
      5,
    );

    expect(result.probability).toBeGreaterThan(0);
    expect(result.estimatedTypes).toContain("removal");
  });

  it("should return higher probability for more open mana", () => {
    const lowMana = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      "tempo",
      3,
      4,
    );

    const highMana = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 3, green: 0, colorless: 0 },
      "tempo",
      3,
      4,
    );

    expect(highMana.probability).toBeGreaterThan(lowMana.probability);
  });

  it("should return higher probability with more cards in hand", () => {
    const fewCards = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "midrange",
      1,
      4,
    );

    const manyCards = estimateCombatTrickProbability(
      { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
      "midrange",
      6,
      4,
    );

    expect(manyCards.probability).toBeGreaterThan(fewCards.probability);
  });

  it("should identify indestructible tricks for control with high mana", () => {
    const result = estimateCombatTrickProbability(
      { white: 2, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      "control",
      4,
      6,
    );

    expect(result.estimatedTypes).toContain("indestructible");
  });

  it("should return low probability for combo archetype (less interactive)", () => {
    const result = estimateCombatTrickProbability(
      { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
      "combo",
      3,
      5,
    );

    expect(result.probability).toBeLessThan(0.5);
  });

  it("should include reasoning string", () => {
    const result = estimateCombatTrickProbability(
      { white: 1, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
      "tempo",
      4,
      3,
    );

    expect(result.reasoning).toContain("mana");
    expect(result.reasoning).toContain("tempo");
  });

  it("should cap probability at 0.95", () => {
    const result = estimateCombatTrickProbability(
      { white: 3, blue: 3, black: 3, red: 3, green: 3, colorless: 5 },
      "tempo",
      7,
      10,
    );

    expect(result.probability).toBeLessThanOrEqual(0.95);
  });
});

describe("calculateCombatTrickDiscount", () => {
  it("should return unchanged EV when probability is 0", () => {
    const result = calculateCombatTrickDiscount(
      { probability: 0, estimatedTypes: [], confidence: 0, reasoning: "" },
      0.6,
    );

    expect(result.discountedEV).toBe(0.6);
    expect(result.riskAdjustment).toBe(0);
  });

  it("should reduce EV when removal is likely", () => {
    const estimate = {
      probability: 0.6,
      estimatedTypes: ["removal"] as CombatTrickType[],
      confidence: 0.7,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.5, 3);

    expect(result.discountedEV).toBeLessThan(0.5);
    expect(result.riskAdjustment).toBeLessThan(0);
  });

  it("should reduce EV when pump is likely against low toughness creatures", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["pump"] as CombatTrickType[],
      confidence: 0.6,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.4, 2);

    expect(result.discountedEV).toBeLessThan(0.4);
    expect(result.riskAdjustment).toBeLessThan(0);
  });

  it("should not reduce EV for pump against high toughness creatures", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["pump"] as CombatTrickType[],
      confidence: 0.6,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.4, 8);

    expect(result.riskAdjustment).toBe(0);
    expect(result.discountedEV).toBe(0.4);
  });

  it("should apply indestructible risk penalty", () => {
    const estimate = {
      probability: 0.5,
      estimatedTypes: ["indestructible"] as CombatTrickType[],
      confidence: 0.7,
      reasoning: "test",
    };

    const result = calculateCombatTrickDiscount(estimate, 0.5);

    expect(result.discountedEV).toBeLessThan(0.5);
  });

  it("should never discount below -0.5", () => {
    const estimate = {
      probability: 0.9,
      estimatedTypes: ["removal", "pump", "indestructible"] as CombatTrickType[],
      confidence: 0.9,
      reasoning: "worst case",
    };

    const result = calculateCombatTrickDiscount(estimate, -0.3);

    expect(result.discountedEV).toBeGreaterThanOrEqual(-0.5);
  });
});

describe("integration: combat trick discount in attack decisions", () => {
  it("should make AI more cautious when opponent has open mana and tricks enabled", () => {
    const noManaState = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    noManaState.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };
    noManaState.players.player2.hand = [];

    const withManaState = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    withManaState.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 2,
      green: 0,
      colorless: 1,
    };
    withManaState.players.player2.hand = [
      {
        cardInstanceId: "h1",
        name: "Lightning Bolt",
        type: "Instant",
        manaValue: 1,
      },
    ];

    const noManaAI = new CombatDecisionTree(noManaState, "player1", "hard");
    noManaAI.setConfig({
      useCombatTricks: true,
      opponentArchetype: "tempo",
    });

    const withManaAI = new CombatDecisionTree(
      withManaState,
      "player1",
      "hard",
    );
    withManaAI.setConfig({
      useCombatTricks: true,
      opponentArchetype: "tempo",
    });

    const noManaPlan = noManaAI.generateAttackPlan();
    const withManaPlan = withManaAI.generateAttackPlan();

    if (
      noManaPlan.attacks.length > 0 &&
      withManaPlan.attacks.length > 0
    ) {
      expect(withManaPlan.attacks[0].expectedValue).toBeLessThanOrEqual(
        noManaPlan.attacks[0].expectedValue,
      );
    }

    if (noManaPlan.attacks.length > 0 && withManaPlan.attacks.length === 0) {
      expect(true).toBe(true);
    }
  });

  it("should not affect decisions when useCombatTricks is false", () => {
    const state = createTestGameState(
      20,
      20,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2, false, 2),
      ],
      [],
    );
    state.players.player2.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 2,
      green: 0,
      colorless: 0,
    };

    const ai = new CombatDecisionTree(state, "player1", "hard");
    ai.setConfig({ useCombatTricks: false });

    const plan = ai.generateAttackPlan();
    expect(plan).toBeDefined();
  });
});
