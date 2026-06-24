/**
 * @fileoverview Unit Tests for auto-pass priority guard (#910)
 *
 * The game UI auto-passes priority on the human's behalf during the AI's turn
 * so they do not have to babysit every phase. That convenience must NEVER
 * destroy the response window: when objects are on the stack the player must
 * retain priority so they can cast instants/counterspells or activate
 * abilities in response (CR 117).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
} from "../game-state";
import { shouldAutoPassPriority } from "../auto-pass-priority";
import { Phase } from "../types";
import type { GameState, PlayerId, StackObject } from "../types";

describe("shouldAutoPassPriority (#910 response window guard)", () => {
  let state: GameState;
  let humanId: PlayerId;
  let aiId: PlayerId;

  beforeEach(() => {
    state = createInitialGameState(["Human", "AI"]);
    state = startGame(state);

    const ids = Array.from(state.players.keys());
    // createInitialGameState makes the first player the active player. Put the
    // AI on the hot seat by making player 2 the active player.
    humanId = ids[0];
    aiId = ids[1];

    state.status = "in_progress";
    state.turn.activePlayerId = aiId;
    state.priorityPlayerId = humanId;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [];
    state.players.forEach((p) =>
      state.players.set(p.id, { ...p, hasPassedPriority: false }),
    );
    state.consecutivePasses = 0;
  });

  it("auto-passes on the AI's turn with an empty stack (convenience preserved)", () => {
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(true);
  });

  it("NEVER auto-passes while the stack is non-empty (response window preserved)", () => {
    state.stack = [makeStackObject(aiId)];

    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);
  });

  it("resumes auto-passing once the stack empties again", () => {
    state.stack = [makeStackObject(aiId)];
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);

    state.stack = [];
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(true);
  });

  it("does not auto-pass through interactive combat phases even with an empty stack", () => {
    for (const phase of [
      Phase.DECLARE_ATTACKERS,
      Phase.DECLARE_BLOCKERS,
      Phase.COMBAT_DAMAGE,
    ]) {
      state.turn.currentPhase = phase;
      state.stack = [];
      expect(
        shouldAutoPassPriority(state, {
          activePlayerId: aiId,
          humanPlayerId: humanId,
        }),
      ).toBe(false);
    }
  });

  it("does not auto-pass when it is the human's own turn", () => {
    state.turn.activePlayerId = humanId;
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);
  });

  it("does not auto-pass when the human does not have priority", () => {
    state.priorityPlayerId = aiId;
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);
  });

  it("does not auto-pass when the game is not in progress", () => {
    state.status = "completed";
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);
  });

  it("a non-empty stack blocks auto-pass regardless of phase", () => {
    // Even in a main phase where auto-pass would normally be fine, a live stack wins.
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.stack = [makeStackObject(aiId), makeStackObject(humanId)];
    expect(
      shouldAutoPassPriority(state, {
        activePlayerId: aiId,
        humanPlayerId: humanId,
      }),
    ).toBe(false);
  });
});

function makeStackObject(controllerId: PlayerId): StackObject {
  return {
    id: `stack-${Math.random().toString(36).slice(2)}`,
    type: "spell",
    sourceCardId: null,
    controllerId,
    name: "Test Spell",
    text: "",
    manaCost: "{U}",
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  };
}
