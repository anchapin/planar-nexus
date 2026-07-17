/**
 * @fileoverview Tests for the optional `schema` parameter added to the generic
 * localStorage hooks in issue #1429.
 *
 * The hooks are IndexedDB-first with a localStorage fallback. To exercise the
 * localStorage read path (the one the issue validates), IndexedDB is mocked to
 * reject, forcing the fallback. With no schema the hook keeps its legacy
 * behavior; with a schema it validates and falls back to the initial value on
 * failure.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";
import { z } from "zod";

// Reject every IndexedDB call so the hooks use their localStorage fallback.
jest.mock("@/lib/indexeddb-storage", () => ({
  indexedDBStorage: {
    initialize: jest.fn(() => Promise.resolve()),
    get: jest.fn(() =>
      Promise.reject(new Error("forced localStorage fallback")),
    ),
    set: jest.fn(() =>
      Promise.reject(new Error("forced localStorage fallback")),
    ),
    delete: jest.fn(() => Promise.resolve()),
    getAll: jest.fn(() => Promise.resolve([])),
    clearStorage: jest.fn(() => Promise.resolve()),
  },
}));

import { useLocalStorage, useSimpleLocalStorage } from "../use-local-storage";

const NumberMapSchema = z.record(z.string(), z.number());

describe("useLocalStorage — optional schema validation (#1429)", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
  });

  it("loads valid data when a schema is provided", async () => {
    localStorage.setItem("k", JSON.stringify({ a: 1, b: 2 }));
    const { result } = renderHook(() =>
      useLocalStorage("k", {}, NumberMapSchema),
    );
    await waitFor(() => {
      expect(result.current[2].loading).toBe(false);
    });
    expect(result.current[0]).toEqual({ a: 1, b: 2 });
  });

  it("falls back to the initial value and clears the key on a schema mismatch", async () => {
    localStorage.setItem("k", JSON.stringify({ a: "not-a-number" }));
    const initial = { seed: 0 };
    const { result } = renderHook(() =>
      useLocalStorage("k", initial, NumberMapSchema),
    );
    await waitFor(() => {
      expect(result.current[2].loading).toBe(false);
    });
    expect(result.current[0]).toEqual(initial);
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("falls back on malformed JSON and does not throw", async () => {
    localStorage.setItem("k", "{broken");
    const initial = { seed: 0 };
    const { result } = renderHook(() =>
      useLocalStorage("k", initial, NumberMapSchema),
    );
    await waitFor(() => {
      expect(result.current[2].loading).toBe(false);
    });
    expect(result.current[0]).toEqual(initial);
    expect(result.current[2].error).toBeNull();
  });

  it("keeps legacy behavior when no schema is supplied", async () => {
    // Without a schema the hook accepts any JSON shape (unchanged behavior).
    localStorage.setItem("k", JSON.stringify({ anything: "goes", n: 1 }));
    const { result } = renderHook(() => useLocalStorage("k", {}));
    await waitFor(() => {
      expect(result.current[2].loading).toBe(false);
    });
    expect(result.current[0]).toEqual({ anything: "goes", n: 1 });
  });
});

describe("useSimpleLocalStorage — optional schema validation (#1429)", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
  });

  it("loads valid data when a schema is provided", async () => {
    localStorage.setItem("s", JSON.stringify({ a: 1 }));
    const { result } = renderHook(() =>
      useSimpleLocalStorage("s", {}, NumberMapSchema),
    );
    await waitFor(() => {
      expect(result.current[0]).toEqual({ a: 1 });
    });
  });

  it("keeps the initial value on a schema mismatch and clears the key", async () => {
    localStorage.setItem("s", JSON.stringify({ a: "bad" }));
    const initial = { seed: 0 };
    const { result } = renderHook(() =>
      useSimpleLocalStorage("s", initial, NumberMapSchema),
    );
    await waitFor(() => {
      expect(result.current[0]).toEqual(initial);
    });
    expect(localStorage.getItem("s")).toBeNull();
  });

  it("keeps legacy behavior when no schema is supplied", async () => {
    localStorage.setItem("s", JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() =>
      useSimpleLocalStorage<number[]>("s", []),
    );
    await waitFor(() => {
      expect(result.current[0]).toEqual([1, 2, 3]);
    });
  });
});
