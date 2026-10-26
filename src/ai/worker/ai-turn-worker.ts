/**
 * @fileoverview AI-opponent Web Worker (planar-nexus issue #2417, slice 2).
 *
 * The worker plays **one AI turn** off the main thread: it receives the
 * engine state, runs the AI turn loop (`../ai-turn-loop.ts`) inside the
 * worker thread, and returns the state the turn ended in. Both the AI
 * decision work *and* the rules-engine calls the turn makes therefore
 * happen off the main thread.
 *
 * Why this worker lives under `src/ai/` and not next to the rules-engine
 * worker (slice 1):
 *
 *   - The rules engine is self-contained (issue #1724): files under
 *     `src/lib/game-state/**` may not import application code, so the
 *     engine worker could never import the AI turn loop.
 *   - The reverse direction is banned too (issue #1710): application code
 *     may only reach the engine through its public barrel
 *     (`@/lib/game-state`). This worker honours that — the turn loop
 *     imports the engine through the barrel, and so does this module.
 *
 * Protocol: see `ai-turn-worker-types.ts`. The worker is a plain object
 * with a `handleRequest()` method so Jest can exercise it directly — no
 * real `Worker` required — exactly like `engine-worker.ts` exposes
 * `createEngineWorkerHandler()`.
 *
 * The handler is **async** (slice 1's engine handler is synchronous): an
 * AI turn is an async pipeline (phase delays, worker-backed evaluation),
 * so the request/response cycle is asynchronous too.
 */

import { cardScriptsLoaded, loadCardScripts, type GameState } from "@/lib/game-state";

import { runAITurn, type AITurnConfig } from "../ai-turn-loop";
import { fromAITurnStateSnapshot, toAITurnStateSnapshot } from "./ai-turn-worker-state";
import type {
  AITurnWorkerCommentaryEvent,
  AITurnWorkerRequest,
  AITurnWorkerResponse,
} from "./ai-turn-worker-types";

/**
 * Raised when the worker is asked to do something it cannot (an unknown
 * request type). The message is what the main thread sees in the error
 * envelope, mirroring slice 1's `EngineActionError` contract.
 */
export class AITurnWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AITurnWorkerError";
  }
}

/**
 * The worker surface. `handleRequest` is the single entry point used by
 * the `message` listener below and by the in-process fallback.
 */
export interface AITurnWorkerHandler {
  /** Apply one protocol request and return the matching response. */
  handleRequest(request: AITurnWorkerRequest): Promise<AITurnWorkerResponse>;
}

/** Sink for messages the worker wants to push to the main thread. */
export type AITurnWorkerPost = (message: unknown) => void;

/**
 * Make sure the card-script index is available inside the worker.
 *
 * Card scripts load in their own chunk (issue #1814) and the *page* awaits
 * `loadCardScripts()` before a game starts — but a worker thread has its
 * own module registry, so the index has to be loaded again there. Without
 * it every card would read as unscripted and the AI's turn would be played
 * against a subtly different rules engine than the main thread sees.
 *
 * The load is best-effort: in Jest the index is registered synchronously by
 * `jest.setup.js` (so this is a no-op), and in an environment without the
 * generated chunk the turn still runs — it just sees unscripted cards.
 */
async function ensureCardScripts(): Promise<void> {
  if (cardScriptsLoaded()) return;
  try {
    await loadCardScripts();
  } catch {
    /* best effort — the turn still runs with unscripted cards */
  }
}

/**
 * Create an isolated worker handler.
 *
 * `post` is the sink for out-of-band messages (currently only commentary
 * lines). The worker entry point passes the worker's `postMessage`; tests
 * and the in-process fallback can omit it (commentary is then dropped).
 */
export function createAITurnWorkerHandler(
  post?: AITurnWorkerPost,
): AITurnWorkerHandler {
  const errorResponse = (
    id: number,
    error: unknown,
  ): AITurnWorkerResponse => ({
    id,
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    },
  });

  return {
    async handleRequest(
      request: AITurnWorkerRequest,
    ): Promise<AITurnWorkerResponse> {
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
            name: "AITurnWorkerError",
            message:
              "Malformed AI turn worker request: missing numeric id",
          },
        };
      }

      try {
        if (request.type !== "ai_turn") {
          throw new AITurnWorkerError(
            `Unsupported AI turn worker request: ${String(
              (request as { type?: unknown }).type,
            )}`,
          );
        }

        await ensureCardScripts();

        const state: GameState = fromAITurnStateSnapshot(request.state);

        // The caller's `onCommentary` callback cannot cross the worker
        // boundary, so the worker emits the text as an event and the client
        // re-dispatches it to the callback on the main thread.
        const emitCommentary = (text: string): void => {
          if (!post) return;
          const event: AITurnWorkerCommentaryEvent = {
            id: request.id,
            type: "commentary",
            text,
          };
          post(event);
        };

        const config: AITurnConfig = {
          ...request.config,
          onCommentary: emitCommentary,
        };

        const result = await runAITurn(
          state,
          request.aiPlayerId,
          config,
        );

        return {
          id: request.id,
          ok: true,
          state: toAITurnStateSnapshot(result.finalState ?? state),
          result: {
            success: result.success,
            actionsTaken: result.actionsTaken,
            error: result.error,
            phase: result.phase,
            nextOpponentBluffHistory: result.nextOpponentBluffHistory,
            opponentBluffSignals: result.opponentBluffSignals,
          },
        };
      } catch (error) {
        return errorResponse(request.id, error);
      }
    },
  };
}

/**
 * Minimal shape of the worker global we rely on. Declared locally so the
 * module stays importable from Node / jsdom (where `self` is the window and
 * has no worker-only semantics).
 */
interface AITurnWorkerScope {
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
 * `self`), which is what separates the two environments.
 */
function getWorkerScope(): AITurnWorkerScope | null {
  if (typeof self === "undefined") return null;
  if (typeof window !== "undefined") return null;
  if (typeof self.postMessage !== "function") return null;
  return self as unknown as AITurnWorkerScope;
}

// Worker entry point. The protocol is a plain id-keyed request/response
// envelope (see `ai-turn-worker-types.ts`), which keeps the AI turn
// transport dependency-free and directly testable.
const workerScope = getWorkerScope();
if (workerScope) {
  const handler = createAITurnWorkerHandler((message) => {
    workerScope.postMessage(message);
  });
  workerScope.addEventListener("message", (event) => {
    void handler
      .handleRequest(event.data as AITurnWorkerRequest)
      .then((response) => {
        workerScope.postMessage(response);
      });
  });
}
