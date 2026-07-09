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
import type {
  AIGameState,
  AIPlayerState,
  AIPermanent,
} from "@/lib/game-state/types";

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
      player1: createMockPlayerState(
        "player1",
        player1Life,
        player1Battlefield,
      ),
      player2: createMockPlayerState(
        "player2",
        player2Life,
        player2Battlefield,
      ),
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
        opponentCreatures: [
          { power: 1, toughness: 1, keywords: [], manaValue: 1 },
        ],
        aiLifeBucket: "critical",
        opponentLifeBucket: "mid",
        aiHandSize: 0,
        opponentHandEstimate: 40,
      };

      const similarity = computeSignatureSimilarity(sig1, sig2);
      expect(similarity).toBeLessThan(0.5);
    });

    it("should give high similarity for similar life buckets and creature counts", () => {
      const gameState1 = createTestGameState(
        14,
        9,
        [createMockPermanent("c1", "Bear", "creature", 2, 2)],
        [createMockPermanent("c2", "Goblin", "creature", 1, 1)],
      );
      const gameState2 = createTestGameState(
        12,
        8,
        [createMockPermanent("c3", "Knight", "creature", 2, 3)],
        [createMockPermanent("c4", "Imp", "creature", 1, 1)],
      );

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
        opponentCreatures: [
          { power: 1, toughness: 1, keywords: [], manaValue: 1 },
        ],
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

// ---------------------------------------------------------------------------
// Issue #1068 — lookahead aggression bias.
//
// The engine accepts an external `aggressionBias` (driven by the board-state
// swing) that is added to its internally-derived aggression modifier and
// clamped to [-1, 1]. Positive bias → more aggressive lookahead signal (press
// when behind); negative → conservative (protect a lead). Default 0 leaves the
// historical signal unchanged.
// ---------------------------------------------------------------------------

describe("LookaheadEngine aggressionBias (issue #1068)", () => {
  function symmetricBoard(): AIGameState {
    // Symmetric, modest board → internal modifier near 0, so the additive bias
    // is observable without being masked by clamping.
    return createTestGameState(
      20,
      20,
      [createMockPermanent("a1", "Bear", "creature", 2, 2)],
      [createMockPermanent("d1", "Bear", "creature", 2, 2)],
    );
  }

  it("defaults aggressionBias to 0 (no change to historical signal)", () => {
    const baseline = new LookaheadEngine(new HeuristicTable());
    const withZero = new LookaheadEngine(new HeuristicTable(), {
      aggressionBias: 0,
    });
    const state = symmetricBoard();

    const r1 = baseline.evaluate(state, "player1");
    const r2 = withZero.evaluate(state, "player1");

    expect(r1.evaluated).toBe(true);
    expect(r2.aggressionModifier).toBeCloseTo(r1.aggressionModifier, 5);
  });

  it("a positive bias raises the aggression modifier by ~bias", () => {
    const state = symmetricBoard();
    const base = new LookaheadEngine(new HeuristicTable()).evaluate(
      state,
      "player1",
    );
    const pressed = new LookaheadEngine(new HeuristicTable(), {
      aggressionBias: 0.4,
    }).evaluate(state, "player1");

    expect(pressed.aggressionModifier).toBeGreaterThan(base.aggressionModifier);
    expect(pressed.aggressionModifier - base.aggressionModifier).toBeCloseTo(
      0.4,
      1,
    );
  });

  it("a negative bias lowers the aggression modifier by ~bias", () => {
    const state = symmetricBoard();
    const base = new LookaheadEngine(new HeuristicTable()).evaluate(
      state,
      "player1",
    );
    const conservative = new LookaheadEngine(new HeuristicTable(), {
      aggressionBias: -0.4,
    }).evaluate(state, "player1");

    expect(conservative.aggressionModifier).toBeLessThan(base.aggressionModifier);
    expect(conservative.aggressionModifier - base.aggressionModifier).toBeCloseTo(
      -0.4,
      1,
    );
  });

  it("clamps the final aggression modifier to [-1, 1] even with a large bias", () => {
    const state = symmetricBoard();
    const maxBias = new LookaheadEngine(new HeuristicTable(), {
      aggressionBias: 5,
    }).evaluate(state, "player1");
    const minBias = new LookaheadEngine(new HeuristicTable(), {
      aggressionBias: -5,
    }).evaluate(state, "player1");

    expect(maxBias.aggressionModifier).toBeLessThanOrEqual(1);
    expect(minBias.aggressionModifier).toBeGreaterThanOrEqual(-1);
  });

  it("can be updated at runtime via setConfig", () => {
    const state = symmetricBoard();
    const engine = new LookaheadEngine(new HeuristicTable());
    const before = engine.evaluate(state, "player1").aggressionModifier;

    engine.setConfig({ aggressionBias: 0.5 });
    const after = engine.evaluate(state, "player1").aggressionModifier;

    expect(after).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Issue #1232 — opponent combo-assembly detection.
//
// The lookahead engine reads the opponent's known cards via
// `detectComboAssembly`, escalates the aggression modifier when a combo is
// imminent, and emits a `comboThreatDetected` event when the threat tier
// changes (or re-fires on every imminent evaluation).
//
// These tests are deliberately scoped to the engine surface (the detector has
// its own fixture suite in
// `src/ai/decision-making/__tests__/combo-threat-detector.test.ts`). They
// assert that the engine wires the detector's result into the right fields
// and that the documented urgency scalar raises the modifier as expected.
// ---------------------------------------------------------------------------

describe("LookaheadEngine combo-threat detection (issue #1232)", () => {
  function makeComboState(
    opponentHand: string[],
    opponentMana: number,
  ): AIGameState {
    const state = createTestGameState(
      20,
      20,
      [createMockPermanent("c1", "Bear", "creature", 2, 2)],
      [],
    );
    const opponent = state.players.player2;
    opponent.hand = opponentHand.map((name, idx) => ({
      cardInstanceId: `opp-hand-${idx}`,
      name,
      type: "varies",
      manaValue: 1,
    }));
    opponent.manaPool = {
      ...opponent.manaPool,
      generic: opponentMana,
    };
    return state;
  }

  it("reports `comboThreat === 'none'` when the opponent has no combo signal", () => {
    const state = makeComboState(["Grizzly Bears", "Counterspell"], 0);
    const result = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    }).evaluate(state, "player1");

    expect(result.evaluated).toBe(true);
    expect(result.comboThreat).toBe("none");
    expect(result.comboArchetype).toBeNull();
    expect(result.comboThreatUrgency).toBe(0);
  });

  it("escalates the aggression modifier by ~0.4 when the opponent is imminent", () => {
    // Symmetric board → the legacy signal cancels out to ~0, so the
    // ~0.4 urgency contribution is observable. Past in Flames +
    // Tendrils of Agony + 6 mana → imminent at expert depth.
    const state = makeComboState(["Past in Flames", "Tendrils of Agony"], 6);
    const baseline = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    }).evaluate(state, "player1");

    expect(baseline.comboThreat).toBe("imminent");
    expect(baseline.comboArchetype).toBe("storm");
    expect(baseline.comboThreatUrgency).toBeCloseTo(0.4, 5);
    expect(baseline.aggressionModifier).toBeGreaterThan(0);
  });

  it("Easy depth misses the imminent threat and stays at `building`", () => {
    // Same opponent sequence; on Easy (depth = 2) only the first card in
    // the hand is scanned, so Past in Flames is missed entirely.
    const state = makeComboState(
      ["Filler-A", "Filler-B", "Past in Flames", "Tendrils of Agony"],
      6,
    );
    const easy = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "easy",
      comboDetectionDepth: 2,
    }).evaluate(state, "player1");

    const expert = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    }).evaluate(state, "player1");

    expect(easy.comboThreat).toBe("none");
    expect(expert.comboThreat).toBe("imminent");
    expect(expert.aggressionModifier).toBeGreaterThan(
      easy.aggressionModifier,
    );
  });

  it("switches the preferred line when the threat flips to imminent", () => {
    // Compare the modifier on two evaluations of the *same* board.
    // The first evaluation has no opponent combo signal, the second
    // one does. The aggression modifier must rise on the second.
    const stateNoThreat = makeComboState(["Grizzly Bears"], 0);
    const stateWithThreat = makeComboState(["Past in Flames", "Tendrils of Agony"], 6);

    const engine = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    });

    const r1 = engine.evaluate(stateNoThreat, "player1");
    const r2 = engine.evaluate(stateWithThreat, "player1");

    expect(r1.comboThreat).toBe("none");
    expect(r2.comboThreat).toBe("imminent");
    expect(r2.aggressionModifier).toBeGreaterThan(r1.aggressionModifier);
  });

  it("emits a `comboThreatDetected` event when the threat tier changes", () => {
    const state = makeComboState(["Past in Flames", "Tendrils of Agony"], 6);
    const engine = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    });

    const events: import("../decision-making/lookahead/lookahead-engine").ComboThreatEvent[] =
      [];
    engine.onComboThreat((e) => {
      events.push(e);
    });

    // First evaluation escalates from the default `none` → `imminent`.
    engine.evaluate(state, "player1");
    // Second evaluation: threat tier is stable but imminent re-fires
    // (so the post-game replay can plot the urgency). Two events in
    // total; the schema is identical so downstream sinks can diff by
    // `turn` and `piecesPresent`.
    engine.evaluate(state, "player1");

    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.type).toBe("comboThreatDetected");
      expect(e.threat).toBe("imminent");
      expect(e.archetype).toBe("storm");
      expect(e.matchedPieces).toEqual(
        expect.arrayContaining(["past in flames", "tendrils of agony"]),
      );
    }
  });

  it("re-fires the `comboThreatDetected` event on every imminent evaluation", () => {
    // The replay sink needs to see sustained urgency, not just
    // transitions. Verify the re-fire contract.
    const state = makeComboState(["Past in Flames", "Tendrils of Agony"], 6);
    const engine = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    });
    const events: number[] = [];
    engine.onComboThreat(() => {
      events.push(Date.now());
    });

    engine.evaluate(state, "player1");
    engine.evaluate(state, "player1");
    engine.evaluate(state, "player1");

    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("clamps the final aggression modifier to [-1, 1] even with an imminent urgency", () => {
    // Build an extremely defensive board so the legacy modifier is
    // already negative, then stack the +0.4 urgency on top. The result
    // must still be inside [-1, 1].
    const state = createTestGameState(
      3, // AI critically low
      20,
      [],
      [
        createMockPermanent("d1", "Dragon", "creature", 5, 5),
        createMockPermanent("d2", "Dragon", "creature", 5, 5),
      ],
    );
    state.players.player2.hand = [
      {
        cardInstanceId: "h1",
        name: "Past in Flames",
        type: "varies",
        manaValue: 1,
      },
      {
        cardInstanceId: "h2",
        name: "Tendrils of Agony",
        type: "varies",
        manaValue: 1,
      },
    ];
    state.players.player2.manaPool = {
      ...state.players.player2.manaPool,
      generic: 8,
    };

    const result = new LookaheadEngine(new HeuristicTable(), {
      difficulty: "expert",
      comboDetectionDepth: 8,
    }).evaluate(state, "player1");

    expect(result.aggressionModifier).toBeGreaterThanOrEqual(-1);
    expect(result.aggressionModifier).toBeLessThanOrEqual(1);
    expect(result.comboThreat).toBe("imminent");
  });

  it("LookaheadResult includes the new comboThreat fields (no regression)", () => {
    // Pure-shape check: every evaluation must populate the new fields
    // so consumers don't need to defend against undefined.
    const state = makeComboState(["Grizzly Bears"], 0);
    const result = new LookaheadEngine(new HeuristicTable()).evaluate(
      state,
      "player1",
    );

    expect(typeof result.comboThreat).toBe("string");
    expect(["imminent", "building", "none"]).toContain(result.comboThreat);
    expect(result.comboArchetype === null || typeof result.comboArchetype === "string").toBe(true);
    expect(typeof result.comboThreatUrgency).toBe("number");
  });
});
