/**
 * Tests for Achievement System
 * Issue #594: Achievement System - Milestone tracking
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

// Mock the indexedDB storage
jest.mock("../indexeddb-storage", () => ({
  indexedDBStorage: {
    initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

// Mock the game-state types
const mockGameState = {
  players: new Map([
    [
      "player-1",
      {
        id: "player-1",
        name: "Test Player",
        life: 20,
        hand: [],
        battlefield: [],
        library: [],
        graveyard: [],
      },
    ],
  ]),
  format: "standard",
  turn: { turnNumber: 1, currentPlayer: "player-1", phase: "untap" },
};

// Import after mocks
import {
  ACHIEVEMENTS,
  RARITY_COLORS,
  RARITY_POINTS,
  achievementManager,
  formatRarity,
  getRarityColor,
  getTotalPossiblePoints,
  type Achievement,
  type AchievementProgress,
  type AchievementRarity,
  type AchievementCategory,
} from "../achievements";

describe("Achievements Module", () => {
  describe("ACHIEVEMENTS", () => {
    it("should have at least one achievement defined", () => {
      expect(ACHIEVEMENTS.length).toBeGreaterThan(0);
    });

    it("should have unique IDs for all achievements", () => {
      const ids = ACHIEVEMENTS.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have valid rarity for all achievements", () => {
      const validRarities: AchievementRarity[] = [
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ];
      ACHIEVEMENTS.forEach((achievement) => {
        expect(validRarities).toContain(achievement.rarity);
      });
    });

    it("should have valid category for all achievements", () => {
      const validCategories: AchievementCategory[] = [
        "games",
        "wins",
        "collection",
        "social",
        "special",
      ];
      ACHIEVEMENTS.forEach((achievement) => {
        expect(validCategories).toContain(achievement.category);
      });
    });

    it("should have positive points for all achievements", () => {
      ACHIEVEMENTS.forEach((achievement) => {
        expect(achievement.points).toBeGreaterThan(0);
      });
    });

    it("should have non-empty names and descriptions", () => {
      ACHIEVEMENTS.forEach((achievement) => {
        expect(achievement.name).toBeTruthy();
        expect(achievement.description).toBeTruthy();
      });
    });

    it("should have valid icon for all achievements", () => {
      ACHIEVEMENTS.forEach((achievement) => {
        expect(achievement.icon).toBeTruthy();
      });
    });

    it("should have valid requirement for all achievements", () => {
      ACHIEVEMENTS.forEach((achievement) => {
        expect(achievement.requirement).toBeDefined();
        expect(achievement.requirement.type).toBeTruthy();
        expect(achievement.requirement.count).toBeGreaterThan(0);
      });
    });

    it("should have first_game achievement", () => {
      const firstGame = ACHIEVEMENTS.find((a) => a.id === "first_game");
      expect(firstGame).toBeDefined();
      expect(firstGame?.requirement.type).toBe("games_played");
      expect(firstGame?.requirement.count).toBe(1);
    });

    it("should have first_win achievement", () => {
      const firstWin = ACHIEVEMENTS.find((a) => a.id === "first_win");
      expect(firstWin).toBeDefined();
      expect(firstWin?.requirement.type).toBe("wins");
      expect(firstWin?.requirement.count).toBe(1);
    });

    it("should have collection achievements", () => {
      const collectionAchievements = ACHIEVEMENTS.filter(
        (a) => a.requirement.type === "cards_collected",
      );
      expect(collectionAchievements.length).toBeGreaterThan(0);
    });

    it("should have format-specific achievements", () => {
      const formatAchievements = ACHIEVEMENTS.filter(
        (a) => a.requirement.type === "games_with_format",
      );
      expect(formatAchievements.length).toBeGreaterThan(0);
    });

    it("should have special achievements", () => {
      const specialAchievements = ACHIEVEMENTS.filter(
        (a) => a.requirement.type === "special",
      );
      expect(specialAchievements.length).toBeGreaterThan(0);
    });
  });

  describe("RARITY_COLORS", () => {
    it("should have colors for all rarity tiers", () => {
      const rarities: AchievementRarity[] = [
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ];
      rarities.forEach((rarity) => {
        expect(RARITY_COLORS[rarity]).toBeDefined();
        expect(RARITY_COLORS[rarity]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });
  });

  describe("RARITY_POINTS", () => {
    it("should have points for all rarity tiers", () => {
      const rarities: AchievementRarity[] = [
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
      ];
      rarities.forEach((rarity) => {
        expect(RARITY_POINTS[rarity]).toBeDefined();
        expect(RARITY_POINTS[rarity]).toBeGreaterThan(0);
      });
    });

    it("should have increasing points for higher rarities", () => {
      expect(RARITY_POINTS.common).toBeLessThan(RARITY_POINTS.uncommon);
      expect(RARITY_POINTS.uncommon).toBeLessThan(RARITY_POINTS.rare);
      expect(RARITY_POINTS.rare).toBeLessThan(RARITY_POINTS.epic);
      expect(RARITY_POINTS.epic).toBeLessThan(RARITY_POINTS.legendary);
    });
  });

  describe("formatRarity", () => {
    it("should format common correctly", () => {
      expect(formatRarity("common")).toBe("Common");
    });

    it("should format uncommon correctly", () => {
      expect(formatRarity("uncommon")).toBe("Uncommon");
    });

    it("should format rare correctly", () => {
      expect(formatRarity("rare")).toBe("Rare");
    });

    it("should format epic correctly", () => {
      expect(formatRarity("epic")).toBe("Epic");
    });

    it("should format legendary correctly", () => {
      expect(formatRarity("legendary")).toBe("Legendary");
    });
  });

  describe("getRarityColor", () => {
    it("should return color for common", () => {
      expect(getRarityColor("common")).toBe("#9ca3af");
    });

    it("should return color for uncommon", () => {
      expect(getRarityColor("uncommon")).toBe("#22c55e");
    });

    it("should return color for rare", () => {
      expect(getRarityColor("rare")).toBe("#3b82f6");
    });

    it("should return color for epic", () => {
      expect(getRarityColor("epic")).toBe("#a855f7");
    });

    it("should return color for legendary", () => {
      expect(getRarityColor("legendary")).toBe("#f59e0b");
    });
  });

  describe("getTotalPossiblePoints", () => {
    it("should calculate total possible points", () => {
      const total = getTotalPossiblePoints();
      const expected = ACHIEVEMENTS.reduce((sum, a) => sum + a.points, 0);
      expect(total).toBe(expected);
    });

    it("should return a positive number", () => {
      const total = getTotalPossiblePoints();
      expect(total).toBeGreaterThan(0);
    });

    it("should be at least 500 points", () => {
      // With at least 26 achievements, minimum points should be significant
      const total = getTotalPossiblePoints();
      expect(total).toBeGreaterThanOrEqual(500);
    });
  });
});

describe("AchievementManager", () => {
  const testPlayerId = "test-player-123";

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the achievement manager for each test
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await achievementManager.resetAchievements(testPlayerId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("getPlayerAchievements", () => {
    it("should return player achievements structure", async () => {
      const playerData = await (
        achievementManager as any
      ).getPlayerAchievements(testPlayerId);

      expect(playerData).toBeDefined();
      expect(playerData.playerId).toBe(testPlayerId);
      expect(playerData.achievements).toBeDefined();
      expect(Array.isArray(playerData.achievements)).toBe(true);
      expect(playerData.totalPoints).toBe(0);
      expect(playerData.lastUpdated).toBeDefined();
    });

    it("should initialize achievements for all defined achievements", async () => {
      const playerData = await (
        achievementManager as any
      ).getPlayerAchievements(testPlayerId);

      // Should have progress entries for all achievements
      expect(playerData.achievements.length).toBe(ACHIEVEMENTS.length);
    });

    it("should initialize all achievements as not unlocked", async () => {
      const playerData = await (
        achievementManager as any
      ).getPlayerAchievements(testPlayerId);

      playerData.achievements.forEach((progress: AchievementProgress) => {
        expect(progress.unlocked).toBe(false);
        expect(progress.currentProgress).toBe(0);
      });
    });
  });

  describe("checkGameAchievements", () => {
    it("should return empty array when player not found", async () => {
      const invalidGameState = {
        players: new Map(),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: "invalid", phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        "invalid-player",
        invalidGameState as any,
        false,
      );

      expect(notifications).toEqual([]);
    });

    it("should check first_game achievement after playing a game", async () => {
      // Use a unique player ID to avoid state conflicts
      const uniquePlayerId = "test-player-first-game-" + Date.now();

      // Play first game
      const gameState = {
        players: new Map([
          [
            uniquePlayerId,
            {
              id: uniquePlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: uniquePlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        uniquePlayerId,
        gameState as any,
        false,
      );

      // Should have unlocked first_game
      const firstGameAchievement = notifications.find(
        (n: any) => n.achievement.id === "first_game",
      );
      expect(firstGameAchievement).toBeDefined();
      expect(firstGameAchievement!.achievement.id).toBe("first_game");
    });

    it("should check first_win achievement after winning a game", async () => {
      // First, initialize player achievements
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Win first game
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      // Should have unlocked both first_game and first_win
      const unlockedIds = notifications.map((n: any) => n.achievement.id);
      expect(unlockedIds).toContain("first_game");
      expect(unlockedIds).toContain("first_win");
    });

    it("should track format-specific achievements", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Play commander game
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "commander",
        turn: { turnNumber: 1, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        false,
      );

      // Should have unlocked commander_first
      const commanderAchievement = notifications.find(
        (n: any) => n.achievement.id === "commander_first",
      );
      expect(commanderAchievement).toBeDefined();
    });

    it("should check comeback_win achievement when winning with low life", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Win with less than 5 life
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 3,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 5, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      // Should have unlocked comeback_win
      const comebackAchievement = notifications.find(
        (n: any) => n.achievement.id === "comeback_win",
      );
      expect(comebackAchievement).toBeDefined();
    });

    it("should check quick_win achievement when winning in few turns", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Win in 5 turns or fewer
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 5, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      // Should have unlocked quick_win
      const quickWinAchievement = notifications.find(
        (n: any) => n.achievement.id === "quick_win",
      );
      expect(quickWinAchievement).toBeDefined();
    });

    it("should not unlock quick_win when winning after turn 5", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Win after turn 5
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 10, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      // Should NOT have unlocked quick_win
      const quickWinAchievement = notifications.find(
        (n: any) => n.achievement.id === "quick_win",
      );
      expect(quickWinAchievement).toBeUndefined();
    });

    it("should not unlock comeback_win when losing with low life", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Lose with less than 5 life
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 3,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 5, currentPlayer: testPlayerId, phase: "untap" },
      };

      const notifications = await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        false,
      );

      // Should NOT have unlocked comeback_win
      const comebackAchievement = notifications.find(
        (n: any) => n.achievement.id === "comeback_win",
      );
      expect(comebackAchievement).toBeUndefined();
    });
  });

  describe("checkCollectionAchievements", () => {
    it("should check collection achievements based on collection size", async () => {
      await (achievementManager as any).getPlayerAchievements(testPlayerId);

      // Add 10 cards to collection
      const notifications =
        await achievementManager.checkCollectionAchievements(testPlayerId, 10);

      // Should have unlocked collection_10
      const collectionAchievement = notifications.find(
        (n: any) => n.achievement.id === "collection_10",
      );
      expect(collectionAchievement).toBeDefined();
    });

    it("should not unlock achievements that are already unlocked", async () => {
      // First, unlock collection_10
      await achievementManager.checkCollectionAchievements(testPlayerId, 10);

      // Now add more cards - collection_10 should not be in notifications again
      const notifications =
        await achievementManager.checkCollectionAchievements(testPlayerId, 50);

      const collection10Notification = notifications.find(
        (n: any) => n.achievement.id === "collection_10",
      );
      expect(collection10Notification).toBeUndefined();
    });
  });

  describe("getUnlockedAchievements", () => {
    it("should return empty array when no achievements unlocked", async () => {
      const unlocked =
        await achievementManager.getUnlockedAchievements(testPlayerId);
      expect(unlocked).toEqual([]);
    });

    it("should return unlocked achievements", async () => {
      // Play and win first game
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: testPlayerId, phase: "untap" },
      };

      await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      const unlocked =
        await achievementManager.getUnlockedAchievements(testPlayerId);

      expect(unlocked.length).toBeGreaterThan(0);
      expect(unlocked[0]).toHaveProperty("id");
    });
  });

  describe("getAchievementDisplayProgress", () => {
    it("should return progress for all achievements", async () => {
      const displayProgress =
        await achievementManager.getAchievementDisplayProgress(testPlayerId);

      expect(displayProgress.length).toBe(ACHIEVEMENTS.length);

      displayProgress.forEach((item) => {
        expect(item.achievement).toBeDefined();
        expect(item.progress).toBeDefined();
        expect(item.progress.currentProgress).toBeDefined();
        expect(item.progress.unlocked).toBeDefined();
      });
    });
  });

  describe("subscribe", () => {
    it("should allow subscribing to achievement notifications", () => {
      const callback = jest.fn();
      const unsubscribe = achievementManager.subscribe(callback);

      expect(typeof unsubscribe).toBe("function");

      // Clean up
      unsubscribe();
    });

    it("should call subscriber when achievement is unlocked", async () => {
      const callback = jest.fn();
      const unsubscribe = achievementManager.subscribe(callback);

      // Play first game to unlock achievement
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: testPlayerId, phase: "untap" },
      };

      await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        false,
      );

      // Callback should have been called
      expect(callback).toHaveBeenCalled();

      // Clean up
      unsubscribe();
    });
  });

  describe("resetAchievements", () => {
    it("should reset achievements for a player", async () => {
      // First, play a game to unlock achievements
      const gameState = {
        players: new Map([
          [
            testPlayerId,
            {
              id: testPlayerId,
              name: "Test Player",
              life: 20,
              hand: [],
              battlefield: [],
              library: [],
              graveyard: [],
            },
          ],
        ]),
        format: "standard",
        turn: { turnNumber: 1, currentPlayer: testPlayerId, phase: "untap" },
      };

      await achievementManager.checkGameAchievements(
        testPlayerId,
        gameState as any,
        true,
      );

      // Verify achievements were unlocked
      let unlocked =
        await achievementManager.getUnlockedAchievements(testPlayerId);
      expect(unlocked.length).toBeGreaterThan(0);

      // Reset achievements
      await achievementManager.resetAchievements(testPlayerId);

      // Verify achievements are reset
      unlocked = await achievementManager.getUnlockedAchievements(testPlayerId);
      expect(unlocked).toEqual([]);
    });
  });
});

describe("Achievement AchievementProgress Interface", () => {
  it("should have correct structure for AchievementProgress", () => {
    const progress: AchievementProgress = {
      achievementId: "test-achievement",
      currentProgress: 5,
      unlocked: true,
      unlockedAt: Date.now(),
    };

    expect(progress.achievementId).toBe("test-achievement");
    expect(progress.currentProgress).toBe(5);
    expect(progress.unlocked).toBe(true);
    expect(progress.unlockedAt).toBeDefined();
  });

  it("should allow AchievementProgress without unlockedAt when not unlocked", () => {
    const progress: AchievementProgress = {
      achievementId: "test-achievement",
      currentProgress: 0,
      unlocked: false,
    };

    expect(progress.achievementId).toBe("test-achievement");
    expect(progress.currentProgress).toBe(0);
    expect(progress.unlocked).toBe(false);
    expect(progress.unlockedAt).toBeUndefined();
  });
});

describe("Achievement Categories", () => {
  it("should have games category achievements", () => {
    const gamesAchievements = ACHIEVEMENTS.filter(
      (a) => a.category === "games",
    );
    expect(gamesAchievements.length).toBeGreaterThan(0);
  });

  it("should have wins category achievements", () => {
    const winsAchievements = ACHIEVEMENTS.filter((a) => a.category === "wins");
    expect(winsAchievements.length).toBeGreaterThan(0);
  });

  it("should have collection category achievements", () => {
    const collectionAchievements = ACHIEVEMENTS.filter(
      (a) => a.category === "collection",
    );
    expect(collectionAchievements.length).toBeGreaterThan(0);
  });

  it("should have special category achievements", () => {
    const specialAchievements = ACHIEVEMENTS.filter(
      (a) => a.category === "special",
    );
    expect(specialAchievements.length).toBeGreaterThan(0);
  });
});

describe("Achievement Progression", () => {
  it("should have progressive milestones for games played", () => {
    const gamesAchievements = ACHIEVEMENTS.filter(
      (a) => a.requirement.type === "games_played",
    ).sort((a, b) => a.requirement.count - b.requirement.count);

    // Should have increasing requirements
    for (let i = 1; i < gamesAchievements.length; i++) {
      expect(gamesAchievements[i].requirement.count).toBeGreaterThan(
        gamesAchievements[i - 1].requirement.count,
      );
    }
  });

  it("should have progressive milestones for wins", () => {
    const winsAchievements = ACHIEVEMENTS.filter(
      (a) => a.requirement.type === "wins",
    ).sort((a, b) => a.requirement.count - b.requirement.count);

    // Should have increasing requirements
    for (let i = 1; i < winsAchievements.length; i++) {
      expect(winsAchievements[i].requirement.count).toBeGreaterThan(
        winsAchievements[i - 1].requirement.count,
      );
    }
  });

  it("should have progressive milestones for collection", () => {
    const collectionAchievements = ACHIEVEMENTS.filter(
      (a) => a.requirement.type === "cards_collected",
    ).sort((a, b) => a.requirement.count - b.requirement.count);

    // Should have increasing requirements
    for (let i = 1; i < collectionAchievements.length; i++) {
      expect(collectionAchievements[i].requirement.count).toBeGreaterThan(
        collectionAchievements[i - 1].requirement.count,
      );
    }
  });
});

describe("Achievement Points Distribution", () => {
  it("should award more points for harder achievements", () => {
    // First game should have lower points than games_100
    const firstGame = ACHIEVEMENTS.find((a) => a.id === "first_game");
    const games100 = ACHIEVEMENTS.find((a) => a.id === "games_100");

    if (firstGame && games100) {
      expect(firstGame.points).toBeLessThan(games100.points);
    }
  });

  it("should award more points for wins than games played", () => {
    // wins_10 should have more points than games_10
    const wins10 = ACHIEVEMENTS.find((a) => a.id === "wins_10");
    const games10 = ACHIEVEMENTS.find((a) => a.id === "games_10");

    if (wins10 && games10) {
      expect(wins10.points).toBeGreaterThan(games10.points);
    }
  });

  it("should award more points for higher rarity", () => {
    const commonAchievements = ACHIEVEMENTS.filter(
      (a) => a.rarity === "common",
    );
    const legendaryAchievements = ACHIEVEMENTS.filter(
      (a) => a.rarity === "legendary",
    );

    const commonAvgPoints =
      commonAchievements.reduce((sum, a) => sum + a.points, 0) /
      commonAchievements.length;
    const legendaryAvgPoints =
      legendaryAchievements.reduce((sum, a) => sum + a.points, 0) /
      legendaryAchievements.length;

    expect(legendaryAvgPoints).toBeGreaterThan(commonAvgPoints);
  });
});
