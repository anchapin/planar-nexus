/**
 * @fileoverview Unit tests for the synergy embedding worker manager
 * (issue #1813).
 *
 * The manager is the module-level singleton that owns the embedding worker:
 * lazy creation, LOAD_MODEL posted at most once, responses dispatched to
 * subscribers, and — critically — NO termination. Provider unmount only
 * unsubscribes; the worker (and its multi-MB model) survives route
 * transitions.
 *
 * jsdom has no `Worker` global and the real browser factory contains
 * `import.meta` (unparseable under ts-jest CommonJS), so tests inject a fake
 * worker through `_setEmbeddingWorkerFactoryLoader` and reset the singleton
 * between tests via `_resetEmbeddingWorkerManager`.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  embeddingWorkerManager,
  _setEmbeddingWorkerFactoryLoader,
  _resetEmbeddingWorkerManager,
  type EmbeddingWorkerLike,
} from "../embedding-manager";
import type { WorkerMessage, WorkerResponse } from "@/lib/ai/embedding-worker";

class FakeEmbeddingWorker implements EmbeddingWorkerLike {
  static instances: FakeEmbeddingWorker[] = [];

  public sent: WorkerMessage[] = [];
  public onerror: ((event: ErrorEvent) => void) | null = null;
  private listeners = new Map<
    string,
    Set<(event: MessageEvent<WorkerResponse>) => void>
  >();

  constructor() {
    FakeEmbeddingWorker.instances.push(this);
  }

  postMessage(message: WorkerMessage): void {
    this.sent.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Test helper: make the worker emit a response to its listeners. */
  emit(response: WorkerResponse): void {
    const event = { data: response } as MessageEvent<WorkerResponse>;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

/** Inject a fake-worker factory and return the created instances array. */
function injectFakeWorker(): FakeEmbeddingWorker[] {
  const instances = FakeEmbeddingWorker.instances;
  _setEmbeddingWorkerFactoryLoader(async () => {
    return () => new FakeEmbeddingWorker();
  });
  return instances;
}

describe("embeddingWorkerManager (issue #1813)", () => {
  beforeEach(() => {
    _resetEmbeddingWorkerManager();
    FakeEmbeddingWorker.instances = [];
    injectFakeWorker();
  });

  afterEach(() => {
    _resetEmbeddingWorkerManager();
    FakeEmbeddingWorker.instances = [];
  });

  it("creates no worker and posts nothing until ensureStarted is called", async () => {
    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
    expect(embeddingWorkerManager.getLoadState()).toBe("not-started");

    // Subscribing alone must not start the worker.
    const unsubscribe = embeddingWorkerManager.subscribe(() => {});
    unsubscribe();

    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
  });

  it("posts LOAD_MODEL exactly once on first ensureStarted", async () => {
    await embeddingWorkerManager.ensureStarted();

    expect(FakeEmbeddingWorker.instances).toHaveLength(1);
    const worker = FakeEmbeddingWorker.instances[0];
    expect(worker.sent).toEqual([{ type: "LOAD_MODEL" }]);
    expect(embeddingWorkerManager.getLoadState()).toBe("loading");
  });

  it("is idempotent: repeated ensureStarted calls post LOAD_MODEL only once", async () => {
    await embeddingWorkerManager.ensureStarted();
    await embeddingWorkerManager.ensureStarted();
    await embeddingWorkerManager.ensureStarted();

    const worker = FakeEmbeddingWorker.instances[0];
    expect(worker.sent).toEqual([{ type: "LOAD_MODEL" }]);
  });

  it("flips load state to ready on MODEL_LOADED and dispatches to subscribers", async () => {
    const received: WorkerResponse[] = [];
    embeddingWorkerManager.subscribe((response) => received.push(response));

    await embeddingWorkerManager.ensureStarted();
    const worker = FakeEmbeddingWorker.instances[0];

    worker.emit({ type: "MODEL_LOADED" });

    expect(embeddingWorkerManager.getLoadState()).toBe("ready");
    expect(received).toEqual([{ type: "MODEL_LOADED" }]);
  });

  it("does not terminate the worker or reset state when subscribers leave", async () => {
    await embeddingWorkerManager.ensureStarted();
    const worker = FakeEmbeddingWorker.instances[0];
    worker.emit({ type: "MODEL_LOADED" });

    const unsubscribe = embeddingWorkerManager.subscribe(() => {});
    unsubscribe();

    // Singleton semantics: the worker instance and its ready state persist.
    expect(FakeEmbeddingWorker.instances).toHaveLength(1);
    expect(embeddingWorkerManager.getLoadState()).toBe("ready");
  });

  it("stays inert (no crash) when no worker can be created", async () => {
    _setEmbeddingWorkerFactoryLoader(async () => () => null);

    await expect(
      embeddingWorkerManager.ensureStarted(),
    ).resolves.toBeUndefined();
    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
    expect(embeddingWorkerManager.getLoadState()).toBe("not-started");
  });

  it("stays inert when the factory loader itself fails (Jest/SSR default path)", async () => {
    _setEmbeddingWorkerFactoryLoader(async () => {
      throw new Error("Cannot use 'import.meta' outside a module");
    });

    await expect(
      embeddingWorkerManager.ensureStarted(),
    ).resolves.toBeUndefined();
    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
  });

  it("re-arms LOAD_MODEL after an ERROR so a later ensureStarted can retry", async () => {
    await embeddingWorkerManager.ensureStarted();
    const worker = FakeEmbeddingWorker.instances[0];

    worker.emit({ type: "ERROR", error: "model fetch failed" });
    expect(embeddingWorkerManager.getLoadState()).not.toBe("ready");

    await embeddingWorkerManager.ensureStarted();

    expect(
      worker.sent.filter((message) => message.type === "LOAD_MODEL"),
    ).toHaveLength(2);
  });

  it("requestEmbeddings is a no-op before the worker exists", () => {
    expect(() =>
      embeddingWorkerManager.requestEmbeddings([
        { id: "c1", name: "Shock" },
      ] as never),
    ).not.toThrow();
  });
});
