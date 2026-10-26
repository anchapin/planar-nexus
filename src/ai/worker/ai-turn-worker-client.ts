/**
 * @fileoverview AI-opponent worker client (planar-nexus issue #2417, slice 2).
 *
 * Main-thread handle for the AI-opponent worker. It mirrors slice 1's
 * rules-engine worker client (`src/lib/game-state/engine-worker-client.ts`)
 * and adds the two things the AI turn transport needs:
 *
 *   - a **turn API**: `runTurn(state, aiPlayerId, config)` plays one AI
 *     turn inside the worker and resolves with the turn result (including
 *     the state the turn ended in).
 *   - an **in-process fallback**: when no `Worker` global exists (Jest,
 *     SSR, a blocked worker chunk) the very same worker handler runs
 *     in-process, so the existing test harness path keeps working and the
 *     UI never loses the AI because a worker could not start.
 *
 * The client speaks the id-keyed request/response protocol defined in
 * `ai-turn-worker-types.ts`:
 *
 *   - every request carries a unique id; every response echoes it back,
 *   - responses are matched to pending promises by id, so out-of-order
 *     responses resolve the right promise,
 *   - a response with an unknown id is dropped (late response, stale
 *     worker) instead of throwing,
 *   - an error envelope rejects the promise with the turn's own error,
 *   - commentary lines arrive as separate `{ id, type: "commentary" }`
 *     events and are re-dispatched to the caller's `onCommentary` callback
 *     so the UI keeps seeing the same commentary in the same order.
 */

import type { GameState, PlayerId } from "@/lib/game-state";

import type { AITurnConfig, AITurnResult } from "../ai-turn-loop";
import {
  cloneAITurnStateSnapshot,
  fromAITurnStateSnapshot,
  toAITurnStateSnapshot,
} from "./ai-turn-worker-state";
import type { AITurnWorkerHandler } from "./ai-turn-worker";
import type {
  AITurnWorkerCommentaryEvent,
  AITurnWorkerConfig,
  AITurnWorkerRequest,
  AITurnWorkerResponseMessage,
  AITurnWorkerSuccessResponse,
} from "./ai-turn-worker-types";

/** Lifecycle status of the client. */
export type AITurnWorkerStatus =
  /** No transport has been requested yet. */
  | "idle"
  /** A real Web Worker is attached. */
  | "ready"
  /** Running in-process (no Worker global, or the worker could not start). */
  | "fallback"
  /** The transport could not be created because of an unexpected error. */
  | "error";

/**
 * The minimal transport surface the client needs. A real `Worker` satisfies
 * it; tests inject a fake transport to exercise the protocol without a
 * browser.
 */
export interface AITurnWorkerTransport {
  /** Send a request to the worker. */
  postMessage(message: AITurnWorkerRequest): void;
  /** Subscribe to worker messages (and worker errors). */
  addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
  /** Stop the worker. */
  terminate?(): void;
}

/** Factory used to build the transport (the real one lives in the factory module). */
export type AITurnWorkerTransportFactory = () => AITurnWorkerTransport | null;

/** Options accepted by {@link AITurnWorkerClient.create}. */
export interface AITurnWorkerClientOptions {
  /**
   * Inject a transport factory. Used by tests to drive the protocol with a
   * fake worker. When the factory returns `null` the client falls back to
   * the in-process handler.
   */
  transportFactory?: AITurnWorkerTransportFactory;
}

/** Options accepted by {@link AITurnWorkerClient.runTurn}. */
export interface AITurnRunTurnOptions {
  /**
   * Commentary sink. The worker cannot call a function on the main thread,
   * so commentary lines are streamed back as events and re-dispatched here.
   */
  onCommentary?: (text: string) => void;
}

interface PendingRequest {
  resolve: (response: AITurnWorkerSuccessResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Turn an error envelope back into a thrown error. The error's message
 * *and* class name are preserved so callers can tell a turn failure from a
 * transport failure.
 */
function toAITurnWorkerError(payload: {
  name?: string;
  message?: string;
}): Error {
  const error = new Error(
    payload.message ?? "AI turn worker returned an error without a payload",
  );
  error.name = payload.name || "Error";
  return error;
}

/**
 * Project the caller's turn config onto the transferable wire subset.
 *
 * `onCommentary` and `swingTracker` are deliberately dropped: the first is
 * re-created from the commentary event stream, the second is a class
 * instance that cannot survive a structured clone (configs carrying one
 * never reach the worker — the bridge keeps those turns synchronous).
 */
export function toAITurnWorkerConfig(
  config: AITurnConfig,
): AITurnWorkerConfig {
  return {
    difficulty: config.difficulty,
    delayMs: config.delayMs,
    skipPhases: config.skipPhases,
    format: config.format,
    archetype: config.archetype,
    opponentBluffHistory: config.opponentBluffHistory,
  };
}

export class AITurnWorkerClient {
  private static instance: AITurnWorkerClient | null = null;

  private readonly transportFactory: AITurnWorkerTransportFactory | null;
  private transport: AITurnWorkerTransport | null = null;
  private localHandler: AITurnWorkerHandler | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private status: AITurnWorkerStatus = "idle";
  private initError: Error | null = null;
  private commentarySink: ((text: string) => void) | null = null;

  private constructor(options: AITurnWorkerClientOptions = {}) {
    this.transportFactory = options.transportFactory ?? null;
  }

  /** Shared singleton used by app code. */
  public static getInstance(): AITurnWorkerClient {
    if (!AITurnWorkerClient.instance) {
      AITurnWorkerClient.instance = new AITurnWorkerClient();
    }
    return AITurnWorkerClient.instance;
  }

  /**
   * Create an isolated client. Tests use this to inject a fake transport
   * without touching the shared singleton.
   */
  public static create(
    options: AITurnWorkerClientOptions = {},
  ): AITurnWorkerClient {
    return new AITurnWorkerClient(options);
  }

  /** Reset the singleton so the next {@link getInstance} starts fresh. */
  public static _resetForTesting(): void {
    if (AITurnWorkerClient.instance) {
      AITurnWorkerClient.instance.terminate();
      AITurnWorkerClient.instance = null;
    }
  }

  /** Current lifecycle status. */
  public getStatus(): AITurnWorkerStatus {
    return this.status;
  }

  /** The error that prevented the worker from starting (if any). */
  public getInitError(): Error | null {
    return this.initError;
  }

  /** True when a real Web Worker is attached (false in the fallback path). */
  public isWorkerActive(): boolean {
    return this.transport !== null;
  }

  /**
   * Play one AI turn inside the worker and resolve with the turn result.
   *
   * Rejects with the turn's own error when the worker reports one. When no
   * worker is available the very same handler runs in-process, so the
   * result is the same either way.
   */
  public async runTurn(
    state: GameState,
    aiPlayerId: PlayerId,
    config: AITurnConfig,
    options: AITurnRunTurnOptions = {},
  ): Promise<AITurnResult> {
    const snapshot = toAITurnStateSnapshot(state);
    const wireConfig = toAITurnWorkerConfig(config);

    const transport = await this.ensureTransport();
    if (transport) {
      this.commentarySink = options.onCommentary ?? null;
      try {
        const response = await this.request({
          id: this.nextRequestId++,
          type: "ai_turn",
          state: snapshot,
          aiPlayerId,
          config: wireConfig,
        });
        return this.toTurnResult(response);
      } finally {
        this.commentarySink = null;
      }
    }

    // In-process fallback: the handler runs in this thread, so the snapshot
    // is copied first — a real worker would have copied it for us during
    // postMessage.
    const handler = await this.ensureLocalHandler();
    const response = await handler.handleRequest({
      id: this.nextRequestId++,
      type: "ai_turn",
      state: cloneAITurnStateSnapshot(snapshot),
      aiPlayerId,
      config: wireConfig,
    });
    if (!response.ok) {
      throw toAITurnWorkerError(response.error);
    }
    return this.toTurnResult(response);
  }

  /**
   * Tear the worker down. Pending requests are rejected so no caller is
   * left hanging on a promise that can never settle.
   */
  public terminate(): void {
    if (this.transport) {
      try {
        this.transport.terminate?.();
      } catch {
        /* already terminated */
      }
      this.transport = null;
    }
    this.localHandler = null;
    this.status = "idle";

    const error = new Error(
      "AI turn worker client terminated before the request completed",
    );
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Assemble the public turn result from a worker response. */
  private toTurnResult(
    response: AITurnWorkerSuccessResponse,
  ): AITurnResult {
    return {
      success: response.result.success,
      actionsTaken: response.result.actionsTaken,
      error: response.result.error,
      phase: response.result.phase,
      nextOpponentBluffHistory: response.result.nextOpponentBluffHistory,
      opponentBluffSignals: response.result.opponentBluffSignals,
      finalState: fromAITurnStateSnapshot(response.state),
    };
  }

  /**
   * Resolve the transport to use: an injected factory (tests), the real
   * worker factory (browser), or `null` for the in-process fallback.
   */
  private async ensureTransport(): Promise<AITurnWorkerTransport | null> {
    if (this.transport) {
      return this.transport;
    }

    if (this.transportFactory) {
      try {
        const transport = this.transportFactory();
        if (transport) {
          this.attachTransport(transport);
          return transport;
        }
        this.status = "fallback";
        return null;
      } catch (error) {
        this.initError =
          error instanceof Error ? error : new Error(String(error));
        this.status = "error";
        return null;
      }
    }

    // No Worker global: Jest / jsdom, SSR, or a non-browser runtime.
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      this.status = "fallback";
      return null;
    }

    try {
      // The factory captures `import.meta.url` at module top-level, which
      // ts-jest's CommonJS parser cannot handle — so it is loaded through a
      // dynamic import wrapped in try/catch, exactly like slice 1's engine
      // worker client does.
      const mod = (await import("./ai-turn-worker-factory")) as {
        createAITurnWorker?: () => Worker | null;
      };
      const worker = mod.createAITurnWorker?.() ?? null;
      if (!worker) {
        this.status = "fallback";
        return null;
      }
      this.attachTransport(worker as unknown as AITurnWorkerTransport);
      return this.transport;
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      this.status = "error";
      return null;
    }
  }

  /** Attach a transport and start listening for responses. */
  private attachTransport(transport: AITurnWorkerTransport): void {
    this.transport = transport;
    transport.addEventListener("message", this.handleMessage);
    transport.addEventListener("error", this.handleTransportError);
    this.status = "ready";
  }

  /**
   * Load the in-process worker handler. The handler is imported lazily so
   * the module graph stays acyclic (the handler imports the AI turn loop,
   * which is the module that calls into this client).
   */
  private async ensureLocalHandler(): Promise<AITurnWorkerHandler> {
    if (!this.localHandler) {
      const mod = await import("./ai-turn-worker");
      this.localHandler = mod.createAITurnWorkerHandler();
    }
    return this.localHandler;
  }

  /** Post a request and wait for the response with the matching id. */
  private request(
    request: AITurnWorkerRequest,
  ): Promise<AITurnWorkerSuccessResponse> {
    const transport = this.transport;
    if (!transport) {
      return Promise.reject(
        new Error("AI turn worker transport is not available"),
      );
    }

    return new Promise<AITurnWorkerSuccessResponse>((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      try {
        transport.postMessage(request);
      } catch (error) {
        this.pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Match an incoming message to its pending request.
   *
   * Commentary events are re-dispatched to the caller's sink and are not
   * responses. Unknown ids (a late response for a request that already
   * settled, or a message from a previous worker) are dropped — the client
   * never throws on a message it cannot match.
   */
  private readonly handleMessage = (event: {
    data?: unknown;
    message?: string;
  }): void => {
    const message = event.data as
      | {
          id?: unknown;
          ok?: unknown;
          type?: unknown;
          text?: unknown;
          state?: unknown;
          result?: unknown;
          error?: unknown;
        }
      | undefined;

    if (
      !message ||
      typeof message !== "object" ||
      typeof message.id !== "number"
    ) {
      return;
    }

    if (message.type === "commentary") {
      const commentary = message as unknown as AITurnWorkerCommentaryEvent;
      if (typeof commentary.text === "string") {
        this.commentarySink?.(commentary.text);
      }
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (message.ok === true) {
      pending.resolve(message as unknown as AITurnWorkerSuccessResponse);
      return;
    }

    const errorPayload = message.error as
      | { name?: string; message?: string }
      | undefined;
    pending.reject(toAITurnWorkerError(errorPayload ?? {}));
  };

  /** A worker-level error rejects every pending request. */
  private readonly handleTransportError = (event: {
    message?: string;
  }): void => {
    this.initError = new Error(event.message ?? "AI turn worker failed");
    this.status = "error";
    const error = new Error(this.initError.message);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  };
}

/** Shared singleton used by app code. */
export const aiTurnWorkerClient = AITurnWorkerClient.getInstance();
