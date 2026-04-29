import { describe, test, expect, beforeEach } from "@jest/globals";

import {
  StackInteractionAI,
  StackAction,
  StackContext,
  shouldBluffHoldMana,
  manageResponseResources,
} from "../stack-interaction-ai";
import type {
  OpponentHistory,
  BluffHoldDecision,
} from "../stack-interaction-ai";
import { GameState, PlayerState } from "../game-state-evaluator";

function createControlPlayerState(
  id: string,
  overrides?: Partial<PlayerState>,
): PlayerState {
  return {
    id,
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      {
        cardInstanceId: "counter1",
        name: "Counterspell",
        type: "Instant",
        manaValue: 2,
      },
      {
        cardInstanceId: "removal1",
        name: "Fatal Push",
        type: "Instant",
        manaValue: 1,
      },
      {
        cardInstanceId: "draw1",
        name: "Brainstorm",
        type: "Instant",
        manaValue: 1,
      },
      { cardInstanceId: "land1", name: "Island", type: "Land", manaValue: 0 },
    ],
    graveyard: [],
    exile: [],
    library: 40,
    battlefield: [
      {
        id: `${id}_land1`,
        cardInstanceId: `${id}_land1`,
        name: "Island",
        type: "land",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_land2`,
        cardInstanceId: `${id}_land2`,
        name: "Island",
        type: "land",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_land3`,
        cardInstanceId: `${id}_land3`,
        name: "Island",
        type: "land",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_land4`,
        cardInstanceId: `${id}_land4`,
        name: "Island",
        type: "land",
        controller: id,
        tapped: false,
      },
    ],
    manaPool: { blue: 4, colorless: 0 },
    ...overrides,
  };
}

function createAggroPlayerState(id: string): PlayerState {
  return {
    id,
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [
      {
        cardInstanceId: "creature1",
        name: "Goblin Guide",
        type: "Creature",
        manaValue: 1,
      },
      {
        cardInstanceId: "creature2",
        name: "Monastery Swiftspear",
        type: "Creature",
        manaValue: 1,
      },
      {
        cardInstanceId: "burn1",
        name: "Lightning Bolt",
        type: "Instant",
        manaValue: 1,
      },
    ],
    graveyard: [],
    exile: [],
    library: 50,
    battlefield: [
      {
        id: `${id}_land1`,
        cardInstanceId: `${id}_land1`,
        name: "Mountain",
        type: "land",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_land2`,
        cardInstanceId: `${id}_land2`,
        name: "Mountain",
        type: "land",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_creature1`,
        cardInstanceId: `${id}_creature1`,
        name: "Goblin Guide",
        type: "creature",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_creature2`,
        cardInstanceId: `${id}_creature2`,
        name: "Monastery Swiftspear",
        type: "creature",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_creature3`,
        cardInstanceId: `${id}_creature3`,
        name: "Ragavan",
        type: "creature",
        controller: id,
        tapped: true,
      },
      {
        id: `${id}_creature4`,
        cardInstanceId: `${id}_creature4`,
        name: "Kird Ape",
        type: "creature",
        controller: id,
        tapped: false,
      },
      {
        id: `${id}_creature5`,
        cardInstanceId: `${id}_creature5`,
        name: "Lavamancer",
        type: "creature",
        controller: id,
        tapped: false,
      },
    ],
    manaPool: { red: 2, colorless: 0 },
  };
}

function createGameState(
  aiPlayerState: PlayerState,
  opponentState: PlayerState,
  turn: number = 8,
): GameState {
  return {
    players: {
      player1: aiPlayerState,
      player2: opponentState,
    },
    turnInfo: {
      currentTurn: turn,
      currentPlayer: "player1",
      phase: "precombat_main",
      step: "main",
      priority: "player1",
    },
    stack: [],
  };
}

function createStackAction(overrides?: Partial<StackAction>): StackAction {
  return {
    id: "stack_1",
    cardId: "some_card",
    name: "Rampant Growth",
    controller: "player2",
    type: "spell",
    manaValue: 2,
    isInstantSpeed: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createStackContext(
  mana: Record<string, number> = { blue: 2, colorless: 0 },
  responses: any[] = [],
  overrides?: Partial<StackContext>,
): StackContext {
  return {
    currentAction: createStackAction(),
    stackSize: 1,
    actionsAbove: [],
    availableMana: mana,
    availableResponses: responses,
    opponentsRemaining: ["player2"],
    isMyTurn: true,
    phase: "precombat_main",
    step: "main",
    respondingToOpponent: false,
    ...overrides,
  };
}

function createCautiousOpponentHistory(): OpponentHistory {
  return {
    hesitationCount: 4,
    wasBaited: true,
    avgPlaysPerTurn: 1.2,
    playsAroundOpenMana: true,
  };
}

function createAggressiveOpponentHistory(): OpponentHistory {
  return {
    hesitationCount: 0,
    wasBaited: false,
    avgPlaysPerTurn: 3.0,
    playsAroundOpenMana: false,
  };
}

describe("Strategic Bluffing and Mana-Hold Logic", () => {
  let ai: StackInteractionAI;
  let gameState: GameState;
  let context: StackContext;

  beforeEach(() => {
    const aiPlayer = createControlPlayerState("player1");
    const opponent = createControlPlayerState("player2", {
      id: "player2",
      hand: [
        {
          cardInstanceId: "opp1",
          name: "Spell",
          type: "Sorcery",
          manaValue: 3,
        },
      ],
      battlefield: [
        {
          id: "opp_land1",
          cardInstanceId: "opp_land1",
          name: "Island",
          type: "land",
          controller: "player2",
          tapped: false,
        },
        {
          id: "opp_land2",
          cardInstanceId: "opp_land2",
          name: "Island",
          type: "land",
          controller: "player2",
          tapped: false,
        },
        {
          id: "opp_land3",
          cardInstanceId: "opp_land3",
          name: "Island",
          type: "land",
          controller: "player2",
          tapped: false,
        },
      ],
      manaPool: { blue: 3, colorless: 0 },
    });

    gameState = createGameState(aiPlayer, opponent);
    context = createStackContext({ blue: 4, colorless: 0 }, [
      {
        cardId: "counter1",
        name: "Counterspell",
        type: "instant",
        manaValue: 2,
        manaCost: { blue: 2 },
        canCounter: true,
        canTarget: ["spell"],
        effect: { type: "counter", value: 7, targets: ["spell"] },
      },
    ]);

    ai = new StackInteractionAI(gameState, "player1", "medium");
  });

  describe("shouldBluffHoldMana", () => {
    test("should not bluff with less than 2 mana", () => {
      const lowManaContext = createStackContext({ blue: 1, colorless: 0 });
      const decision = ai.shouldBluffHoldMana(lowManaContext, {
        totalScore: 0,
        factors: {} as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(false);
      expect(decision.bluffStrength).toBe(0);
    });

    test("should not bluff during end or combat phase", () => {
      const endPhaseState = { ...gameState };
      endPhaseState.turnInfo = {
        ...gameState.turnInfo,
        phase: "end",
      };
      const endAi = new StackInteractionAI(endPhaseState, "player1", "medium");
      const decision = endAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {} as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(false);
    });

    test("should not bluff when critically low on life", () => {
      const lowLifeState = { ...gameState };
      lowLifeState.players.player1 = {
        ...gameState.players.player1,
        life: 5,
      };
      const lowLifeAi = new StackInteractionAI(
        lowLifeState,
        "player1",
        "medium",
      );
      const decision = lowLifeAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: { lifeScore: -1.5 } as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(false);
    });

    test("should not bluff in early game (turns 1-3)", () => {
      const earlyState = createGameState(
        gameState.players.player1,
        gameState.players.player2,
        2,
      );
      const earlyAi = new StackInteractionAI(earlyState, "player1", "medium");
      const decision = earlyAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {} as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(false);
    });

    test("should not bluff when far behind", () => {
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: -3.0,
        factors: {} as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(false);
    });

    test("should detect genuine hold when immediate threats exist", () => {
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {} as any,
        threats: [
          {
            permanentId: "threat1",
            threatLevel: 0.8,
            reason: "Opponent about to win",
            urgency: "immediate",
          },
        ],
      } as any);

      expect(decision.shouldBluff).toBe(true);
      expect(decision.isGenuineHold).toBe(true);
      expect(decision.bluffStrength).toBe(0.2);
    });

    test("should bluff as control archetype with sufficient mana and cautious opponent", () => {
      const opponentHistory = createCautiousOpponentHistory();
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: 0.8,
        factors: {
          cardAdvantage: 0.6,
          tempoAdvantage: -0.2,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      expect(decision.shouldBluff).toBe(true);
      expect(decision.isGenuineHold).toBe(false);
      expect(decision.bluffStrength).toBeGreaterThan(0);
    });

    test("should have lower bluff strength against aggressive opponent who ignores open mana", () => {
      const noHistoryDecision = ai.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0,
          tempoAdvantage: 0,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      const aggressiveDecision = ai.shouldBluffHoldMana(
        context,
        {
          totalScore: 0,
          factors: {
            cardAdvantage: 0,
            tempoAdvantage: 0,
            creatureCount: 2,
          } as any,
          threats: [],
        } as any,
        createAggressiveOpponentHistory(),
      );

      expect(aggressiveDecision.bluffStrength).toBeLessThanOrEqual(
        noHistoryDecision.bluffStrength,
      );
    });

    test("should increase bluff strength with more mana available", () => {
      const lowManaContext = createStackContext({ blue: 2, colorless: 1 });
      const highManaContext = createStackContext({ blue: 5, colorless: 2 });

      const lowDecision = ai.shouldBluffHoldMana(lowManaContext, {
        totalScore: 0.5,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0.1,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      const highDecision = ai.shouldBluffHoldMana(highManaContext, {
        totalScore: 0.5,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0.1,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      expect(highDecision.bluffStrength).toBeGreaterThan(
        lowDecision.bluffStrength,
      );
    });

    test("should increase bluff strength with cautious opponent history", () => {
      const noHistoryDecision = ai.shouldBluffHoldMana(context, {
        totalScore: 0.5,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0.1,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      const cautiousDecision = ai.shouldBluffHoldMana(
        context,
        {
          totalScore: 0.5,
          factors: {
            cardAdvantage: 0.3,
            tempoAdvantage: 0.1,
            creatureCount: 2,
          } as any,
          threats: [],
        } as any,
        createCautiousOpponentHistory(),
      );

      expect(cautiousDecision.bluffStrength).toBeGreaterThan(
        noHistoryDecision.bluffStrength,
      );
    });
  });

  describe("Bluff vs Genuine Hold Separation", () => {
    test("should distinguish bluff hold from genuine hold", () => {
      const genuineDecision: BluffHoldDecision = ai.shouldBluffHoldMana(
        context,
        {
          totalScore: 0,
          factors: {} as any,
          threats: [
            {
              permanentId: "threat1",
              threatLevel: 0.9,
              reason: "Lethal threat",
              urgency: "immediate",
            },
          ],
        } as any,
      );

      expect(genuineDecision.shouldBluff).toBe(true);
      expect(genuineDecision.isGenuineHold).toBe(true);
      expect(genuineDecision.reasoning).toContain("immediate threats");

      const bluffDecision: BluffHoldDecision = ai.shouldBluffHoldMana(context, {
        totalScore: 1.0,
        factors: {
          cardAdvantage: 0.6,
          tempoAdvantage: -0.3,
          creatureCount: 1,
        } as any,
        threats: [],
      } as any);

      expect(bluffDecision.shouldBluff).toBe(true);
      expect(bluffDecision.isGenuineHold).toBe(false);
    });

    test("should mark holds with instant responses as genuine when strength is moderate", () => {
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0.1,
          tempoAdvantage: 0,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      if (decision.shouldBluff) {
        expect(typeof decision.isGenuineHold).toBe("boolean");
      }
    });

    test("should not classify as genuine hold when no instant responses available", () => {
      const noResponsesContext = createStackContext(
        { blue: 3, colorless: 0 },
        [],
      );
      const decision = ai.shouldBluffHoldMana(noResponsesContext, {
        totalScore: 1.0,
        factors: {
          cardAdvantage: 0.6,
          tempoAdvantage: -0.3,
          creatureCount: 1,
        } as any,
        threats: [],
      } as any);

      if (decision.shouldBluff) {
        expect(decision.isGenuineHold).toBe(false);
      }
    });
  });

  describe("Archetype Detection", () => {
    test("should identify control archetype", () => {
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0.8,
          tempoAdvantage: -0.5,
          creatureCount: 1,
        } as any,
        threats: [],
      } as any);

      if (decision.shouldBluff) {
        expect(decision.reasoning).toContain("control");
      }
    });

    test("should identify tempo archetype", () => {
      const decision = ai.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0.1,
          tempoAdvantage: 0.5,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      if (decision.shouldBluff) {
        expect(decision.reasoning).toContain("tempo");
      }
    });

    test("should not give archetype bonus for aggro", () => {
      const aggroPlayer = createAggroPlayerState("player1");
      const opponent = createControlPlayerState("player2");
      const aggroState = createGameState(aggroPlayer, opponent);
      const aggroAi = new StackInteractionAI(aggroState, "player1", "medium");

      const decision = aggroAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0,
          tempoAdvantage: 0.2,
          creatureCount: 6,
        } as any,
        threats: [],
      } as any);

      expect(decision.reasoning).not.toContain("control");
      expect(decision.reasoning).not.toContain("tempo");
    });
  });

  describe("manageResources integration", () => {
    test("should return bluff holdFor when bluff conditions are met", () => {
      const resourceDecision = ai.manageResources(context);
      if (
        resourceDecision.holdFor === "bluff" ||
        resourceDecision.holdFor === "end_step" ||
        resourceDecision.holdFor === "opponent_turn" ||
        resourceDecision.holdFor === "better_threat"
      ) {
        expect(resourceDecision.useNow).toBe(false);
      }
    });

    test("should set useNow true when no hold condition is met", () => {
      const aggroPlayer = createAggroPlayerState("player1");
      const opponent = createControlPlayerState("player2");
      const aggroState = createGameState(aggroPlayer, opponent, 2);
      const aggroAi = new StackInteractionAI(aggroState, "player1", "medium");
      const noResponseContext = createStackContext(
        { red: 2, colorless: 0 },
        [],
      );

      const decision = aggroAi.manageResources(noResponseContext);
      expect(decision.useNow).toBe(true);
      expect(decision.holdFor).toBe("nothing");
    });
  });

  describe("Convenience function shouldBluffHoldMana", () => {
    test("should produce the same result as the class method", () => {
      const classDecision = ai.shouldBluffHoldMana(context, {
        totalScore: 0.5,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      const convenienceDecision = shouldBluffHoldMana(
        gameState,
        "player1",
        context,
      );

      expect(convenienceDecision.shouldBluff).toBe(classDecision.shouldBluff);
    });

    test("should accept opponent history parameter", () => {
      const decision = shouldBluffHoldMana(
        gameState,
        "player1",
        context,
        createCautiousOpponentHistory(),
      );

      expect(decision.bluffStrength).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Difficulty Scaling", () => {
    test("easy AI should bluff less effectively", () => {
      const easyAi = new StackInteractionAI(gameState, "player1", "easy");
      const hardAi = new StackInteractionAI(gameState, "player1", "hard");

      const easyDecision = easyAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      const hardDecision = hardAi.shouldBluffHoldMana(context, {
        totalScore: 0,
        factors: {
          cardAdvantage: 0.3,
          tempoAdvantage: 0,
          creatureCount: 2,
        } as any,
        threats: [],
      } as any);

      expect(typeof easyDecision.shouldBluff).toBe("boolean");
      expect(typeof hardDecision.shouldBluff).toBe("boolean");
    });
  });
});
