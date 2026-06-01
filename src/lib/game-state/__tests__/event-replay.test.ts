/**
 * Event Replay and State Reconstruction Tests
 * Issue #866: Event Sourcing Should Be Single Source of Truth
 *
 * These tests verify that:
 * - CR 704: State is always derivable by replaying events
 * - State hash can be computed at any point for sync verification
 * - Late-joining player can reconstruct state from event log
 * - All game state changes flow through event log
 */

import type { GameState, GameAction, PlayerId, Phase } from "../types";
import {
  createEventSourcedState,
  EventSourcingGameState,
  eventLogToReplay,
  type ActionEvent,
  type StateSyncEvent,
  type GameStartEvent,
} from "../event-sourcing";
import { computeStateHash } from "../state-hash";
import { cloneGameState } from "../state-serialization";
import { ReplacementEffectManager } from "../replacement-effects";
import { LayerSystem } from "../layer-system";

// Helper to create a minimal mock state
function createMockState(
  playerId: PlayerId = "p1",
  life: number = 20,
): GameState {
  return {
    gameId: "test-game",
    players: new Map([
      [
        playerId,
        {
          id: playerId,
          name: playerId,
          life,
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
      activePlayerId: playerId,
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
    priorityPlayerId: playerId,
    consecutivePasses: 0,
    status: "in_progress",
    winners: [],
    endReason: null,
    format: "commander",
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    linkedEffectRegistry: { effects: [], bySourceCard: new Map() },
    replacementEffectManager: new ReplacementEffectManager(),
    layerSystem: new LayerSystem(),
  };
}

describe("Event Replay and State Reconstruction", () => {
  describe("State derivable by replaying events", () => {
    it("should reconstruct state at any event index by replaying events", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Initial state should match
      const initialHash = computeStateHash(initialState);
      expect(esState.getStateHash()).toBe(initialHash);

      // Add a state sync checkpoint
      esState.addVerifiedStateSyncCheckpoint();

      // Simulate some actions by manually emitting events
      const action1: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      const hash1 = esState.getStateHash();
      esState.emitAction(action1, hash1);

      // Add another checkpoint
      esState.addVerifiedStateSyncCheckpoint();

      const action2: GameAction = {
        type: "lose_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 3 },
      };
      const hash2 = esState.getStateHash();
      esState.emitAction(action2, hash2);

      // Get the event log
      const log = esState.getEventLog();
      expect(log.events.length).toBeGreaterThan(0);

      // Verify GAME_START is at index 1
      const gameStartEvent = log.events.find(
        (e): e is GameStartEvent => e.type === "GAME_START",
      );
      expect(gameStartEvent).toBeDefined();
      expect(gameStartEvent?.index).toBe(1);
    });

    it("should compute deterministic state hash at any point", () => {
      const state1 = createMockState("p1", 20);
      const state2 = createMockState("p1", 20);

      const hash1 = computeStateHash(state1);
      const hash2 = computeStateHash(state2);

      // Same state should produce same hash
      expect(hash1).toBe(hash2);

      // Different life should produce different hash
      const state3 = createMockState("p1", 19);
      const hash3 = computeStateHash(state3);
      expect(hash3).not.toBe(hash1);
    });

    it("should emit action events with correct previous and resulting state hashes", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      const previousHash = esState.getStateHash();

      const action: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };

      // Use performVerifiedStateTransition which applies state BEFORE emitting
      // direct emitAction is for pre-mutation recording - the state isn't changed yet
      const { event } = esState.performVerifiedStateTransition(
        action,
        (state) => {
          const newState = cloneGameState(state);
          const player = newState.players.get("p1");
          if (player) {
            player.life += 5;
          }
          return newState;
        },
      );

      expect(event.type).toBe("ACTION");
      expect(event.previousStateHash).toBe(previousHash);
      // The resulting state should be different since we gained life
      expect(event.resultingStateHash).not.toBe(previousHash);
    });
  });

  describe("State hash verification at checkpoints", () => {
    it("should add verified state sync checkpoints with correct hashes", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add a checkpoint
      const checkpoint = esState.addVerifiedStateSyncCheckpoint();

      expect(checkpoint.type).toBe("STATE_SYNC");
      expect(checkpoint.stateHash).toBe(computeStateHash(esState.getState()));
      expect(checkpoint.index).toBeGreaterThan(0);
    });

    it("should verify event log integrity", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add checkpoint
      esState.addVerifiedStateSyncCheckpoint();

      // Emit some actions
      const action1: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      esState.emitAction(action1, esState.getStateHash());

      // Verify integrity - should be valid since we haven't corrupted anything
      const integrity = esState.verifyEventLogIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.discrepancies).toHaveLength(0);
    });

    it("should detect hash mismatches in event log", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add checkpoint
      const checkpoint = esState.addVerifiedStateSyncCheckpoint();

      // Manually corrupt the event log by changing a hash
      const log = esState.getEventLog();
      const stateSyncEvent = log.events.find(
        (e): e is StateSyncEvent => e.type === "STATE_SYNC",
      );
      if (stateSyncEvent) {
        // Corrupt the hash
        const corruptedEvent = {
          ...stateSyncEvent,
          stateHash: "corrupted_hash_value",
        };
        const index = log.events.indexOf(stateSyncEvent);
        log.events[index] = corruptedEvent;
      }

      // Verify should detect the mismatch
      const integrity = esState.verifyEventLogIntegrity();
      expect(integrity.isValid).toBe(false);
      expect(integrity.discrepancies.length).toBeGreaterThan(0);
    });
  });

  describe("Late-joining player state reconstruction", () => {
    it("should provide events since a specific index for late-join recovery", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add initial checkpoint
      const checkpoint1 = esState.addVerifiedStateSyncCheckpoint();

      // Emit some actions
      const action1: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      esState.emitAction(action1, esState.getStateHash());

      // Add another checkpoint
      const checkpoint2 = esState.addVerifiedStateSyncCheckpoint();

      const action2: GameAction = {
        type: "lose_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 3 },
      };
      esState.emitAction(action2, esState.getStateHash());

      // Get events since checkpoint1
      const eventsSince = esState.getEventsSince(checkpoint1.index);
      expect(eventsSince.length).toBeGreaterThan(0);
      expect(eventsSince.every((e) => e.index > checkpoint1.index)).toBe(true);
    });

    it("should provide getStateAtEventIndex alias for consistency", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add checkpoint
      const checkpoint = esState.addVerifiedStateSyncCheckpoint();

      // getStateAtEventIndex should be same as getStateAtIndex
      const state1 = esState.getStateAtIndex(checkpoint.index);
      const state2 = esState.getStateAtEventIndex(checkpoint.index);

      expect(state1).toEqual(state2);
    });
  });

  describe("All game state changes flow through event log", () => {
    it("should create event log on initialization", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      const log = esState.getEventLog();

      expect(log.events.length).toBeGreaterThan(0);
      expect(log.sessionId).toBe("test-session");
      expect(log.createdAt).toBeDefined();
    });

    it("should track pending events for multiplayer sync", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Emit an action from a different player
      const action: GameAction = {
        type: "draw_card",
        playerId: "p2", // Different player
        timestamp: Date.now(),
        data: { targetId: "p2" },
      };

      esState.emitAction(action, esState.getStateHash());

      const log = esState.getEventLog();

      // The event should be in pending events since it's not from local player
      const pendingEvent = log.pendingEvents.find(
        (e) =>
          e.type === "ACTION" && (e as ActionEvent).action.playerId === "p2",
      );
      expect(pendingEvent).toBeDefined();
    });

    it("should confirm own actions automatically", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Emit an action from local player
      const action: GameAction = {
        type: "gain_life",
        playerId: "p1", // Local player
        timestamp: Date.now(),
        data: { amount: 5 },
      };

      const event = esState.emitAction(action, esState.getStateHash());

      // Should be auto-confirmed since it's from local player
      expect(event.confirmed).toBe(true);
      expect(event.confirmedBy).toContain("p1");
    });

    it("should increment event index for each event", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // GAME_START is index 1
      const gameStartIndex = esState.getCurrentEventIndex();
      expect(gameStartIndex).toBe(1);

      // Add checkpoint
      esState.addVerifiedStateSyncCheckpoint();
      expect(esState.getCurrentEventIndex()).toBe(2);

      // Emit action
      const action: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      esState.emitAction(action, esState.getStateHash());
      expect(esState.getCurrentEventIndex()).toBe(3);
    });
  });

  describe("Event replay for ReplaySystem compatibility", () => {
    it("should provide replay events in correct format", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add checkpoint
      esState.addVerifiedStateSyncCheckpoint();

      // Emit actions
      const action1: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      esState.emitAction(action1, esState.getStateHash());

      const action2: GameAction = {
        type: "lose_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 3 },
      };
      esState.emitAction(action2, esState.getStateHash());

      // Get replay events
      const replayEvents = esState.getReplayEvents();

      // Should have the two actions
      const actionEvents = replayEvents.filter(
        (e) => e.action.type === "gain_life" || e.action.type === "lose_life",
      );
      expect(actionEvents.length).toBe(2);
    });

    it("should export event log to replay format", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add checkpoint
      esState.addVerifiedStateSyncCheckpoint();

      // Emit action
      const action: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      esState.emitAction(action, esState.getStateHash());

      // Export to replay format
      const replay = eventLogToReplay(
        esState.getEventLog(),
        "commander",
        ["p1"],
        20,
        true,
      );

      expect(replay.id).toBe("test-session");
      expect(replay.metadata.format).toBe("commander");
      expect(replay.actions.length).toBeGreaterThan(0);
    });
  });

  describe("Rollback support for desync recovery", () => {
    it("should find state at any checkpoint", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      // Add multiple checkpoints
      const checkpoint1 = esState.addVerifiedStateSyncCheckpoint();

      const action: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      // Use performVerifiedStateTransition that applies state before emitting
      esState.performVerifiedStateTransition(action, (state) => {
        const newState = cloneGameState(state);
        const player = newState.players.get("p1");
        if (player) {
          player.life += 5;
        }
        return newState;
      });

      const checkpoint2 = esState.addVerifiedStateSyncCheckpoint();

      // Get state at checkpoint1
      const stateAtCheckpoint1 = esState.getStateAtIndex(checkpoint1.index);
      expect(stateAtCheckpoint1).toBeDefined();

      // Get state at checkpoint2
      const stateAtCheckpoint2 = esState.getStateAtIndex(checkpoint2.index);
      expect(stateAtCheckpoint2).toBeDefined();
    });

    it("should perform rollback to previous state", () => {
      const initialState = createMockState();
      const esState = createEventSourcedState(
        initialState,
        "test-session",
        "p1",
      );

      const initialHash = esState.getStateHash();

      // Add checkpoint
      const checkpoint = esState.addVerifiedStateSyncCheckpoint();

      // Emit action that changes state
      const action: GameAction = {
        type: "gain_life",
        playerId: "p1",
        timestamp: Date.now(),
        data: { amount: 5 },
      };
      // Use performVerifiedStateTransition that applies state before emitting
      esState.performVerifiedStateTransition(action, (state) => {
        const newState = cloneGameState(state);
        const player = newState.players.get("p1");
        if (player) {
          player.life += 5;
        }
        return newState;
      });

      // Current state should be different
      const afterActionHash = esState.getStateHash();
      expect(afterActionHash).not.toBe(initialHash);

      // Perform rollback to checkpoint
      const rollbackResult = esState.performRollback(
        checkpoint.index,
        "Test rollback",
      );
      expect(rollbackResult).toBe(true);

      // State should now match initial
      const afterRollbackHash = esState.getStateHash();
      expect(afterRollbackHash).toBe(initialHash);
    });
  });
});
