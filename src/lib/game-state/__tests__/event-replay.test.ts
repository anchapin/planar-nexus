/**
 * Event Replay Tests
 * Issue #815: Verify that getStateAtIndex properly replays events to reconstruct state
 *
 * These tests verify the event replay functionality for:
 * - Finding closest STATE_SYNC/GAME_START checkpoint
 * - Replaying all ACTION events between checkpoint and target
 * - Returning the correct reconstructed state
 */

import { GameState, GameAction, PlayerId, Phase, ZoneType } from "../types";
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
      [
        "player1-library",
        {
          type: ZoneType.LIBRARY,
          playerId: "player1",
          cardIds: ["card1", "card2", "card3", "card4", "card5"],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player1-hand",
        {
          type: ZoneType.HAND,
          playerId: "player1",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player1-battlefield",
        {
          type: ZoneType.BATTLEFIELD,
          playerId: "player1",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player1-graveyard",
        {
          type: ZoneType.GRAVEYARD,
          playerId: "player1",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player1-exile",
        {
          type: ZoneType.EXILE,
          playerId: "player1",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player2-library",
        {
          type: ZoneType.LIBRARY,
          playerId: "player2",
          cardIds: ["card6", "card7", "card8", "card9", "card10"],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player2-hand",
        {
          type: ZoneType.HAND,
          playerId: "player2",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player2-battlefield",
        {
          type: ZoneType.BATTLEFIELD,
          playerId: "player2",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player2-graveyard",
        {
          type: ZoneType.GRAVEYARD,
          playerId: "player2",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
      [
        "player2-exile",
        {
          type: ZoneType.EXILE,
          playerId: "player2",
          cardIds: [],
          isRevealed: false,
          visibleTo: [],
        },
      ],
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

/**
 * Create a mock CardInstance for testing
 */
function createMockCard(
  cardId: string,
  controllerId: string,
  name: string = "Test Card",
  keywords: string[] = [],
  oracleText: string = ""
): import("../types").CardInstance {
  return {
    id: cardId as import("../types").CardInstanceId,
    oracleId: `oracle-${cardId}`,
    cardData: {
      id: cardId,
      name,
      lang: "en",
      mana_cost: "{1}",
      cmc: 1,
      type_line: "Creature — Human",
      oracle_text: oracleText,
      keywords: keywords as any,
      card_back: false,
      artist: "",
      artist_ids: [],
      edition: "",
      rarity: "common" as const,
      border_color: "black" as const,
      frame: "normal" as const,
      frame_effect: null,
      security_stamp: null,
      relatedCards: { fetches: [], lands: [], pays: [] },
    } as any,
    currentFaceIndex: 0,
    isFaceDown: false,
    controllerId,
    ownerId: controllerId,
    isTapped: false,
    isFlipped: false,
    isTurnedFaceUp: false,
    isPhasedOut: false,
    hasSummoningSickness: false,
    attachedTo: null,
    counters: new Map(),
    markedDamage: new Map(),
    timestamp: Date.now(),
    attackDomain: new Map(),
    attackPower: null,
    defenseToughness: null,
    printedText: null,
    oracleText: oracleText,
    currentProwlingPlayer: null,
    controllingEffectId: null,
    attackedLastTurn: false,
    staticAbilities: new Map(),
    triggeredAbilities: [],
    activatedAbilities: [],
    loyalty: 0,
    countersUpdatedThisTurn: false,
    zoneId: null,
  };
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
      const handAtNextCheckpoint =
        stateAtNextCheckpoint!.zones.get("player1-hand");

      // Verify maps work correctly
      expect(handAtCheckpoint).toBeDefined();
      expect(handAtNextCheckpoint).toBeDefined();
      expect(handAtCheckpoint?.cardIds.length).toBe(
        handAtNextCheckpoint?.cardIds.length,
      );
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

  describe("mutationApplier integration", () => {
    it("should correctly replay declare_attackers action", () => {
      const { declareAttackers } = require("../event-sourced-game-state");
      const initialState = createMockState();

      // Create state with a creature on battlefield
      const creatureCard = createMockCard("creature-1", "player1", "Test Creature");
      initialState.cards.set("creature-1", creatureCard);
      const battlefieldZone = initialState.zones.get("player1-battlefield") || { cardIds: [], type: "battlefield" as ZoneType };
      battlefieldZone.cardIds.push("creature-1");
      initialState.zones.set("player1-battlefield", battlefieldZone);

      const esState = createEventSourcedState(initialState, "test-session", "player1");
      esState.addVerifiedStateSyncCheckpoint();

      // Declare attackers
      const attackerIds = [{ cardId: "creature-1" as CardInstanceId, defenderId: "player2" as PlayerId }];
      declareAttackers(esState, "player1", attackerIds);

      // Get state at the last checkpoint
      const log = esState.getEventLog();
      const lastCheckpoint = log.events.filter(e => e.type === "STATE_SYNC").pop() as any;

      // Reconstruct state at that checkpoint
      const stateBeforeAttack = esState.getStateAtIndex(lastCheckpoint.index);
      expect(stateBeforeAttack).not.toBeNull();
      expect(stateBeforeAttack!.combat.attackers.length).toBe(0);

      // Now replay events and check state after attack declaration
      const attackEvent = log.events.find(e => e.type === "ACTION" && (e as any).action.type === "declare_attackers");
      if (attackEvent) {
        const stateAfterAttack = esState.getStateAtIndex(attackEvent.index);
        expect(stateAfterAttack).not.toBeNull();
        expect(stateAfterAttack!.combat.attackers.length).toBe(1);
        expect(stateAfterAttack!.combat.attackers[0].cardId).toBe("creature-1");
      }
    });

    it("should correctly replay declare_blockers action", () => {
      const { declareBlockers } = require("../event-sourced-game-state");
      const initialState = createMockState();

      // Create state with attackers and blockers on battlefield
      const attackerCard = createMockCard("attacker-1", "player1", "Attacker");
      const blockerCard = createMockCard("blocker-1", "player2", "Blocker");
      initialState.cards.set("attacker-1", attackerCard);
      initialState.cards.set("blocker-1", blockerCard);

      // Setup battlefield zones
      const p1Battlefield = initialState.zones.get("player1-battlefield") || { cardIds: [], type: "battlefield" as ZoneType };
      p1Battlefield.cardIds.push("attacker-1");
      initialState.zones.set("player1-battlefield", p1Battlefield);

      const p2Battlefield = initialState.zones.get("player2-battlefield") || { cardIds: [], type: "battlefield" as ZoneType };
      p2Battlefield.cardIds.push("blocker-1");
      initialState.zones.set("player2-battlefield", p2Battlefield);

      // Set combat phase and pre-declare attackers
      initialState.turn.currentPhase = "declare_blockers";
      initialState.combat.inCombatPhase = true;
      initialState.combat.attackers = [{
        cardId: "attacker-1" as CardInstanceId,
        defenderId: "player2" as PlayerId,
        isAttackingPlaneswalker: false,
        damageToDeal: 3,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      }];

      const esState = createEventSourcedState(initialState, "test-session", "player2");
      esState.addVerifiedStateSyncCheckpoint();

      // Declare blockers
      const blockerAssignments = new Map<CardInstanceId, CardInstanceId[]>();
      blockerAssignments.set("attacker-1" as CardInstanceId, ["blocker-1" as CardInstanceId]);
      declareBlockers(esState, "player2", blockerAssignments);

      // Verify state at the declare_blockers action
      const log = esState.getEventLog();
      const blockEvent = log.events.find(e => e.type === "ACTION" && (e as any).action.type === "declare_blockers");
      if (blockEvent) {
        const stateAfterBlock = esState.getStateAtIndex(blockEvent.index);
        expect(stateAfterBlock).not.toBeNull();
        expect(stateAfterBlock!.combat.blockers.size).toBe(1);
        expect(stateAfterBlock!.combat.blockers.get("attacker-1")?.[0]?.cardId).toBe("blocker-1");
      }
    });

    it("should handle multiple sequential actions and replay correctly", () => {
      const { drawCard, dealDamageToPlayer, gainLife } = require("../event-sourced-game-state");
      const initialState = createMockState();
      const esState = createEventSourcedState(initialState, "test-session", "player1");

      esState.addVerifiedStateSyncCheckpoint(); // Index 2

      // Emit multiple actions
      drawCard(esState, "player1");
      esState.addVerifiedStateSyncCheckpoint(); // Index after draw

      gainLife(esState, "player1", 5);
      esState.addVerifiedStateSyncCheckpoint();

      dealDamageToPlayer(esState, "player2", 3, false);

      // Get the final state
      const finalState = esState.getState();
      const finalHash = computeStateHash(finalState);

      // Replay from checkpoint before draw
      const checkpoint = esState.getStateAtIndex(2);
      expect(checkpoint).not.toBeNull();

      // All checkpoints should be reachable
      const log = esState.getEventLog();
      for (const event of log.events) {
        if (event.type === "STATE_SYNC") {
          const state = esState.getStateAtIndex(event.index);
          expect(state).not.toBeNull();
        }
      }
    });
  });
});
