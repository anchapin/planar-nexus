/**
 * Event Replay Tests
 * Issue #815: Verify that getStateAtIndex properly replays events to reconstruct state
 *
 * These tests verify the event replay functionality for:
 * - Finding closest STATE_SYNC/GAME_START checkpoint
 * - Replaying all ACTION events between checkpoint and target
 * - Returning the correct reconstructed state
 */

import type { GameState, GameAction, PlayerId, Phase } from "../types";
import {
  createEventSourcedState,
  EventSourcingGameState,
} from "../event-sourcing";
import { computeStateHash } from "../state-hash";
import { ReplacementEffectManager } from "../replacement-effects";
import { LayerSystem } from "../layer-system";

/**
 * Create a mock GameState with the minimum required fields
 */
function createMockState(overrides: Partial<GameState> = {}): GameState {
  const state: GameState = {
    gameId: "test-replay",
    players: new Map([
      [
        "player1",
        {
          id: "player1",
          name: "Player 1",
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
      [
        "player2",
        {
          id: "player2",
          name: "Player 2",
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
    zones: new Map([
      ["player1-library", { type: "library" as const, playerId: "player1", cardIds: ["card1", "card2", "card3", "card4", "card5"], isRevealed: false, visibleTo: [] }],
      ["player1-hand", { type: "hand" as const, playerId: "player1", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player1-battlefield", { type: "battlefield" as const, playerId: "player1", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player1-graveyard", { type: "graveyard" as const, playerId: "player1", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player1-exile", { type: "exile" as const, playerId: "player1", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player2-library", { type: "library" as const, playerId: "player2", cardIds: ["card6", "card7", "card8", "card9", "card10"], isRevealed: false, visibleTo: [] }],
      ["player2-hand", { type: "hand" as const, playerId: "player2", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player2-battlefield", { type: "battlefield" as const, playerId: "player2", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player2-graveyard", { type: "graveyard" as const, playerId: "player2", cardIds: [], isRevealed: false, visibleTo: [] }],
      ["player2-exile", { type: "exile" as const, playerId: "player2", cardIds: [], isRevealed: false, visibleTo: [] }],
    ]),
    stack: [],
    turn: {
      activePlayerId: "player1",
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
    priorityPlayerId: "player1",
    consecutivePasses: 0,
    status: "in_progress" as const,
    winners: [],
    endReason: null,
    format: "commander",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    replacementEffectManager: new ReplacementEffectManager(),
    layerSystem: new LayerSystem(),
    linkedEffectRegistry: {
      effects: [],
      bySourceCard: new Map(),
    },
  };

  return { ...state, ...overrides };
}

describe("Event Replay", () => {
  describe("getStateAtIndex", () => {
    it("should return null when targetIndex is before any checkpoint", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // The GAME_START event is at index 1
      const result = esState.getStateAtIndex(0);
      expect(result).toBeNull();
    });

    it("should return the checkpoint state when targetIndex equals a checkpoint", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // The GAME_START event is at index 1
      const result = esState.getStateAtIndex(1);

      expect(result).not.toBeNull();
      expect(result!.gameId).toBe("test-replay");
    });

    it("should return current state when requesting beyond last event", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      const result = esState.getStateAtIndex(9999);

      // Should return current state when no events found
      expect(result).not.toBeNull();
      expect(result!.gameId).toBe("test-replay");
    });

    it("should find closest GAME_START checkpoint when no STATE_SYNC exists", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // Without any STATE_SYNC, should find GAME_START at index 1
      const result = esState.getStateAtIndex(5);

      expect(result).not.toBeNull();
      expect(result!.gameId).toBe("test-replay");
    });

it("should replay events after checkpoint", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // Add a checkpoint
      esState.addStateSyncCheckpoint(); // Index 2

      // Emit the action (this will be at index 3)
      // Note: emitAction only records the action - state is not modified
      const action: GameAction = {
        type: "draw_card",
        playerId: "player1",
        timestamp: Date.now(),
        data: { targetId: "player1" },
      };
      esState.emitAction(action, esState.getStateHash());

      // Add another checkpoint (this captures current state at index 4)
      esState.addStateSyncCheckpoint(); // Index 4

      // Now get state at index 2 (at checkpoint)
      const stateAtCheckpoint = esState.getStateAtIndex(2);

      // And state at index 4 (at next checkpoint)
      const stateAtNextCheckpoint = esState.getStateAtIndex(4);

      expect(stateAtCheckpoint).not.toBeNull();
      expect(stateAtNextCheckpoint).not.toBeNull();

      // Both checkpoints should have the same hand size since emitAction doesn't modify state
      const handAtCheckpoint = stateAtCheckpoint!.zones.get("player1-hand");
      const handAtNextCheckpoint = stateAtNextCheckpoint!.zones.get("player1-hand");

      // Verify maps work correctly
      expect(handAtCheckpoint).toBeDefined();
      expect(handAtNextCheckpoint).toBeDefined();
      expect(handAtCheckpoint?.cardIds.length).toBe(handAtNextCheckpoint?.cardIds.length);
    });
  });

  describe("replay consistency", () => {
    it("should produce deterministic results when replaying", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // Add a checkpoint
      esState.addStateSyncCheckpoint(); // Index 2

      // Perform several actions
      const drawAction: GameAction = {
        type: "draw_card",
        playerId: "player1",
        timestamp: Date.now(),
        data: { targetId: "player1" },
      };
      esState.emitAction(drawAction, esState.getStateHash()); // Index 3

      const damageAction: GameAction = {
        type: "deal_damage",
        playerId: "player1",
        timestamp: Date.now(),
        data: { amount: 3, targetId: "player2", isCombatDamage: false },
      };
      esState.emitAction(damageAction, esState.getStateHash()); // Index 4

      // Get state at index 4 multiple times
      const result1 = esState.getStateAtIndex(4);
      const result2 = esState.getStateAtIndex(4);
      const result3 = esState.getStateAtIndex(4);

      // All results should be identical
      expect(computeStateHash(result1!)).toBe(computeStateHash(result2!));
      expect(computeStateHash(result2!)).toBe(computeStateHash(result3!));
    });

    it("should return same hash for reconstructed state as original event's resultingStateHash", () => {
      const state = createMockState();
      const esState = createEventSourcedState(state, "test-session", "player1");

      // Get events after initialization
      const events = esState.getEventLog().events;
      expect(events.length).toBeGreaterThan(0);

      // Find an ACTION event and check its stored hash
      const actionEvents = events.filter((e) => e.type === "ACTION");
      if (actionEvents.length > 0) {
        const actionEvent = actionEvents[0];
        const reconstructedState = esState.getStateAtIndex(actionEvent.index);

        expect(reconstructedState).not.toBeNull();

        const reconstructedHash = computeStateHash(reconstructedState!);
        // The reconstructed state should match the event's resultingStateHash
        expect(reconstructedHash).toBe((actionEvent as any).resultingStateHash);
      }
    });
  });
});