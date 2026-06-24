/**
 * @fileOverview Tests for SavedGamesManager initialization race-safety
 *
 * Issue #913: HIGH: initPromise race condition in DeckStorageManager and
 * SavedGamesManager
 *
 * Covers:
 * - Concurrent initialization collapses onto a single in-flight promise
 * - A failed initialization resets so a subsequent call can retry
 * - Idempotency: after success, later calls do not re-initialize
 */

import { savedGamesManager } from "../saved-games";
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
  savedGamesManager._resetInitState();
  mockInitialize.mockReset();
  // Clear localStorage fallback state between tests.
  if (typeof global !== "undefined" && global.localStorage) {
    global.localStorage.clear();
  }
});

describe("SavedGamesManager initialization race-safety (#913)", () => {
  it("collapses concurrent initialization into a single in-flight call", async () => {
    const deferred = createDeferred<void>();
    mockInitialize.mockReturnValueOnce(deferred.promise);

    // Fire several operations before initialization completes.
    const p1 = savedGamesManager.getAllSavedGames();
    const p2 = savedGamesManager.getAllSavedGames();
    const p3 = savedGamesManager.getAllSavedGames();

    // All three share the same in-flight init — initialize called exactly once.
    expect(mockInitialize).toHaveBeenCalledTimes(1);

    deferred.resolve();

    await expect(p1).resolves.toEqual([]);
    await expect(p2).resolves.toEqual([]);
    await expect(p3).resolves.toEqual([]);

    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("does not re-initialize once initialization has succeeded", async () => {
    mockInitialize.mockResolvedValueOnce(undefined);

    await savedGamesManager.getAllSavedGames();
    await savedGamesManager.getAllSavedGames();
    await savedGamesManager.getAllSavedGames();

    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("resets after a failed init so a later call can retry", async () => {
    // First initialization attempt fails.
    mockInitialize.mockRejectedValueOnce(new Error("init boom"));

    // Public method swallows the error and falls back to localStorage.
    const first = await savedGamesManager.getAllSavedGames();
    expect(first).toEqual([]);
    expect(mockInitialize).toHaveBeenCalledTimes(1);

    // Second attempt succeeds — proving the failed promise was reset.
    mockInitialize.mockResolvedValueOnce(undefined);
    const second = await savedGamesManager.getAllSavedGames();
    expect(second).toEqual([]);
    expect(mockInitialize).toHaveBeenCalledTimes(2);

    // Third call must NOT re-initialize (idempotent after success).
    const third = await savedGamesManager.getAllSavedGames();
    expect(third).toEqual([]);
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight promise across concurrent failed-init callers", async () => {
    const deferred = createDeferred<void>();
    mockInitialize.mockReturnValueOnce(deferred.promise);

    const p1 = savedGamesManager.getAllSavedGames();
    const p2 = savedGamesManager.getAllSavedGames();

    expect(mockInitialize).toHaveBeenCalledTimes(1);

    deferred.reject(new Error("init failed"));

    await expect(p1).resolves.toEqual([]);
    await expect(p2).resolves.toEqual([]);

    // initPromise is cleared, so a retry starts a fresh initialization.
    mockInitialize.mockResolvedValueOnce(undefined);
    await savedGamesManager.getAllSavedGames();
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });
});
