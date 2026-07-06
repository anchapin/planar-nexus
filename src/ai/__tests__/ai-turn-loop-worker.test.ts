/**
 * @fileoverview runAITurn worker-offload tests (issue #1244)
 *
 * `computeAdaptiveContext` inside `runAITurn` calls `evaluateGameState` once
 * per turn (when a `BoardSwingTracker` is configured). Issue #1244 moves that
 * call onto the AI Web Worker via the
 * `game-state-evaluator-worker-bridge.ts` bridge so a "medium" turn loop does
 * not block the UI on a 10-permanent board.
 *
 * This test asserts that, when a swing tracker is configured, the bridge is
 * awaited from inside `runAITurn` (i.e. the turn loop is async-aware of the
 * worker offload). We inject a stub client via the bridge's resolver hook so
 * the test does not require a real `Worker` global.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Engine stubs identical to ai-turn-loop.test.ts so the real turn-loop
// orchestration runs against deterministic no-op phases.
jest.mock("@/lib/game-state/mana");
jest.mock("@/lib/game-state/spell-casting");
jest.mock("@/lib/game-state/combat");
jest.mock("@/lib/game-state/keyword-actions");
jest.mock("@/lib/game-state/game-state");
jest.mock("@/lib/game-state/turn-phases");
jest.mock("@/lib/game-state/serialization");
jest.mock("@/lib/game-rules");

let mockAttackPlan: { attacks: unknown[] } = { attacks: [] };
jest.mock("../decision-making/combat-decision-tree", () => ({
  CombatDecisionTree: jest.fn().mockImplementation(() => ({
    generateAttackPlan: jest.fn(() => mockAttackPlan),
    getConfig: jest.fn(() => ({
      aggression: 0.5,
      riskTolerance: 0.5,
      lookaheadConfig: {},
    })),
    setConfig: jest.fn(),
  })),
  deckArchetypeToOpponentArchetype: jest.fn(() => "midrange"),
}));

import { canPlayLand, playLand } from "@/lib/game-state/mana";
import { canCastSpell, castSpell } from "@/lib/game-state/spell-casting";
import { declareAttackers } from "@/lib/game-state/combat";
import {
  tapCardAction,
  untapCardAction,
  discardCards,
} from "@/lib/game-state/keyword-actions";
import { passPriority, drawCard } from "@/lib/game-state/game-state";
import { advancePhase } from "@/lib/game-state/turn-phases";
import { engineToAIState } from "@/lib/game-state/serialization";
import { getMaxHandSize, getMulliganRules } from "@/lib/game-rules";
import * as gameStateEvaluator from "../game-state-evaluator";
import {
  BoardSwingTracker,
  type DetailedEvaluation,
} from "../game-state-evaluator";
import {
  _setEvaluatorClientResolver,
  _resetEvaluatorClientResolver,
  type GameStateEvaluatorWorkerClient,
} from "../worker/game-state-evaluator-worker-bridge";
import {
  runAITurn,
  type AITurnConfig,
} from "../ai-turn-loop";
import type {
  GameState as EngineGameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  Turn,
} from "@/lib/game-state/types";

const canPlayLandMock = canPlayLand as unknown as jest.Mock;
const playLandMock = playLand as unknown as jest.Mock;
const canCastSpellMock = canCastSpell as unknown as jest.Mock;
const castSpellMock = castSpell as unknown as jest.Mock;
const declareAttackersMock = declareAttackers as unknown as jest.Mock;
const tapCardActionMock = tapCardAction as unknown as jest.Mock;
const untapCardActionMock = untapCardAction as unknown as jest.Mock;
const discardCardsMock = discardCards as unknown as jest.Mock;
const passPriorityMock = passPriority as unknown as jest.Mock;
const drawCardMock = drawCard as unknown as jest.Mock;
const advancePhaseMock = advancePhase as unknown as jest.Mock;
const engineToAIStateMock = engineToAIState as unknown as jest.Mock;
const getMaxHandSizeMock = getMaxHandSize as unknown as jest.Mock;
const getMulliganRulesMock = getMulliganRules as unknown as jest.Mock;

const AI: PlayerId = "player1";
const OPP: PlayerId = "player2";

function mkCard(id: CardInstanceId, typeLine: string): CardInstance {
  return {
    id,
    oracleId: id,
    cardData: {
      name: id,
      type_line: typeLine,
      cmc: 1,
      mana_cost: "{1}",
    } as any,
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId: AI,
    ownerId: AI,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: false,
  } as unknown as CardInstance;
}

function buildTurnState(): EngineGameState {
  const cards = new Map<string, CardInstance>();
  cards.set("c1", mkCard("c1", "Creature — Human"));
  cards.set("c2", mkCard("c2", "Creature — Human"));

  const zones = new Map<string, { cardIds: CardInstanceId[] }>();
  zones.set(`${AI}-hand`, { cardIds: ["c1"] });
  zones.set(`${AI}-battlefield`, { cardIds: ["c2"] });
  zones.set(`${AI}-library`, { cardIds: [] });
  zones.set(`${OPP}-battlefield`, { cardIds: [] });

  const players = new Map<PlayerId, unknown>();
  players.set(AI, { id: AI });
  players.set(OPP, { id: OPP });

  const turn: Turn = {
    activePlayerId: AI,
    currentPhase: "untap" as any,
    turnNumber: 3,
    extraTurns: 0,
    isFirstTurn: false,
    startedAt: 0,
  };

  return {
    cards,
    zones,
    players,
    turn,
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    } as any,
    priorityPlayerId: AI,
  } as unknown as EngineGameState;
}

function baseConfig(overrides: Partial<AITurnConfig> = {}): AITurnConfig {
  return {
    difficulty: "medium",
    delayMs: 0,
    archetype: "midrange",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  canPlayLandMock.mockReturnValue(true);
  playLandMock.mockImplementation((state: any) => ({ success: true, state }));
  canCastSpellMock.mockReturnValue({ canCast: true });
  castSpellMock.mockImplementation((state: any) => ({ success: true, state }));
  declareAttackersMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  tapCardActionMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  untapCardActionMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  passPriorityMock.mockImplementation((state: any) => state);
  drawCardMock.mockImplementation((state: any) => state);
  discardCardsMock.mockImplementation((state: any) => ({
    success: true,
    state,
    description: "",
  }));
  advancePhaseMock.mockImplementation((turn: any) => ({
    ...turn,
    currentPhase: "next",
  }));
  engineToAIStateMock.mockReturnValue({});
  getMaxHandSizeMock.mockReturnValue(7);
  mockAttackPlan = { attacks: [] };
});

afterEach(() => {
  _resetEvaluatorClientResolver();
});

describe("runAITurn offloads evaluation to the AI worker (issue #1244)", () => {
  it("awaits the worker client when a swing tracker is configured", async () => {
    const analyzeMock = jest
      .fn<Promise<DetailedEvaluation | null>, []>()
      .mockResolvedValue({
        totalScore: 2.5,
        factors: {} as any,
        threats: [],
        opportunities: [],
        recommendedActions: [],
      });
    const fakeClient: GameStateEvaluatorWorkerClient = {
      analyzeGameState: analyzeMock,
      quickScore: jest.fn(),
    };
    _setEvaluatorClientResolver(async () => fakeClient);

    const result = await runAITurn(
      buildTurnState(),
      AI,
      baseConfig({ swingTracker: new BoardSwingTracker() }),
    );

    if (!result.success) {
      // Surface the error to the test output so failures are debuggable.
      console.error("runAITurn failed:", result.error);
    }
    expect(result.success).toBe(true);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    // The bridge forwards (gameState, playerId, difficulty, archetype).
    expect(analyzeMock).toHaveBeenCalledWith(
      {}, // engineToAIStateMock returns {}
      AI,
      "medium",
      "midrange",
    );
  });

  it("does not invoke the worker when no swing tracker is configured", async () => {
    const analyzeMock = jest
      .fn<Promise<DetailedEvaluation | null>, []>()
      .mockResolvedValue(null);
    const fakeClient: GameStateEvaluatorWorkerClient = {
      analyzeGameState: analyzeMock,
      quickScore: jest.fn(),
    };
    _setEvaluatorClientResolver(async () => fakeClient);

    const result = await runAITurn(buildTurnState(), AI, baseConfig());

    expect(result.success).toBe(true);
    // No swing tracker → no adaptive evaluation → bridge is never called.
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("falls back to main-thread evaluation when the worker resolves to null", async () => {
    // Simulate SSR/jsdom: client resolves to null → bridge falls back to the
    // synchronous `evaluateGameState` on the main thread. The turn loop must
    // still succeed and produce a stable result.
    _setEvaluatorClientResolver(async () => null);

    const mainThreadSpy = jest.spyOn(
      gameStateEvaluator,
      "evaluateGameState",
    );

    const result = await runAITurn(
      buildTurnState(),
      AI,
      baseConfig({ swingTracker: new BoardSwingTracker() }),
    );

    expect(result.success).toBe(true);
    expect(mainThreadSpy).toHaveBeenCalled();
    mainThreadSpy.mockRestore();
  });

  it("falls back to main-thread evaluation when the worker throws", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const throwingClient: GameStateEvaluatorWorkerClient = {
      analyzeGameState: jest
        .fn()
        .mockRejectedValue(new Error("worker crashed")),
      quickScore: jest.fn(),
    };
    _setEvaluatorClientResolver(async () => throwingClient);

    const mainThreadSpy = jest.spyOn(
      gameStateEvaluator,
      "evaluateGameState",
    );

    const result = await runAITurn(
      buildTurnState(),
      AI,
      baseConfig({ swingTracker: new BoardSwingTracker() }),
    );

    expect(result.success).toBe(true);
    expect(mainThreadSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    mainThreadSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
void ({} as AIGameState);