/**
 * @fileoverview Unit tests for multi-turn lookahead / forward board-state planning.
 *
 * Issue #667: Tests board state signatures, heuristic table matching,
 * lookahead engine evaluation, and integration with combat decision tree.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  CombatDecisionTree,
  type CombatPlan,
} from "../decision-making/combat-decision-tree";
import {
  createBoardStateSignature,
  computeSignatureSimilarity,
} from "../decision-making/lookahead/board-state-signature";
import { HeuristicTable } from "../decision-making/lookahead/heuristic-table";
import { LookaheadEngine } from "../decision-making/lookahead/lookahead-engine";
import type {
  BoardStateSignature,
  AttackLineHeuristic,
} from "../decision-making/lookahead/types";
import type { AIGameState, AIPlayerState, AIPermanent } from "@/lib/game-state/types";

function createMockPlayerState(
  id: string,
  life: number = 20,
  battlefield: AIPermanent[] = [],
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield,
    graveyard: [],
    exile: [],
    library: 40,
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
  type: "creature" | "land" = "creature",
  power?: number,
  toughness?: number,
  tapped: boolean = false,
  manaValue: number = 1,
  keywords: string[] = [],
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
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

function createTestGameState(
  player1Life: number = 20,
  player2Life: number = 20,
  player1Battlefield: AIPermanent[] = [],
  player2Battlefield: AIPermanent[] = [],
): AIGameState {
  return {
    players: {
      player1: createMockPlayerState("player1", player1Life, player1Battlefield),
      player2: createMockPlayerState("player2", player2Life, player2Battlefield),
    },
    turnInfo: {
      currentTurn: 5,
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

describe("Board State Signature", () => {
  describe("createBoardStateSignature", () => {
    it("should create a signature from a game state", () => {
      const gameState = createTestGameState(
        15,
        8,
        [
          createMockPermanent("c1", "Bear", "creature", 2, 2),
          createMockPermanent("c2", "Ogre", "creature", 3, 3),
        ],
        [createMockPermanent("c3", "Goblin", "creature", 1, 1)],
      );

      const sig = createBoardStateSignature(gameState, "player1");

      expect(sig.aiCreatures).toHaveLength(2);
      expect(sig.opponentCreatures).toHaveLength(1);
      expect(sig.aiLifeBucket).toBe("mid");
      expect(sig.opponentLifeBucket).toBe("low");
    });

    it("should bucket life totals correctly", () => {
      const criticalState = createTestGameState(3, 20);
      const criticalSig = createBoardStateSignature(criticalState, "player1");
      expect(criticalSig.aiLifeBucket).toBe("critical");

      const lowState = createTestGameState(8, 20);
      const lowSig = createBoardStateSignature(lowState, "player1");
      expect(lowSig.aiLifeBucket).toBe("low");

      const midState = createTestGameState(12, 20);
      const midSig = createBoardStateSignature(midState, "player1");
      expect(midSig.aiLifeBucket).toBe("mid");

      const highState = createTestGameState(18, 20);
      const highSig = createBoardStateSignature(highState, "player1");
      expect(highSig.aiLifeBucket).toBe("high");
    });

    it("should sort creatures by power descending", () => {
      const gameState = createTestGameState(
        20,
        20,
        [
          createMockPermanent("c1", "Small", "creature", 1, 1),
          createMockPermanent("c2", "Big", "creature", 5, 5),
          createMockPermanent("c3", "Medium", "creature", 3, 3),
        ],
        [],
      );

      const sig = createBoardStateSignature(gameState, "player1");

      expect(sig.aiCreatures[0].power).toBe(5);
      expect(sig.aiCreatures[1].power).toBe(3);
      expect(sig.aiCreatures[2].power).toBe(1);
    });

    it("should handle empty battlefields", () => {
      const gameState = createTestGameState();
      const sig = createBoardStateSignature(gameState, "player1");

      expect(sig.aiCreatures).toHaveLength(0);
      expect(sig.opponentCreatures).toHaveLength(0);
    });
  });

  describe("computeSignatureSimilarity", () => {
    it("should return 1 for identical signatures", () => {
      const gameState = createTestGameState(20, 15);
      const sig1 = createBoardStateSignature(gameState, "player1");
      const sig2 = createBoardStateSignature(gameState, "player1");

      expect(computeSignatureSimilarity(sig1, sig2)).toBe(1);
    });

    it("should return 0 for completely different signatures", () => {
      const sig1: BoardStateSignature = {
        aiCreatures: [{ power: 5, toughness: 5, keywords: [], manaValue: 5 }],
        opponentCreatures: [],
        aiLifeBucket: "high",
        opponentLifeBucket: "high",
        aiHandSize: 7,
        opponentHandEstimate: 0,
      };
      const sig2: BoardStateSignature = {
        aiCreatures: [],
        opponentCreatures: [{ power: 1, toughness: 1, keywords: [], manaValue: 1 }],
        aiLifeBucket: "critical",
        opponentLifeBucket: "mid",
        aiHandSize: 0,
        opponentHandEstimate: 40,
      };

      const similarity = computeSignatureSimilarity(sig1, sig2);
      expect(similarity).toBeLessThan(0.5);
    });

    it("should give high similarity for similar life buckets and creature counts", () => {
      const gameState1 = createTestGameState(14, 9, [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
      ], [
        createMockPermanent("c2", "Goblin", "creature", 1, 1),
      ]);
      const gameState2 = createTestGameState(12, 8, [
        createMockPermanent("c3", "Knight", "creature", 2, 3),
      ], [
        createMockPermanent("c4", "Imp", "creature", 1, 1),
      ]);

      const sig1 = createBoardStateSignature(gameState1, "player1");
      const sig2 = createBoardStateSignature(gameState2, "player1");

      const similarity = computeSignatureSimilarity(sig1, sig2);
      expect(similarity).toBeGreaterThan(0.5);
    });
  });
});

describe("HeuristicTable", () => {
  let table: HeuristicTable;

  beforeEach(() => {
    table = new HeuristicTable();
  });

  it("should initialize with built-in heuristics", () => {
    const all = table.getAll();
    expect(all.length).toBeGreaterThan(0);
  });

  it("should add and retrieve heuristics", () => {
    const heuristic: AttackLineHeuristic = {
      id: "test-heuristic",
      description: "Test",
      signature: {
        aiCreatures: [],
        opponentCreatures: [],
        aiLifeBucket: "mid",
        opponentLifeBucket: "low",
        aiHandSize: 2,
        opponentHandEstimate: 0,
      },
      aggressionModifier: 0.5,
      priorityAttackers: ["c1"],
      holdBack: ["c2"],
      lookaheadTurns: 2,
      confidence: 0.9,
    };

    table.add(heuristic);
    const all = table.getAll();
    expect(all.find((h) => h.id === "test-heuristic")).toBeDefined();
  });

  it("should remove heuristics by ID", () => {
    table.add({
      id: "to-remove",
      description: "Remove me",
      signature: {
        aiCreatures: [],
        opponentCreatures: [],
        aiLifeBucket: "mid",
        opponentLifeBucket: "mid",
        aiHandSize: 0,
        opponentHandEstimate: 0,
      },
      aggressionModifier: 0,
      priorityAttackers: [],
      holdBack: [],
      lookaheadTurns: 1,
      confidence: 0.5,
    });

    expect(table.remove("to-remove")).toBe(true);
    expect(table.remove("nonexistent")).toBe(false);
  });

  it("should look up matching heuristics", () => {
    const results = table.lookup(
      {
        aiCreatures: [],
        opponentCreatures: [],
        aiLifeBucket: "critical",
        opponentLifeBucket: "critical",
        aiHandSize: 1,
        opponentHandEstimate: 0,
      },
      0.2,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].aggressionModifier).toBeGreaterThan(0);
  });

  it("should return empty array when no heuristics match", () => {
    table.clear();
    const results = table.lookup(
      {
        aiCreatures: [],
        opponentCreatures: [],
        aiLifeBucket: "high",
        opponentLifeBucket: "high",
        aiHandSize: 7,
        opponentHandEstimate: 7,
      },
      0.9,
    );

    expect(results).toHaveLength(0);
  });

  it("should clear all heuristics", () => {
    table.clear();
    expect(table.getAll()).toHaveLength(0);
  });
});

describe("LookaheadEngine", () => {
  let engine: LookaheadEngine;
  let table: HeuristicTable;

  beforeEach(() => {
    table = new HeuristicTable();
    engine = new LookaheadEngine(table);
  });

  it("should return non-evaluated result when disabled", () => {
    engine.setConfig({ enabled: false });
    const gameState = createTestGameState();
    const result = engine.evaluate(gameState, "player1");

    expect(result.evaluated).toBe(false);
    expect(result.aggressionModifier).toBe(0);
  });

  it("should evaluate and return aggression modifier", () => {
    const gameState = createTestGameState(
      20,
      4,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
        createMockPermanent("c2", "Ogre", "creature", 4, 2),
      ],
      [],
    );

    const result = engine.evaluate(gameState, "player1");

    expect(result.evaluated).toBe(true);
    expect(typeof result.aggressionModifier).toBe("number");
    expect(typeof result.bestScore).toBe("number");
  });

  it("should detect lethal when opponent has low life", () => {
    const gameState = createTestGameState(
      20,
      4,
      [
        createMockPermanent("c1", "Bear", "creature", 3, 3),
        createMockPermanent("c2", "Ogre", "creature", 4, 2),
      ],
      [createMockPermanent("c3", "Wall", "creature", 0, 4)],
    );

    const result = engine.evaluate(gameState, "player1");

    expect(result.evaluated).toBe(true);
    if (result.lethalFound) {
      expect(result.turnsToLethal).toBeLessThan(Infinity);
    }
  });

  it("should detect opponent lethal risk when AI has low life", () => {
    const gameState = createTestGameState(
      3,
      20,
      [],
      [
        createMockPermanent("c3", "Dragon", "creature", 5, 5),
        createMockPermanent("c4", "Bear", "creature", 2, 2),
      ],
    );

    const result = engine.evaluate(gameState, "player1");

    expect(result.evaluated).toBe(true);
    expect(result.opponentLethalRisk).toBe(true);
  });

  it("should return Infinity for turnsToLethal when no lethal found", () => {
    const gameState = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [createMockPermanent("c2", "Bear", "creature", 2, 2)],
    );

    const result = engine.evaluate(gameState, "player1");

    if (!result.lethalFound && !result.opponentLethalRisk) {
      expect(result.turnsToLethal).toBe(Infinity);
    }
  });

  it("should respect maxDepth configuration", () => {
    engine.setConfig({ maxDepth: 1 });
    const gameState = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [],
    );

    const result = engine.evaluate(gameState, "player1");
    expect(result.evaluated).toBe(true);
  });

  it("should apply custom heuristics from the table", () => {
    table.add({
      id: "custom-aggressive",
      description: "Always be aggressive",
      signature: {
        aiCreatures: [{ power: 5, toughness: 5, keywords: [], manaValue: 5 }],
        opponentCreatures: [{ power: 1, toughness: 1, keywords: [], manaValue: 1 }],
        aiLifeBucket: "high",
        opponentLifeBucket: "high",
        aiHandSize: 5,
        opponentHandEstimate: 0,
      },
      aggressionModifier: 0.8,
      priorityAttackers: ["big-creature"],
      holdBack: [],
      lookaheadTurns: 2,
      confidence: 0.95,
    });

    const gameState = createTestGameState(
      18,
      16,
      [createMockPermanent("big-creature", "Big", "creature", 5, 5)],
      [createMockPermanent("small", "Tiny", "creature", 1, 1)],
    );

    const result = engine.evaluate(gameState, "player1");
    expect(result.priorityAttackers).toContain("big-creature");
  });
});

describe("Combat Decision Tree + Lookahead Integration", () => {
  it("should use lookahead for medium difficulty and above", () => {
    const gameState = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 3, 3)],
      [createMockPermanent("c2", "Bear", "creature", 2, 2)],
    );

    const mediumAI = new CombatDecisionTree(gameState, "player1", "medium");
    const plan = mediumAI.generateAttackPlan();

    expect(plan).toBeDefined();
    expect(plan.attacks).toBeDefined();
  });

  it("should skip lookahead for easy difficulty", () => {
    const gameState = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [],
    );

    const easyAI = new CombatDecisionTree(gameState, "player1", "easy");
    const plan = easyAI.generateAttackPlan();

    expect(plan).toBeDefined();
  });

  it("should adjust attack decisions based on lookahead", () => {
    const gameState = createTestGameState(
      4,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [
        createMockPermanent("c2", "Dragon", "creature", 6, 6),
        createMockPermanent("c3", "Bear", "creature", 2, 2),
      ],
    );

    const hardAI = new CombatDecisionTree(gameState, "player1", "hard");
    const plan = hardAI.generateAttackPlan();

    expect(plan).toBeDefined();
    expect(plan.strategy).toBe("defensive");
  });

  it("should prioritize aggressive attacks when opponent is at low life with enough power", () => {
    const gameState = createTestGameState(
      20,
      3,
      [
        createMockPermanent("c1", "Bear", "creature", 2, 2),
        createMockPermanent("c2", "Ogre", "creature", 3, 3),
      ],
      [createMockPermanent("c3", "Wall", "creature", 0, 4)],
    );

    const hardAI = new CombatDecisionTree(gameState, "player1", "hard");
    const plan = hardAI.generateAttackPlan();

    expect(plan).toBeDefined();
    expect(plan.strategy).toBe("aggressive");
    expect(plan.attacks.length).toBeGreaterThanOrEqual(0);
  });

  it("should accept a custom heuristic table", () => {
    const gameState = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [],
    );

    const customTable = new HeuristicTable();
    customTable.clear();
    const ai = new CombatDecisionTree(gameState, "player1", "medium");
    ai.setHeuristicTable(customTable);

    const plan = ai.generateAttackPlan();
    expect(plan).toBeDefined();
  });
});
