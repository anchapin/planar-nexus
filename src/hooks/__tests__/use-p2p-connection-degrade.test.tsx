/**
 * use-p2p-connection — terminal P2P failure → degrade to local hot-seat (#1090).
 *
 * Drives the connection event wiring directly (the underlying transport is
 * mocked) to verify:
 *   - A terminal "failed" transition surfaces a distinct `terminalFailure`
 *     state (not just a generic error string).
 *   - continueAsLocalHotSeat() migrates the in-progress game state to local
 *     hot-seat storage with no data loss and flips `degradedToLocal`.
 *   - The degrade path never throws into the caller (graceful transition).
 *   - Degrading twice is idempotent — it does not re-save or corrupt state.
 *   - saveForLocalResume() persists without switching modes.
 *   - dismissTerminalFailure() clears the prompt without migrating.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useP2PConnection } from "../use-p2p-connection";
import { createP2PGameConnection } from "@/lib/p2p-game-connection";
import { saveGameForLocalHotSeat } from "@/lib/local-game-storage";
import type { GameState, PlayerId, Phase } from "@/lib/game-state/types";

// ---------------------------------------------------------------------------
// Mocks — jest.mock is hoisted above imports, so the factories use literal
// jest.fn() values. We access the live mock fns via the imported bindings
// (cast to jest.Mock), the repo convention (see use-storage-backup.test.ts).
// ---------------------------------------------------------------------------

// Capture the events the hook registers so tests can drive them directly.
let capturedEvents: {
  onConnectionStateChange: (state: string, ...args: unknown[]) => void;
  onGameStateSync: (gameState: GameState) => void;
  onError: (err: Error) => void;
} | null = null;

jest.mock("@/lib/p2p-game-connection", () => ({
  createP2PGameConnection: jest.fn(),
}));

jest.mock("@/lib/local-game-storage", () => ({
  saveGameForLocalHotSeat: jest.fn(),
}));

// The connection-health hook polls on an interval which loops forever under
// jsdom; stub it to a stable value so we can drive the degrade path in
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
    close: jest.fn(),
    getSignalingState: jest
      .fn()
      .mockReturnValue({ localOffer: { type: "offer", sdp: "x" } }),
    getLastFailureDiagnostic: jest.fn().mockReturnValue(null),
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

describe("useP2PConnection — terminal failure → local hot-seat (#1090)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedEvents = null;
    mockCreateP2PGameConnection.mockImplementation((opts: any) => {
      capturedEvents = opts.events;
      return makeMockConnection();
    });
    mockSaveGameForLocalHotSeat.mockResolvedValue({
      gameId: "hotseat_p2p_game-live-1",
      resumeKey: "p2p_game-live-1",
      gameStateVersion: 1,
      source: "p2p",
    });
  });

  it('surfaces a terminal "failed" state as a distinct terminalFailure flag', async () => {
    const { result } = renderHookWithDefaults();

    await act(async () => {
      await result.current.initializeAsHost();
    });
    // Establish a connection, then kill it terminally.
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    expect(result.current.terminalFailure).toBe(false);

    act(() => capturedEvents!.onConnectionStateChange("failed"));

    await waitFor(() => expect(result.current.terminalFailure).toBe(true));
    // It is distinct from the generic error string.
    expect(result.current.connectionState).toBe("failed");
    expect(result.current.degradedToLocal).toBe(false);
  });

  it("migrates the in-progress game to local storage with no data loss and no throw", async () => {
    const onDegradedToLocal = jest.fn();
    const { result } = renderHookWithDefaults({ onDegradedToLocal });
    const state = makeGameState("game-live-1");

    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    // Host broadcasts a full game-state sync → cached for migration.
    act(() => {
      result.current.sendGameState(state, true);
    });
    act(() => capturedEvents!.onConnectionStateChange("failed"));
    await waitFor(() => expect(result.current.terminalFailure).toBe(true));

    let migrationResult: { ok?: boolean } = {};
    await act(async () => {
      // Must not throw even if storage hiccups.
      migrationResult = await result.current.continueAsLocalHotSeat();
    });

    expect(migrationResult.ok).toBe(true);
    // The live game state was handed to local storage verbatim.
    expect(mockSaveGameForLocalHotSeat).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: "game-live-1", status: "in_progress" }),
      expect.objectContaining({ playerName: "Alice" }),
    );
    // Mode flipped to local.
    expect(result.current.degradedToLocal).toBe(true);
    // Terminal prompt is dismissed once degraded.
    expect(result.current.terminalFailure).toBe(false);
    // Caller notified with the migrated game id.
    expect(onDegradedToLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        gameId: "hotseat_p2p_game-live-1",
        hadGameState: true,
      }),
    );
  });

  it("is idempotent: degrading twice does not re-save or corrupt state", async () => {
    const { result } = renderHookWithDefaults();
    const state = makeGameState("game-idem");

    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    act(() => {
      result.current.sendGameState(state, true);
    });
    act(() => capturedEvents!.onConnectionStateChange("failed"));
    await waitFor(() => expect(result.current.terminalFailure).toBe(true));

    await act(async () => {
      await result.current.continueAsLocalHotSeat();
    });
    expect(mockSaveGameForLocalHotSeat).toHaveBeenCalledTimes(1);

    // Second call must be a no-op (no second save, no throw).
    let second: { ok?: boolean } = {};
    await act(async () => {
      second = await result.current.continueAsLocalHotSeat();
    });
    expect(second.ok).toBe(true);
    expect(mockSaveGameForLocalHotSeat).toHaveBeenCalledTimes(1);
    expect(result.current.degradedToLocal).toBe(true);
  });

  it("never throws when the storage migration rejects", async () => {
    mockSaveGameForLocalHotSeat.mockRejectedValue(new Error("indexeddb full"));
    const { result } = renderHookWithDefaults();
    const state = makeGameState("game-fail");

    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    act(() => {
      result.current.sendGameState(state, true);
    });
    act(() => capturedEvents!.onConnectionStateChange("failed"));
    await waitFor(() => expect(result.current.terminalFailure).toBe(true));

    let res: { ok?: boolean; error?: string } = {};
    await act(async () => {
      res = await result.current.continueAsLocalHotSeat();
    });
    // Graceful: error surfaced as a result, not thrown.
    expect(res.ok).toBe(false);
    expect(res.error).toContain("indexeddb full");
    expect(result.current.degradedToLocal).toBe(false);
  });

  it("saveForLocalResume persists without switching modes", async () => {
    const { result } = renderHookWithDefaults();
    const state = makeGameState("game-resume");

    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    act(() => {
      result.current.sendGameState(state, true);
    });

    let res: { ok?: boolean; resumeKey?: string } = {};
    await act(async () => {
      res = await result.current.saveForLocalResume();
    });
    expect(res.ok).toBe(true);
    expect(res.resumeKey).toBeTruthy();
    expect(mockSaveGameForLocalHotSeat).toHaveBeenCalled();
    // Mode is NOT flipped by a "save for later".
    expect(result.current.degradedToLocal).toBe(false);
  });

  it("dismissTerminalFailure clears the prompt without migrating", async () => {
    const { result } = renderHookWithDefaults();

    await act(async () => {
      await result.current.initializeAsHost();
    });
    act(() => capturedEvents!.onConnectionStateChange("connected"));
    act(() => capturedEvents!.onConnectionStateChange("failed"));
    await waitFor(() => expect(result.current.terminalFailure).toBe(true));

    act(() => result.current.dismissTerminalFailure());
    expect(result.current.terminalFailure).toBe(false);
    expect(result.current.degradedToLocal).toBe(false);
    expect(mockSaveGameForLocalHotSeat).not.toHaveBeenCalled();
  });
});
