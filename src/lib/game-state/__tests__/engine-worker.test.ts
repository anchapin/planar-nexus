/**
 * Engine worker tests (issue #2417, slice 1).
 *
 * Covers the three pieces of the slice:
 *  - the worker handler, exercised directly (no real Worker): init holds an
 *    authoritative state, dispatch applies actions through the public
 *    engine API, a rejected action returns the error envelope and leaves
 *    the held state untouched;
 *  - the state codec: the snapshot strips the non-cloneable fields and
 *    decoding re-creates real manager instances;
 *  - the client: id-matched request/response over a fake transport
 *    (including out-of-order delivery and unknown-id drops), error
 *    envelopes rejecting the pending promise, terminate() rejecting
 *    pending requests, and the in-process fallback used when no Worker
 *    global exists.
 */

import { createInitialGameState } from "../game-state";
import { createEngineWorkerHandler } from "../engine-worker";
import {
  cloneEngineStateSnapshot,
  fromEngineStateSnapshot,
  toEngineStateSnapshot,
} from "../engine-worker-state";
import {
  EngineWorkerClient,
  type EngineWorkerTransport,
} from "../engine-worker-client";
import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
} from "../engine-worker-types";
import type { GameState } from "../types/game";
import type { PlayerId } from "../types/players";

function freshGame(): { state: GameState; playerId: PlayerId } {
  const state = createInitialGameState(["Alice", "Bob"], 20);
  return { state, playerId: state.turn.activePlayerId };
}

function lifeOf(state: GameState, playerId: PlayerId): number {
  const player = state.players.get(playerId);
  if (!player) throw new Error("player missing");
  return player.life;
}

/** Transport that runs a real handler and delivers responses async. */
function createHandlerTransport(): EngineWorkerTransport {
  const handler = createEngineWorkerHandler();
  const listeners = new Set<(event: { data?: unknown }) => void>();
  return {
    postMessage(message: EngineWorkerRequest) {
      const response = handler.handleRequest(message);
      setTimeout(() => {
        listeners.forEach((listener) => listener({ data: response }));
      }, 0);
    },
    addEventListener(
      type: "message" | "error",
      listener: (event: { data?: unknown; message?: string }) => void,
    ) {
      if (type === "message") {
        listeners.add(listener as (event: { data?: unknown }) => void);
      }
    },
    terminate() {},
  };
}

/** Wait until the transport has recorded at least `count` requests. */
async function waitForRequests(
  transport: ManualTransport,
  count: number,
): Promise<void> {
  for (let i = 0; i < 50 && transport.requests.length < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (transport.requests.length < count) {
    throw new Error(
      `expected ${count} requests, saw ${transport.requests.length}`,
    );
  }
}

/** Transport that records requests; the test delivers responses manually. */
class ManualTransport implements EngineWorkerTransport {
  readonly requests: EngineWorkerRequest[] = [];
  private readonly listeners = new Set<(event: { data?: unknown }) => void>();

  postMessage(message: EngineWorkerRequest): void {
    this.requests.push(message);
  }

  addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void {
    if (type === "message") {
      this.listeners.add(listener as (event: { data?: unknown }) => void);
    }
  }

  respond(response: EngineWorkerResponse): void {
    this.listeners.forEach((listener) => listener({ data: response }));
  }

  terminate(): void {}
}

describe("engine worker handler", () => {
  it("rejects dispatch before init with an error envelope", () => {
    const handler = createEngineWorkerHandler();
    const { playerId } = freshGame();
    const response = handler.handleRequest({
      id: 1,
      type: "dispatch",
      action: { type: "gain_life", playerId, amount: 3 },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.id).toBe(1);
      expect(response.error.name).toBe("EngineActionError");
      expect(response.error.message).toMatch(/init/);
    }
    expect(handler.getState()).toBeNull();
  });

  it("init holds the state and dispatch applies actions to it", () => {
    const handler = createEngineWorkerHandler();
    const { state, playerId } = freshGame();

    const initResponse = handler.handleRequest({
      id: 1,
      type: "init",
      state: toEngineStateSnapshot(state),
    });
    expect(initResponse.ok).toBe(true);
    expect(handler.getState()).not.toBeNull();

    const gainResponse = handler.handleRequest({
      id: 2,
      type: "dispatch",
      action: { type: "gain_life", playerId, amount: 5 },
    });
    expect(gainResponse.ok).toBe(true);
    if (gainResponse.ok) {
      expect(
        lifeOf(fromEngineStateSnapshot(gainResponse.state), playerId),
      ).toBe(25);
    }

    const damageResponse = handler.handleRequest({
      id: 3,
      type: "dispatch",
      action: { type: "deal_damage", playerId, amount: 3 },
    });
    expect(damageResponse.ok).toBe(true);
    const held = handler.getState();
    expect(held).not.toBeNull();
    if (held) {
      expect(lifeOf(held, playerId)).toBe(22);
    }
  });

  it("a rejected action returns the error envelope and leaves the held state untouched", () => {
    const handler = createEngineWorkerHandler();
    const { state, playerId } = freshGame();
    handler.handleRequest({
      id: 1,
      type: "init",
      state: toEngineStateSnapshot(state),
    });
    const before = handler.getState();

    const response = handler.handleRequest({
      id: 2,
      type: "dispatch",
      action: {
        type: "play_land",
        playerId,
        cardId: "no-such-card" as never,
      },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.message.length).toBeGreaterThan(0);
    }
    // The held reference is only replaced after a successful action.
    expect(handler.getState()).toBe(before);
  });

  it("a malformed request returns an unmatched error envelope instead of throwing", () => {
    const handler = createEngineWorkerHandler();
    const response = handler.handleRequest(
      undefined as unknown as EngineWorkerRequest,
    );
    expect(response.ok).toBe(false);
    expect(response.id).toBe(-1);
    if (!response.ok) {
      expect(response.error.message).toMatch(/Malformed/);
    }
  });

  it("reset drops the held state", () => {
    const handler = createEngineWorkerHandler();
    const { state, playerId } = freshGame();
    handler.handleRequest({
      id: 1,
      type: "init",
      state: toEngineStateSnapshot(state),
    });
    handler.reset();
    expect(handler.getState()).toBeNull();
    const response = handler.handleRequest({
      id: 2,
      type: "dispatch",
      action: { type: "gain_life", playerId, amount: 1 },
    });
    expect(response.ok).toBe(false);
  });
});

describe("engine state codec", () => {
  it("snapshot strips the non-cloneable fields and decoding re-creates the managers", () => {
    const { state } = freshGame();
    const snapshot = toEngineStateSnapshot(state);
    expect("replacementEffectManager" in snapshot).toBe(false);
    expect("layerSystem" in snapshot).toBe(false);
    expect("random" in snapshot).toBe(false);

    const rebuilt = fromEngineStateSnapshot(snapshot);
    expect(typeof rebuilt.replacementEffectManager.createAPNAPOrder).toBe(
      "function",
    );
    expect(rebuilt.layerSystem).toBeDefined();
    expect(rebuilt.players).toBeInstanceOf(Map);
  });

  it("clone produces an independent copy of the Maps", () => {
    const { state, playerId } = freshGame();
    const snapshot = toEngineStateSnapshot(state);
    const copy = cloneEngineStateSnapshot(snapshot);
    const copiedPlayer = copy.players.get(playerId);
    if (!copiedPlayer) throw new Error("player missing in copy");
    copiedPlayer.life = 7;
    expect(lifeOf(state, playerId)).toBe(20);
  });
});

describe("engine worker client (fake transport)", () => {
  it("init + dispatch round-trip resolves with the resulting state", async () => {
    const client = EngineWorkerClient.create({
      transportFactory: () => createHandlerTransport(),
    });
    const { state, playerId } = freshGame();

    const initialised = await client.init(state);
    expect(client.getStatus()).toBe("ready");
    expect(client.isWorkerActive()).toBe(true);
    expect(lifeOf(initialised, playerId)).toBe(20);

    const after = await client.dispatch({
      type: "gain_life",
      playerId,
      amount: 4,
    });
    expect(lifeOf(after, playerId)).toBe(24);
    // The client rebuilds a live GameState (real manager instances).
    expect(typeof after.replacementEffectManager.createAPNAPOrder).toBe(
      "function",
    );
    client.terminate();
  });

  it("an error envelope rejects the dispatch promise with the engine error", async () => {
    const client = EngineWorkerClient.create({
      transportFactory: () => createHandlerTransport(),
    });
    const { state, playerId } = freshGame();
    await client.init(state);

    await expect(
      client.dispatch({
        type: "play_land",
        playerId,
        cardId: "no-such-card" as never,
      }),
    ).rejects.toMatchObject({ name: "EngineActionError" });
    client.terminate();
  });

  it("matches out-of-order responses to pending requests by id", async () => {
    const handler = createEngineWorkerHandler();
    const transport = new ManualTransport();
    const client = EngineWorkerClient.create({
      transportFactory: () => transport,
    });
    const { state, playerId } = freshGame();

    const initPromise = client.init(state);
    await waitForRequests(transport, 1);
    const initRequest = transport.requests[0];
    transport.respond(handler.handleRequest(initRequest));
    await initPromise;

    const first = client.dispatch({
      type: "gain_life",
      playerId,
      amount: 1,
    });
    const second = client.dispatch({
      type: "gain_life",
      playerId,
      amount: 2,
    });
    const [, firstRequest, secondRequest] = transport.requests;
    const firstResponse = handler.handleRequest(firstRequest);
    const secondResponse = handler.handleRequest(secondRequest);

    // Deliver in reverse order: id matching, not arrival order, must win.
    transport.respond(secondResponse);
    transport.respond(firstResponse);

    await expect(second).resolves.toMatchObject({});
    const secondState = await second;
    expect(lifeOf(secondState, playerId)).toBe(23);
    const firstState = await first;
    expect(lifeOf(firstState, playerId)).toBe(21);
    client.terminate();
  });

  it("drops responses with an unknown id instead of throwing", async () => {
    const handler = createEngineWorkerHandler();
    const transport = new ManualTransport();
    const client = EngineWorkerClient.create({
      transportFactory: () => transport,
    });
    const { state } = freshGame();

    const initPromise = client.init(state);
    await waitForRequests(transport, 1);
    transport.respond({
      id: 9999,
      ok: true,
      state: toEngineStateSnapshot(state),
    });
    transport.respond(handler.handleRequest(transport.requests[0]));
    const initialised = await initPromise;
    expect(initialised.gameId).toBe(state.gameId);
    client.terminate();
  });

  it("terminate rejects pending requests", async () => {
    const transport = new ManualTransport();
    const client = EngineWorkerClient.create({
      transportFactory: () => transport,
    });
    const { state, playerId } = freshGame();

    const initPromise = client.init(state);
    const handler = createEngineWorkerHandler();
    await waitForRequests(transport, 1);
    transport.respond(handler.handleRequest(transport.requests[0]));
    await initPromise;

    const pending = client.dispatch({
      type: "gain_life",
      playerId,
      amount: 1,
    });
    const assertion = expect(pending).rejects.toThrow(/terminated/);
    client.terminate();
    await assertion;
  });
});

describe("engine worker client (in-process fallback)", () => {
  it("falls back when the transport factory returns null and keeps the caller's state unmutated", async () => {
    const client = EngineWorkerClient.create({
      transportFactory: () => null,
    });
    const { state, playerId } = freshGame();

    await client.init(state);
    expect(client.getStatus()).toBe("fallback");
    expect(client.isWorkerActive()).toBe(false);

    const after = await client.dispatch({
      type: "gain_life",
      playerId,
      amount: 6,
    });
    expect(lifeOf(after, playerId)).toBe(26);
    // The fallback clones on init, so the caller's object is untouched.
    expect(lifeOf(state, playerId)).toBe(20);
    client.terminate();
  });
});
