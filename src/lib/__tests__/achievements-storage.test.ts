/**
 * @fileoverview Integration tests for the localStorage validation added to the
 * achievements module in issue #1429.
 *
 * IndexedDB is mocked to REJECT so every method falls through to its
 * localStorage fallback — the read sites the issue flags
 * (`getPlayerAchievements`, and `getStat`/`setStat` reached via the public
 * `checkGameAchievements`).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Force the localStorage fallback path in every method.
jest.mock("../indexeddb-storage", () => ({
  indexedDBStorage: {
    initialize: jest.fn(() => Promise.resolve()),
    get: jest.fn(() =>
      Promise.reject(new Error("IndexedDB unavailable (forced fallback)")),
    ),
    set: jest.fn(() =>
      Promise.reject(new Error("IndexedDB unavailable (forced fallback)")),
    ),
    delete: jest.fn(() => Promise.resolve()),
    getAll: jest.fn(() => Promise.resolve([])),
    clearStorage: jest.fn(() => Promise.resolve()),
  },
}));

import {
  achievementManager,
  ACHIEVEMENTS,
  type PlayerAchievements,
} from "../achievements";
import type { GameState } from "../game-state/types";

const PLAYER_ID = "p1";

function seedAchievements(value: string) {
  localStorage.setItem(`planar_nexus_achievements_${PLAYER_ID}`, value);
}

const validAchievements: PlayerAchievements = {
  playerId: PLAYER_ID,
  achievements: [
    {
      achievementId: "first_game",
      currentProgress: 1,
      unlocked: true,
      unlockedAt: 1,
    },
    { achievementId: "games_10", currentProgress: 3, unlocked: false },
  ],
  totalPoints: 10,
  lastUpdated: 1700000000000,
};

function makeGameState(life = 20, turnNumber = 3): GameState {
  // Only `.players.get(playerId).life`, `.format`, and `.turn.turnNumber` are
  // read by checkGameAchievements, so a minimal cast is sufficient.
  return {
    players: new Map([[PLAYER_ID, { id: PLAYER_ID, name: "Tester", life }]]),
    format: "standard",
    turn: { turnNumber },
  } as unknown as GameState;
}

describe("achievementManager — localStorage fallback validation (#1429)", () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    // IndexedDB rejection logs an error on every call; silence it for clarity.
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    localStorage.clear();
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("returns valid achievements from the localStorage fallback", async () => {
    seedAchievements(JSON.stringify(validAchievements));
    const result = await achievementManager.getPlayerAchievements(PLAYER_ID);
    expect(result.playerId).toBe(PLAYER_ID);
    expect(result.totalPoints).toBe(10);
    expect(result.achievements).toHaveLength(2);
  });

  it("falls back to an empty record on malformed JSON (no throw)", async () => {
    seedAchievements("{not valid json");
    const result = await achievementManager.getPlayerAchievements(PLAYER_ID);
    expect(result.playerId).toBe(PLAYER_ID);
    expect(result.totalPoints).toBe(0);
    // Empty record seeds progress rows for every defined achievement.
    expect(result.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(result.achievements.every((a) => a.unlocked === false)).toBe(true);
  });

  it("falls back to an empty record on a cross-version shape", async () => {
    seedAchievements(
      JSON.stringify({ playerId: PLAYER_ID, achievements: "not-an-array" }),
    );
    const result = await achievementManager.getPlayerAchievements(PLAYER_ID);
    expect(result.totalPoints).toBe(0);
    expect(result.achievements).toHaveLength(ACHIEVEMENTS.length);
  });

  it("neutralizes a prototype-pollution payload in the achievements key", async () => {
    seedAchievements(JSON.stringify({ __proto__: { polluted: "PWNED" } }));
    const result = await achievementManager.getPlayerAchievements(PLAYER_ID);
    expect(result.totalPoints).toBe(0);
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("getStat/setStat fallback tolerates malformed stats and writes a clean map", async () => {
    // Poison the stats key with unparseable JSON.
    localStorage.setItem(
      `planar_nexus_stats_${PLAYER_ID}`,
      "}{ totally broken",
    );
    // No achievements in storage either → getPlayerAchievements returns empty.

    await achievementManager.checkGameAchievements(
      PLAYER_ID,
      makeGameState(),
      true, // won the game
    );

    // Despite poisoned inputs, a fresh, well-formed stats map was written.
    const stored = JSON.parse(
      localStorage.getItem(`planar_nexus_stats_${PLAYER_ID}`) || "{}",
    );
    expect(stored.games_played).toBe(1);
    expect(stored.wins).toBe(1);
    expect(stored.format_standard).toBe(1);
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("getStat fallback preserves and increments legitimate stats", async () => {
    localStorage.setItem(
      `planar_nexus_stats_${PLAYER_ID}`,
      JSON.stringify({ games_played: 5, wins: 2, format_standard: 5 }),
    );

    await achievementManager.checkGameAchievements(
      PLAYER_ID,
      makeGameState(),
      true,
    );

    const stored = JSON.parse(
      localStorage.getItem(`planar_nexus_stats_${PLAYER_ID}`) || "{}",
    );
    expect(stored.games_played).toBe(6);
    expect(stored.wins).toBe(3);
    expect(stored.format_standard).toBe(6);
  });
});
