/**
 * Issue #1255 — lobby ready-check state machine + post-rejoin seat reservation.
 *
 * Verifies the acceptance criteria from issue #1255:
 *
 *   - WAITING → READY_CHECK → STARTING → IN_GAME → ENDED transitions
 *   - Full-roster ready check (15 s window) reaches quorum when every
 *     non-spectator peer has answered
 *   - Quorum fallback: when the window expires with at least one missing
 *     response, the host can still force-advance to `STARTING`
 *   - Late joiner during `IN_GAME` triggers a brief (10 s) single-peer
 *     ready check
 *   - `canStartGame` is false while the lobby is in `WAITING` /
 *     `READY_CHECK` and only true after the state machine has reached
 *     `STARTING` (atomic gate against the timestamp-based race in #1255)
 *   - Refresh-mid-game peer holds their seat for 30 s while the
 *     reconnect-token store attempts rejoin; a late joiner is rejected
 *     with `seat-held`
 *   - State machine rejects illegal transitions (e.g. WAITING → IN_GAME)
 *   - Cancelled sessions drop late `READY_CHECK_RESPONSE` messages
 *   - `closeLobby` resets the state machine to a clean state
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("../public-lobby-browser", () => ({
  publicLobbyBrowser: {
    registerPublicGame: jest.fn(),
    updatePublicGame: jest.fn(),
    unregisterPublicGame: jest.fn(),
  },
}));

jest.mock("../game-code-generator", () => ({
  generateGameCode: jest.fn(() => "ABC123"),
  generateLobbyId: jest.fn(() => "lobby-rc"),
  generatePlayerId: jest.fn(() => "player-rc"),
  formatGameCode: jest.fn((code: string) => code),
}));

jest.mock("../format-validator", () => ({
  validateDeckForLobby: jest.fn(() => ({
    valid: true,
    isValid: true,
    canPlay: true,
    errors: [],
    warnings: [],
  })),
}));

jest.mock("../game-mode", () => ({
  getGameModeForPlayerCount: jest.fn(() => "duel"),
  getGameModeConfig: jest.fn(() => ({
    name: "Duel",
    isTeamMode: false,
    minPlayers: 2,
    maxPlayers: 2,
  })),
}));

import {
  lobbyManager,
  LOBBY_READY_CHECK_WINDOW_MS,
  LOBBY_LATE_JOINER_READY_CHECK_MS,
  LOBBY_SEAT_HOLD_DURATION_MS,
} from "../lobby-manager";
import { generateGameCode, generatePlayerId } from "../game-code-generator";

const baseConfig = {
  name: "Ready-Check Test",
  format: "commander" as const,
  maxPlayers: "4" as const,
  settings: {
    isPublic: false,
    allowSpectators: false,
    timerEnabled: false,
  },
};

  /**
   * Helper: add a non-host player with a deck so `allPlayersReady` /
   * `canStartGame` can return true once they affirm ready. Returns the
   * generated peerId.
   */
  function addPeerWithDeck(name: string, deckId = `deck-${name}`): string {
    const peer = lobbyManager.addPlayer(name);
    if (!peer) throw new Error(`addPlayer returned null for ${name}`);
    lobbyManager.updatePlayerDeck(peer.id, deckId, `${name}'s deck`);
    return peer.id;
  }

  /**
   * Helper: give the host a deck so `canStartGame` (which requires
   * every player — host included — to have a deck without validation
   * errors) can return true. Returns the host playerId.
   */
  function giveHostADeck(deckId = "deck-host"): string {
    const hostId = lobbyManager.getHostPlayerId()!;
    lobbyManager.updatePlayerDeck(hostId, deckId, "Host's deck");
    return hostId;
  }

describe("Issue #1255 — lobby ready-check state machine", () => {
  let now = 0;
  let realDateNow: () => number;
  let mockPlayerCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    lobbyManager.closeLobby();
    // Issue #1277 — reset the per-lobby mutation budget so each test
    // starts with a full 60-event token bucket. Without this, the
    // cumulative mutations from this 30+ test file exhaust the bucket
    // and later tests would see `addPlayer` returning null.
    lobbyManager.resetMutationBudget();

    realDateNow = Date.now;
    now = 1_700_000_000_000;
    Date.now = () => now;

    mockPlayerCounter = 0;
    (generatePlayerId as jest.Mock).mockImplementation(
      () => `player-${++mockPlayerCounter}`,
    );
    (generateGameCode as jest.Mock).mockReturnValue("ABC123");
  });

  afterEach(() => {
    Date.now = realDateNow;
    lobbyManager.closeLobby();
    localStorage.clear();
  });

  describe("initial state", () => {
    it("a fresh lobby starts in WAITING with no active ready check", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
      expect(lobbyManager.getActiveReadyCheck()).toBeNull();
      expect(lobbyManager.getActiveSeatHolds()).toEqual([]);
    });

    it("getLobbyState returns WAITING when no lobby is active", () => {
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
    });

    it("the lobby `state` field round-trips through localStorage", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.beginReadyCheck();
      const raw = localStorage.getItem("planar_nexus_current_lobby");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.state).toBe("READY_CHECK");
    });

    it("closeLobby resets the state machine", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.beginReadyCheck();
      lobbyManager.holdSeatForRejoin("peer-x", "Alex");
      lobbyManager.closeLobby();
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
      expect(lobbyManager.getActiveReadyCheck()).toBeNull();
      expect(lobbyManager.getActiveSeatHolds()).toEqual([]);
    });
  });

  describe("beginReadyCheck", () => {
    it("transitions WAITING → READY_CHECK and returns a sessionId", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const result = lobbyManager.beginReadyCheck();
      expect(result.started).toBe(true);
      expect(result.sessionId).toMatch(/^rc-\d+$/);
      expect(lobbyManager.getLobbyState()).toBe("READY_CHECK");
    });

    it("opens a check targeting every roster member (host + peers)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      addPeerWithDeck("Peer B");
      const result = lobbyManager.beginReadyCheck();
      expect(result.started).toBe(true);
      const session = lobbyManager.getActiveReadyCheck()!;
      expect(session.targetPeerIds).toHaveLength(3); // host + 2 peers
      expect(session.windowMs).toBe(LOBBY_READY_CHECK_WINDOW_MS);
      expect(session.kind).toBe("full");
    });

    it("a second beginReadyCheck while a session is open is a no-op", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const first = lobbyManager.beginReadyCheck();
      const second = lobbyManager.beginReadyCheck();
      expect(first.started).toBe(true);
      expect(second.started).toBe(false);
      expect(second.reason).toMatch(/in progress/i);
      expect(second.sessionId).toBe(first.sessionId);
    });

    it("refuses to start a full check during an active game", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      // Drive the state machine to IN_GAME.
      lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        lobbyManager.getActiveReadyCheck()!.id,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();
      expect(lobbyManager.getLobbyState()).toBe("IN_GAME");

      const result = lobbyManager.beginReadyCheck("full");
      expect(result.started).toBe(false);
      expect(result.reason).toMatch(/active game/i);
    });

    it("a late-joiner check is permitted during IN_GAME (single-peer gate)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        lobbyManager.getActiveReadyCheck()!.id,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();
      expect(lobbyManager.getLobbyState()).toBe("IN_GAME");

      const result = lobbyManager.beginReadyCheck("late-joiner", ["peer-x"]);
      expect(result.started).toBe(true);
      const session = lobbyManager.getActiveReadyCheck()!;
      expect(session.kind).toBe("late-joiner");
      expect(session.windowMs).toBe(LOBBY_LATE_JOINER_READY_CHECK_MS);
    });
  });

  describe("recordReadyResponse", () => {
    it("a quorum of `ready: true` responses reaches quorumReached", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const sessionId = lobbyManager.getActiveReadyCheck()!.id;
      lobbyManager.recordReadyResponse(
        sessionId,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      const r2 = lobbyManager.recordReadyResponse(sessionId, peerA, true);
      expect(r2.accepted).toBe(true);
      expect(r2.quorumReached).toBe(true);
      expect(r2.late).toBe(false);
    });

    it("a `ready: false` response still counts as an answer (quorum = all answered)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const sessionId = lobbyManager.getActiveReadyCheck()!.id;
      lobbyManager.recordReadyResponse(
        sessionId,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      const r2 = lobbyManager.recordReadyResponse(sessionId, peerA, false);
      expect(r2.accepted).toBe(true);
      expect(r2.quorumReached).toBe(true);
    });

    it("an unknown sessionId is rejected and counted as dropped", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const before = lobbyManager.readyCheckDropped;
      const result = lobbyManager.recordReadyResponse(
        "rc-999",
        "peer-x",
        true,
      );
      expect(result.accepted).toBe(false);
      expect(result.late).toBe(true);
      expect(lobbyManager.readyCheckDropped).toBe(before + 1);
    });

    it("a response from a non-target peer is rejected (not dropped)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const sessionId = lobbyManager.getActiveReadyCheck()!.id;
      const before = lobbyManager.readyCheckDropped;
      const result = lobbyManager.recordReadyResponse(
        sessionId,
        "spectator-peer",
        true,
      );
      expect(result.accepted).toBe(false);
      expect(result.late).toBe(false);
      // Non-target responses are a UI-level error, not a dropped message.
      expect(lobbyManager.readyCheckDropped).toBe(before);
    });

    it("a response after the window expired is dropped and counted", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const sessionId = lobbyManager.getActiveReadyCheck()!.id;
      now += LOBBY_READY_CHECK_WINDOW_MS + 1;
      const before = lobbyManager.readyCheckDropped;
      const result = lobbyManager.recordReadyResponse(
        sessionId,
        peerA,
        true,
      );
      expect(result.accepted).toBe(false);
      expect(result.late).toBe(true);
      expect(lobbyManager.readyCheckDropped).toBe(before + 1);
    });

    it("a response after cancel is dropped", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.cancelReadyCheck();
      const before = lobbyManager.readyCheckDropped;
      const result = lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "peer-x",
        true,
      );
      expect(result.accepted).toBe(false);
      expect(result.late).toBe(true);
      expect(lobbyManager.readyCheckDropped).toBe(before + 1);
    });
  });

  describe("evaluateReadyCheck", () => {
    it("reports elapsed / remaining / pending accurately as time advances", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const sessionId = lobbyManager.getActiveReadyCheck()!.id;

      // At t=0, the window is fully open.
      let eval0 = lobbyManager.evaluateReadyCheck()!;
      expect(eval0.elapsedMs).toBe(0);
      expect(eval0.remainingMs).toBe(LOBBY_READY_CHECK_WINDOW_MS);
      expect(eval0.windowExpired).toBe(false);
      expect(eval0.quorumReached).toBe(false);
      expect(eval0.pendingPeerIds).toContain(
        lobbyManager.getCurrentLobby()!.hostId,
      );
      expect(eval0.pendingPeerIds).toContain(peerA);

      // The host answers; quorum is still pending on peer A.
      lobbyManager.recordReadyResponse(
        sessionId,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      eval0 = lobbyManager.evaluateReadyCheck()!;
      expect(eval0.quorumReached).toBe(false);
      expect(eval0.pendingPeerIds).toEqual([peerA]);

      // 5 s later, the window is still open.
      now += 5_000;
      const eval5 = lobbyManager.evaluateReadyCheck()!;
      expect(eval5.elapsedMs).toBe(5_000);
      expect(eval5.remainingMs).toBe(LOBBY_READY_CHECK_WINDOW_MS - 5_000);
      expect(eval5.windowExpired).toBe(false);

      // Past the window without peer A's answer.
      now += LOBBY_READY_CHECK_WINDOW_MS;
      const evalExpired = lobbyManager.evaluateReadyCheck()!;
      expect(evalExpired.windowExpired).toBe(true);
      expect(evalExpired.remainingMs).toBe(0);
      expect(evalExpired.quorumReached).toBe(false);
    });

    it("returns null when no check is active", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.evaluateReadyCheck()).toBeNull();
    });
  });

  describe("advanceToStarting", () => {
    it("transitions READY_CHECK → STARTING when quorum is reached", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(opened.sessionId!, peerA, true);
      const advanced = lobbyManager.advanceToStarting();
      expect(advanced).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("STARTING");
      expect(lobbyManager.getActiveReadyCheck()).toBeNull();
    });

    it("refuses to advance when quorum is not reached (no force flag)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const advanced = lobbyManager.advanceToStarting();
      expect(advanced).toBe(false);
      expect(lobbyManager.getLobbyState()).toBe("READY_CHECK");
    });

    it("force-advance transitions to STARTING even with missing responses", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      now += LOBBY_READY_CHECK_WINDOW_MS + 1;
      const advanced = lobbyManager.advanceToStarting({ force: true });
      expect(advanced).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("STARTING");
    });

    it("refuses to advance when no check is active", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.advanceToStarting({ force: true })).toBe(false);
    });

    it("refuses to advance a cancelled session", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      lobbyManager.cancelReadyCheck();
      const advanced = lobbyManager.advanceToStarting({ force: true });
      expect(advanced).toBe(false);
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
    });
  });

  describe("canStartGame atomic gate", () => {
    it("is false in WAITING", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      // All players are ready, decks are valid, but the state machine is
      // still WAITING (no ready check yet).
      lobbyManager.updatePlayerStatus("player-1", "ready");
      expect(lobbyManager.canStartGame()).toBe(false);
    });

    it("is false during READY_CHECK even when all players are ready", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.updatePlayerStatus("player-1", "ready");
      lobbyManager.beginReadyCheck();
      expect(lobbyManager.canStartGame()).toBe(false);
    });

    it("is true once the lobby reaches STARTING via the ready check", () => {
      // Use a 2-player lobby so `allPlayersReady` (which gates on
      // `players.length === maxPlayers`) returns true with just host + 1 peer.
      const config2 = { ...baseConfig, maxPlayers: "2" as const };
      lobbyManager.createLobby(config2, "Host");
      giveHostADeck();
      const peerA = addPeerWithDeck("Peer A");
      lobbyManager.updatePlayerStatus(peerA, "ready");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(opened.sessionId!, peerA, true);
      lobbyManager.advanceToStarting();
      expect(lobbyManager.canStartGame()).toBe(true);
    });
  });

  describe("startInGame / endGame transitions", () => {
    it("STARTING → IN_GAME only via startInGame", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      expect(lobbyManager.startInGame()).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("IN_GAME");
    });

    it("endGame transitions IN_GAME → ENDED", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();
      expect(lobbyManager.endGame()).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("ENDED");
    });

    it("startInGame refuses when not in STARTING", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      // Lobby is in WAITING — startInGame must refuse.
      expect(lobbyManager.startInGame()).toBe(false);
    });

    it("endGame refuses when not in IN_GAME", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.endGame()).toBe(false);
    });
  });

  describe("cancelReadyCheck", () => {
    it("transitions READY_CHECK → WAITING and clears the session", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      const result = lobbyManager.cancelReadyCheck("test-cancel");
      expect(result.cancelled).toBe(true);
      expect(result.reason).toBe("test-cancel");
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
      expect(lobbyManager.getActiveReadyCheck()).toBeNull();
    });

    it("is a no-op when no session is active", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const result = lobbyManager.cancelReadyCheck();
      expect(result.cancelled).toBe(false);
    });
  });

  describe("state machine guards", () => {
    it("rejects illegal transitions: WAITING → IN_GAME", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      // The only legal exit from WAITING is READY_CHECK (via
      // beginReadyCheck) or ENDED. startInGame is the IN_GAME setter
      // and must refuse when not in STARTING.
      expect(lobbyManager.startInGame()).toBe(false);
      expect(lobbyManager.getLobbyState()).toBe("WAITING");
    });

    it("rejects illegal transitions: READY_CHECK → IN_GAME (must go via STARTING)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      lobbyManager.beginReadyCheck();
      expect(lobbyManager.startInGame()).toBe(false);
      expect(lobbyManager.getLobbyState()).toBe("READY_CHECK");
    });

    it("rejects illegal transitions: STARTING → ENDED without IN_GAME", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      expect(lobbyManager.endGame()).toBe(false);
      expect(lobbyManager.getLobbyState()).toBe("STARTING");
    });
  });

  describe("seat-hold semantics (issue #1255 AC: refresh-mid-game peer holds seat for 30s)", () => {
    it("holdSeatForRejoin creates a 30 s hold", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const hold = lobbyManager.holdSeatForRejoin("peer-x", "Alex");
      expect(hold.expiresAt - hold.heldAt).toBe(LOBBY_SEAT_HOLD_DURATION_MS);
      expect(hold.reason).toBe("peer-disconnected");
      expect(lobbyManager.isSeatHeld("peer-x")).toBe(true);
    });

    it("isSeatHeld auto-purges expired holds", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.holdSeatForRejoin("peer-x", "Alex");
      now += LOBBY_SEAT_HOLD_DURATION_MS + 1;
      expect(lobbyManager.isSeatHeld("peer-x")).toBe(false);
      expect(lobbyManager.getActiveSeatHolds()).toEqual([]);
    });

    it("releaseSeatHold removes the hold and reports success", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.holdSeatForRejoin("peer-x", "Alex");
      expect(lobbyManager.releaseSeatHold("peer-x")).toBe(true);
      expect(lobbyManager.isSeatHeld("peer-x")).toBe(false);
      // A second release is a no-op.
      expect(lobbyManager.releaseSeatHold("peer-x")).toBe(false);
    });

    it("getActiveSeatHolds returns remainingMs for each entry", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.holdSeatForRejoin("peer-x", "Alex");
      const list = lobbyManager.getActiveSeatHolds();
      expect(list).toHaveLength(1);
      expect(list[0].remainingMs).toBe(LOBBY_SEAT_HOLD_DURATION_MS);

      // 10 s later, remaining drops to 20 s.
      now += 10_000;
      const refreshed = lobbyManager.getActiveSeatHolds();
      expect(refreshed[0].remainingMs).toBe(
        LOBBY_SEAT_HOLD_DURATION_MS - 10_000,
      );
    });

    it("joinMidGame rejects a late joiner while a seat is held", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      // Drive the state machine to IN_GAME.
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();

      // Peer A refreshes; the host reserves their seat for 30 s.
      lobbyManager.holdSeatForRejoin("player-2", "Peer A");

      // A new joiner arrives while the seat is held.
      const result = lobbyManager.joinMidGame("Newcomer");
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe("seat-held");
      expect(result.heldFor).toBe("Peer A");
    });

    it("joinMidGame accepts a late joiner after the seat-hold window expires", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();

      // Hold peer A's seat, then advance the clock past the 30 s window.
      lobbyManager.holdSeatForRejoin("player-2", "Peer A");
      now += LOBBY_SEAT_HOLD_DURATION_MS + 1;

      const result = lobbyManager.joinMidGame("Newcomer");
      expect(result.accepted).toBe(true);
      expect(result.player).toBeDefined();
      expect(result.readyCheckSessionId).toMatch(/^rc-\d+$/);
    });

    it("joinMidGame opens a brief (10 s) single-peer ready check for the joiner", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();

      const result = lobbyManager.joinMidGame("Newcomer");
      const session = lobbyManager.getActiveReadyCheck()!;
      expect(session.kind).toBe("late-joiner");
      expect(session.windowMs).toBe(LOBBY_LATE_JOINER_READY_CHECK_MS);
      expect(session.targetPeerIds).toEqual([result.player!.id]);
    });

    it("releaseSeatHold allows a new joiner while the original peer reconnects", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      addPeerWithDeck("Peer A");
      const opened = lobbyManager.beginReadyCheck();
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        "player-2",
        true,
      );
      lobbyManager.advanceToStarting();
      lobbyManager.startInGame();

      lobbyManager.holdSeatForRejoin("player-2", "Peer A");
      // The reconnect-token store succeeds → host releases the hold.
      expect(lobbyManager.releaseSeatHold("player-2")).toBe(true);

      // Now the host can fill the seat with a new joiner.
      const result = lobbyManager.joinMidGame("Newcomer");
      expect(result.accepted).toBe(true);
    });
  });

  describe("end-to-end: full flow with multiple peers", () => {
    it("3-peer lobby goes from WAITING to IN_GAME through the state machine", () => {
      // Use a 3-player lobby so `allPlayersReady` returns true once
      // every member affirms ready (the lobby must be at max capacity
      // for the existing roster check to pass).
      const config3 = { ...baseConfig, maxPlayers: "3" as const };
      lobbyManager.createLobby(config3, "Host");
      giveHostADeck();
      const peerA = addPeerWithDeck("Peer A");
      const peerB = addPeerWithDeck("Peer B");
      // Mark them ready so the allReady check would otherwise pass.
      lobbyManager.updatePlayerStatus(peerA, "ready");
      lobbyManager.updatePlayerStatus(peerB, "ready");

      // The host clicks "Start Game" → opens a full ready check.
      const opened = lobbyManager.beginReadyCheck();
      expect(lobbyManager.getLobbyState()).toBe("READY_CHECK");
      expect(lobbyManager.canStartGame()).toBe(false);

      // Peers respond (host is implicit by clicking the button).
      const r1 = lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      expect(r1.quorumReached).toBe(false);
      const r2 = lobbyManager.recordReadyResponse(
        opened.sessionId!,
        peerA,
        true,
      );
      expect(r2.quorumReached).toBe(false);
      const r3 = lobbyManager.recordReadyResponse(
        opened.sessionId!,
        peerB,
        true,
      );
      expect(r3.quorumReached).toBe(true);

      // Host advances → STARTING. canStartGame is now true.
      expect(lobbyManager.advanceToStarting()).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("STARTING");
      expect(lobbyManager.canStartGame()).toBe(true);

      // Host broadcasts the start signal; all peers echo it back; the
      // host flips the lobby to IN_GAME.
      expect(lobbyManager.startInGame()).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("IN_GAME");
      // canStartGame is now false again — STARTING was a one-shot gate.
      expect(lobbyManager.canStartGame()).toBe(false);
    });

    it("quorum-by-timeout: missing peer is force-advanced through STARTING", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peerA = addPeerWithDeck("Peer A");
      const peerB = addPeerWithDeck("Peer B");
      lobbyManager.updatePlayerStatus(peerA, "ready");
      lobbyManager.updatePlayerStatus(peerB, "ready");

      const opened = lobbyManager.beginReadyCheck();
      // Only the host responds; peer A and peer B are silent.
      lobbyManager.recordReadyResponse(
        opened.sessionId!,
        lobbyManager.getCurrentLobby()!.hostId,
        true,
      );
      expect(lobbyManager.getActiveReadyCheck()!.responses).toHaveProperty(
        lobbyManager.getCurrentLobby()!.hostId,
      );

      // 15 s elapse without further responses.
      now += LOBBY_READY_CHECK_WINDOW_MS + 1;
      const evalResult = lobbyManager.evaluateReadyCheck()!;
      expect(evalResult.windowExpired).toBe(true);
      expect(evalResult.quorumReached).toBe(false);
      expect(evalResult.pendingPeerIds).toEqual([peerA, peerB]);

      // Host force-advances; the state machine reaches STARTING.
      expect(lobbyManager.advanceToStarting({ force: true })).toBe(true);
      expect(lobbyManager.getLobbyState()).toBe("STARTING");
    });
  });
});
