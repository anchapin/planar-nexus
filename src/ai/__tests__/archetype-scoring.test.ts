import { describe, it, expect } from "@jest/globals";
import {
  GameStateEvaluator,
  evaluateGameState,
  compareHoldVsPlay,
  ArchetypeWeights,
  type ProposedPlay,
  type DeckArchetype,
} from "../game-state-evaluator";
import type {
  AIGameState,
  AIPlayerState,
  AIPermanent,
  AIHandCard,
} from "@/lib/game-state/types";

function createMockPlayerState(
  id: string,
  life: number = 20,
  hand: AIHandCard[] = [],
  battlefield: AIPermanent[] = [],
  graveyard: string[] = [],
  exile: string[] = [],
  library: number = 40,
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand,
    battlefield,
    graveyard,
    exile,
    library,
    manaPool: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

function createMockPermanent(
  id: string,
  name: string,
  type:
    | "creature"
    | "land"
    | "artifact"
    | "enchantment"
    | "planeswalker" = "creature",
  power?: number,
  toughness?: number,
  tapped: boolean = false,
  manaValue: number = 1,
  keywords: string[] = [],
): AIPermanent {
  return {
    cardInstanceId: id,
    id,
    name,
    type,
    controller: "player1",
    tapped,
    manaValue,
    power,
    toughness,
    keywords,
  };
}

function createMockHandCard(
  name: string,
  manaValue: number,
  type: string = "Creature",
): AIHandCard {
  return {
    cardInstanceId: `hand-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    manaValue,
    type,
    colors: [],
  };
}

function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Hand: AIHandCard[] = [],
  player2Hand: AIHandCard[] = [],
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = [],
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState(
        "player1",
        player1Life,
        player1Hand,
        player1Battlefield,
      ),
      player2: createMockPlayerState(
        "player2",
        player2Life,
        player2Hand,
        player2Battlefield,
      ),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer: "player1",
      priority: "player1",
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

describe("per-archetype scoring weights", () => {
  it("should export archetype weight vectors for all five archetypes", () => {
    const expected = ["aggro", "control", "combo", "midrange", "ramp"] as const;
    for (const arch of expected) {
      expect(ArchetypeWeights[arch]).toBeDefined();
      expect(ArchetypeWeights[arch].creaturePower).toBeGreaterThan(0);
    }
  });

  it("should accept archetype in constructor and modify weights", () => {
    const gameState = createTestGameState();
    const base = new GameStateEvaluator(gameState, "player1", "medium");
    const aggro = new GameStateEvaluator(
      gameState,
      "player1",
      "medium",
      "aggro",
    );
    const control = new GameStateEvaluator(
      gameState,
      "player1",
      "medium",
      "control",
    );

    expect(base.getArchetype()).toBe("unknown");
    expect(aggro.getArchetype()).toBe("aggro");
    expect(control.getArchetype()).toBe("control");
    expect(aggro.getWeights()).not.toEqual(base.getWeights());
    expect(control.getWeights()).not.toEqual(base.getWeights());
  });

  it("should make aggro evaluator prioritize board presence over card advantage", () => {
    const player1Hand = [
      createMockHandCard("Ragavan", 1, "Creature"),
      createMockHandCard("Lightning Bolt", 1, "Instant"),
    ];
    const player2Hand = [
      createMockHandCard("Counterspell", 2, "Instant"),
      createMockHandCard("Preordain", 1, "Instant"),
    ];

    const gameState = createTestGameState(20, 20, player1Hand, player2Hand);
    gameState.players.player1.battlefield = [
      createMockPermanent("c1", "Ragavan", "creature", 2, 1),
      createMockPermanent("c2", "Monastery Swiftspear", "creature", 2, 1),
    ];

    const aggroEvaluator = new GameStateEvaluator(
      gameState,
      "player1",
      "medium",
      "aggro",
    );
    const controlEvaluator = new GameStateEvaluator(
      gameState,
      "player1",
      "medium",
      "control",
    );

    const aggroWeights = aggroEvaluator.getWeights();
    const controlWeights = controlEvaluator.getWeights();

    expect(aggroWeights.creaturePower).toBeGreaterThan(
      controlWeights.creaturePower,
    );
    expect(aggroWeights.creatureCount).toBeGreaterThan(
      controlWeights.creatureCount,
    );
    expect(aggroWeights.tempoAdvantage).toBeGreaterThan(
      controlWeights.tempoAdvantage,
    );
    expect(controlWeights.cardAdvantage).toBeGreaterThan(
      aggroWeights.cardAdvantage,
    );
    expect(controlWeights.stackPressureScore).toBeGreaterThan(
      aggroWeights.stackPressureScore,
    );
  });

  it("should make combo evaluator prioritize hand quality and synergy", () => {
    const comboWeights = ArchetypeWeights.combo;
    const aggroWeights = ArchetypeWeights.aggro;

    expect(comboWeights.handQuality).toBeGreaterThan(aggroWeights.handQuality);
    expect(comboWeights.synergy).toBeGreaterThan(aggroWeights.synergy);
    expect(comboWeights.winConditionProgress).toBeGreaterThan(
      aggroWeights.winConditionProgress,
    );
    expect(comboWeights.creaturePower).toBeLessThan(aggroWeights.creaturePower);
  });

  it("should make control evaluator prioritize inevitability and card advantage", () => {
    const controlWeights = ArchetypeWeights.control;
    const rampWeights = ArchetypeWeights.ramp;

    expect(controlWeights.inevitability).toBeGreaterThan(
      rampWeights.inevitability,
    );
    expect(controlWeights.cardAdvantage).toBeGreaterThan(
      rampWeights.cardAdvantage,
    );
    expect(controlWeights.cardSelection).toBeGreaterThan(
      rampWeights.cardSelection,
    );
  });

  it("should make ramp evaluator prioritize mana available", () => {
    const rampWeights = ArchetypeWeights.ramp;
    const midrangeWeights = ArchetypeWeights.midrange;

    expect(rampWeights.manaAvailable).toBeGreaterThan(
      midrangeWeights.manaAvailable,
    );
  });

  it("should pass archetype through evaluateGameState", () => {
    const gameState = createTestGameState();
    const baseEval = evaluateGameState(gameState, "player1", "medium");
    const aggroEval = evaluateGameState(
      gameState,
      "player1",
      "medium",
      "aggro",
    );

    expect(baseEval.totalScore).not.toBe(aggroEval.totalScore);
  });

  it("should pass archetype through compareHoldVsPlay", () => {
    const hand_card = createMockHandCard("Grizzly Bears", 2, "Creature");
    const gameState = createTestGameState(20, 20, [hand_card], []);
    gameState.players.player1.manaPool = {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 2,
      colorless: 0,
      generic: 0,
    };

    const play: ProposedPlay = {
      card: hand_card,
      type: "cast_creature",
      manaCost: 2,
      producedPermanent: { type: "creature", power: 2, toughness: 2 },
    };

    const baseResult = compareHoldVsPlay(gameState, play, "player1");
    const aggroResult = compareHoldVsPlay(
      gameState,
      play,
      "player1",
      "medium",
      "aggro",
    );

    expect(aggroResult.playNowScore).not.toBe(baseResult.playNowScore);
  });

  it("should fall back to base weights for unknown archetype", () => {
    const gameState = createTestGameState();
    const base = new GameStateEvaluator(gameState, "player1", "medium");
    const unknown = new GameStateEvaluator(
      gameState,
      "player1",
      "medium",
      "unknown",
    );

    expect(base.getWeights()).toEqual(unknown.getWeights());
  });

  it("should not break backward compatibility when archetype is omitted", () => {
    const hand_card = createMockHandCard("Bear", 2, "Creature");
    const gameState = createTestGameState(20, 20, [hand_card], []);

    const evaluator = new GameStateEvaluator(gameState, "player1");
    const evaluation = evaluator.evaluate();

    expect(evaluation.totalScore).toBeDefined();
    expect(evaluation.factors).toBeDefined();
    expect(evaluator.getArchetype()).toBe("unknown");
  });
});
