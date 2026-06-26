/**
 * Lobby capacity regression coverage for 3+ player games.
 * Issue #1087: the lobby layer must admit 3+ peers (the mesh foundation
 * routes their GameMessages; this locks in the lobby-side capacity +
 * stable-identity behaviour the mesh depends on).
 *
 * Self-contained (its own dependency mocks) so it does not disturb the
 * existing lobby-manager test suite.
 */

jest.mock("../public-lobby-browser", () => ({
  publicLobbyBrowser: {
    registerPublicGame: jest.fn(),
    updatePublicGame: jest.fn(),
    unregisterPublicGame: jest.fn(),
  },
}));

jest.mock("../game-code-generator", () => ({
  generateGameCode: jest.fn(() => "ABC123"),
  generateLobbyId: jest.fn(() => "lobby-123"),
  generatePlayerId: jest.fn(() => "player-123"),
}));

jest.mock("../format-validator", () => ({
  validateDeckForLobby: jest.fn(() => ({ valid: true, errors: [] })),
}));

jest.mock("../game-mode", () => ({
  getGameModeForPlayerCount: jest.fn(() => "ffa"),
  getGameModeConfig: jest.fn(() => ({
    name: "Free-for-All",
    isTeamMode: false,
    minPlayers: 2,
    maxPlayers: 4,
  })),
}));

import { lobbyManager } from "../lobby-manager";
import { generatePlayerId } from "../game-code-generator";
import type { GameFormat, PlayerCount } from "../multiplayer-types";

const baseSettings = {
  isPublic: false,
  allowSpectators: false,
  timerEnabled: false,
};

describe("Lobby capacity for 3+ players (issue #1087 mesh foundation)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lobbyManager.closeLobby();
  });

  afterEach(() => {
    // Restore the module-level mock default so nothing leaks.
    jest.mocked(generatePlayerId).mockReturnValue("player-123");
    lobbyManager.closeLobby();
  });

  it("admits up to maxPlayers (4) peers, each with a stable distinct id", () => {
    let counter = 0;
    jest.mocked(generatePlayerId).mockImplementation(() => `pid-${counter++}`);

    const lobby = lobbyManager.createLobby(
      {
        name: "Commander Pod",
        format: "commander" as GameFormat,
        maxPlayers: "4" as PlayerCount,
        settings: baseSettings,
      },
      "Host",
    );

    const p2 = lobbyManager.addPlayer("Alice");
    const p3 = lobbyManager.addPlayer("Bob");
    const p4 = lobbyManager.addPlayer("Carol");
    // Capacity is enforced: host + 3 = 4; the 5th is rejected (null), and
    // addPlayer returns null WITHOUT minting a new id.
    const overCapacity = lobbyManager.addPlayer("Dave");

    expect([p2, p3, p4].every(Boolean)).toBe(true);
    expect(overCapacity).toBeNull();
    expect(lobby.players).toHaveLength(4);
    // Every player has a stable, distinct identity.
    const ids = lobby.players.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("a 3-player lobby admits exactly two non-host peers", () => {
    let counter = 0;
    jest.mocked(generatePlayerId).mockImplementation(() => `id-${counter++}`);

    const lobby = lobbyManager.createLobby(
      {
        name: "Trio",
        format: "standard" as GameFormat,
        maxPlayers: "3" as PlayerCount,
        settings: baseSettings,
      },
      "Host",
    );

    expect(lobbyManager.addPlayer("A")).not.toBeNull();
    expect(lobbyManager.addPlayer("B")).not.toBeNull();
    expect(lobbyManager.addPlayer("C")).toBeNull();

    expect(lobby.players).toHaveLength(3);
  });
});
