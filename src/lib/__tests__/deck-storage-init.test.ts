/**
 * @fileOverview Tests for DeckStorageManager initialization race-safety
 *
 * Issue #913: HIGH: initPromise race condition in DeckStorageManager and
 * SavedGamesManager
 *
 * Covers:
 * - Concurrent initialization collapses onto a single in-flight promise
 * - A failed initialization resets so a subsequent call can retry
 * - Idempotency: after success, later calls do not re-initialize
 */

import { deckStorage } from "../deck-storage";
import { indexedDBStorage } from "../indexeddb-storage";

// Self-contained factory: the mock functions are created inside (ts-jest does
// not hoist outer `mock*` variables the way babel-jest does). We read them
// back from the mocked module below.
jest.mock("../indexeddb-storage", () => ({
  indexedDBStorage: {
    initialize: jest.fn(),
    getAll: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockInitialize = indexedDBStorage.initialize as jest.MockedFunction<
  typeof indexedDBStorage.initialize
>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  deckStorage._resetInitState();
  mockInitialize.mockReset();
});

describe("DeckStorageManager initialization race-safety (#913)", () => {
  it("collapses concurrent initialization into a single in-flight call", async () => {
    // Block initialization until we explicitly resolve it.
    const deferred = createDeferred<void>();
    mockInitialize.mockReturnValueOnce(deferred.promise);

    // Fire several operations before initialization completes.
    const p1 = deckStorage.getDeckCount();
    const p2 = deckStorage.getDeckCount();
    const p3 = deckStorage.getDeckCount();

    // All three share the same in-flight init — initialize called exactly once.
    expect(mockInitialize).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await expect(p1).resolves.toBe(0);
    await expect(p2).resolves.toBe(0);
    await expect(p3).resolves.toBe(0);

    // Still only one initialization after resolution.
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("does not re-initialize once initialization has succeeded", async () => {
    mockInitialize.mockResolvedValueOnce(undefined);

    await deckStorage.getDeckCount();
    await deckStorage.getDeckCount();
    await deckStorage.getDeckCount();

    // Idempotent: only the first call initializes.
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("resets after a failed init so a later call can retry", async () => {
    // First initialization attempt fails.
    const failure = new Error("init boom");
    mockInitialize.mockRejectedValueOnce(failure);

    // Public method swallows the error and falls back to localStorage.
    const first = await deckStorage.getDeckCount();
    expect(first).toBe(0);
    expect(mockInitialize).toHaveBeenCalledTimes(1);

    // Second attempt succeeds — proving the failed promise was reset
    // rather than being permanently cached/rejected.
    mockInitialize.mockResolvedValueOnce(undefined);
    const second = await deckStorage.getDeckCount();
    expect(second).toBe(0);
    expect(mockInitialize).toHaveBeenCalledTimes(2);

    // Third call must NOT re-initialize (idempotent after success).
    const third = await deckStorage.getDeckCount();
    expect(third).toBe(0);
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight promise across concurrent failed-init callers", async () => {
    const deferred = createDeferred<void>();
    mockInitialize.mockReturnValueOnce(deferred.promise);

    const p1 = deckStorage.getDeckCount();
    const p2 = deckStorage.getDeckCount();

    expect(mockInitialize).toHaveBeenCalledTimes(1);

    // Reject the shared in-flight promise.
    deferred.reject(new Error("init failed"));

    // Both callers observe the failure and fall back gracefully.
    await expect(p1).resolves.toBe(0);
    await expect(p2).resolves.toBe(0);

    // initPromise is cleared, so a retry starts a fresh initialization.
    mockInitialize.mockResolvedValueOnce(undefined);
    await deckStorage.getDeckCount();
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });
});
