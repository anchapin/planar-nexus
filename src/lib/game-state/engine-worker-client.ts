/**
 * @fileoverview Rules-engine worker client (issue #2417, slice 1).
 *
 * Main-thread handle for the engine worker. It mirrors the repo's existing
 * worker clients (`src/lib/search/search-worker-client.ts`,
 * `src/lib/backup/backup-checksum-client.ts`) and adds the two things the
 * engine transport needs:
 *
 *   - an **action API**: `dispatch(action)` applies one engine action to
 *     the worker's authoritative state and resolves with the resulting
 *     state; `init(state)` hands the initial state over; `terminate()`
 *     tears the worker down.
 *   - an **in-process fallback**: when no `Worker` global exists (Jest,
 *     SSR, a blocked worker chunk) the very same worker handler runs
 *     in-process, so the existing test harness path keeps working and the
 *     UI never loses the rules engine because a worker could not start.
 *
 * The client speaks the id-keyed request/response protocol defined in
 * `engine-worker-types.ts`:
 *
 *   - every request carries a unique id; every response echoes it back,
 *   - responses are matched to pending promises by id, so out-of-order
 *     responses resolve the right promise,
 *   - a response with an unknown id is dropped (late response, stale
 *     worker) instead of throwing,
 *   - an error envelope rejects the promise with the engine's own error.
 */

import type { GameState } from "@/lib/game-state";

import {
  cloneEngineStateSnapshot,
  fromEngineStateSnapshot,
  toEngineStateSnapshot,
} from "./engine-worker-state";
import type { EngineWorkerHandler } from "./engine-worker";
import type {
  EngineWorkerAction,
  EngineWorkerErrorPayload,
  EngineWorkerRequest,
  EngineWorkerSuccessResponse,
} from "./engine-worker-types";

/** Lifecycle status of the client. */
export type EngineWorkerStatus =
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
export interface EngineWorkerTransport {
  /** Send a request to the worker. */
  postMessage(message: EngineWorkerRequest): void;
  /** Subscribe to worker messages (and worker errors). */
  addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
  /** Stop the worker. */
  terminate?(): void;
}

/** Factory used to build the transport (the real one lives in the factory module). */
export type EngineWorkerTransportFactory = () => EngineWorkerTransport | null;

/** Options accepted by {@link EngineWorkerClient.create}. */
export interface EngineWorkerClientOptions {
  /**
   * Inject a transport factory. Used by tests to drive the protocol with a
   * fake worker. When the factory returns `null` the client falls back to
   * the in-process handler.
   */
  transportFactory?: EngineWorkerTransportFactory;
}

interface PendingRequest {
  resolve: (response: EngineWorkerSuccessResponse) => void;
  reject: (error: Error) => void;
}

/**
 * Turn an error envelope back into a thrown error. The engine error's
 * message *and* class name are preserved so callers can tell an engine
 * rejection (`EngineActionError`) from an engine crash (the engine's own
 * error class).
 */
function toEngineWorkerError(payload: EngineWorkerErrorPayload): Error {
  const error = new Error(payload.message);
  error.name = payload.name || "Error";
  return error;
}

export class EngineWorkerClient {
  private static instance: EngineWorkerClient | null = null;

  private readonly transportFactory: EngineWorkerTransportFactory | null;
  private transport: EngineWorkerTransport | null = null;
  private localHandler: EngineWorkerHandler | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private status: EngineWorkerStatus = "idle";
  private initError: Error | null = null;

  private constructor(options: EngineWorkerClientOptions = {}) {
    this.transportFactory = options.transportFactory ?? null;
  }

  /** Shared singleton used by app code. */
  public static getInstance(): EngineWorkerClient {
    if (!EngineWorkerClient.instance) {
      EngineWorkerClient.instance = new EngineWorkerClient();
    }
    return EngineWorkerClient.instance;
  }

  /**
   * Create an isolated client. Tests use this to inject a fake transport
   * without touching the shared singleton.
   */
  public static create(
    options: EngineWorkerClientOptions = {},
  ): EngineWorkerClient {
    return new EngineWorkerClient(options);
  }

  /** Reset the singleton so the next {@link getInstance} starts fresh. */
  public static _resetForTesting(): void {
    if (EngineWorkerClient.instance) {
      EngineWorkerClient.instance.terminate();
      EngineWorkerClient.instance = null;
    }
  }

  /** Current lifecycle status. */
  public getStatus(): EngineWorkerStatus {
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
   * Hand the initial state to the worker and resolve with the state the
   * worker now holds.
   */
  public async init(state: GameState): Promise<GameState> {
    const snapshot = toEngineStateSnapshot(state);

    const transport = await this.ensureTransport();
    if (transport) {
      const response = await this.request({
        id: this.nextRequestId++,
        type: "init",
        state: snapshot,
      });
      return fromEngineStateSnapshot(response.state);
    }

    // In-process fallback: the handler runs in this thread, so the
    // snapshot is copied first — a real worker would have copied it for
    // us during postMessage.
    const handler = await this.ensureLocalHandler();
    const response = handler.handleRequest({
      id: this.nextRequestId++,
      type: "init",
      state: cloneEngineStateSnapshot(snapshot),
    });
    if (!response.ok) {
      throw toEngineWorkerError(response.error);
    }
    return fromEngineStateSnapshot(response.state);
  }

  /**
   * Apply one action to the worker's authoritative state and resolve with
   * the resulting state.
   *
   * Rejects with the engine's error when the rules reject the action (or
   * when the action throws inside the engine) — the worker stays alive and
   * its held state is unchanged.
   */
  public async dispatch(action: EngineWorkerAction): Promise<GameState> {
    const transport = this.transport;
    if (transport) {
      const response = await this.request({
        id: this.nextRequestId++,
        type: "dispatch",
        action,
      });
      return fromEngineStateSnapshot(response.state);
    }

    const handler = await this.ensureLocalHandler();
    const response = handler.handleRequest({
      id: this.nextRequestId++,
      type: "dispatch",
      action,
    });
    if (!response.ok) {
      throw toEngineWorkerError(response.error);
    }
    return fromEngineStateSnapshot(response.state);
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
      "Engine worker client terminated before the request completed",
    );
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Resolve the transport to use: an injected factory (tests), the real
   * worker factory (browser), or `null` for the in-process fallback.
   */
  private async ensureTransport(): Promise<EngineWorkerTransport | null> {
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
      // dynamic import wrapped in try/catch, exactly like the search and
      // backup checksum clients do.
      const mod = (await import("./engine-worker-factory")) as {
        createEngineWorker?: () => Worker | null;
      };
      const worker = mod.createEngineWorker?.() ?? null;
      if (!worker) {
        this.status = "fallback";
        return null;
      }
      this.attachTransport(worker as unknown as EngineWorkerTransport);
      return this.transport;
    } catch (error) {
      this.initError =
        error instanceof Error ? error : new Error(String(error));
      this.status = "error";
      return null;
    }
  }

  /** Attach a transport and start listening for responses. */
  private attachTransport(transport: EngineWorkerTransport): void {
    this.transport = transport;
    transport.addEventListener("message", this.handleMessage);
    transport.addEventListener("error", this.handleTransportError);
    this.status = "ready";
  }

  /**
   * Load the in-process worker handler. The handler is imported lazily so
   * the module graph stays acyclic (the engine barrel re-exports this
   * client, and the handler imports the barrel for the engine API).
   */
  private async ensureLocalHandler(): Promise<EngineWorkerHandler> {
    if (!this.localHandler) {
      const mod = await import("./engine-worker");
      this.localHandler = mod.createEngineWorkerHandler();
    }
    return this.localHandler;
  }

  /** Post a request and wait for the response with the matching id. */
  private request(
    request: EngineWorkerRequest,
  ): Promise<EngineWorkerSuccessResponse> {
    const transport = this.transport;
    if (!transport) {
      return Promise.reject(
        new Error("Engine worker transport is not available"),
      );
    }

    return new Promise<EngineWorkerSuccessResponse>((resolve, reject) => {
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
   * Match an incoming response to its pending request.
   *
   * Unknown ids (a late response for a request that already settled, or a
   * message from a previous worker) are dropped — the client never throws
   * on a message it cannot match.
   */
  private readonly handleMessage = (event: {
    data?: unknown;
    message?: string;
  }): void => {
    const response = event.data as
      | { id?: unknown; ok?: unknown; state?: unknown; error?: unknown }
      | undefined;

    if (
      !response ||
      typeof response !== "object" ||
      typeof response.id !== "number"
    ) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);

    if (response.ok === true) {
      pending.resolve(response as unknown as EngineWorkerSuccessResponse);
      return;
    }

    const errorPayload = response.error as EngineWorkerErrorPayload | undefined;
    pending.reject(
      toEngineWorkerError(
        errorPayload ?? {
          name: "Error",
          message: "Engine worker returned an error without a payload",
        },
      ),
    );
  };

  /** A worker-level error rejects every pending request. */
  private readonly handleTransportError = (event: {
    message?: string;
  }): void => {
    this.initError = new Error(event.message ?? "Engine worker failed");
    this.status = "error";
    const error = new Error(this.initError.message);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  };
}

/** Default singleton — shared across all consumers. */
export const engineWorkerClient = EngineWorkerClient.getInstance();
