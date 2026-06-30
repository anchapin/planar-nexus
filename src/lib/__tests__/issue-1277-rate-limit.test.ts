/**
 * Issue #1277 — integration tests verifying that the per-peer /
 * per-connection rate limits and row-count caps actually apply to the
 * signaling, public-lobby, and lobby-manager surfaces.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createLocalSignalingClient,
  LocalSignalingClient,
  SIGNALING_CONNECTION_REQUEST_LIMIT,
  SIGNALING_MAX_CONNECTION_STRING_BYTES,
} from "../local-signaling-client";

// jsdom (jest env) supplies a minimal `window` — LocalSignalingClient never
// touches it, but the `parseConnectionString` helper accepts arbitrary
// input, so we can drive it directly without a peer connection.

// ────────────────────────────────────────────────────────────────────────
// local-signaling-client.ts
// ────────────────────────────────────────────────────────────────────────

describe("issue #1277 — local signaling client rate limits", () => {
  it("accepts up to SIGNALING_CONNECTION_REQUEST_LIMIT connection-requests", () => {
    const client = createLocalSignalingClient({ role: "host" });
    for (let i = 0; i < SIGNALING_CONNECTION_REQUEST_LIMIT.maxEvents; i++) {
      expect(client.acceptConnectionRequest(1_000_000 + i)).toBe(true);
    }
  });

  it("rejects connection-requests beyond the configured budget", () => {
    const client = createLocalSignalingClient({ role: "host" });
    const limit = SIGNALING_CONNECTION_REQUEST_LIMIT.maxEvents;
    for (let i = 0; i < limit; i++) {
      expect(client.acceptConnectionRequest(1_000_000)).toBe(true);
    }
    // The (limit+1)-th call inside the same window must be rejected.
    expect(client.acceptConnectionRequest(1_000_000)).toBe(false);
  });

  it("issue #1277 — admits 71st connection-request silently (rejection only)", () => {
    // Construct a small-budget client so the test is fast and obviously
    // exercises the rate limiter without relying on the real default of
    // 30 events / minute.
    const client = createLocalSignalingClient({
      role: "host",
      signalingLimits: {
        connectionRequest: { maxEvents: 70, windowMs: 60_000 },
      },
    });
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 100; i++) {
      if (client.acceptConnectionRequest(1_000_000)) accepted++;
      else rejected++;
    }
    expect(accepted).toBe(70);
    expect(rejected).toBe(30);
  });

  it("parseConnectionString rejects oversize payloads row-cap", () => {
    const oversize = "a".repeat(SIGNALING_MAX_CONNECTION_STRING_BYTES + 1);
    expect(LocalSignalingClient.parseConnectionString(oversize)).toBeNull();
  });

  it("parseConnectionString rejects empty input", () => {
    expect(LocalSignalingClient.parseConnectionString("")).toBeNull();
  });

  it("parseConnectionString still parses a well-formed payload under the cap", () => {
    const tiny = JSON.stringify({
      type: "offer",
      phase: "waiting-for-answer",
      offer: { type: "offer", sdp: "v=0" },
      answer: undefined,
      ice: [],
    });
    const parsed = LocalSignalingClient.parseConnectionString(tiny);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("offer");
  });
});

// ────────────────────────────────────────────────────────────────────────
// public-lobby-browser.ts
// ────────────────────────────────────────────────────────────────────────

describe("issue #1277 — public-lobby-browser rate limits + row-cap", () => {
  // localStorage is provided by jsdom, but we want a clean store per test.
  beforeEach(() => {
    localStorage.clear();
  });

  it("imports cleanly and uses the configured read budget", async () => {
    const { publicLobbyBrowser, LOBBY_LIST_READ_LIMIT } = await import(
      "../public-lobby-browser"
    );
    expect(publicLobbyBrowser.readDropped).toBe(0);

    const limit = LOBBY_LIST_READ_LIMIT.maxEvents;
    for (let i = 0; i < limit; i++) {
      // First 6 reads return at least an empty array — never throw.
      expect(Array.isArray(publicLobbyBrowser.getPublicGames())).toBe(true);
    }
    // 7th read inside the same minute-window is dropped.
    const before = publicLobbyBrowser.readDropped;
    expect(publicLobbyBrowser.getPublicGames()).toEqual([]);
    expect(publicLobbyBrowser.readDropped).toBe(before + 1);
  });

  it("caps the returned rows at LOBBY_MAX_ROWS_PER_READ", async () => {
    const {
      publicLobbyBrowser,
      LOBBY_MAX_ROWS_PER_READ,
    } = await import("../public-lobby-browser");

    // Manufacture 1000 public games in localStorage.
    const games = [];
    for (let i = 0; i < 1000; i++) {
      games.push({
        id: `g-${i}`,
        gameCode: `CODE${i}`,
        name: `Game ${i}`,
        hostName: "host",
        format: "commander",
        maxPlayers: "4",
        currentPlayers: 1,
        status: "waiting",
        isPublic: true,
        hasPassword: false,
        allowSpectators: true,
        createdAt: Date.now(),
      });
    }
    localStorage.setItem(
      "planar_nexus_public_lobbies",
      JSON.stringify(games),
    );

    // give the public-lobby-browser its budget up-front
    (publicLobbyBrowser as unknown as {
      readLimiter: { reset: () => void };
    }).readLimiter.reset();

    const visible = publicLobbyBrowser.getPublicGames();
    expect(visible.length).toBe(LOBBY_MAX_ROWS_PER_READ);
  });
});

// ────────────────────────────────────────────────────────────────────────
// lobby-manager.ts row-count cap
// ────────────────────────────────────────────────────────────────────────

describe("issue #1277 — lobby manager row-cap on maxPlayers", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("rejects a maxPlayers roster larger than LOBBY_MAX_PLAYERS", async () => {
    const { LOBBY_MAX_PLAYERS } = await import("../lobby-manager");

    // Mock the dependencies that the lobby-manager reaches out to so we
    // exercise the row-cap without touching format-validation / lobby
    // browser code paths.
    jest.doMock("../public-lobby-browser", () => ({
      publicLobbyBrowser: {
        registerPublicGame: () => undefined,
        updatePublicGame: () => undefined,
        unregisterPublicGame: () => undefined,
      },
    }));
    jest.doMock("../game-code-generator", () => ({
      generateGameCode: () => "ABC123",
      generateLobbyId: () => "lobby-123",
      generatePlayerId: () => "player-123",
    }));
    jest.doMock("../format-validator", () => ({
      validateDeckForLobby: () => ({ valid: true, errors: [] }),
    }));
    jest.doMock("../game-mode", () => ({
      getGameModeForPlayerCount: () => "duel",
      getGameModeConfig: () => ({
        name: "Duel",
        isTeamMode: false,
        minPlayers: 2,
        maxPlayers: 2,
      }),
    }));

    const { lobbyManager } = await import("../lobby-manager");

    expect(() =>
      lobbyManager.createLobby(
        {
          name: "Too Big",
          format: "commander",
          maxPlayers: String(LOBBY_MAX_PLAYERS + 1),
          settings: {
            isPublic: false,
            allowSpectators: true,
            timerEnabled: false,
          } as never,
        } as never,
        "host",
      ),
    ).toThrow(/maxPlayers/);
  });
});
