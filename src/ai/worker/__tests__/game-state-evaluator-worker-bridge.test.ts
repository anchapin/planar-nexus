/**
 * Game-state-evaluator worker bridge tests (#1244)
 *
 * The bridge (`game-state-evaluator-worker-bridge.ts`) is the single seam
 * between the main thread and the AI Web Worker for game-state evaluation.
 * These tests cover the three required scenarios:
 *
 *  1. Client invocation — when a worker client is available, the bridge
 *     forwards to it and returns the worker's result (no main-thread compute).
 *  2. Fallback (no worker) — when the client resolves to null (e.g. jsdom, or
 *     `Worker` is undefined), the bridge computes on the main thread with
 *     results IDENTICAL to the direct evaluator.
 *  3. Fallback (worker error) — when the client throws (or returns null), the
 *     bridge falls back to main-thread compute identically.
 *
 * Plus the `quickScoreAsync` path, and that the default resolver degrades
 * gracefully to the fallback in jsdom (mirrors #1080 trigger-chain tests).
 */
import { describe, test, expect, afterEach } from "@jest/globals";

import {
  evaluateGameStateAsync,
  quickScoreAsync,
  _setEvaluatorClientResolver,
  _resetEvaluatorClientResolver,
  type GameStateEvaluatorWorkerClient,
} from "../game-state-evaluator-worker-bridge";
import {
  evaluateGameState,
  quickScore,
  type GameState,
  type DetailedEvaluation,
} from "../../game-state-evaluator";

function makeGameState(): GameState {
  return {
    players: {
      player1: {
        id: "player1",
        life: 20,
        poisonCounters: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        battlefield: [],
        hand: [],
        graveyard: [],
        exile: [],
        library: [],
        commandZone: [],
        landsPlayed: 0,
      },
      player2: {
        id: "player2",
        life: 18,
        poisonCounters: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        battlefield: [],
        hand: [],
        graveyard: [],
        exile: [],
        library: [],
        commandZone: [],
        landsPlayed: 0,
      },
    },
    turnInfo: {
      currentTurn: 3,
      currentPlayer: "player1",
      phase: "main1",
      activePlayerId: "player1",
    },
    stack: [],
    commandZone: [],
  } as unknown as GameState;
}

const gameState = makeGameState();
const mainThreadEvaluation: DetailedEvaluation = evaluateGameState(
  gameState,
  "player1",
  "medium",
);
const mainThreadScore: number = quickScore(gameState, "player1", "medium");

describe("game-state-evaluator-worker-bridge (#1244)", () => {
  afterEach(() => {
    _resetEvaluatorClientResolver();
  });

  describe("client invocation (worker path)", () => {
    test("forwards to the worker client and returns its result", async () => {
      const analyzeMock = jest
        .fn<Promise<DetailedEvaluation | null>, []>()
        .mockResolvedValue(mainThreadEvaluation);
      const fakeClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: analyzeMock,
        quickScore: jest.fn(),
      };
      _setEvaluatorClientResolver(async () => fakeClient);

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(mainThreadEvaluation);
      expect(analyzeMock).toHaveBeenCalledTimes(1);
      expect(analyzeMock).toHaveBeenCalledWith(
        gameState,
        "player1",
        "medium",
        undefined,
      );
    });

    test("does not recompute on the main thread when the worker succeeds", async () => {
      // Return a sentinel from the worker. If the bridge used the worker
      // result verbatim, the sentinel must surface (proving main-thread
      // compute did NOT run and overwrite it).
      const sentinel: DetailedEvaluation = {
        ...mainThreadEvaluation,
        totalScore: 999,
      };
      const fakeClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest.fn().mockResolvedValue(sentinel),
        quickScore: jest.fn(),
      };
      _setEvaluatorClientResolver(async () => fakeClient);

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(sentinel);
      expect(result.totalScore).not.toBe(mainThreadEvaluation.totalScore);
    });

    test("forwards archetype to the worker client", async () => {
      const analyzeMock = jest
        .fn<Promise<DetailedEvaluation | null>, []>()
        .mockResolvedValue(mainThreadEvaluation);
      _setEvaluatorClientResolver(async () => ({
        analyzeGameState: analyzeMock,
        quickScore: jest.fn(),
      }));

      await evaluateGameStateAsync(gameState, "player1", "hard", "aggro");

      expect(analyzeMock).toHaveBeenCalledWith(
        gameState,
        "player1",
        "hard",
        "aggro",
      );
    });
  });

  describe("fallback (worker unavailable)", () => {
    test("falls back to main-thread compute when client resolves to null", async () => {
      _setEvaluatorClientResolver(async () => null);

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(mainThreadEvaluation);
    });

    test("falls back when the client throws (worker error)", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest
          .fn()
          .mockRejectedValue(new Error("worker boom")),
        quickScore: jest.fn(),
      };
      _setEvaluatorClientResolver(async () => throwingClient);

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(mainThreadEvaluation);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    test("falls back when the worker returns null (no proxy)", async () => {
      const nullClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest.fn().mockResolvedValue(null),
        quickScore: jest.fn(),
      };
      _setEvaluatorClientResolver(async () => nullClient);

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(mainThreadEvaluation);
    });

    test("falls back when the resolver itself throws", async () => {
      _setEvaluatorClientResolver(async () => {
        throw new Error("resolver exploded");
      });

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(result).toEqual(mainThreadEvaluation);
    });

    test("fallback warning is emitted at most once across calls", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const throwingClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest
          .fn()
          .mockRejectedValue(new Error("worker boom")),
        quickScore: jest.fn(),
      };
      _setEvaluatorClientResolver(async () => throwingClient);

      await evaluateGameStateAsync(gameState, "player1", "medium");
      await evaluateGameStateAsync(gameState, "player1", "medium");
      await evaluateGameStateAsync(gameState, "player1", "medium");

      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe("quickScoreAsync", () => {
    test("forwards to the worker client", async () => {
      const quickScoreMock = jest.fn().mockResolvedValue(7.5);
      const fakeClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest.fn(),
        quickScore: quickScoreMock,
      };
      _setEvaluatorClientResolver(async () => fakeClient);

      const result = await quickScoreAsync(gameState, "player1", "medium");

      expect(result).toBe(7.5);
      expect(quickScoreMock).toHaveBeenCalledWith(
        gameState,
        "player1",
        "medium",
        undefined,
      );
    });

    test("falls back to main-thread quickScore when worker is unavailable", async () => {
      _setEvaluatorClientResolver(async () => null);

      const result = await quickScoreAsync(gameState, "player1", "medium");

      expect(result).toBe(mainThreadScore);
    });

    test("falls back when the worker returns null", async () => {
      const fakeClient: GameStateEvaluatorWorkerClient = {
        analyzeGameState: jest.fn(),
        quickScore: jest.fn().mockResolvedValue(null),
      };
      _setEvaluatorClientResolver(async () => fakeClient);

      const result = await quickScoreAsync(gameState, "player1", "medium");

      expect(result).toBe(mainThreadScore);
    });
  });

  describe("default resolver (jsdom has no Worker global)", () => {
    test("evaluateGameStateAsync degrades gracefully to the main-thread fallback", async () => {
      // Reset to the default resolver explicitly.
      _resetEvaluatorClientResolver();

      const result = await evaluateGameStateAsync(gameState, "player1", "medium");

      // jsdom provides no `Worker`, so the real client exposes no proxy and
      // the dynamic import path resolves to null → main-thread fallback.
      expect(result).toEqual(mainThreadEvaluation);
    });

    test("quickScoreAsync degrades gracefully to the main-thread fallback", async () => {
      _resetEvaluatorClientResolver();

      const result = await quickScoreAsync(gameState, "player1", "medium");

      expect(result).toBe(mainThreadScore);
    });
  });
});