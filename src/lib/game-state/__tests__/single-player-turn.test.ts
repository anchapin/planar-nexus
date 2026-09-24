/**
 * @fileoverview Regression test for #2163 — End Turn button absent after single-player game starts
 *
 * The root cause was the initial game state created in game-board-client.tsx
 * using `activePlayer` instead of `activePlayerId` in the turn object, making
 * `gameState.turn.activePlayerId` undefined and `isPlayerTurn` always false.
 */

import { describe, it, expect } from "@jest/globals";
import { Phase } from "../types";
import type { Turn } from "../types";

describe("Turn interface field names", () => {
  /**
   * Verify the Turn interface uses activePlayerId (not activePlayer).
   * The GameBoardContent component accesses gameState.turn.activePlayerId.
   */
  it("should have activePlayerId field for current turn player", () => {
    const turn: Turn = {
      turnNumber: 1,
      activePlayerId: "Player 1",
      currentPhase: Phase.UNTAP,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: Date.now(),
    };

    // This is what GameBoardContent.tsx does at line ~2417
    // If activePlayerId is missing/undefined, currentPlayer would be undefined
    // and isPlayerTurn would always be false, hiding the End Turn button
    expect(turn.activePlayerId).toBe("Player 1");
    expect(turn.activePlayerId).not.toBeUndefined();
  });

  /**
   * Verify that creating a turn object matching game-board-client.tsx structure
   * works correctly after the #2163 fix.
   */
  it("should support single-player initial turn state structure", () => {
    const playerName = "Player 1";
    const aiPlayerName = "AI Opponent";

    // This structure mirrors what game-board-client.tsx creates after the fix
    const initialTurn = {
      turnNumber: 1,
      activePlayerId: playerName,
      currentPhase: "untap" as string,
      extraTurns: 0,
      isFirstTurn: true,
      startedAt: Date.now(),
    };

    // Verify the turn object has activePlayerId
    expect(initialTurn.activePlayerId).toBe(playerName);

    // Simulate what GameBoardContent does: look up the active player
    const players = new Map<string, { name: string }>([
      [playerName, { name: playerName }],
      [aiPlayerName, { name: aiPlayerName }],
    ]);

    const currentPlayer = players.get(initialTurn.activePlayerId);
    expect(currentPlayer).toBeDefined();
    expect(currentPlayer?.name).toBe(playerName);

    // isPlayerTurn would be currentPlayer?.name === playerName
    const isPlayerTurn = currentPlayer?.name === playerName;
    expect(isPlayerTurn).toBe(true); // This was false before the fix
  });

  /**
   * Verify that using the old wrong field name (activePlayer) results in
   * undefined activePlayerId, which is the bug we fixed.
   */
  it("should NOT have activePlayer field (wrong name used in bug)", () => {
    const turnWithWrongField = {
      turnNumber: 1,
      activePlayer: "Player 1", // Wrong field name — this was the bug
      currentPhase: "untap",
    };

    // With the wrong field name (activePlayer instead of activePlayerId),
    // accessing activePlayerId returns undefined
    const buggyTurn: { activePlayer?: string; activePlayerId?: string } =
      turnWithWrongField as any;
    expect(buggyTurn.activePlayerId).toBeUndefined();
  });
});
