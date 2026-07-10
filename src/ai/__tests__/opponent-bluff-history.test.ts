/**
 * Tests for the persistent opponent-bluff accumulator (issue #1230).
 *
 * Covers the acceptance criteria from the issue body:
 *   - across N turns, hesitation/baits/representativeCounter accumulate
 *     monotonically (AC #1)
 *   - shouldCounter confidence scales up when representativeCounterspell
 *     reaches the >= 2 threshold (AC #2)
 *   - Easy tier ignores the accumulator (AC #3)
 *   - default tests for the new module path (AC #4 / coverage floor)
 */

import { describe, test, expect } from "@jest/globals";
import type { AIGameState, AIPlayerState } from "@/lib/game-state/types";
import {
  createOpponentBluffHistory,
  observeOpponentTurn,
  toOpponentHistory,
  opponentHistoryMatters,
  counterspellTighteningFactor,
  counterspellConfidenceBump,
  snapshotOpponentBluffSignals,
  type OpponentBluffSignals,
} from "../opponent-bluff-history";
import {
  StackInteractionAI,
  type StackAction,
  type StackContext,
  type AvailableResponse,
} from "../stack-interaction-ai";
import { getCounterspellProbability } from "../counterspell-frequency-model";

function makeSignal(
  partial: Partial<OpponentBluffSignals> & { turnNumber: number },
): OpponentBluffSignals {
  return {
    representCounterspellOnStack: 0,
    heldManaPreCombat: 0,
    passedWithMana: 0,
    didCounterOnStack: 0,
    cardsPlayed: 0,
    ...partial,
  };
}

describe("createOpponentBluffHistory", () => {
  test("returns a zeroed, freshness-shaped accumulator", () => {
    const h = createOpponentBluffHistory();
    expect(h.turnsTracked).toBe(0);
    expect(h.representativeCounterspellCount).toBe(0);
    expect(h.baitedCount).toBe(0);
    expect(h.hesitationCount).toBe(0);
    expect(h.totalCardsPlayed).toBe(0);
    expect(h.avgPlaysPerTurn).toBe(0);
    expect(h.playsAroundOpenMana).toBe(false);
    expect(h.wasBaited).toBe(false);
    expect(h.signals).toEqual([]);
    expect(h.lastObservedAt).toBe(0);
  });
});

describe("observeOpponentTurn — accumulation (issue #1230 AC #1)", () => {
  test("accumulates monotonically across a 10-turn simulated game", () => {
    let h = createOpponentBluffHistory();
    const hesitationTrace: number[] = [];
    const baitTrace: number[] = [];
    const repTrace: number[] = [];
    const avgTrace: number[] = [];
    for (let turn = 1; turn <= 10; turn++) {
      // Simulate the opponent repeatedly holding mana while AI casts weak
      // spells: 1 represent-counter + 1 hold-mana-pre-combat + 1 played card.
      h = observeOpponentTurn(
        h,
        makeSignal({
          turnNumber: turn,
          representCounterspellOnStack: 1,
          heldManaPreCombat: 1,
          passedWithMana: 0,
          cardsPlayed: 1,
          didCounterOnStack: 0,
        }),
      );
      hesitationTrace.push(h.hesitationCount);
      baitTrace.push(h.baitedCount);
      repTrace.push(h.representativeCounterspellCount);
      avgTrace.push(h.avgPlaysPerTurn);
    }
    // Monotonic non-decreasing across all turns.
    for (let i = 1; i < hesitationTrace.length; i++) {
      expect(hesitationTrace[i]).toBeGreaterThanOrEqual(hesitationTrace[i - 1]);
      expect(baitTrace[i]).toBeGreaterThanOrEqual(baitTrace[i - 1]);
      expect(repTrace[i]).toBeGreaterThanOrEqual(repTrace[i - 1]);
    }
    // Final totals: 10 reps + 10 baits (matching the loop input).
    expect(h.representativeCounterspellCount).toBe(10);
    expect(h.baitedCount).toBe(10);
    // avgPlaysPerTurn stays at ~1.0 across the whole game.
    expect(h.avgPlaysPerTurn).toBeCloseTo(1.0, 5);
    // Derived flags flip on once threshold reached (>= 2).
    expect(h.playsAroundOpenMana).toBe(true);
    expect(h.wasBaited).toBe(true);
    expect(h.turnsTracked).toBe(10);
  });

  test("treats negative input as zero — does not regress counters", () => {
    const seeded = observeOpponentTurn(
      createOpponentBluffHistory(),
      makeSignal({
        turnNumber: 1,
        representCounterspellOnStack: 3,
        cardsPlayed: 2,
      }),
    );
    const next = observeOpponentTurn(
      seeded,
      makeSignal({
        turnNumber: 2,
        // Defensive: malformed caller sends negative deltas. Must NOT undo
        // the prior totals (AC #1 monotonicity).
        representCounterspellOnStack: -5,
        heldManaPreCombat: -1,
        cardsPlayed: -3,
      }),
    );
    expect(next.representativeCounterspellCount).toBe(3);
    expect(next.baitedCount).toBe(0);
    expect(next.totalCardsPlayed).toBe(2);
    expect(next.turnsTracked).toBe(2);
  });

  test("does not mutate the previous accumulator", () => {
    const prev = observeOpponentTurn(
      createOpponentBluffHistory(),
      makeSignal({ turnNumber: 1, representCounterspellOnStack: 1 }),
    );
    const prevCopy = { ...prev };
    observeOpponentTurn(
      prev,
      makeSignal({ turnNumber: 2, representCounterspellOnStack: 5 }),
    );
    expect(prev).toEqual(prevCopy);
  });
});

describe("toOpponentHistory — legacy shape derivation", () => {
  test("returns undefined when nothing has been observed", () => {
    expect(toOpponentHistory(undefined)).toBeUndefined();
    expect(toOpponentHistory(createOpponentBluffHistory())).toBeUndefined();
  });

  test("projects accumulator onto the existing OpponentHistory shape", () => {
    let h = createOpponentBluffHistory();
    h = observeOpponentTurn(
      h,
      makeSignal({ turnNumber: 1, passedWithMana: 1 }),
    );
    h = observeOpponentTurn(
      h,
      makeSignal({ turnNumber: 2, passedWithMana: 1 }),
    );
    h = observeOpponentTurn(
      h,
      makeSignal({ turnNumber: 3, heldManaPreCombat: 1, passedWithMana: 1 }),
    );
    const derived = toOpponentHistory(h);
    expect(derived).toBeDefined();
    expect(derived!.hesitationCount).toBe(3);
    expect(derived!.wasBaited).toBe(true);
    expect(derived!.playsAroundOpenMana).toBe(false);
    expect(derived!.avgPlaysPerTurn).toBe(0);
  });
});

describe("difficulty gating (AC #3)", () => {
  test("Easy tier ignores the accumulator — no-op factor returned", () => {
    expect(opponentHistoryMatters("easy")).toBe(false);
    const h = observeOpponentTurn(
      createOpponentBluffHistory(),
      makeSignal({
        turnNumber: 1,
        representCounterspellOnStack: 10,
        didCounterOnStack: 0,
      }),
    );
    expect(counterspellTighteningFactor(h, "easy")).toBe(1);
    expect(counterspellConfidenceBump(h, "easy")).toBe(0);
  });

  test("Hard/Expert tiers read the accumulator", () => {
    expect(opponentHistoryMatters("medium")).toBe(true);
    expect(opponentHistoryMatters("hard")).toBe(true);
    expect(opponentHistoryMatters("expert")).toBe(true);
  });

  test("confidence bump threshold is representativeCounterspell >= 2 (AC #2)", () => {
    // Single noisy observation does not move the needle.
    let h = createOpponentBluffHistory();
    h = observeOpponentTurn(
      h,
      makeSignal({ turnNumber: 1, representCounterspellOnStack: 1 }),
    );
    expect(counterspellConfidenceBump(h, "expert")).toBeCloseTo(0.1, 5);
    // Two observations = full bump.
    h = observeOpponentTurn(
      h,
      makeSignal({ turnNumber: 2, representCounterspellOnStack: 1 }),
    );
    expect(counterspellConfidenceBump(h, "expert")).toBeCloseTo(0.2, 5);
    expect(counterspellConfidenceBump(h, "hard")).toBeCloseTo(0.12, 5);
    expect(counterspellConfidenceBump(h, "medium")).toBeCloseTo(0.06, 5);
  });

  test("tightening factor shrinks when reps exceed real counters", () => {
    let h = createOpponentBluffHistory();
    // 3 representations, 0 actual counters → opponent has been bluffing.
    h = observeOpponentTurn(
      h,
      makeSignal({
        turnNumber: 1,
        representCounterspellOnStack: 3,
        didCounterOnStack: 0,
      }),
    );
    const expertFactor = counterspellTighteningFactor(h, "expert");
    const easyFactor = counterspellTighteningFactor(h, "easy");
    expect(easyFactor).toBe(1);
    expect(expertFactor).toBeLessThan(1);
    expect(expertFactor).toBeGreaterThanOrEqual(0.6); // Expert floor
  });

  test("tightening factor stays at 1 when reps matches actual counters", () => {
    let h = createOpponentBluffHistory();
    h = observeOpponentTurn(
      h,
      makeSignal({
        turnNumber: 1,
        representCounterspellOnStack: 2,
        didCounterOnStack: 2,
      }),
    );
    expect(counterspellTighteningFactor(h, "expert")).toBe(1);
    expect(counterspellTighteningFactor(h, "hard")).toBe(1);
  });
});

describe("snapshotOpponentBluffSignals (replay export AC #4)", () => {
  test("returns a shallow copy suitable for GameReplay exposure", () => {
    const seeded = observeOpponentTurn(
      createOpponentBluffHistory(),
      makeSignal({ turnNumber: 5, representCounterspellOnStack: 1 }),
    );
    const snap = snapshotOpponentBluffSignals(seeded);
    expect(Array.isArray(snap)).toBe(true);
    expect(snap.length).toBe(1);
    expect(snap[0]!.turnNumber).toBe(5);
  });

  test("returns empty for an undefined accumulator", () => {
    expect(snapshotOpponentBluffSignals(undefined).length).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Integration: stack-interaction-ai.ts + counterspell-frequency-model.ts
// --------------------------------------------------------------------------

function makeMinimalAIGameState(): AIGameState {
  const ai: AIPlayerState = {
    id: "ai",
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    library: 30,
    manaPool: { blue: 4 },
  };
  const opponent: AIPlayerState = {
    id: "opp",
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    library: 30,
    manaPool: { blue: 4 },
  };
  return {
    players: { ai, opponent },
    turnInfo: {
      currentTurn: 4,
      currentPlayer: "ai",
      phase: "precombat_main",
      step: "main",
      priority: "ai",
    },
    stack: [],
  };
}

function makeSpellAction(overrides: Partial<StackAction> = {}): StackAction {
  return {
    id: "stack-1",
    cardId: "some",
    name: "Opt",
    controller: "opp",
    type: "spell",
    manaValue: 1,
    isInstantSpeed: false,
    timestamp: 0,
    ...overrides,
  };
}

function makeCounterspellResponse(): AvailableResponse {
  return {
    cardId: "counterspell",
    name: "Counterspell",
    type: "instant",
    manaValue: 2,
    canCounter: true,
    canTarget: ["spell"],
    effect: { type: "counter", value: 0, targets: ["spell"] },
  } as unknown as AvailableResponse;
}

function makeCtx(): StackContext {
  // High-threat spell so both no-history and with-history variants cross the
  // counterspell threshold (Expert requires score > 2.8) and the
  // `calculateCounterspellConfidence` path runs on both branches.
  return {
    currentAction: makeSpellAction({
      name: "Crux of Fate",
      manaValue: 7,
      targets: [{ playerId: "ai" }],
    }),
    stackSize: 1,
    actionsAbove: [],
    availableMana: { blue: 4 },
    availableResponses: [makeCounterspellResponse()],
    opponentsRemaining: ["opp"],
    isMyTurn: true,
    phase: "precombat_main",
    step: "main",
    respondingToOpponent: true,
  };
}

describe("getCounterspellProbability — bluff tightening (issue #1230)", () => {
  test("tightens probability by the supplied factor", () => {
    const stack = [makeSpellAction({ name: "Primeval Titan", manaValue: 6 })];
    const baseline = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      stack,
      makeSpellAction({ name: "Counterspell", manaValue: 2, controller: "ai" }),
    );
    const tightened = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      stack,
      makeSpellAction({ name: "Counterspell", manaValue: 2, controller: "ai" }),
      0.5,
    );
    expect(tightened.probability).toBeCloseTo(baseline.probability * 0.5, 5);
  });

  test("clamps out-of-range factors (defensive)", () => {
    const stack = [makeSpellAction({ name: "Primeval Titan", manaValue: 6 })];
    const current = makeSpellAction({
      name: "Counterspell",
      manaValue: 2,
      controller: "ai",
    });
    const upper = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      stack,
      current,
      2.0,
    );
    const lower = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      stack,
      current,
      -1.0,
    );
    const baseline = getCounterspellProbability(
      "control",
      { blue: 4, colorless: 2 },
      stack,
      current,
    );
    expect(upper.probability).toBeCloseTo(baseline.probability, 5);
    expect(lower.probability).toBe(0);
  });
});

describe("StackInteractionAI — accumulator plumbing", () => {
  test("constructor accepts opponentBluffHistory and stores it", () => {
    const ai = new StackInteractionAI(
      makeMinimalAIGameState(),
      "ai",
      "medium",
      {
        opponentBluffHistory: createOpponentBluffHistory(),
      },
    );
    const previous = ai.setOpponentBluffHistory(undefined);
    expect(previous).toBeDefined();
  });

  test("decideCounterspell confidence rises once reps >= 2 (AC #2)", () => {
    const state = makeMinimalAIGameState();
    const ctx = makeCtx();

    const empty = new StackInteractionAI(state, "ai", "expert");
    const baseline = empty.decideCounterspell(ctx, makeCounterspellResponse());

    let h = createOpponentBluffHistory();
    for (let turn = 1; turn <= 3; turn++) {
      h = observeOpponentTurn(
        h,
        makeSignal({
          turnNumber: turn,
          representCounterspellOnStack: 1,
          didCounterOnStack: 0,
        }),
      );
    }
    const withHistory = new StackInteractionAI(state, "ai", "expert", {
      opponentBluffHistory: h,
    });
    const bumped = withHistory.decideCounterspell(
      ctx,
      makeCounterspellResponse(),
    );

    expect(bumped.confidence).toBeGreaterThan(baseline.confidence);
  });

  test("Easy tier does not gain confidence from accumulator (AC #3)", () => {
    const state = makeMinimalAIGameState();
    const ctx = makeCtx();

    const empty = new StackInteractionAI(state, "ai", "easy");
    const baseline = empty.decideCounterspell(ctx, makeCounterspellResponse());

    let h = createOpponentBluffHistory();
    for (let turn = 1; turn <= 4; turn++) {
      h = observeOpponentTurn(
        h,
        makeSignal({
          turnNumber: turn,
          representCounterspellOnStack: 1,
          didCounterOnStack: 0,
        }),
      );
    }
    const withHistory = new StackInteractionAI(state, "ai", "easy", {
      opponentBluffHistory: h,
    });
    const result = withHistory.decideCounterspell(
      ctx,
      makeCounterspellResponse(),
    );
    // Confidence unchanged vs baseline for easy (no history bump).
    expect(result.confidence).toBeCloseTo(baseline.confidence, 5);
  });
});
