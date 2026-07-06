/**
 * Issue #1254 — useReconnectTokens hook.
 *
 * Validates the listing/cancel flow the multiplayer landing page
 * relies on. The hook wraps the IndexedDB store; the assertions here
 * mirror the acceptance criteria:
 *   - On mount, the hook lists every live (non-expired) token.
 *   - Expired tokens are pruned before the list is returned so a
 *     returning peer does not see stale "Resume" affordances.
 *   - `remove()` drops a token and removes it from the list.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  useReconnectTokens,
  useReconnectToken,
} from "../use-reconnect-tokens";
import { ReconnectTokenStore } from "@/lib/p2p-reconnect-store";

describe("useReconnectTokens", () => {
  let store: ReconnectTokenStore;
  let originalDbName: string;

  beforeEach(() => {
    // The hook opens its own IDB handle with the default DB name
    // (`PlanarNexusReconnectTokens`). Pin both that name and a private
    // store instance to a unique dbName so the test never collides
    // with another test's IndexedDB state.
    originalDbName = "PlanarNexusReconnectTokens";
    store = new ReconnectTokenStore({ dbName: originalDbName });
  });

  afterEach(async () => {
    try {
      await store.clearAll();
    } catch {
      /* ignore */
    }
    store.close();
  });

  it("returns an empty list when the store is empty", async () => {
    const { result } = renderHook(() => useReconnectTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toEqual([]);
  });

  it("lists every live token", async () => {
    await store.save({
      peerId: "alice",
      sessionKey: "k-a",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 0,
      issuedAt: Date.now(),
      playerName: "Alice",
    });
    await store.save({
      peerId: "bob",
      sessionKey: "k-b",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 1,
      issuedAt: Date.now(),
      playerName: "Bob",
    });

    const { result } = renderHook(() => useReconnectTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toHaveLength(2);
    const codes = result.current.tokens.map((t) => t.gameCode).sort();
    expect(codes).toEqual(["GAME-A", "GAME-A"]);
  });

  it("remove() deletes the token and updates the list", async () => {
    await store.save({
      peerId: "alice",
      sessionKey: "k-a",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 0,
      issuedAt: Date.now(),
      playerName: "Alice",
    });

    const { result } = renderHook(() => useReconnectTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toHaveLength(1);

    await act(async () => {
      await result.current.remove("GAME-A", "alice");
    });
    expect(result.current.tokens).toHaveLength(0);

    // The store itself agrees the row is gone.
    const got = await store.get("GAME-A", "alice");
    expect(got).toBeNull();
  });

  it("prunes expired tokens before returning the list", async () => {
    await store.save({
      peerId: "alice",
      sessionKey: "k-a",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 0,
      issuedAt: Date.now() - 10_000,
      expiresAt: Date.now() + 60_000,
      playerName: "Alice",
    });
    await store.save({
      peerId: "bob",
      sessionKey: "k-b",
      hostPeerId: "host-1",
      gameCode: "GAME-B",
      lastDeliveredSeq: 0,
      issuedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1, // already expired
      playerName: "Bob",
    });

    const { result } = renderHook(() => useReconnectTokens());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tokens).toHaveLength(1);
    expect(result.current.tokens[0].peerId).toBe("alice");
  });
});

describe("useReconnectToken — single-token lookup", () => {
  let store: ReconnectTokenStore;

  beforeEach(() => {
    store = new ReconnectTokenStore({
      dbName: "PlanarNexusReconnectTokens",
    });
  });

  afterEach(async () => {
    try {
      await store.clearAll();
    } catch {
      /* ignore */
    }
    store.close();
  });

  it("returns null when no token exists for the (gameCode, peerId) pair", async () => {
    const { result } = renderHook(() =>
      useReconnectToken("GAME-X", "peer-missing"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.token).toBeNull();
  });

  it("returns the token when one exists", async () => {
    await store.save({
      peerId: "alice",
      sessionKey: "k-alice",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 5,
      issuedAt: Date.now(),
      playerName: "Alice",
    });

    const { result } = renderHook(() => useReconnectToken("GAME-A", "alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.token).not.toBeNull();
    expect(result.current.token!.peerId).toBe("alice");
    expect(result.current.token!.playerName).toBe("Alice");
    expect(result.current.token!.lastDeliveredSeq).toBe(5);
  });

  it("clear() drops the token and updates state", async () => {
    await store.save({
      peerId: "alice",
      sessionKey: "k-alice",
      hostPeerId: "host-1",
      gameCode: "GAME-A",
      lastDeliveredSeq: 0,
      issuedAt: Date.now(),
      playerName: "Alice",
    });

    const { result } = renderHook(() => useReconnectToken("GAME-A", "alice"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.token).not.toBeNull();

    await act(async () => {
      await result.current.clear();
    });
    expect(result.current.token).toBeNull();
  });

  it("returns null when gameCode is null/undefined", async () => {
    const { result } = renderHook(() =>
      useReconnectToken(null, "alice"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.token).toBeNull();
  });
});