/**
 * use-p2p-connection — behavioral transport coverage (#1788).
 *
 * Drives the connection event wiring directly (the underlying transport is
 * mocked) to verify:
 *   - Send success / no-connection paths for sendGameState / sendGameAction /
 *     sendChat / requestStateSync.
 *   - The reconnection attempt ladder (issue #988) and the transient
 *     "Reconnected" acknowledgement.
 *   - Host-migration event wiring (issue #916): promotion, remote host
 *     change, termination, roster assignments, peer joins/leaves.
 *   - game-ended persistence to Dexie (issue #1570) incl. spectator skip.
 *   - Reconnect-token lookup / clear (issue #1254) and handshake-driven
 *     token persistence.
 *   - rotateSessionKeyOnPromotion (issue #1391) as a pure function.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import {
  useP2PConnection,
  rotateSessionKeyOnPromotion,
} from "../use-p2p-connection";
import { createP2PGameConnection } from "@/lib/p2p-game-connection";
import { saveGameForLocalHotSeat } from "@/lib/local-game-storage";
import {
  HandshakeSession,
  verifySimpleStateChecksum,
} from "@/lib/p2p-handshake";
import { createHostMigrationManager } from "@/lib/p2p-host-migration";
import { reconnectTokenStore } from "@/lib/p2p-reconnect-store";
import {
  db as localIntelligenceDb,
  getMatchRecordKey,
} from "@/lib/db/local-intelligence-db";
import type { GameState, PlayerId, Phase } from "@/lib/game-state";

// ---------------------------------------------------------------------------
// Mocks — jest.mock is hoisted above imports, so the factories use literal
// jest.fn() values. We access the live mock fns via the imported bindings
// (cast to jest.Mock), the repo convention (see use-storage-backup.test.ts).
// ---------------------------------------------------------------------------

// Capture the events the hook registers so tests can drive them directly.

let capturedEvents: any = null;
let capturedMigrationEvents: any = null;

jest.mock("@/lib/p2p-game-connection", () => ({
  createP2PGameConnection: jest.fn(),
}));

jest.mock("@/lib/local-game-storage", () => ({
  saveGameForLocalHotSeat: jest.fn(),
}));

jest.mock("@/lib/p2p-handshake", () => {
  // Issue #1796: the hook's `rotateSessionKeyOnPromotion` and the
  // reconnect-token save both import `generateSessionKey` from this
  // module. The mock passes through the real implementation and only
  // stubs the class + checksum helpers this test actually exercises;
  // removing the pass-through would silently turn the session-key
  // mint into `undefined` and break these two paths.
  const actual = jest.requireActual("@/lib/p2p-handshake");
  return {
    ...actual,
    HandshakeSession: jest.fn(),
    verifySimpleStateChecksum: jest.fn(),
  };
});

jest.mock("@/lib/p2p-host-migration", () => ({
  HostMigrationManager: jest.fn(),
  createHostMigrationManager: jest.fn(),
}));

jest.mock("@/lib/p2p-reconnect-store", () => ({
  reconnectTokenStore: {
    get: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/lib/db/local-intelligence-db", () => ({
  db: {
    match_records: {
      put: jest.fn(),
    },
  },
  getMatchRecordKey: jest.fn(),
}));

// The connection-health hook polls on an interval which loops forever under
// jsdom; stub it to a stable value so we can drive the transport paths in
// isolation (its polling behaviour is covered by its own suite).
jest.mock("@/hooks/use-connection-health", () => ({
  useConnectionHealth: () => ({
    state: "disconnected",
    isHealthy: false,
    isReconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    lastStateChange: new Date(0),
    connectionQuality: "excellent",
    latency: 0,
    packetLoss: 0,
    jitter: 0,
  }),
}));

const mockCreateP2PGameConnection =
  createP2PGameConnection as unknown as jest.Mock;
const mockSaveGameForLocalHotSeat =
  saveGameForLocalHotSeat as unknown as jest.Mock;
const MockHandshakeSession = HandshakeSession as unknown as jest.Mock;
const mockVerifyChecksum = verifySimpleStateChecksum as unknown as jest.Mock;
const mockCreateHostMigrationManager =
  createHostMigrationManager as unknown as jest.Mock;
const mockTokenStore = reconnectTokenStore as unknown as {
  get: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};
const mockMatchPut = (localIntelligenceDb as any).match_records
  .put as jest.Mock;
const mockGetMatchRecordKey = getMatchRecordKey as unknown as jest.Mock;

/** Build a fully-wired mock P2PGameConnection. */
function makeMockConnection() {
  return {
    initializeAsHost: jest.fn().mockResolvedValue(undefined),
    initializeAsJoiner: jest.fn().mockResolvedValue(undefined),
    processAnswer: jest.fn().mockResolvedValue(undefined),
    processIceCandidates: jest.fn().mockResolvedValue(undefined),
    sendGameState: jest.fn().mockReturnValue(true),
    sendGameAction: jest.fn().mockReturnValue(true),
    sendChat: jest.fn().mockReturnValue(true),
    requestStateSync: jest.fn().mockReturnValue(true),
    close: jest.fn(),
    getSignalingState: jest.fn().mockReturnValue({
      localOffer: { type: "offer", sdp: "offer-sdp" },
      localAnswer: { type: "answer", sdp: "answer-sdp" },
    }),
    getLastFailureDiagnostic: jest.fn().mockReturnValue(null),
    getOutgoingSeq: jest.fn().mockReturnValue(7),
    getSessionKey: jest.fn().mockReturnValue("old-key"),
    setSessionKey: jest.fn(),
    getLocalRole: jest.fn().mockReturnValue("player"),
    getRemoteRole: jest.fn().mockReturnValue("player"),
    setLocalRole: jest.fn(),
    getSpectatorDrops: jest.fn().mockReturnValue(0),
  };
}

function makeMockMigrationManager() {
  return {
    seedHostJoinSeq: jest.fn(),
    getHostId: jest.fn().mockReturnValue("host-1"),
    isLocalHost: jest.fn().mockReturnValue(true),
    assignNextJoinSeq: jest
      .fn()
      .mockReturnValue({ playerId: "peer-2", playerName: "Bob", joinSeq: 1 }),
    upsertPeer: jest.fn(),
    recordHostJoinSeq: jest.fn(),
    applyMigration: jest
      .fn()
      .mockReturnValue({ newHostId: "peer-2", promotedSelf: false }),
    removePeer: jest.fn(),
    initiateMigration: jest.fn().mockReturnValue({
      terminated: false,
      promotedSelf: true,
      newHostId: "peer-2",
    }),
    buildMigrationMessage: jest
      .fn()
      .mockReturnValue({ type: "host-migration", newHostId: "peer-2" }),
    setLastKnownGameState: jest.fn(),
    reset: jest.fn(),
  };
}

function makeGameState(id = "game-live-1"): GameState {
  return {
    gameId: id,
    players: new Map(),
    cards: new Map(),
    zones: new Map(),
    stack: [],
    turn: {
      activePlayerId: "player-1" as PlayerId,
      currentPhase: "precombat_main" as Phase,
      turnNumber: 12,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: Date.now(),
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 0,
    },
    waitingChoice: null,
    priorityPlayerId: null,
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "commander",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  } as unknown as GameState;
}

function makeGameEndedPayload(
  opts: {
    includeLocalPlayer?: boolean;
  } = {},
) {
  const standings = [
    { playerId: "player-1", playerName: "Alice", position: 1, life: 0 },
    { playerId: "player-2", playerName: "Bob", position: 2, life: 12 },
  ];
  return {
    gameId: "game-ended-1",
    winnerId: "player-1",
    endReason: "life-reduced-to-zero",
    format: "commander",
    startedAt: 1_000,
    endedAt: 61_000,
    standings:
      opts.includeLocalPlayer === false
        ? standings.filter((s) => s.playerId !== "player-1")
        : standings,
  };
}

function renderHookWithDefaults(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useP2PConnection({
      playerId: "player-1",
      playerName: "Alice",
      role: "host",
      enableHostMigration: false,
      enableHandshake: false,
      enableConflictResolution: false,
      ...overrides,
    }),
  );
}

/** Render + initializeAsHost + mark connected. The common preamble. */
async function renderConnected(overrides: Record<string, unknown> = {}) {
  const utils = renderHookWithDefaults(overrides);
  await act(async () => {
    await utils.result.current.initializeAsHost();
  });
  act(() => capturedEvents.onConnectionStateChange("connected"));
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedEvents = null;
  capturedMigrationEvents = null;
  mockCreateP2PGameConnection.mockImplementation((opts: any) => {
    capturedEvents = opts.events;
    return makeMockConnection();
  });
  mockCreateHostMigrationManager.mockImplementation((opts: any) => {
    capturedMigrationEvents = opts.events;
    return makeMockMigrationManager();
  });
  MockHandshakeSession.mockImplementation(() => ({
    start: jest.fn().mockReturnValue({ type: "handshake-init", nonce: "n1" }),
    getRemoteChecksum: jest.fn().mockReturnValue("checksum-xyz"),
    cleanup: jest.fn(),
  }));
  mockVerifyChecksum.mockReturnValue(true);
  mockTokenStore.get.mockResolvedValue(null);
  mockTokenStore.save.mockResolvedValue(true);
  mockTokenStore.delete.mockResolvedValue(true);
  mockMatchPut.mockResolvedValue(1);
  mockGetMatchRecordKey.mockImplementation(
    (gameId: string, playerId: string) => `${gameId}::${playerId}`,
  );
  mockSaveGameForLocalHotSeat.mockResolvedValue({
    gameId: "hotseat_x",
    resumeKey: "p2p_x",
    gameStateVersion: 1,
    source: "p2p",
  });
});

describe("useP2PConnection — send / signaling surface (#1788)", () => {
  it("delegates sendGameState / sendChat / requestStateSync to the connection when connected", async () => {
    const { result } = await renderConnected();
    const state = makeGameState();

    act(() => {
      result.current.sendGameState(state, true);
    });
    act(() => {
      result.current.sendChat("gg");
    });
    act(() => {
      result.current.requestStateSync();
    });

    expect(result.current.getConnection()).toBeTruthy();
    expect(result.current.sendGameState(state, true)).toBe(true);
    expect(result.current.sendChat("gg")).toBe(true);
    expect(result.current.requestStateSync()).toBe(true);
  });

  it("returns failure results when there is no active connection", async () => {
    const { result } = renderHookWithDefaults();

    expect(result.current.sendGameState(makeGameState(), false)).toBe(false);
    expect(result.current.sendGameAction("cast", {})).toEqual({
      success: false,
    });
    expect(result.current.sendChat("hi")).toBe(false);
    expect(result.current.requestStateSync()).toBe(false);
  });

  it("sends game actions through the transport once connected", async () => {
    const { result } = await renderConnected();

    const outcome = result.current.sendGameAction("cast-spell", {
      cardId: "c1",
    });

    expect(outcome).toEqual({ success: true });
  });

  it("processAnswer and processIceCandidates delegate, throw, and surface errors", async () => {
    const { result } = renderHookWithDefaults();

    await expect(
      result.current.processAnswer({ type: "answer" }),
    ).rejects.toThrow("No active connection");
    await expect(
      result.current.processIceCandidates([{ candidate: "cand" }]),
    ).rejects.toThrow("No active connection");

    await act(async () => {
      await result.current.initializeAsHost();
    });
    await act(async () => {
      await result.current.processAnswer({ type: "answer", sdp: "a" });
    });
    await act(async () => {
      await result.current.processIceCandidates([{ candidate: "c" }]);
    });
    expect(result.current.error).toBeNull();

    // Transport rejection surfaces the message and rethrows.
    const conn = result.current.getConnection() as any;
    conn.processAnswer.mockRejectedValueOnce(new Error("bad sdp"));
    await expect(
      result.current.processAnswer({ type: "answer" }),
    ).rejects.toThrow("bad sdp");
    await waitFor(() => expect(result.current.error).toContain("bad sdp"));
  });

  it("initializeAsJoiner wires events, returns the local answer, and surfaces failures", async () => {
    const { result } = renderHookWithDefaults({ role: "joiner" });

    let answer: RTCSessionDescriptionInit = { type: "answer" };
    await act(async () => {
      answer = await result.current.initializeAsJoiner({
        type: "offer",
        sdp: "o",
      });
    });
    expect(answer).toEqual({ type: "answer", sdp: "answer-sdp" });
    expect(result.current.connectionState).toBe("disconnected");

    // Joiner-side reconnect ladder shares the same attempt tracking.
    act(() => capturedEvents.onConnectionStateChange("connected"));
    act(() => capturedEvents.onConnectionStateChange("reconnecting"));
    await waitFor(() => expect(result.current.reconnectAttempts).toBe(1));

    const failing = renderHookWithDefaults({ role: "joiner" });
    (
      mockCreateP2PGameConnection.mock.results[0] as unknown as { value: any }
    ).value = undefined;
    mockCreateP2PGameConnection.mockImplementationOnce(() => {
      const conn = makeMockConnection();
      conn.initializeAsJoiner.mockRejectedValueOnce(new Error("joiner boom"));
      return conn;
    });
    await expect(
      failing.result.current.initializeAsJoiner({ type: "offer", sdp: "o" }),
    ).rejects.toThrow("joiner boom");
    await waitFor(() =>
      expect(failing.result.current.error).toContain("joiner boom"),
    );
  });

  it("initializeAsHost surfaces transport failure and sets the failure diagnostic", async () => {
    mockCreateP2PGameConnection.mockImplementationOnce(() => {
      const conn = makeMockConnection();
      conn.initializeAsHost.mockRejectedValueOnce(new Error("host boom"));
      return conn;
    });
    const { result } = renderHookWithDefaults();

    await expect(result.current.initializeAsHost()).rejects.toThrow(
      "host boom",
    );
    await waitFor(() => expect(result.current.error).toContain("host boom"));
  });

  it("tracks the reconnection ladder, fires onReconnect, and acknowledges recovery", async () => {
    const { result } = await renderConnected();

    // Cache a state so the host reconnect path pushes authoritative state.
    act(() => {
      capturedEvents.onGameStateSync(makeGameState("game-recon"));
    });
    act(() => capturedEvents.onConnectionStateChange("disconnected"));
    await waitFor(() => expect(result.current.reconnectAttempts).toBe(1));
    act(() => capturedEvents.onConnectionStateChange("reconnecting"));
    await waitFor(() => expect(result.current.reconnectAttempts).toBe(2));

    // Transport-driven recovery resets the counter and flags the banner.
    act(() => capturedEvents.onReconnect());
    await waitFor(() => expect(result.current.reconnectAttempts).toBe(0));
    expect(result.current.reconnectedRecently).toBe(true);

    // Host push happened because the local peer is the authoritative host.
    const conn = result.current.getConnection() as any;
    expect(conn.sendGameState).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game-recon" }),
      true,
    );

    act(() => result.current.acknowledgeReconnect());
    expect(result.current.reconnectedRecently).toBe(false);

    // Uncached: attempts are capped at MAX_RECONNECT_ATTEMPTS_DISPLAY + 1.
    for (let i = 0; i < 6; i += 1) {
      act(() => capturedEvents.onConnectionStateChange("disconnected"));
    }
    await waitFor(() => expect(result.current.reconnectAttempts).toBe(4));
  });

  it("arms reconciliation and requests a snapshot when a peer reconnects", async () => {
    const { result } = renderHookWithDefaults({
      playerId: "player-2",
      role: "joiner",
      initialHostId: "player-1",
    });
    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents.onConnectionStateChange("connected"));

    // Peer-side reconnect: adopt-host-state arms the await + snapshot pull.
    act(() => capturedEvents.onReconnect());
    const conn = result.current.getConnection() as any;
    expect(conn.requestStateSync).toHaveBeenCalled();
  });

  it("closeConnection tears everything down and resets session bookkeeping", async () => {
    const { result } = await renderConnected({ gameCode: "game-close" });
    const conn = result.current.getConnection() as any;

    act(() => {
      result.current.closeConnection();
    });

    expect(conn.close).toHaveBeenCalled();
    expect(result.current.getConnection()).toBeNull();
    expect(result.current.connectionState).toBe("disconnected");
    expect(result.current.error).toBeNull();
    expect(result.current.gameEnded).toBeNull();
    expect(result.current.reconnectAttempts).toBe(0);
    expect(result.current.reconnectedRecently).toBe(false);
    expect(result.current.getConflictQueueSize()).toBe(0);
  });

  it("setLocalRole mirrors onto state and the transport", async () => {
    const { result } = await renderConnected();

    act(() => result.current.setLocalRole("spectator"));

    const conn = result.current.getConnection() as any;
    expect(conn.setLocalRole).toHaveBeenCalledWith("spectator");
  });

  it("cleans up the connection and handshake session on unmount", async () => {
    const { result, unmount } = renderHookWithDefaults({
      enableHandshake: true,
    });
    await act(async () => {
      await result.current.initializeAsHost();
    });
    const conn = result.current.getConnection() as any;

    unmount();

    expect(conn.close).toHaveBeenCalled();
  });
});

describe("useP2PConnection — game-ended persistence (#1570)", () => {
  it("persists a MatchRecord when the local player is in the standings", async () => {
    const { result } = await renderConnected();

    await act(async () => {
      await capturedEvents.onGameEnded(makeGameEndedPayload());
    });

    expect(result.current.gameEnded).toMatchObject({ gameId: "game-ended-1" });
    expect(mockMatchPut).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "game-ended-1::player-1",
        gameId: "game-ended-1",
        playerId: "player-1",
        position: 1,
        isWinner: true,
        durationMs: 60_000,
      }),
    );
  });

  it("skips persistence for a spectator not listed in the standings", async () => {
    const { result } = await renderConnected();

    await act(async () => {
      await capturedEvents.onGameEnded(
        makeGameEndedPayload({ includeLocalPlayer: false }),
      );
    });

    expect(result.current.gameEnded).toMatchObject({ gameId: "game-ended-1" });
    expect(mockMatchPut).not.toHaveBeenCalled();
  });

  it("keeps the session alive when the Dexie write throws", async () => {
    mockMatchPut.mockRejectedValueOnce(new Error("quota exceeded"));
    const { result } = await renderConnected();

    await act(async () => {
      await capturedEvents.onGameEnded(makeGameEndedPayload());
    });

    expect(result.current.gameEnded).toBeTruthy();
    expect(result.current.error).toBeNull();
  });
});

describe("useP2PConnection — reconnect tokens (#1254)", () => {
  it("looks up a stored token for the (gameCode, playerId) pair on mount", async () => {
    mockTokenStore.get.mockResolvedValue({
      sessionKey: "sk-1",
      hostPeerId: "host-1",
      gameCode: "game-abc",
      lastDeliveredSeq: 4,
      playerName: "Alice",
    });
    const { result } = renderHookWithDefaults({ gameCode: "game-abc" });

    await waitFor(() =>
      expect(result.current.reconnectToken).toMatchObject({
        sessionKey: "sk-1",
      }),
    );
    expect(mockTokenStore.get).toHaveBeenCalledWith("game-abc", "player-1");
  });

  it("survives a throwing lookup and clears tokens on demand", async () => {
    mockTokenStore.get.mockRejectedValueOnce(new Error("idb closed"));
    const { result } = renderHookWithDefaults({ gameCode: "game-abc" });

    await waitFor(() => expect(result.current.reconnectToken).toBeNull());

    await act(async () => {
      await result.current.clearReconnectToken();
    });
    expect(mockTokenStore.delete).toHaveBeenCalledWith("game-abc", "player-1");

    // No gameCode → clear is a no-op returning false.
    const noCode = renderHookWithDefaults();
    await act(async () => {
      await noCode.result.current.clearReconnectToken();
    });
  });

  it("persists a reconnect token after a successful handshake", async () => {
    const { result } = await renderConnected({
      gameCode: "game-abc",
      enableHandshake: true,
    });

    // The handshake effect created a session once connected.
    await waitFor(() => expect(MockHandshakeSession).toHaveBeenCalled());
    const [, , onHandshakeComplete] = MockHandshakeSession.mock.calls[0];

    await act(async () => {
      onHandshakeComplete(true, undefined);
    });

    expect(mockTokenStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "player-1",
        gameCode: "game-abc",
        hostPeerId: "player-1",
        lastDeliveredSeq: 7,
        playerName: "Alice",
      }),
    );

    // A failed handshake surfaces the reason instead of persisting.
    await act(async () => {
      onHandshakeComplete(false, "checksum-mismatch");
    });
    await waitFor(() =>
      expect(result.current.error).toContain("Handshake failed"),
    );
  });

  it("skips the token save when no gameCode is configured", async () => {
    await renderConnected({ enableHandshake: true });

    await waitFor(() => expect(MockHandshakeSession).toHaveBeenCalled());
    const [, , onHandshakeComplete] = MockHandshakeSession.mock.calls[0];

    await act(async () => {
      onHandshakeComplete(true, undefined);
    });

    expect(mockTokenStore.save).not.toHaveBeenCalled();
  });

  it("starts the handshake when a player joins and verifies sync checksums", async () => {
    const { result } = await renderConnected({
      gameCode: "game-abc",
      enableHandshake: true,
    });
    await waitFor(() => expect(MockHandshakeSession).toHaveBeenCalled());
    const session = MockHandshakeSession.mock.results[0].value;
    const conn = result.current.getConnection() as any;

    act(() => capturedEvents.onPlayerJoined("peer-2", "Bob"));
    expect(session.start).toHaveBeenCalledWith("peer-2");
    expect(conn.sendGameAction).toHaveBeenCalledWith(
      "handshake-init",
      expect.objectContaining({ nonce: "n1" }),
    );
  });

  it("cleans up the handshake when a player leaves", async () => {
    const { result } = await renderConnected({ enableHandshake: true });
    await waitFor(() => expect(MockHandshakeSession).toHaveBeenCalled());
    const session = MockHandshakeSession.mock.results[0].value;

    act(() => capturedEvents.onPlayerLeft("peer-2"));

    expect(session.cleanup).toHaveBeenCalled();
    expect(result.current.handshakeState).toBe("idle");
  });
});

describe("useP2PConnection — host migration wiring (#916)", () => {
  it("creates the manager, seeds the host roster, and handles promotion events", async () => {
    const onHostMigrated = jest.fn();
    const onGameTerminated = jest.fn();
    renderHookWithDefaults({
      enableHostMigration: true,
      initialHostId: "host-1",
      migrationPeers: [
        {
          playerId: "host-1",
          playerName: "Host",
          joinedAt: 1,
          joinSeq: 0,
        },
      ],
      onHostMigrated,
      onGameTerminated,
    });

    await waitFor(() =>
      expect(mockCreateHostMigrationManager).toHaveBeenCalled(),
    );
    expect(capturedMigrationEvents).toBeTruthy();

    // Local promotion rotates the session key and notifies the caller.
    const onPromoted = capturedMigrationEvents.onPromotedToHost as (
      r: any,
    ) => void;
    onPromoted({ newHostId: "peer-2", reason: "host-disconnected" });
    expect(onHostMigrated).toHaveBeenCalledWith(
      expect.objectContaining({ newHostId: "peer-2" }),
    );

    // Remote host change notifies without rotating keys.
    act(() => {
      (capturedMigrationEvents.onHostChanged as (r: any) => void)({
        newHostId: "peer-3",
      });
    });
    expect(onHostMigrated).toHaveBeenCalledWith(
      expect.objectContaining({ newHostId: "peer-3" }),
    );

    // Termination surfaces the reason and notifies.
    act(() => {
      (capturedMigrationEvents.onTerminated as (r: string) => void)(
        "too few peers",
      );
    });
    await waitFor(() =>
      expect(onGameTerminated).toHaveBeenCalledWith("too few peers"),
    );
  });

  it("registers joining peers with a host-attested joinSeq when local is host", async () => {
    const { result } = await renderConnected({
      enableHostMigration: true,
      initialHostId: "host-1",
    });
    const conn = result.current.getConnection() as any;

    act(() => capturedEvents.onPlayerJoined("peer-2", "Bob"));

    const manager = mockCreateHostMigrationManager.mock.results[0].value as any;
    expect(manager.assignNextJoinSeq).toHaveBeenCalledWith("peer-2", "Bob");
    expect(conn.sendGameAction).toHaveBeenCalledWith(
      "roster-assignment",
      expect.objectContaining({ playerId: "peer-2", joinSeq: 1 }),
    );
  });

  it("records follower join peers with a sentinel joinSeq when local is not host", async () => {
    mockCreateHostMigrationManager.mockImplementationOnce(() => {
      const manager = makeMockMigrationManager();
      manager.isLocalHost.mockReturnValue(false);
      return manager;
    });
    const { result } = renderHookWithDefaults({
      playerId: "player-2",
      role: "joiner",
      enableHostMigration: true,
      initialHostId: "host-1",
    });
    await act(async () => {
      await result.current.initializeAsJoiner({ type: "offer", sdp: "o" });
    });
    await waitFor(() =>
      expect(mockCreateHostMigrationManager).toHaveBeenCalled(),
    );

    act(() => capturedEvents.onPlayerJoined("peer-3", "Carol"));

    const manager = mockCreateHostMigrationManager.mock.results[0].value as any;
    expect(manager.upsertPeer).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId: "peer-3",
        joinSeq: Number.MAX_SAFE_INTEGER,
      }),
    );
  });

  it("routes roster-assignment and host-migration inbound game-actions", async () => {
    const { result } = await renderConnected({
      enableHostMigration: true,
      initialHostId: "host-1",
    });
    const manager = mockCreateHostMigrationManager.mock.results[0].value as any;

    act(() => {
      capturedEvents.onMessage({
        type: "game-action",
        data: {
          action: "roster-assignment",
          data: { playerId: "peer-2", joinSeq: 2 },
        },
      });
    });
    expect(manager.recordHostJoinSeq).toHaveBeenCalledWith("peer-2", 2);

    act(() => {
      capturedEvents.onMessage({
        type: "game-action",
        data: {
          action: "host-migration",
          data: { type: "host-migration", newHostId: "peer-2" },
        },
      });
    });
    expect(manager.applyMigration).toHaveBeenCalledWith(
      expect.objectContaining({ newHostId: "peer-2" }),
    );
    // applyMigration returned a result → host id state updated.
    expect(result.current.currentHostId).toBe("host-1");

    // Malformed payloads are dropped silently.
    act(() => {
      capturedEvents.onMessage({
        type: "game-action",
        data: { action: "roster-assignment", data: { joinSeq: 1 } },
      });
      capturedEvents.onMessage({
        type: "game-action",
        data: {
          action: "roster-assignment",
          data: { playerId: "p", joinSeq: -3 },
        },
      });
      capturedEvents.onMessage({
        type: "game-action",
        data: { action: "host-migration", data: { nope: true } },
      });
      capturedEvents.onMessage({
        type: "game-action",
        data: { action: "host-migration", data: "not-an-object" },
      });
      capturedEvents.onMessage({ type: "chat", data: {} });
    });
    expect(manager.recordHostJoinSeq).toHaveBeenCalledTimes(1);
    expect(manager.applyMigration).toHaveBeenCalledTimes(1);
  });

  it("runs migration when the host peer leaves and broadcasts the message", async () => {
    const { result } = await renderConnected({
      enableHostMigration: true,
      initialHostId: "host-1",
    });
    const conn = result.current.getConnection() as any;
    const manager = mockCreateHostMigrationManager.mock.results[0].value as any;

    // A non-host peer leaving is just roster bookkeeping.
    act(() => capturedEvents.onPlayerLeft("peer-2"));
    expect(manager.removePeer).toHaveBeenCalledWith("peer-2");
    expect(manager.initiateMigration).not.toHaveBeenCalled();

    // The host leaving triggers migration; the local peer is the successor.
    manager.getHostId.mockReturnValueOnce("host-1");
    act(() => capturedEvents.onPlayerLeft("host-1"));
    expect(manager.initiateMigration).toHaveBeenCalledWith("host-disconnected");
    expect(conn.sendGameAction).toHaveBeenCalledWith(
      "host-migration",
      expect.objectContaining({ type: "host-migration" }),
    );

    // Terminated migration does not broadcast.
    manager.initiateMigration.mockReturnValueOnce({ terminated: true });
    manager.getHostId.mockReturnValueOnce("host-1");
    const broadcasts = conn.sendGameAction.mock.calls.length;
    act(() => capturedEvents.onPlayerLeft("host-1"));
    expect(conn.sendGameAction.mock.calls.length).toBe(broadcasts);
  });

  it("caches received game state for migration", async () => {
    const { result } = await renderConnected({
      enableHostMigration: true,
      initialHostId: "host-1",
    });
    const manager = mockCreateHostMigrationManager.mock.results[0].value as any;
    const state = makeGameState("game-cache");

    act(() => capturedEvents.onGameStateSync(state));

    expect(manager.setLastKnownGameState).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game-cache" }),
    );
    expect(result.current.lastGameState).toMatchObject({
      gameId: "game-cache",
    });
  });
});

describe("rotateSessionKeyOnPromotion (#1391)", () => {
  it("is a no-op without a connection", () => {
    expect(rotateSessionKeyOnPromotion(null)).toBeNull();
  });

  it("installs a fresh 32-byte hex key on the live transport", () => {
    const conn = {
      getSessionKey: jest.fn().mockReturnValue("old-key"),
      setSessionKey: jest.fn(),
    } as any;

    const newKey = rotateSessionKeyOnPromotion(conn);

    expect(newKey).toMatch(/^[0-9a-f]{64}$/);
    expect(conn.setSessionKey).toHaveBeenCalledWith(newKey);
    expect(newKey).not.toBe("old-key");
  });
});
