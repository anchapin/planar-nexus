/**
 * Event Sourcing System Tests
 * Issue #753: Architecture - Integrate event sourcing as source of truth for multiplayer sync
 *
 * These tests verify the event sourcing infrastructure for multiplayer sync.
 * Due to the complexity of creating proper GameState with Map-based structures,
 * these tests are designed to be run once the full game-state infrastructure is in place.
 */

import type { GameState, GameAction, PlayerId, Phase, LinkedEffectRegistry } from "../types";
import {
  createEventSourcedState,
  EventSourcingGameState,
  GameEventLog,
  ActionEvent,
} from "../event-sourcing";
import { computeStateHash } from "../state-hash";
import { ReplacementEffectManager } from "../replacement-effects";
import { LayerSystem } from "../layer-system";

describe("EventSourcingGameState", () => {
  describe("interface contracts", () => {
    it("should have createEventSourcedState factory function", () => {
      expect(typeof createEventSourcedState).toBe("function");
    });

    it("should create EventSourcingGameState instance", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      expect(esState).toBeInstanceOf(EventSourcingGameState);
    });

    it("should expose getState method", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      expect(typeof esState.getState).toBe("function");
      expect(esState.getState().gameId).toBe("test");
    });

    it("should expose getEventLog method", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      expect(typeof esState.getEventLog).toBe("function");
      const log = esState.getEventLog();
      expect(log.sessionId).toBe("test-session");
    });

    it("should expose getStateHash method", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      expect(typeof esState.getStateHash).toBe("function");
      expect(typeof esState.getStateHash()).toBe("string");
    });

    it("should expose emitAction method", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      expect(typeof esState.emitAction).toBe("function");
    });

    it("should emit GAME_START event on initialization", () => {
      const mockState: GameState = {
        gameId: "test",
        players: new Map([
          [
            "p1",
            {
              id: "p1",
              name: "p1",
              life: 20,
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
            },
          ],
        ]),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: "p1",
          currentPhase: "PRECOMBAT_MAIN" as Phase,
          turnNumber: 1,
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
        priorityPlayerId: "p1",
        consecutivePasses: 0,
        status: "in_progress",
        winners: [],
        endReason: null,
        format: "commander",
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        replacementEffectManager: new ReplacementEffectManager(),
        layerSystem: new LayerSystem(),
      };

      const esState = createEventSourcedState(mockState, "test-session", "p1");
      const log = esState.getEventLog();
      expect(log.events.length).toBeGreaterThan(0);
      expect(log.events[0].type).toBe("GAME_START");
    });
  });
});

describe("computeStateHash", () => {
  it("should return a string hash", () => {
    const mockState: GameState = {
      gameId: "test",
      players: new Map([
        [
          "p1",
          {
            id: "p1",
            name: "p1",
            life: 20,
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
          },
        ],
      ]),
      cards: new Map(),
      zones: new Map(),
      stack: [],
      turn: {
        activePlayerId: "p1",
        currentPhase: "PRECOMBAT_MAIN" as Phase,
        turnNumber: 1,
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
      priorityPlayerId: "p1",
      consecutivePasses: 0,
      status: "in_progress",
      winners: [],
      endReason: null,
      format: "commander",
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
      replacementEffectManager: new ReplacementEffectManager(),
      layerSystem: new LayerSystem(),
    };

    const hash = computeStateHash(mockState);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("should return deterministic hash for same state", () => {
    const mockState: GameState = {
      gameId: "test",
      players: new Map([
        [
          "p1",
          {
            id: "p1",
            name: "p1",
            life: 20,
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
          },
        ],
      ]),
      cards: new Map(),
      zones: new Map(),
      stack: [],
      turn: {
        activePlayerId: "p1",
        currentPhase: "PRECOMBAT_MAIN" as Phase,
        turnNumber: 1,
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
      priorityPlayerId: "p1",
      consecutivePasses: 0,
      status: "in_progress",
      winners: [],
      endReason: null,
      format: "commander",
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
      replacementEffectManager: new ReplacementEffectManager(),
      layerSystem: new LayerSystem(),
    };

    const hash1 = computeStateHash(mockState);
    const hash2 = computeStateHash(mockState);
    expect(hash1).toBe(hash2);
  });
});
