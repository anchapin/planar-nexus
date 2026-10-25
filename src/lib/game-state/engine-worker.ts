/**
 * @fileoverview Rules-engine Web Worker (issue #2417, slice 1).
 *
 * The worker owns an authoritative `GameState` and applies incoming actions
 * to it through the engine's **public barrel API** (`@/lib/game-state`) —
 * the same functions the main thread calls today (`playLand`,
 * `tapCardAction`, `passPriority`, `dealDamageToPlayer`, …). Because the
 * worker only ever calls public entry points, moving the game loop off the
 * main thread cannot change the rules outcome; it only changes *where* the
 * rules run.
 *
 * Why the worker lives inside the engine folder: the engine's only public
 * API is its barrel (`src/lib/game-state/index.ts`) and ESLint forbids deep
 * imports from outside the engine (#1710 / #1925). A worker that has to
 * call the barrel therefore has to live next to it. The transport modules
 * follow the repo's established worker split (mirroring
 * `src/lib/search/search.worker.ts` + `search-worker-client.ts` +
 * `search-worker-factory.ts`): worker + client + factory sit side by side.
 *
 * The handler is a plain object with a `handleRequest()` method so Jest can
 * exercise it directly — no real `Worker` required — exactly like
 * `search.worker.ts` exposes `searchWorker` and `ai-worker.ts` exposes
 * `aiWorker`.
 *
 * Protocol: see `engine-worker-types.ts`.
 */

import {
  checkStateBasedActionsFromGameState,
  concede,
  dealDamageToPlayer,
  declareAttackers,
  declareBlockers,
  drawCard,
  gainLife,
  passPriority,
  playLand,
  tapCardAction,
  untapCardAction,
} from "@/lib/game-state";
import type { CardInstanceId, GameState } from "@/lib/game-state";

import {
  fromEngineStateSnapshot,
  toEngineStateSnapshot,
} from "./engine-worker-state";
import type {
  EngineWorkerAction,
  EngineWorkerRequest,
  EngineWorkerResponse,
} from "./engine-worker-types";

/**
 * Raised when the rules reject an action (the engine returned
 * `success: false`) or when the worker is asked to act before it holds a
 * state. The message is the engine's own message so the main thread sees
 * the same information it would have seen before the move.
 */
export class EngineActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineActionError";
  }
}

/**
 * The worker surface. `handleRequest` is the single entry point used by
 * the `message` listener below and by the in-process fallback.
 */
export interface EngineWorkerHandler {
  /** Apply one protocol request and return the matching response. */
  handleRequest(request: EngineWorkerRequest): EngineWorkerResponse;
  /** The authoritative state the worker currently holds (null before init). */
  getState(): GameState | null;
  /** Drop the held state (used by teardown and by tests). */
  reset(): void;
}

/**
 * Apply one action to the held state through the public engine API.
 *
 * Throws {@link EngineActionError} when the rules reject the action; engine
 * errors that throw propagate unchanged so the caller sees the original
 * engine error (message *and* error class).
 */
function applyEngineAction(
  state: GameState,
  action: EngineWorkerAction,
): GameState {
  switch (action.type) {
    case "play_land": {
      const result = playLand(state, action.playerId, action.cardId);
      if (!result.success) {
        throw new EngineActionError(
          result.error ?? "play_land was rejected by the rules engine",
        );
      }
      return result.state;
    }
    case "tap_card": {
      const result = tapCardAction(state, action.cardId);
      if (!result.success) {
        throw new EngineActionError(
          result.error ?? `tap_card was rejected by the rules engine`,
        );
      }
      return result.state;
    }
    case "untap_card": {
      const result = untapCardAction(state, action.cardId);
      if (!result.success) {
        throw new EngineActionError(
          result.error ?? `untap_card was rejected by the rules engine`,
        );
      }
      return result.state;
    }
    case "draw_card":
      return drawCard(state, action.playerId);
    case "pass_priority":
      return passPriority(state, action.playerId);
    case "deal_damage":
      return dealDamageToPlayer(state, action.playerId, action.amount);
    case "gain_life":
      return gainLife(state, action.playerId, action.amount);
    case "concede":
      return concede(state, action.playerId);
    case "declare_attackers": {
      const result = declareAttackers(state, action.attackers);
      if (!result.success) {
        throw new EngineActionError(
          result.errors?.join("; ") ||
            "declare_attackers was rejected by the rules engine",
        );
      }
      return result.state;
    }
    case "declare_blockers": {
      const assignments = new Map<CardInstanceId, CardInstanceId[]>();
      for (const blocker of action.blockers) {
        const existing = assignments.get(blocker.cardId);
        if (existing) {
          existing.push(blocker.attackerId);
        } else {
          assignments.set(blocker.cardId, [blocker.attackerId]);
        }
      }
      const result = declareBlockers(state, assignments);
      if (!result.success) {
        throw new EngineActionError(
          result.errors?.join("; ") ||
            "declare_blockers was rejected by the rules engine",
        );
      }
      return result.state;
    }
    case "check_state_based_actions":
      return checkStateBasedActionsFromGameState(state);
    default: {
      const unknown = action as { type?: string };
      throw new EngineActionError(
        `Unsupported engine action: ${String(unknown.type)}`,
      );
    }
  }
}

/**
 * Create an isolated worker handler.
 *
 * Each handler owns its own authoritative state, so tests can create several
 * without them sharing state.
 */
export function createEngineWorkerHandler(): EngineWorkerHandler {
  let state: GameState | null = null;

  const errorResponse = (id: number, error: unknown): EngineWorkerResponse => ({
    id,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  });

  return {
    handleRequest(request: EngineWorkerRequest): EngineWorkerResponse {
      // A malformed message (no numeric id) can never be answered with a
      // matched response; return an error envelope with the unmatched id
      // -1 (clients drop unknown ids) instead of throwing — a real worker
      // must survive garbage on its message port.
      if (
        !request ||
        typeof request !== "object" ||
        typeof (request as { id?: unknown }).id !== "number"
      ) {
        return {
          id: -1,
          ok: false,
          error: {
            name: "EngineActionError",
            message: "Malformed engine worker request: missing numeric id",
          },
        };
      }

      try {
        if (request.type === "init") {
          state = fromEngineStateSnapshot(request.state);
          return {
            id: request.id,
            ok: true,
            state: toEngineStateSnapshot(state),
          };
        }

        if (request.type === "dispatch") {
          if (!state) {
            throw new EngineActionError(
              "Engine worker has no state — send an init request first",
            );
          }
          // The engine functions return the next state; the held reference
          // is replaced only after the action succeeded, so a rejected or
          // throwing action leaves the authoritative state untouched.
          const next = applyEngineAction(state, request.action);
          state = next;
          return {
            id: request.id,
            ok: true,
            state: toEngineStateSnapshot(state),
          };
        }

        throw new EngineActionError(
          `Unsupported engine worker request: ${String(
            (request as { type?: string }).type,
          )}`,
        );
      } catch (error) {
        return errorResponse(request.id, error);
      }
    },

    getState(): GameState | null {
      return state;
    },

    reset(): void {
      state = null;
    },
  };
}

/**
 * Minimal shape of the worker global we rely on. Declared locally so the
 * module stays importable from Node / jsdom (where `self` is the window and
 * has no worker-only semantics).
 */
interface EngineWorkerScope {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}

/**
 * Return the worker global when — and only when — this module is running
 * inside a real Web Worker.
 *
 * The check matters: in jsdom (Jest) and in the browser `self` also exists
 * and even has `postMessage`, so a naive guard would install a message
 * listener on the page. A dedicated worker has no `window` object (it has
 * `self`), which is what separates the two environments without pulling in
 * the WebWorker TypeScript lib (it conflicts with the DOM lib).
 */
function getWorkerScope(): EngineWorkerScope | null {
  if (typeof self === "undefined") return null;
  if (typeof window !== "undefined") return null;
  if (typeof self.postMessage !== "function") return null;
  return self as unknown as EngineWorkerScope;
}

// Worker entry point. `Comlink` is deliberately not used: the protocol is a
// plain id-keyed request/response envelope (see `engine-worker-types.ts`),
// which keeps the engine free of a transport dependency and makes the
// protocol directly testable.
const workerScope = getWorkerScope();
if (workerScope) {
  const handler = createEngineWorkerHandler();
  workerScope.addEventListener("message", (event) => {
    const response = handler.handleRequest(event.data as EngineWorkerRequest);
    workerScope.postMessage(response);
  });
}
