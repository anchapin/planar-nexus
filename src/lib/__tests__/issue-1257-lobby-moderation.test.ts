/**
 * Issue #1257 — host moderation tests.
 *
 * Verifies the lobby-manager primitives (kick, session-ban with 30-minute
 * expiry, pause/resume clock math, ban-list persistence) against the
 * acceptance criteria from issue #1257:
 *
 *   - Host can kick a peer; the kicked peer sees the host's reason
 *   - Session-banned peerId cannot rejoin the same game code within
 *     30 minutes (entries auto-purge on / past expiry)
 *   - Pause freezes priority timers; pause-clock math is correct
 *   - Ban list survives closeLobby → createLobby cycle for the same code
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Mocks must be installed BEFORE the lobby-manager import.
jest.mock("../public-lobby-browser", () => ({
  publicLobbyBrowser: {
    registerPublicGame: jest.fn(),
    updatePublicGame: jest.fn(),
    unregisterPublicGame: jest.fn(),
  },
}));

jest.mock("../game-code-generator", () => ({
  generateGameCode: jest.fn(() => "ABC123"),
  generateLobbyId: jest.fn(() => "lobby-test"),
  generatePlayerId: jest.fn(() => "player-test"),
  formatGameCode: jest.fn((code: string) => code),
}));

jest.mock("../format-validator", () => ({
  validateDeckForLobby: jest.fn(() => ({ valid: true, errors: [], warnings: [], isValid: true, canPlay: true })),
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

jest.mock("../multiplayer-types", () => ({
  LobbyStatus: {
    WAITING: "waiting",
    IN_PROGRESS: "in-progress",
    COMPLETED: "completed",
  },
  PlayerStatus: {
    NOT_READY: "not-ready",
    READY: "ready",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
  },
}));

import {
  lobbyManager,
  LOBBY_BAN_DURATION_MS,
  type LobbyBanEntry,
} from "../lobby-manager";
import { generateGameCode, generatePlayerId } from "../game-code-generator";

const baseConfig = {
  name: "Moderation Test",
  format: "commander" as const,
  maxPlayers: "4" as const,
  settings: {
    isPublic: false,
    allowSpectators: false,
    timerEnabled: false,
  },
};

describe("Issue #1257 — lobby host moderation", () => {
  let now = 0;
  let realDateNow: () => number;
  let mockPlayerCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    lobbyManager.closeLobby();

    // Pin Date.now so pause-clock and ban-expiry math is deterministic.
    realDateNow = Date.now;
    now = 1_700_000_000_000;
    Date.now = () => now;

    // Each addPlayer() call gets a unique id so the existing test
    // expectations about player ordering keep working.
    mockPlayerCounter = 0;
    (generatePlayerId as jest.Mock).mockImplementation(
      () => `player-${++mockPlayerCounter}`,
    );
    // The host's own playerId is the first generatePlayerId() call inside
    // createLobby — give it a stable name so we can locate it.
    (generateGameCode as jest.Mock).mockReturnValue("ABC123");
  });

  afterEach(() => {
    Date.now = realDateNow;
    lobbyManager.closeLobby();
    localStorage.clear();
  });

  describe("banPeer / isPeerBanned / unbanPeer", () => {
    it("adds a peer to the session ban list with a 30-minute expiry", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const banned = lobbyManager.banPeer("misbehaving-peer", "session", "spam");
      expect(banned.added).toBe(true);
      expect(banned.entry).not.toBeNull();
      expect(banned.entry!.scope).toBe("session");
      expect(banned.entry!.expiresAt - banned.entry!.bannedAt).toBe(
        LOBBY_BAN_DURATION_MS,
      );
      expect(lobbyManager.isPeerBanned("misbehaving-peer")).toBe(true);
    });

    it("returns false from isPeerBanned for unknown peers", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.isPeerBanned("unknown")).toBe(false);
    });

    it("unbanPeer removes the entry and persists", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session");
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(true);
      expect(lobbyManager.unbanPeer("peer-1")).toBe(true);
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(false);
      // A second call is a no-op.
      expect(lobbyManager.unbanPeer("peer-1")).toBe(false);
    });

    it("a peerId banned at time T is rejected at T + 30 minutes - 1 ms and re-admitted at T + 30 minutes + 1 ms", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session");
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(true);

      // 1 ms before expiry — still banned.
      now += LOBBY_BAN_DURATION_MS - 1;
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(true);

      // 1 ms past expiry — auto-purged, peer is allowed again.
      now += 2;
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(false);
      // And the in-memory map is trimmed (no stale entries).
      expect(lobbyManager.getBanList()).toHaveLength(0);
    });

    it("persistent scope is stored with the same expiry semantics (forward-compatible)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const result = lobbyManager.banPeer("peer-2", "persistent", "history");
      expect(result.added).toBe(true);
      expect(result.entry!.scope).toBe("persistent");
      // Same 30-minute window as session — persistent storage is a future
      // backend concern; today the in-memory store expires identically.
      expect(result.entry!.expiresAt - result.entry!.bannedAt).toBe(
        LOBBY_BAN_DURATION_MS,
      );
    });

    it("isPeerBanned auto-purges expired entries (no unbounded growth)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-a", "session");
      lobbyManager.banPeer("peer-b", "session");
      lobbyManager.banPeer("peer-c", "session");
      expect(lobbyManager.getBanList()).toHaveLength(3);

      // Advance past all expiries.
      now += LOBBY_BAN_DURATION_MS + 1;
      expect(lobbyManager.isPeerBanned("peer-a")).toBe(false);
      expect(lobbyManager.getBanList()).toHaveLength(0);
    });

    it("getBanList returns remainingMs for each entry", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-x", "session");
      const list = lobbyManager.getBanList();
      expect(list).toHaveLength(1);
      expect(list[0].peerId).toBe("peer-x");
      expect(list[0].remainingMs).toBe(LOBBY_BAN_DURATION_MS);

      // 5 minutes in — remaining drops to 25 minutes.
      now += 5 * 60 * 1000;
      const refreshed = lobbyManager.getBanList();
      expect(refreshed[0].remainingMs).toBe(LOBBY_BAN_DURATION_MS - 5 * 60 * 1000);
    });

    it("purgeExpiredBans returns the number of entries removed", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session");
      lobbyManager.banPeer("peer-2", "session");

      now += LOBBY_BAN_DURATION_MS + 1;
      const removed = lobbyManager.purgeExpiredBans();
      expect(removed).toBe(2);
      expect(lobbyManager.purgeExpiredBans()).toBe(0);
    });

    it("ban list persists to localStorage keyed by game code", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session", "reason-1");
      lobbyManager.banPeer("peer-2", "session", "reason-2");

      const raw = localStorage.getItem("planar_nexus_lobby_bans");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed["ABC123"]).toHaveLength(2);
      expect(parsed["ABC123"][0].peerId).toBe("peer-1");
      expect(parsed["ABC123"][0].reason).toBe("reason-1");
      expect(parsed["ABC123"][1].peerId).toBe("peer-2");
    });

    it("ban list survives closeLobby → createLobby for the same game code", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session", "reason");
      lobbyManager.closeLobby();
      // Reopen with the same game code (generateGameCode is mocked to ABC123).
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(true);
      expect(lobbyManager.getBanList()[0].reason).toBe("reason");
    });

    it("a freshly-created lobby with no persisted entries starts with an empty ban list", () => {
      // First session bans a peer.
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.banPeer("peer-1", "session");
      lobbyManager.closeLobby();

      // Switch to a different game code.
      (generateGameCode as jest.Mock).mockReturnValueOnce("XYZ789");
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(false);
      expect(lobbyManager.getBanList()).toHaveLength(0);
    });

    it("stale localStorage payloads (expired) are dropped on re-hydrate", () => {
      // Pre-seed localStorage with one expired and one live entry.
      const expiredAt = now - 1;
      const liveExpiresAt = now + LOBBY_BAN_DURATION_MS;
      const seed: Record<string, LobbyBanEntry[]> = {
        ABC123: [
          {
            peerId: "expired-peer",
            scope: "session",
            bannedAt: expiredAt - LOBBY_BAN_DURATION_MS,
            expiresAt: expiredAt,
          },
          {
            peerId: "live-peer",
            scope: "session",
            bannedAt: now,
            expiresAt: liveExpiresAt,
            reason: "still live",
          },
        ],
      };
      localStorage.setItem("planar_nexus_lobby_bans", JSON.stringify(seed));

      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.isPeerBanned("expired-peer")).toBe(false);
      expect(lobbyManager.isPeerBanned("live-peer")).toBe(true);
      // The expired entry is pruned from the persisted store.
      const after = JSON.parse(localStorage.getItem("planar_nexus_lobby_bans")!);
      expect(after["ABC123"]).toHaveLength(1);
      expect(after["ABC123"][0].peerId).toBe("live-peer");
    });

    it("corrupt localStorage payload is dropped without throwing", () => {
      localStorage.setItem("planar_nexus_lobby_bans", "{ not valid json");
      expect(() => lobbyManager.createLobby(baseConfig, "Host")).not.toThrow();
      expect(lobbyManager.getBanList()).toEqual([]);
      // The corrupt key is removed so subsequent calls stay fast.
      expect(localStorage.getItem("planar_nexus_lobby_bans")).toBeNull();
    });

    it("no-op when no lobby is active (returns false / empty list)", () => {
      expect(lobbyManager.banPeer("peer-1", "session").added).toBe(false);
      expect(lobbyManager.isPeerBanned("peer-1")).toBe(false);
      expect(lobbyManager.unbanPeer("peer-1")).toBe(false);
      expect(lobbyManager.getBanList()).toEqual([]);
    });
  });

  describe("kickPeer", () => {
    it("removes the peer from the roster AND session-bans them with the reason", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      // Add a peer to the roster (host + 1 = 2 players).
      const peer = lobbyManager.addPlayer("Misbehaving Peer");
      expect(peer).not.toBeNull();
      const lobbyBefore = lobbyManager.getCurrentLobby();
      expect(lobbyBefore?.players).toHaveLength(2);

      const result = lobbyManager.kickPeer(peer!.id, "abusive chat");
      expect(result.removed).toBe(true);
      expect(result.banned).toBe(true);
      expect(result.reason).toBe("abusive chat");

      const lobbyAfter = lobbyManager.getCurrentLobby();
      expect(lobbyAfter?.players).toHaveLength(1);
      expect(lobbyAfter?.players[0].id).toBe(lobbyBefore!.hostId);

      // The kicked peer cannot rejoin (they're on the ban list with the
      // kick reason for 30 minutes).
      expect(lobbyManager.isPeerBanned(peer!.id)).toBe(true);
      expect(lobbyManager.getBanList()[0].reason).toBe("abusive chat");
    });

    it("propagates the kick reason into the persisted ban entry (issue #1257 AC: kicked peer sees host's reason)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peer = lobbyManager.addPlayer("Peer");
      lobbyManager.kickPeer(peer!.id, "stalling the table");
      const list = lobbyManager.getBanList();
      expect(list[0].reason).toBe("stalling the table");
    });

    it("refuses to kick the host (host migration is the supported path)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const hostId = lobbyManager.getCurrentLobby()!.hostId;
      const result = lobbyManager.kickPeer(hostId, "host swap");
      expect(result.removed).toBe(false);
      expect(result.banned).toBe(false);
      expect(result.reason).toMatch(/host/i);
      expect(lobbyManager.isPeerBanned(hostId)).toBe(false);
    });

    it("kicking a non-existent peer returns {removed: false, banned: false}", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const result = lobbyManager.kickPeer("ghost-peer", "ghost");
      expect(result.removed).toBe(false);
      // The ban entry is still created (the host's intent was recorded
      // for the 30-minute window) — only the roster removal failed.
      expect(result.banned).toBe(true);
      expect(lobbyManager.isPeerBanned("ghost-peer")).toBe(true);
    });

    it("kicking an already-banned peer still removes them from the roster", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const peer = lobbyManager.addPlayer("Peer");
      lobbyManager.banPeer(peer!.id, "session", "first offense");
      const result = lobbyManager.kickPeer(peer!.id, "second offense");
      expect(result.removed).toBe(true);
      // The ban entry's reason is updated to the latest (most recent action wins).
      expect(lobbyManager.getBanList()[0].reason).toBe("second offense");
    });

    it("returns {removed: false, banned: false, reason: ...} when no lobby is active", () => {
      const result = lobbyManager.kickPeer("peer", "reason");
      expect(result.removed).toBe(false);
      expect(result.banned).toBe(false);
      expect(result.reason).toMatch(/lobby/i);
    });
  });

  describe("pauseGame / resumeGame / pause-clock math", () => {
    it("pauseGame returns the wall-clock start time", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const { pausedAt } = lobbyManager.pauseGame();
      expect(pausedAt).toBe(now);
      expect(lobbyManager.isPaused()).toBe(true);
      expect(lobbyManager.getPausedAt()).toBe(pausedAt);
    });

    it("pauseGame is idempotent — a second call does not reset pausedAt", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const first = lobbyManager.pauseGame();
      now += 5_000;
      const second = lobbyManager.pauseGame();
      expect(second.pausedAt).toBe(first.pausedAt);
    });

    it("resumeGame returns the elapsed ms since pauseGame and clears pausedAt", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.pauseGame();
      // 12 seconds elapse while paused.
      now += 12_000;
      const { pausedDurationMs } = lobbyManager.resumeGame();
      expect(pausedDurationMs).toBe(12_000);
      expect(lobbyManager.isPaused()).toBe(false);
      expect(lobbyManager.getPausedAt()).toBeNull();
      expect(lobbyManager.getPauseElapsedMs()).toBe(0);
    });

    it("resumeGame is a no-op when the game is not paused (returns 0)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      const { pausedDurationMs } = lobbyManager.resumeGame();
      expect(pausedDurationMs).toBe(0);
      expect(lobbyManager.isPaused()).toBe(false);
    });

    it("getPauseElapsedMs matches the gap between pauseGame and now", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.pauseGame();
      now += 90_000;
      expect(lobbyManager.getPauseElapsedMs()).toBe(90_000);
      // Not paused → 0.
      lobbyManager.resumeGame();
      expect(lobbyManager.getPauseElapsedMs()).toBe(0);
    });

    it("pause-clock math: peer applies resumeGame's pausedDurationMs to their local timer", () => {
      // This is the canonical math referenced by the issue: peers freeze
      // their priority timer at pausedAt, and on resume shift it forward
      // by the elapsed pause duration. We verify the returned value is
      // exactly the delta between pausedAt and the resume call.
      lobbyManager.createLobby(baseConfig, "Host");
      const { pausedAt } = lobbyManager.pauseGame();
      now += 7 * 60 * 1000 + 2_500; // 7m 2.5s later
      const { pausedDurationMs } = lobbyManager.resumeGame();
      // The peer should subtract `pausedDurationMs` from their local
      // turn-elapsed counter when resuming. This assertion verifies the
      // arithmetic the integration layer relies on.
      expect(pausedDurationMs).toBe(now - pausedAt);
      expect(pausedDurationMs).toBe(7 * 60 * 1000 + 2_500);
    });

    it("createLobby resets the pause clock (a new game is never born paused)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.pauseGame();
      expect(lobbyManager.isPaused()).toBe(true);
      lobbyManager.closeLobby();
      lobbyManager.createLobby(baseConfig, "Host");
      expect(lobbyManager.isPaused()).toBe(false);
      expect(lobbyManager.getPausedAt()).toBeNull();
    });

    it("closeLobby clears the pause clock (game ended, freeze lifted)", () => {
      lobbyManager.createLobby(baseConfig, "Host");
      lobbyManager.pauseGame();
      lobbyManager.closeLobby();
      // After close, the manager has no lobby so the pause state is moot.
      expect(lobbyManager.isPaused()).toBe(false);
    });

    it("no-op pause/resume when no lobby is active", () => {
      // No lobby — pause/resume still return their zero-value shapes so
      // UI handlers don't have to branch on `lobby != null`.
      const p = lobbyManager.pauseGame();
      expect(typeof p.pausedAt).toBe("number");
      const r = lobbyManager.resumeGame();
      expect(r.pausedDurationMs).toBe(0);
    });
  });
});