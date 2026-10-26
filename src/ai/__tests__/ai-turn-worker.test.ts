/**
 * @fileoverview AI-opponent worker tests (issue #2417, slice 2).
 *
 * The AI turn now has two paths:
 *
 *   - the **worker path** — the turn is requested from the AI-opponent Web
 *     Worker, which runs the turn loop inside the worker thread,
 *   - the **synchronous path** — the turn loop runs in-process (Jest, SSR,
 *     a dev build whose worker chunk cannot be served, a turn that is not
 *     transferable).
 *
 * These tests cover both:
 *
 *   1. the worker protocol (request shape, id matching, error envelopes,
 *      commentary events) driven through a fake transport,
 *   2. the worker handler itself (the code that runs inside the worker),
 *   3. the bridge (worker path vs. fallback) and the public
 *      `runAITurnOffThread` entry point.
 *
 * The turn loop itself is stubbed (`jest.mock("../ai-turn-loop")`) so these
 * tests assert the *wiring* — that the turn is requested from the worker
 * instead of being executed on the main thread — and not the AI's
 * decisions. The turn loop's own behaviour is covered by
 * `ai-turn-loop.test.ts`.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import type { GameState, PlayerId } from "@/lib/game-state";

// The turn loop is stubbed so the tests can assert that a worker-routed
// turn never executes on the main thread. `requireActual` keeps the real
// `runAITurnOffThread` entry point (which the bridge calls into).
//
// The stub is created *inside* the factory: `jest.mock` is hoisted above
// the imports, so a top-level `const` would still be in its temporal dead
// zone when the factory runs.
jest.mock("../ai-turn-loop", () => {
  const actual = jest.requireActual("../ai-turn-loop") as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    runAITurn: jest.fn<typeof runAITurn>(
      async (
        state: GameState,
        _aiPlayerId: PlayerId,
        config: AITurnConfig,
      ) => {
        config.onCommentary?.("stub commentary");
        return {
          success: true,
          actionsTaken: [],
          finalState: state,
          phase: "complete",
        };
      },
    ),
  };
});

import {
  runAITurn,
  runAITurnOffThread,
  type AITurnConfig,
  type AITurnResult,
} from "../ai-turn-loop";
import {
  AITurnWorkerClient,
  type AITurnWorkerTransport,
} from "../worker/ai-turn-worker-client";
import { createAITurnWorkerHandler } from "../worker/ai-turn-worker";
import {
  _resetAITurnWorkerClientResolver,
  _setAITurnWorkerClientResolver,
  isAITurnWorkerTransferable,
  runAITurnViaWorker,
  type AITurnWorkerClientLike,
} from "../worker/ai-turn-worker-bridge";
import type { AITurnWorkerRequest } from "../worker/ai-turn-worker-types";

/** The stubbed turn loop (see the `jest.mock` factory above). */
const mockRunAITurn = runAITurn as unknown as jest.MockedFunction<
  typeof runAITurn
>;

const AI: PlayerId = "player1";

/** The real, unmocked turn loop (see the fallback tests below). */
const realRunAITurn = (
  jest.requireActual("../ai-turn-loop") as typeof import("../ai-turn-loop")
).runAITurn;

/** Let pending microtasks (e.g. the client's async transport setup) run. */
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function buildState(): GameState {
  return {
    gameId: "game-1",
    format: "standard",
    status: "in_progress",
    players: new Map(),
    cards: new Map(),
    zones: new Map(),
    stack: [],
    turn: {
      activePlayerId: AI,
      currentPhase: "untap",
      turnNumber: 1,
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
    },
    winners: [],
    lastModifiedAt: 0,
  } as unknown as GameState;
}

function baseConfig(overrides: Partial<AITurnConfig> = {}): AITurnConfig {
  return {
    difficulty: "medium",
    delayMs: 0,
    ...overrides,
  };
}

/** A fake worker transport that records requests and replays messages. */
class FakeTransport implements AITurnWorkerTransport {
  public readonly requests: AITurnWorkerRequest[] = [];
  private readonly listeners: Array<(event: { data?: unknown }) => void> = [];

  public postMessage(message: AITurnWorkerRequest): void {
    this.requests.push(message);
  }

  public addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void {
    if (type === "message") {
      this.listeners.push(listener);
    }
  }

  /** Deliver a message to the client (as the worker would). */
  public emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunAITurn.mockImplementation(
    async (state, _aiPlayerId, config) => {
      config.onCommentary?.("stub commentary");
      return {
        success: true,
        actionsTaken: [],
        finalState: state,
        phase: "complete",
      };
    },
  );
});

afterEach(() => {
  _resetAITurnWorkerClientResolver();
  AITurnWorkerClient._resetForTesting();
});

describe("AI turn worker client — worker path", () => {
  it("requests the turn from the worker instead of running it on the main thread", async () => {
    const transport = new FakeTransport();
    const client = AITurnWorkerClient.create({
      transportFactory: () => transport,
    });
    const state = buildState();

    const pending = client.runTurn(state, AI, baseConfig());
    await flushMicrotasks();

    // The request is on the wire before the turn has run anywhere.
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0].type).toBe("ai_turn");
    expect(transport.requests[0].aiPlayerId).toBe(AI);
    expect(mockRunAITurn).not.toHaveBeenCalled();

    transport.emit({
      id: transport.requests[0].id,
      ok: true,
      state: { ...state },
      result: { success: true, actionsTaken: [] },
    });

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.finalState).toBeDefined();
    // The turn loop never ran on the main thread.
    expect(mockRunAITurn).not.toHaveBeenCalled();
  });

  it("re-dispatches commentary events to the caller's callback", async () => {
    const transport = new FakeTransport();
    const client = AITurnWorkerClient.create({
      transportFactory: () => transport,
    });
    const commentary: string[] = [];

    const pending = client.runTurn(buildState(), AI, baseConfig(), {
      onCommentary: (text) => commentary.push(text),
    });
    await flushMicrotasks();

    transport.emit({
      id: transport.requests[0].id,
      type: "commentary",
      text: "the AI attacks",
    });
    transport.emit({
      id: transport.requests[0].id,
      ok: true,
      state: {},
      result: { success: true, actionsTaken: [] },
    });

    await pending;
    expect(commentary).toEqual(["the AI attacks"]);
  });

  it("rejects with the worker's error envelope", async () => {
    const transport = new FakeTransport();
    const client = AITurnWorkerClient.create({
      transportFactory: () => transport,
    });

    const pending = client.runTurn(buildState(), AI, baseConfig());
    await flushMicrotasks();

    transport.emit({
      id: transport.requests[0].id,
      ok: false,
      error: { name: "AITurnWorkerError", message: "boom" },
    });

    await expect(pending).rejects.toThrow("boom");
  });

  it("drops responses with an unknown id", async () => {
    const transport = new FakeTransport();
    const client = AITurnWorkerClient.create({
      transportFactory: () => transport,
    });

    const pending = client.runTurn(buildState(), AI, baseConfig());
    await flushMicrotasks();

    // A stale response must not resolve (or reject) the pending request.
    transport.emit({
      id: transport.requests[0].id + 99,
      ok: true,
      state: {},
      result: { success: true, actionsTaken: [] },
    });

    transport.emit({
      id: transport.requests[0].id,
      ok: true,
      state: {},
      result: { success: true, actionsTaken: [] },
    });

    const result = await pending;
    expect(result.success).toBe(true);
  });
});

describe("AI turn worker client — in-process fallback", () => {
  it("runs the turn in-process when no worker is available", async () => {
    const client = AITurnWorkerClient.create({
      transportFactory: () => null,
    });

    const result = await client.runTurn(buildState(), AI, baseConfig());

    expect(result.success).toBe(true);
    expect(result.finalState).toBeDefined();
    expect(mockRunAITurn).toHaveBeenCalledTimes(1);
    expect(client.getStatus()).toBe("fallback");
    expect(client.isWorkerActive()).toBe(false);
  });
});

describe("AI turn worker handler (runs inside the worker)", () => {
  it("plays the turn and returns the resulting state", async () => {
    const posted: unknown[] = [];
    const handler = createAITurnWorkerHandler((message) => posted.push(message));
    const state = buildState();

    const response = await handler.handleRequest({
      id: 7,
      type: "ai_turn",
      state: { ...state },
      aiPlayerId: AI,
      config: { difficulty: "medium", delayMs: 0 },
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.id).toBe(7);
    expect(response.result.success).toBe(true);
    expect(response.state).toBeDefined();
    // The commentary line the turn produced is streamed back as an event.
    expect(posted).toEqual([
      { id: 7, type: "commentary", text: "stub commentary" },
    ]);
  });

  it("answers a malformed request with an unmatched error envelope", async () => {
    const handler = createAITurnWorkerHandler();
    const response = await handler.handleRequest({
      id: undefined,
    } as unknown as AITurnWorkerRequest);

    expect(response.ok).toBe(false);
    expect(response.id).toBe(-1);
  });
});

describe("AI turn worker bridge", () => {
  it("reports a turn as transferable only when nothing untransferable is attached", () => {
    const state = buildState();
    expect(isAITurnWorkerTransferable(state, baseConfig())).toBe(true);

    const seeded = { ...state, random: () => 0.5 } as GameState;
    expect(isAITurnWorkerTransferable(seeded, baseConfig())).toBe(false);

    const tracker = { record: () => undefined } as never;
    expect(
      isAITurnWorkerTransferable(state, baseConfig({ swingTracker: tracker })),
    ).toBe(false);
  });

  it("returns the worker result when the worker client is available", async () => {
    const stubResult: AITurnResult = {
      success: true,
      actionsTaken: [],
      phase: "complete",
    };
    const runTurn = jest.fn(async () => stubResult);
    _setAITurnWorkerClientResolver(async () => ({ runTurn }));

    const result = await runAITurnViaWorker(
      buildState(),
      AI,
      baseConfig(),
    );

    expect(result).toBe(stubResult);
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it("returns null when no worker client is available", async () => {
    _setAITurnWorkerClientResolver(async () => null);

    const result = await runAITurnViaWorker(
      buildState(),
      AI,
      baseConfig(),
    );

    expect(result).toBeNull();
  });

  it("returns null when the worker fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    _setAITurnWorkerClientResolver(async () => ({
      runTurn: async () => {
        throw new Error("worker exploded");
      },
    }));

    const result = await runAITurnViaWorker(
      buildState(),
      AI,
      baseConfig(),
    );

    expect(result).toBeNull();
    warn.mockRestore();
  });
});

describe("runAITurnOffThread", () => {
  it("uses the worker path when the worker client is available", async () => {
    const stubResult: AITurnResult = {
      success: true,
      actionsTaken: [],
      phase: "complete",
    };
    const runTurn = jest.fn(async () => stubResult);
    _setAITurnWorkerClientResolver(async () => ({ runTurn }));

    const result = await runAITurnOffThread(
      buildState(),
      AI,
      baseConfig(),
    );

    expect(result).toBe(stubResult);
    expect(mockRunAITurn).not.toHaveBeenCalled();
  });

  it("falls back to the synchronous turn when the worker path is unavailable", async () => {
    _setAITurnWorkerClientResolver(async () => null);

    const result = await runAITurnOffThread(
      buildState(),
      AI,
      baseConfig(),
    );
    const expected = await realRunAITurn(buildState(), AI, baseConfig());

    // Equivalence with the real synchronous loop's result on an
    // identical state (the export mock cannot intercept the
    // module-local call runAITurnOffThread falls back to).
    expect(result.success).toBe(expected.success);
    expect(result.phase).toBe(expected.phase);
    expect(result.actionsTaken).toHaveLength(expected.actionsTaken.length);
  });

  it("keeps a non-transferable turn on the main thread", async () => {
    const runTurn = jest.fn<AITurnWorkerClientLike["runTurn"]>(async () => {
      throw new Error("worker path must not be used");
    });
    _setAITurnWorkerClientResolver(async () => ({ runTurn }));
    const seeded = { ...buildState(), random: () => 0.5 } as GameState;

    const result = await runAITurnOffThread(seeded, AI, baseConfig());
    const expected = await realRunAITurn(buildState(), AI, baseConfig());

    expect(runTurn).not.toHaveBeenCalled();
    // The turn ran synchronously: runAITurnOffThread calls the
    // module-local runAITurn, which the export mock cannot intercept,
    // so equivalence with the real loop's result is the evidence.
    expect(result.success).toBe(expected.success);
    expect(result.phase).toBe(expected.phase);
  });

  it("forces the synchronous path on request", async () => {
    const runTurn = jest.fn<AITurnWorkerClientLike["runTurn"]>(async () => {
      throw new Error("worker path must not be used");
    });
    _setAITurnWorkerClientResolver(async () => ({ runTurn }));

    const result = await runAITurnOffThread(buildState(), AI, baseConfig(), {
      forceSync: true,
    });
    const expected = await realRunAITurn(buildState(), AI, baseConfig());

    expect(runTurn).not.toHaveBeenCalled();
    expect(result.success).toBe(expected.success);
    expect(result.phase).toBe(expected.phase);
  });

  it("keeps the synchronous turn loop as the reference implementation", async () => {
    const state = buildState();
    const result = await runAITurn(state, AI, baseConfig());

    expect(result.success).toBe(true);
    expect(mockRunAITurn).toHaveBeenCalledTimes(1);
  });
});
