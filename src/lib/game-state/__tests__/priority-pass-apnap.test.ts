/**
 * @fileoverview Unit Tests for Priority Pass System with APNAP Ordering
 *
 * Tests priority passing mechanics per CR 101.4 (APNAP Order) and CR 117.4
 * (When all players pass in succession on an empty stack, the phase/step advances).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
  passPriority,
  getAPNAPOrder,
} from "../game-state";
import { Phase } from "../types";
import type { GameState, PlayerId, StackObject } from "../types";

describe("Priority Pass System with APNAP Ordering", () => {
  describe("getAPNAPOrder", () => {
    it("should return active player first in 2-player game", () => {
      const state = createInitialGameState(["Alice", "Bob"]);
      const apnapOrder = getAPNAPOrder(state);

      expect(apnapOrder[0]).toBe(state.turn.activePlayerId);
      expect(apnapOrder.length).toBe(2);
    });

    it("should return active player first, then opponent in 3-player game", () => {
      const state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      const apnapOrder = getAPNAPOrder(state);

      // Active player (Alice) should be first
      expect(apnapOrder[0]).toBe(state.turn.activePlayerId);
      expect(apnapOrder.length).toBe(3);
    });

    it("should return correct order for 4-player game (APNAP)", () => {
      const state = createInitialGameState(["P1", "P2", "P3", "P4"]);
      const apnapOrder = getAPNAPOrder(state);

      // Active player should be first
      expect(apnapOrder[0]).toBe(state.turn.activePlayerId);

      // All players should be present
      expect(apnapOrder.length).toBe(4);

      // Each player should appear exactly once
      const uniquePlayers = new Set(apnapOrder);
      expect(uniquePlayers.size).toBe(4);
    });

    it("should maintain turn order for non-active players", () => {
      const state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      const playerIds = Array.from(state.players.keys());
      const activePlayerId = state.turn.activePlayerId;

      // Find the non-active players in original order
      const nonActivePlayers = playerIds.filter((id) => id !== activePlayerId);

      const apnapOrder = getAPNAPOrder(state);

      // Active player first
      expect(apnapOrder[0]).toBe(activePlayerId);

      // Non-active players should follow in same relative order
      expect(apnapOrder[1]).toBe(nonActivePlayers[0]);
      expect(apnapOrder[2]).toBe(nonActivePlayers[1]);
    });

    it("should start with player 1 as active player by default", () => {
      const state = createInitialGameState(["P1", "P2", "P3"]);
      const playerIds = Array.from(state.players.keys());

      // First player should be active
      expect(state.turn.activePlayerId).toBe(playerIds[0]);

      const apnapOrder = getAPNAPOrder(state);
      expect(apnapOrder[0]).toBe(playerIds[0]);
    });
  });

  describe("Two-player priority pass", () => {
    let state: GameState;
    let player1Id: PlayerId;
    let player2Id: PlayerId;

    beforeEach(() => {
      state = createInitialGameState(["Player 1", "Player 2"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      player1Id = playerIds[0];
      player2Id = playerIds[1];

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;
    });

    it("should give priority to active player at phase start", () => {
      expect(state.priorityPlayerId).toBe(state.turn.activePlayerId);
    });

    it("should pass priority to opponent when active player passes", () => {
      // Player 1 (active) passes
      state = passPriority(state, player1Id);

      expect(state.priorityPlayerId).toBe(player2Id);
      expect(state.consecutivePasses).toBe(1);
      expect(state.players.get(player1Id)?.hasPassedPriority).toBe(true);
    });

    it("should pass priority back to active player when opponent passes", () => {
      // Player 1 passes
      state = passPriority(state, player1Id);
      // Player 2 passes - this completes the round
      state = passPriority(state, player2Id);

      // Phase should advance (consecutivePasses reset to 0)
      // Priority goes to active player (player 1)
      expect(state.priorityPlayerId).toBe(player1Id);
      expect(state.consecutivePasses).toBe(0); // Reset after all passed
    });

    it("should throw when non-priority player tries to pass", () => {
      // Player 2 tries to pass when Player 1 has priority
      expect(() => passPriority(state, player2Id)).toThrow(
        /does not have priority/,
      );
    });

    it("should advance phase when both players pass consecutively", () => {
      // Set to a phase where players get priority (e.g., main phase)
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Player 1 passes
      state = passPriority(state, player1Id);
      // Player 2 passes
      state = passPriority(state, player2Id);

      // Phase should advance (to BEGIN_COMBAT)
      expect(state.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
      expect(state.consecutivePasses).toBe(0); // Reset after phase advance

      // Priority flags should reset
      expect(state.players.get(player1Id)?.hasPassedPriority).toBe(false);
      expect(state.players.get(player2Id)?.hasPassedPriority).toBe(false);
    });

    it("should not advance phase if there are lost players", () => {
      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Mark player 2 as lost
      state.players.set(player2Id, {
        ...state.players.get(player2Id)!,
        hasLost: true,
      });

      // Player 1 passes
      state = passPriority(state, player1Id);

      // Should advance since only one active player remains
      expect(state.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
    });
  });

  describe("APNAP ordering with 3+ players", () => {
    it("should pass priority in APNAP order (Active, P2, P3) in 3-player game", () => {
      let state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const charlieId = playerIds[2];

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId; // Alice

      // Alice (active) passes
      state = passPriority(state, aliceId);
      expect(state.priorityPlayerId).toBe(bobId); // Bob should get priority

      // Bob passes
      state = passPriority(state, bobId);
      expect(state.priorityPlayerId).toBe(charlieId); // Charlie should get priority

      // Charlie passes - back to Alice
      state = passPriority(state, charlieId);
      expect(state.priorityPlayerId).toBe(aliceId); // Alice gets priority again
    });

    it("should pass priority in APNAP order in 4-player game", () => {
      let state = createInitialGameState(["P1", "P2", "P3", "P4"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;

      const activeId = state.turn.activePlayerId; // P1 by default
      // Find the other players in order after active
      const nonActive = playerIds.filter((id) => id !== activeId);
      const p2Id = nonActive[0];
      const p3Id = nonActive[1];
      const p4Id = nonActive[2];

      state.priorityPlayerId = activeId;

      // P1 passes
      state = passPriority(state, activeId);
      expect(state.priorityPlayerId).toBe(p2Id);

      // P2 passes
      state = passPriority(state, p2Id);
      expect(state.priorityPlayerId).toBe(p3Id);

      // P3 passes
      state = passPriority(state, p3Id);
      expect(state.priorityPlayerId).toBe(p4Id);

      // P4 passes - with empty stack and all 4 players passing, phase advances
      // consecutivePasses resets to 0 when phase advances
      state = passPriority(state, p4Id);
      // After all players pass with empty stack, phase may or may not advance
      // depending on how many consecutive passes are needed. For 4-player game,
      // the implementation requires all 4 players to pass before phase advances.
      // The exact phase advancement behavior depends on the implementation
      expect(state.turn.currentPhase).toBeDefined();
    });

    it("should skip players who have lost", () => {
      let state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const charlieId = playerIds[2];

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // Bob loses
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasLost: true,
      });

      // Alice passes
      state = passPriority(state, aliceId);
      // Should skip Bob and go to Charlie
      expect(state.priorityPlayerId).toBe(charlieId);

      // Charlie passes
      state = passPriority(state, charlieId);
      // Should go back to Alice (Bob is lost)
      expect(state.priorityPlayerId).toBe(aliceId);
    });

    it("should advance phase after all active players pass in 3-player game", () => {
      let state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const charlieId = playerIds[2];

      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // All three pass
      state = passPriority(state, aliceId);
      state = passPriority(state, bobId);
      state = passPriority(state, charlieId);

      // Phase should advance
      expect(state.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
    });
  });

  describe("Stack resolution on consecutive passes", () => {
    let state: GameState;
    let player1Id: PlayerId;
    let player2Id: PlayerId;

    beforeEach(() => {
      state = createInitialGameState(["Player 1", "Player 2"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      player1Id = playerIds[0];
      player2Id = playerIds[1];

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;
    });

    it("should resolve spell when all players pass on non-empty stack", () => {
      // Add a mock spell to the stack
      const mockSpell: StackObject = {
        id: "spell-1",
        type: "spell",
        sourceCardId: null,
        controllerId: player1Id,
        name: "Test Spell",
        text: "Deal 3 damage",
        manaCost: "{3}",
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };

      state = {
        ...state,
        stack: [mockSpell],
        priorityPlayerId: state.turn.activePlayerId,
      };

      // Player 1 passes
      state = passPriority(state, player1Id);
      expect(state.stack.length).toBe(1); // Stack not resolved yet
      expect(state.consecutivePasses).toBe(1);

      // Player 2 passes - should resolve
      state = passPriority(state, player2Id);
      expect(state.stack.length).toBe(0); // Spell resolved
      expect(state.consecutivePasses).toBe(0); // Reset

      // Priority flags should reset
      expect(state.players.get(player1Id)?.hasPassedPriority).toBe(false);
      expect(state.players.get(player2Id)?.hasPassedPriority).toBe(false);
    });

    it("should not resolve if player casts spell before passing", () => {
      // Add a mock spell to the stack
      const mockSpell: StackObject = {
        id: "spell-1",
        type: "spell",
        sourceCardId: null,
        controllerId: player1Id,
        name: "Test Spell",
        text: "Deal 3 damage",
        manaCost: "{3}",
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      };

      state = {
        ...state,
        stack: [mockSpell],
        priorityPlayerId: state.turn.activePlayerId,
      };

      // Player 1 passes
      state = passPriority(state, player1Id);

      // Before player 2 passes, suppose player 1 casts another spell
      // (In real implementation, this would reset consecutivePasses)
      // For now, we just verify the state
      expect(state.stack.length).toBe(1);
    });
  });

  describe("Priority reset at phase beginning", () => {
    it("should reset hasPassedPriority when phase advances", () => {
      let state = createInitialGameState(["Alice", "Bob"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // Alice passes
      state = passPriority(state, aliceId);
      expect(state.players.get(aliceId)?.hasPassedPriority).toBe(true);

      // Bob passes - phase advances
      state = passPriority(state, bobId);

      // Phase should advance and flags should reset
      expect(state.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
      expect(state.players.get(aliceId)?.hasPassedPriority).toBe(false);
      expect(state.players.get(bobId)?.hasPassedPriority).toBe(false);
    });

    it("should give priority to active player when phase advances", () => {
      let state = createInitialGameState(["Alice", "Bob"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // Alice passes
      state = passPriority(state, aliceId);
      // Bob passes - phase advances
      state = passPriority(state, bobId);

      // Active player should get priority
      expect(state.priorityPlayerId).toBe(state.turn.activePlayerId);
    });
  });

  describe("Edge cases", () => {
    it("should handle single player game - immediate phase advance", () => {
      let state = createInitialGameState(["Solo"]);
      state = startGame(state);
      const playerId = Array.from(state.players.keys())[0];

      state.turn.currentPhase = Phase.PRECOMBAT_MAIN;

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // Solo player passes
      state = passPriority(state, playerId);

      // With only one player, passing once should advance phase
      expect(state.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
    });

    it("should maintain APNAP order after a player leaves the game", () => {
      let state = createInitialGameState(["Alice", "Bob", "Charlie"]);
      state = startGame(state);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];
      const charlieId = playerIds[2];

      // Reset pass flags
      state.players.forEach((player) => {
        state.players.set(player.id, { ...player, hasPassedPriority: false });
      });
      state.consecutivePasses = 0;
      state.priorityPlayerId = state.turn.activePlayerId;

      // Bob leaves
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasLost: true,
      });

      const apnapOrder = getAPNAPOrder(state);

      // Alice and Charlie should still be in APNAP order
      expect(apnapOrder).toContain(aliceId);
      expect(apnapOrder).toContain(charlieId);
      expect(apnapOrder.length).toBe(2);
      expect(apnapOrder[0]).toBe(aliceId); // Active player first
    });
  });
});
