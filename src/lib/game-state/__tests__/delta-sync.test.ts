/**
 * Game State Delta Synchronization Tests
 *
 * Issue #1024: [Performance] Implement game state delta synchronization for P2P
 */

import {
  computeStateDelta,
  applyDelta,
  shouldUseFullSync,
  estimateDeltaSize,
  isDeltaSmallEnough,
  type GameStateDelta,
} from "../delta-sync";
import type { GameState, AIGameState } from "../types";

function createMinimalGameState(turnNumber: number = 1): GameState {
  return {
    gameId: "test-game",
    players: new Map([
      [
        "player1",
        {
          id: "player1",
          name: "Player 1",
          life: 40,
          poisonCounters: 0,
          commanderDamage: new Map(),
          maxHandSize: 7,
          currentHandSizeModifier: 0,
          hasLost: false,
          lossReason: null,
          landsPlayedThisTurn: 0,
          maxLandsPerTurn: 1,
          manaPool: {
            colorless: 0,
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            generic: 0,
          },
          isInCommandZone: false,
          experienceCounters: 0,
          commanderCastCount: 0,
          hasPassedPriority: false,
          hasActivatedManaAbility: false,
          additionalCombatPhase: false,
          additionalMainPhase: false,
          hasOfferedDraw: false,
          hasAcceptedDraw: false,
          isMonarch: false,
        },
      ],
    ]),
    cards: new Map(),
    zones: new Map(),
    stack: [],
    turn: {
      activePlayerId: "player1",
      currentPhase: "precombat_main",
      turnNumber,
      extraTurns: 0,
      isFirstTurn: false,
      startedAt: Date.now(),
    },
    combat: {
      inCombatPhase: false,
      attackers: [],
      blockers: new Map(),
      remainingCombatPhases: 1,
    },
    waitingChoice: null,
    priorityPlayerId: "player1",
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "commander",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
  } as unknown as GameState;
}

function createMinimalAIGameState(): AIGameState {
  return {
    players: {
      player1: {
        id: "player1",
        name: "Player 1",
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 0,
        battlefield: [],
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
        },
        landsPlayedThisTurn: 0,
        hasPassedPriority: false,
      },
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer: "player1",
      phase: "precombat_main",
      priority: "player1",
    },
    stack: [],
  };
}

describe("Delta Sync", () => {
  describe("computeStateDelta", () => {
    it("should return full sync flag when lastSyncedState is null", () => {
      const currentState = createMinimalGameState();
      const delta = computeStateDelta(currentState, null);

      expect(delta.isFullSync).toBe(true);
    });

    it("should track version correctly", () => {
      const currentState = createMinimalGameState(5);
      const lastState = createMinimalAIGameState();

      const delta = computeStateDelta(currentState, lastState);

      expect(delta.version).toBe(5);
    });

    it("should compute player life changes", () => {
      const currentState = createMinimalGameState();
      currentState.players.get("player1")!.life = 35;

      const lastState = createMinimalAIGameState();
      const delta = computeStateDelta(currentState, lastState);

      expect(delta.playerDeltas.length).toBeGreaterThan(0);
      expect(delta.playerDeltas.some((d) => d.action === "update")).toBe(true);
    });
  });

  describe("applyDelta", () => {
    it("should apply player updates correctly", () => {
      const baseState = createMinimalAIGameState();
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [
          {
            id: "player1",
            action: "update",
            data: { life: 35 } as any,
            changedFields: ["life"],
          },
        ],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "abc123",
      };

      const result = applyDelta(baseState, delta);

      expect(result.players["player1"].life).toBe(35);
    });

    it("should handle player additions", () => {
      const baseState = createMinimalAIGameState();
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [
          {
            id: "player2",
            action: "add",
            data: {
              id: "player2",
              name: "Player 2",
              life: 40,
              poisonCounters: 0,
              commanderDamage: {},
              hand: [],
              graveyard: [],
              exile: [],
              library: 0,
              battlefield: [],
              manaPool: {},
            } as any,
          },
        ],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "def456",
      };

      const result = applyDelta(baseState, delta);

      expect(result.players["player2"]).toBeDefined();
      expect(result.players["player2"].life).toBe(40);
    });

    it("should handle player removals", () => {
      const baseState = createMinimalAIGameState();
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [{ id: "player1", action: "remove" }],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "ghi789",
      };

      const result = applyDelta(baseState, delta);

      expect(result.players["player1"]).toBeUndefined();
    });
  });

  describe("shouldUseFullSync", () => {
    it("should return true when lastSyncedState is null", () => {
      const currentState = createMinimalGameState();
      const result = shouldUseFullSync(currentState, null);

      expect(result).toBe(true);
    });

    it("should return true when there are many player changes", () => {
      const currentState = createMinimalGameState();

      const lastState = createMinimalAIGameState();
      lastState.players["player2"] = {
        id: "player2",
        name: "Player 2",
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        hand: [],
        graveyard: [],
        exile: [],
        library: 0,
        battlefield: [],
        manaPool: {},
      } as any;

      currentState.players.set("player2", {
        id: "player2",
        name: "Player 2",
        life: 40,
        poisonCounters: 0,
        commanderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
        },
        isInCommandZone: false,
        experienceCounters: 0,
        commanderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedManaAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
        isMonarch: false,
      } as any);

      currentState.players.set("player3", {
        id: "player3",
        name: "Player 3",
        life: 40,
        poisonCounters: 0,
        commanderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
        },
        isInCommandZone: false,
        experienceCounters: 0,
        commanderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedManaAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
        isMonarch: false,
      } as any);

      currentState.players.set("player4", {
        id: "player4",
        name: "Player 4",
        life: 40,
        poisonCounters: 0,
        commanderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
        },
        isInCommandZone: false,
        experienceCounters: 0,
        commanderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedManaAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
        isMonarch: false,
      } as any);

      currentState.players.set("player5", {
        id: "player5",
        name: "Player 5",
        life: 40,
        poisonCounters: 0,
        commanderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1,
        manaPool: {
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
        },
        isInCommandZone: false,
        experienceCounters: 0,
        commanderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedManaAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
        isMonarch: false,
      } as any);

      const result = shouldUseFullSync(currentState, lastState);

      expect(result).toBe(true);
    });
  });

  describe("estimateDeltaSize", () => {
    it("should estimate size in bytes", () => {
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "abc123",
      };

      const size = estimateDeltaSize(delta);

      expect(typeof size).toBe("number");
      expect(size).toBeGreaterThan(0);
    });
  });

  describe("isDeltaSmallEnough", () => {
    it("should return true for small deltas", () => {
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "abc123",
      };

      expect(isDeltaSmallEnough(delta)).toBe(true);
    });

    it("should return false for deltas exceeding 10KB", () => {
      const largeData = "x".repeat(15 * 1024);
      const delta: GameStateDelta = {
        version: 1,
        timestamp: Date.now(),
        playerDeltas: [{ id: "large", action: "update", data: { extra: largeData } as any }],
        cardDeltas: [],
        zoneDeltas: [],
        stackDeltas: [],
        turnDelta: null,
        combatDelta: null,
        isFullSync: false,
        checksum: "abc123",
      };

      expect(isDeltaSmallEnough(delta)).toBe(false);
    });
  });
});
