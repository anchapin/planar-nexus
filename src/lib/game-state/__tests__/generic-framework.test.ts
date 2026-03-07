/**
 * Generic Card Game Framework Tests
 *
 * Tests for the generic framework that supports different game systems
 * while maintaining backward compatibility with MTG implementations.
 */

import {
  type Player,
  type ResourcePool,
  type GameSystemType,
  type GameFormat,
  type GameState,
  manaPoolToResourcePool,
  resourcePoolToManaPool,
  playerToMTGPlayer,
  mtgPlayerToPlayer,
  gameStateToMTGGameState,
  mtgGameStateToGameState,
} from "../types";
import { createInitialGameState } from "../game-state";
import { createEmptyManaPool } from "../mana";

describe("Generic Card Game Framework", () => {
  describe("Resource Pool Conversions", () => {
    describe("manaPoolToResourcePool", () => {
      it("should convert MTG mana pool to generic resource pool", () => {
        const manaPool = {
          colorless: 5,
          white: 2,
          blue: 3,
          black: 1,
          red: 0,
          green: 4,
          generic: 2,
        };

        const resourcePool = manaPoolToResourcePool(manaPool);

        expect(resourcePool.generic).toBe(7); // 5 colorless + 2 generic
        expect(resourcePool.specific.get("white")).toBe(2);
        expect(resourcePool.specific.get("blue")).toBe(3);
        expect(resourcePool.specific.get("black")).toBe(1);
        expect(resourcePool.specific.get("red")).toBe(0);
        expect(resourcePool.specific.get("green")).toBe(4);
      });

      it("should handle empty mana pool", () => {
        const manaPool = createEmptyManaPool();
        const resourcePool = manaPoolToResourcePool(manaPool);

        expect(resourcePool.generic).toBe(0);
        expect(resourcePool.specific.size).toBeGreaterThan(0);
        expect(resourcePool.specific.get("white")).toBe(0);
      });
    });

    describe("resourcePoolToManaPool", () => {
      it("should convert generic resource pool to MTG mana pool", () => {
        const resourcePool: ResourcePool = {
          generic: 7,
          specific: new Map([
            ["white", 2],
            ["blue", 3],
            ["black", 1],
            ["red", 0],
            ["green", 4],
          ]),
        };

        const manaPool = resourcePoolToManaPool(resourcePool);

        expect(manaPool.colorless).toBe(7);
        expect(manaPool.white).toBe(2);
        expect(manaPool.blue).toBe(3);
        expect(manaPool.black).toBe(1);
        expect(manaPool.red).toBe(0);
        expect(manaPool.green).toBe(4);
        expect(manaPool.generic).toBe(0); // Merged into colorless
      });

      it("should handle resource pool with only generic resources", () => {
        const resourcePool: ResourcePool = {
          generic: 5,
          specific: new Map(),
        };

        const manaPool = resourcePoolToManaPool(resourcePool);

        expect(manaPool.colorless).toBe(5);
        expect(manaPool.white).toBe(0);
        expect(manaPool.blue).toBe(0);
      });
    });

    describe("round-trip conversions", () => {
      it("should maintain data integrity through round-trip conversion", () => {
        const originalMana = {
          colorless: 3,
          white: 2,
          blue: 1,
          black: 4,
          red: 0,
          green: 1,
          generic: 5,
        };

        const resourcePool = manaPoolToResourcePool(originalMana);
        const convertedMana = resourcePoolToManaPool(resourcePool);

        // Generic and colorless get merged
        expect(convertedMana.colorless).toBe(8); // 3 + 5
        expect(convertedMana.white).toBe(2);
        expect(convertedMana.blue).toBe(1);
        expect(convertedMana.black).toBe(4);
        expect(convertedMana.red).toBe(0);
        expect(convertedMana.green).toBe(1);
      });
    });
  });

  describe("Player Conversions", () => {
    describe("mtgPlayerToPlayer", () => {
      it("should convert MTG player to generic player", () => {
        const mtgPlayer = {
          id: "player1",
          name: "Alice",
          gameSystem: "magic" as GameSystemType,
          life: 20,
          poisonCounters: 5,
          commanderDamage: new Map([["player2", 10]]),
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 1,
          maxLandsPerTurn: 1,
          manaPool: createEmptyManaPool(),
          isInCommandZone: false,
          experienceCounters: 3,
          commanderCastCount: 2,
          hasPassedPriority: false,
          hasActivatedManaAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        };

        const player = mtgPlayerToPlayer(mtgPlayer);

        expect(player.id).toBe(mtgPlayer.id);
        expect(player.name).toBe(mtgPlayer.name);
        expect(player.gameSystem).toBe("magic");
        expect(player.stats.health).toBe(20);
        expect(player.stats.secondaryCounters.get("poison")).toBe(5);
        expect(player.stats.leaderDamage.get("player2")).toBe(10);
        expect(player.stats.experienceCounters).toBe(3);
        expect(player.sourcesPlayedThisTurn).toBe(1);
        expect(player.maxSourcesPerTurn).toBe(1);
        expect(player.isInLeaderZone).toBe(false);
        expect(player.leaderCastCount).toBe(2);
      });

      it("should map MTG terminology to generic equivalents", () => {
        const mtgPlayer = {
          id: "player1",
          name: "Bob",
          gameSystem: "magic" as GameSystemType,
          life: 40,
          poisonCounters: 0,
          commanderDamage: new Map(),
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 0,
          maxLandsPerTurn: 1,
          manaPool: createEmptyManaPool(),
          isInCommandZone: true,
          experienceCounters: 0,
          commanderCastCount: 0,
          hasPassedPriority: false,
          hasActivatedManaAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        };

        const player = mtgPlayerToPlayer(mtgPlayer);

        // Verify terminology mapping
        expect(player.sourcesPlayedThisTurn).toBe(0); // landsPlayedThisTurn
        expect(player.maxSourcesPerTurn).toBe(1); // maxLandsPerTurn
        expect(player.isInLeaderZone).toBe(true); // isInCommandZone
        expect(player.leaderCastCount).toBe(0); // commanderCastCount
        expect(player.hasActivatedResourceAbility).toBe(false); // hasActivatedManaAbility
      });
    });

    describe("playerToMTGPlayer", () => {
      it("should convert generic player to MTG player", () => {
        const player: Player = {
          id: "player1",
          name: "Charlie",
          gameSystem: "magic",
          stats: {
            health: 20,
            secondaryCounters: new Map([["poison", 2]]),
            leaderDamage: new Map([["player2", 8]]),
            experienceCounters: 1,
          },
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          sourcesPlayedThisTurn: 1,
          maxSourcesPerTurn: 1,
          resourcePool: {
            generic: 5,
            specific: new Map([["white", 2], ["blue", 1]]),
          },
          isInLeaderZone: false,
          leaderCastCount: 1,
          hasPassedPriority: true,
          hasActivatedResourceAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        };

        const mtgPlayer = playerToMTGPlayer(player);

        expect(mtgPlayer.id).toBe(player.id);
        expect(mtgPlayer.name).toBe(player.name);
        expect(mtgPlayer.life).toBe(20);
        expect(mtgPlayer.poisonCounters).toBe(2);
        expect(mtgPlayer.commanderDamage.get("player2")).toBe(8);
        expect(mtgPlayer.experienceCounters).toBe(1);
        expect(mtgPlayer.landsPlayedThisTurn).toBe(1);
        expect(mtgPlayer.maxLandsPerTurn).toBe(1);
        expect(mtgPlayer.isInCommandZone).toBe(false);
        expect(mtgPlayer.commanderCastCount).toBe(1);
      });

      it("should map generic terminology to MTG equivalents", () => {
        const player: Player = {
          id: "player1",
          name: "Diana",
          gameSystem: "magic",
          stats: {
            health: 40,
            secondaryCounters: new Map(),
            leaderDamage: new Map(),
            experienceCounters: 0,
          },
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          sourcesPlayedThisTurn: 0,
          maxSourcesPerTurn: 1,
          resourcePool: {
            generic: 3,
            specific: new Map(),
          },
          isInLeaderZone: true,
          leaderCastCount: 0,
          hasPassedPriority: false,
          hasActivatedResourceAbility: true,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
        };

        const mtgPlayer = playerToMTGPlayer(player);

        // Verify terminology mapping
        expect(mtgPlayer.landsPlayedThisTurn).toBe(0); // sourcesPlayedThisTurn
        expect(mtgPlayer.maxLandsPerTurn).toBe(1); // maxSourcesPerTurn
        expect(mtgPlayer.isInCommandZone).toBe(true); // isInLeaderZone
        expect(mtgPlayer.commanderCastCount).toBe(0); // leaderCastCount
        expect(mtgPlayer.hasActivatedManaAbility).toBe(true); // hasActivatedResourceAbility
      });
    });

    describe("round-trip player conversions", () => {
      it("should maintain data integrity through round-trip conversion", () => {
        const originalMTGPlayer = {
          id: "player1",
          name: "Eve",
          gameSystem: "magic" as GameSystemType,
          life: 25,
          poisonCounters: 3,
          commanderDamage: new Map([["player2", 15]]),
          maxHandSize: 8,
          currentHandSizeModifier: 1,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 2,
          maxLandsPerTurn: 2,
          manaPool: {
            colorless: 4,
            white: 2,
            blue: 1,
            black: 0,
            red: 3,
            green: 0,
            generic: 1,
          },
          isInCommandZone: false,
          experienceCounters: 5,
          commanderCastCount: 3,
          hasPassedPriority: false,
          hasActivatedManaAbility: true,
          additionalCombatPhase: true,
          additionalMainPhase: false,
          hasOfferedDraw: true,
          hasAcceptedDraw: false,
        };

        const genericPlayer = mtgPlayerToPlayer(originalMTGPlayer);
        const convertedMTGPlayer = playerToMTGPlayer(genericPlayer);

        expect(convertedMTGPlayer.id).toBe(originalMTGPlayer.id);
        expect(convertedMTGPlayer.name).toBe(originalMTGPlayer.name);
        expect(convertedMTGPlayer.life).toBe(originalMTGPlayer.life);
        expect(convertedMTGPlayer.poisonCounters).toBe(originalMTGPlayer.poisonCounters);
        expect(convertedMTGPlayer.commanderDamage.get("player2")).toBe(15);
        expect(convertedMTGPlayer.experienceCounters).toBe(5);
        expect(convertedMTGPlayer.landsPlayedThisTurn).toBe(originalMTGPlayer.landsPlayedThisTurn);
        expect(convertedMTGPlayer.maxLandsPerTurn).toBe(originalMTGPlayer.maxLandsPerTurn);
        expect(convertedMTGPlayer.isInCommandZone).toBe(originalMTGPlayer.isInCommandZone);
        expect(convertedMTGPlayer.commanderCastCount).toBe(originalMTGPlayer.commanderCastCount);
        expect(convertedMTGPlayer.hasActivatedManaAbility).toBe(originalMTGPlayer.hasActivatedManaAbility);

        // Mana pool should be preserved (with generic merged into colorless)
        expect(convertedMTGPlayer.manaPool.colorless).toBe(5); // 4 + 1
        expect(convertedMTGPlayer.manaPool.white).toBe(2);
        expect(convertedMTGPlayer.manaPool.blue).toBe(1);
      });
    });
  });

  describe("Game State Conversions", () => {
    describe("gameStateToMTGGameState", () => {
      it("should convert generic game state to MTG game state", () => {
        const genericFormat: GameFormat = {
          name: "commander",
          gameSystem: "magic",
          maxCopies: 1,
          minDeckSize: 100,
          maxDeckSize: 100,
          startingHealth: 40,
          leaderDamageThreshold: 21,
          usesSideboard: false,
          sideboardSize: 0,
        };

        const genericState: Partial<GameState> = {
          gameId: "game1",
          gameSystem: "magic",
          format: genericFormat,
          players: new Map(),
          cards: new Map(),
          zones: new Map(),
          stack: [],
          turn: {
            activePlayerId: "player1",
            currentPhase: 0, // UNTAP
            turnNumber: 1,
            extraTurns: 0,
            isFirstTurn: true,
            startedAt: Date.now(),
          },
          combat: {
            inCombatPhase: false,
            attackers: [],
            blockers: new Map(),
            remainingCombatPhases: 0,
          },
          waitingChoice: null,
          priorityPlayerId: "player1",
          consecutivePasses: 0,
          status: "in_progress",
          winners: [],
          endReason: null,
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        } as GameState;

        const mtgState = gameStateToMTGGameState(genericState);

        expect(mtgState.gameId).toBe(genericState.gameId);
        expect(mtgState.format).toBe("commander");
        expect(mtgState.players).toBe(genericState.players);
      });
    });

    describe("mtgGameStateToGameState", () => {
      it("should convert MTG game state to generic game state", () => {
        const mtgState = {
          gameId: "game2",
          format: "standard",
          players: new Map(),
          cards: new Map(),
          zones: new Map(),
          stack: [],
          turn: {
            activePlayerId: "player1",
            currentPhase: 0,
            turnNumber: 3,
            extraTurns: 0,
            isFirstTurn: false,
            startedAt: Date.now(),
          },
          combat: {
            inCombatPhase: true,
            attackers: [],
            blockers: new Map(),
            remainingCombatPhases: 1,
          },
          waitingChoice: null,
          priorityPlayerId: "player1",
          consecutivePasses: 1,
          status: "in_progress",
          winners: [],
          endReason: null,
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        };

        const genericState = mtgGameStateToGameState(mtgState);

        expect(genericState.gameId).toBe(mtgState.gameId);
        expect(genericState.gameSystem).toBe("magic");
        expect(genericState.format.name).toBe("standard");
        expect(genericState.format.gameSystem).toBe("magic");
        expect(genericState.format.maxCopies).toBe(4);
        expect(genericState.format.minDeckSize).toBe(60);
        expect(genericState.format.startingHealth).toBe(20);
      });

      it("should handle commander format", () => {
        const mtgState = {
          gameId: "game3",
          format: "commander",
          players: new Map(),
          cards: new Map(),
          zones: new Map(),
          stack: [],
          turn: {
            activePlayerId: "player1",
            currentPhase: 0,
            turnNumber: 1,
            extraTurns: 0,
            isFirstTurn: true,
            startedAt: Date.now(),
          },
          combat: {
            inCombatPhase: false,
            attackers: [],
            blockers: new Map(),
            remainingCombatPhases: 0,
          },
          waitingChoice: null,
          priorityPlayerId: "player1",
          consecutivePasses: 0,
          status: "not_started",
          winners: [],
          endReason: null,
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        };

        const genericState = mtgGameStateToGameState(mtgState);

        expect(genericState.format.name).toBe("commander");
        expect(genericState.format.maxCopies).toBe(1);
        expect(genericState.format.minDeckSize).toBe(100);
        expect(genericState.format.startingHealth).toBe(40);
        expect(genericState.format.leaderDamageThreshold).toBe(21);
      });
    });
  });

  describe("Generic Game System Support", () => {
    it("should support creating a generic game state", () => {
      const genericFormat: GameFormat = {
        name: "custom_game",
        gameSystem: "custom",
        maxCopies: 3,
        minDeckSize: 50,
        maxDeckSize: 100,
        startingHealth: 30,
        leaderDamageThreshold: 15,
        usesSideboard: true,
        sideboardSize: 10,
      };

      const state: Partial<GameState> = {
        gameId: "generic_game1",
        gameSystem: "custom",
        format: genericFormat,
        players: new Map(),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "player1",
          currentPhase: 0,
          turnNumber: 1,
          extraTurns: 0,
          isFirstTurn: true,
          startedAt: Date.now(),
        },
        combat: {
          inCombatPhase: false,
          attackers: [],
          blockers: new Map(),
          remainingCombatPhases: 0,
        },
        waitingChoice: null,
        priorityPlayerId: "player1",
        consecutivePasses: 0,
        status: "not_started",
        winners: [],
        endReason: null,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      } as GameState;

      expect(state.gameSystem).toBe("custom");
      expect(state.format.name).toBe("custom_game");
      expect(state.format.startingHealth).toBe(30);
      expect(state.format.leaderDamageThreshold).toBe(15);
      expect(state.format.maxCopies).toBe(3);
    });

    it("should support custom resource systems", () => {
      const customResourcePool: ResourcePool = {
        generic: 10,
        specific: new Map([
          ["fire", 3],
          ["ice", 2],
          ["lightning", 4],
        ]),
      };

      expect(customResourcePool.generic).toBe(10);
      expect(customResourcePool.specific.get("fire")).toBe(3);
      expect(customResourcePool.specific.get("ice")).toBe(2);
      expect(customResourcePool.specific.get("lightning")).toBe(4);
    });

    it("should support custom player statistics", () => {
      const player: Player = {
        id: "player1",
        name: "Player One",
        gameSystem: "custom",
        stats: {
          health: 30,
          secondaryCounters: new Map([
            ["corruption", 5],
            ["fatigue", 2],
          ]),
          leaderDamage: new Map([["player2", 8]]),
          experienceCounters: 10,
        },
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        sourcesPlayedThisTurn: 1,
        maxSourcesPerTurn: 2,
        resourcePool: {
          generic: 5,
          specific: new Map([
            ["fire", 2],
            ["ice", 1],
          ]),
        },
        isInLeaderZone: false,
        leaderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedResourceAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
      };

      expect(player.stats.health).toBe(30);
      expect(player.stats.secondaryCounters.get("corruption")).toBe(5);
      expect(player.stats.secondaryCounters.get("fatigue")).toBe(2);
      expect(player.stats.experienceCounters).toBe(10);
    });
  });

  describe("Backward Compatibility", () => {
    it("should maintain compatibility with existing MTG game logic", () => {
      // Create a game state using MTG format string
      const mtgState = mtgGameStateToGameState({
        gameId: "compat_test",
        format: "commander",
        players: new Map(),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "player1",
          currentPhase: 0,
          turnNumber: 1,
          extraTurns: 0,
          isFirstTurn: true,
          startedAt: Date.now(),
        },
        combat: {
          inCombatPhase: false,
          attackers: [],
          blockers: new Map(),
          remainingCombatPhases: 0,
        },
        waitingChoice: null,
        priorityPlayerId: "player1",
        consecutivePasses: 0,
        status: "not_started",
        winners: [],
        endReason: null,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      });

      // Convert back to MTG format
      const convertedState = gameStateToMTGGameState(mtgState);

      expect(convertedState.format).toBe("commander");
      expect(mtgState.format.startingHealth).toBe(40);
      expect(mtgState.format.leaderDamageThreshold).toBe(21);
    });

    it("should preserve MTG player properties through conversions", () => {
      const mtgPlayer = {
        id: "player1",
        name: "Frank",
        gameSystem: "magic" as GameSystemType,
        life: 20,
        poisonCounters: 0,
        commanderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1,
        manaPool: createEmptyManaPool(),
        isInCommandZone: false,
        experienceCounters: 0,
        commanderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedManaAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
      };

      const genericPlayer = mtgPlayerToPlayer(mtgPlayer);
      const convertedMTGPlayer = playerToMTGPlayer(genericPlayer);

      expect(convertedMTGPlayer.life).toBe(mtgPlayer.life);
      expect(convertedMTGPlayer.poisonCounters).toBe(mtgPlayer.poisonCounters);
      expect(convertedMTGPlayer.landsPlayedThisTurn).toBe(mtgPlayer.landsPlayedThisTurn);
      expect(convertedMTGPlayer.maxLandsPerTurn).toBe(mtgPlayer.maxLandsPerTurn);
      expect(convertedMTGPlayer.isInCommandZone).toBe(mtgPlayer.isInCommandZone);
      expect(convertedMTGPlayer.commanderCastCount).toBe(mtgPlayer.commanderCastCount);
      expect(convertedMTGPlayer.hasActivatedManaAbility).toBe(mtgPlayer.hasActivatedManaAbility);
    });
  });
});
