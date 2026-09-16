/**
 * @fileoverview Behavioral tests for SynergyProvider's lazy model loading
 * (issue #1813).
 *
 * Before #1813 the provider spawned the embedding worker and posted
 * LOAD_MODEL in a mount effect (initializing the multi-MB
 * Xenova/all-MiniLM-L6-v2 model on every deck-builder visit) and terminated
 * the worker on unmount (throwing the model away). These tests pin the new
 * contract:
 *
 * 1. Mount is inert: no worker, no LOAD_MODEL — modelState is "idle", even
 *    with cards in the deck.
 * 2. First synergy interaction (enableSynergy) starts the singleton worker
 *    and posts LOAD_MODEL exactly once.
 * 3. MODEL_LOADED moves the context to "ready", after which deck changes
 *    (debounced) post GENERATE_EMBEDDINGS.
 * 4. The worker is a module-level singleton: unmounting and remounting the
 *    provider reuses the SAME worker with no second LOAD_MODEL.
 * 5. Embedding results flow through a DYNAMICALLY imported oramaManager —
 *    the vector-index stack must never be a static dependency of the
 *    deck-builder route (jest.mock intercepts the dynamic import here).
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom/jest-globals";

import { SynergyProvider, useSynergy } from "../synergy-context";
import {
  _setEmbeddingWorkerFactoryLoader,
  _resetEmbeddingWorkerManager,
  type EmbeddingWorkerLike,
} from "@/lib/synergy/embedding-manager";
import type { WorkerMessage, WorkerResponse } from "@/lib/ai/embedding-worker";
import type { DeckCard } from "@/lib/card-database";

type SearchHit = { id: string; score: number };
type SearchByVectorFn = (
  vector: number[],
  limit?: number,
) => Promise<{ hits: SearchHit[] }>;
type GetCardByIdFn = (id: string) => Promise<unknown>;

// Self-contained mock factories: jest.mock calls are hoisted above every
// import/const, so they cannot reference module-scope variables.
jest.mock("@/lib/search/orama-manager", () => ({
  oramaManager: {
    searchByVector:
      jest.fn<
        (vector: number[], limit?: number) => Promise<{ hits: SearchHit[] }>
      >(),
  },
}));

jest.mock("@/lib/card-database", () => ({
  getCardById: jest.fn<(id: string) => Promise<unknown>>(),
}));

// Typed handles onto the hoisted mock fns.
const mockSearchByVector = (
  jest.requireMock("@/lib/search/orama-manager") as {
    oramaManager: { searchByVector: jest.MockedFunction<SearchByVectorFn> };
  }
).oramaManager.searchByVector;
const mockGetCardById = (
  jest.requireMock("@/lib/card-database") as {
    getCardById: jest.MockedFunction<GetCardByIdFn>;
  }
).getCardById;

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

  emit(response: WorkerResponse): void {
    const event = { data: response } as MessageEvent<WorkerResponse>;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }
}

const DECK: DeckCard[] = [
  {
    id: "card-1",
    name: "Lightning Bolt",
    count: 4,
    type_line: "Instant",
    mana_cost: "{R}",
  } as unknown as DeckCard,
  {
    id: "card-2",
    name: "Monastery Swiftspear",
    count: 4,
    type_line: "Creature — Human Monk",
    mana_cost: "{R}",
  } as unknown as DeckCard,
];

function Probe() {
  const { modelState, enableSynergy, synergyData, topSuggestions } =
    useSynergy();
  return (
    <div>
      <span data-testid="model-state">{modelState}</span>
      <span data-testid="synergy-count">{synergyData.size}</span>
      <span data-testid="suggestion-count">{topSuggestions.length}</span>
      <button data-testid="enable-synergy" onClick={enableSynergy}>
        enable
      </button>
    </div>
  );
}

function renderProvider(deck: DeckCard[] = DECK) {
  return render(
    <SynergyProvider deck={deck}>
      <Probe />
    </SynergyProvider>,
  );
}

function enableInteraction() {
  return act(async () => {
    fireEvent.click(screen.getByTestId("enable-synergy"));
  });
}

describe("SynergyProvider lazy model loading (issue #1813)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _resetEmbeddingWorkerManager();
    FakeEmbeddingWorker.instances = [];
    _setEmbeddingWorkerFactoryLoader(
      async () => () => new FakeEmbeddingWorker(),
    );
    mockSearchByVector.mockReset();
    mockSearchByVector.mockResolvedValue({ hits: [] });
    mockGetCardById.mockReset();
    mockGetCardById.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    _resetEmbeddingWorkerManager();
    FakeEmbeddingWorker.instances = [];
  });

  it("mounts idle: no worker spawned and no LOAD_MODEL even with cards in the deck", async () => {
    renderProvider();

    expect(screen.getByTestId("model-state").textContent).toBe("idle");
    expect(FakeEmbeddingWorker.instances).toHaveLength(0);

    // Let the (previously eager) deck-change debounce fire — nothing may
    // spawn the worker or post LOAD_MODEL without user intent.
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(FakeEmbeddingWorker.instances).toHaveLength(0);
  });

  it("posts LOAD_MODEL exactly once on first synergy interaction", async () => {
    renderProvider();

    await enableInteraction();

    expect(FakeEmbeddingWorker.instances).toHaveLength(1);
    expect(FakeEmbeddingWorker.instances[0].sent).toEqual([
      { type: "LOAD_MODEL" },
    ]);
    expect(screen.getByTestId("model-state").textContent).toBe("loading");
  });

  it("reaches ready on MODEL_LOADED and posts GENERATE_EMBEDDINGS after the deck debounce", async () => {
    renderProvider();
    await enableInteraction();

    const worker = FakeEmbeddingWorker.instances[0];
    await act(async () => {
      worker.emit({ type: "MODEL_LOADED" });
    });
    expect(screen.getByTestId("model-state").textContent).toBe("ready");

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    const generateCalls = worker.sent.filter(
      (message) => message.type === "GENERATE_EMBEDDINGS",
    );
    expect(generateCalls).toHaveLength(1);
    // `count` is stripped before embeddings are generated.
    expect(
      (
        generateCalls[0] as Extract<
          WorkerMessage,
          { type: "GENERATE_EMBEDDINGS" }
        >
      ).cards.map((card) => card.id),
    ).toEqual(["card-1", "card-2"]);
  });

  it("survives provider unmount/remount: same worker, no second LOAD_MODEL", async () => {
    const first = renderProvider();
    await enableInteraction();
    const worker = FakeEmbeddingWorker.instances[0];
    await act(async () => {
      worker.emit({ type: "MODEL_LOADED" });
    });
    first.unmount();

    // Fresh provider (as after a route transition back to deck-builder).
    renderProvider();
    expect(FakeEmbeddingWorker.instances).toHaveLength(1); // singleton reused
    expect(screen.getByTestId("model-state").textContent).toBe("idle");

    await enableInteraction();

    // Model already warm: jumps straight to ready without a new LOAD_MODEL.
    expect(FakeEmbeddingWorker.instances).toHaveLength(1);
    expect(
      worker.sent.filter((message) => message.type === "LOAD_MODEL"),
    ).toHaveLength(1);
    expect(screen.getByTestId("model-state").textContent).toBe("ready");

    // And the warm worker still serves new embeddings for the fresh mount.
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(
      worker.sent.filter((message) => message.type === "GENERATE_EMBEDDINGS"),
    ).toHaveLength(1);
  });

  it("processes embeddings through the dynamically imported oramaManager", async () => {
    renderProvider();
    await enableInteraction();

    const worker = FakeEmbeddingWorker.instances[0];
    await act(async () => {
      worker.emit({ type: "MODEL_LOADED" });
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    // Mean of two 2-dimensional embeddings [0.2, 0.4] and [0.4, 0.6].
    await act(async () => {
      worker.emit({
        type: "EMBEDDINGS_GENERATED",
        results: [
          { id: "card-1", embedding: [0.2, 0.4] },
          { id: "card-2", embedding: [0.4, 0.6] },
        ],
      });
    });

    expect(mockSearchByVector).toHaveBeenCalledTimes(1);
    expect(mockSearchByVector).toHaveBeenCalledWith(
      [expect.closeTo(0.3), expect.closeTo(0.5)],
      40,
    );
    // Empty hits → empty synergy state, calculation finished.
    expect(screen.getByTestId("synergy-count").textContent).toBe("0");
  });

  it("maps a worker ERROR to modelState=error while loading", async () => {
    renderProvider();
    await enableInteraction();

    await act(async () => {
      FakeEmbeddingWorker.instances[0].emit({
        type: "ERROR",
        error: "WebGPU unavailable",
      });
    });

    expect(screen.getByTestId("model-state").textContent).toBe("error");
  });
});
