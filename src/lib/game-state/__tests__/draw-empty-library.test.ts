/**
 * Issue #1580 — CR 704.5c: a player who attempts to draw from an empty
 * library loses the game as a state-based action.
 *
 * drawCard() (used by startGame and the main draw step) must mark the
 * drawing player as lost via drawWithSBAChecking and re-check the win
 * condition so the game can end.
 */

import {
  createInitialGameState,
  startGame,
  drawCard,
  passPriority,
} from "../game-state";
import type { GameState, PlayerId } from "../types";

describe("drawCard — empty library loss (CR 704.5c, issue #1580)", () => {
  function twoPlayerStarted(): {
    state: GameState;
    aliceId: PlayerId;
    bobId: PlayerId;
  } {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const [aliceId, bobId] = Array.from(state.players.keys());
    return { state, aliceId, bobId };
  }

  function setZoneCards(
    state: GameState,
    playerId: PlayerId,
    zone: string,
    cardIds: string[],
  ): void {
    const z = state.zones.get(`${playerId}-${zone}`)!;
    state.zones.set(`${playerId}-${zone}`, { ...z, cardIds });
  }

  it("marks the player as lost with an 'empty library' lossReason", () => {
    const { state, aliceId } = twoPlayerStarted();
    setZoneCards(state, aliceId, "library", []);

    const newState = drawCard(state, aliceId);

    const alice = newState.players.get(aliceId)!;
    expect(alice.hasLost).toBe(true);
    expect(alice.lossReason).toContain("empty library");
  });

  it("re-checks the win condition: the opponent sees the winner state", () => {
    const { state, aliceId, bobId } = twoPlayerStarted();
    setZoneCards(state, aliceId, "library", []);

    const newState = drawCard(state, aliceId);

    expect(newState.status).toBe("completed");
    expect(newState.winners).toEqual([bobId]);
    // The opponent is not marked as lost
    expect(newState.players.get(bobId)!.hasLost).toBe(false);
  });

  it("does not mark the player lost when the library is non-empty", () => {
    const { state, aliceId } = twoPlayerStarted();
    setZoneCards(state, aliceId, "library", ["card-a", "card-b"]);
    setZoneCards(state, aliceId, "hand", []);

    const newState = drawCard(state, aliceId);

    // Normal behaviour unchanged: top card moves library → hand
    expect(newState.zones.get(`${aliceId}-library`)!.cardIds).toEqual([
      "card-a",
    ]);
    expect(newState.zones.get(`${aliceId}-hand`)!.cardIds).toEqual(["card-b"]);

    const alice = newState.players.get(aliceId)!;
    expect(alice.hasLost).toBe(false);
    expect(alice.lossReason).toBeNull();
    expect(newState.status).toBe("in_progress");
  });

  it("drawing past the last card: the final card is drawn, the next draw loses", () => {
    const { state, aliceId } = twoPlayerStarted();
    setZoneCards(state, aliceId, "library", ["last-card"]);
    setZoneCards(state, aliceId, "hand", []);

    // Draw the last remaining card — no loss yet
    let newState = drawCard(state, aliceId);
    expect(newState.zones.get(`${aliceId}-hand`)!.cardIds).toEqual([
      "last-card",
    ]);
    expect(newState.players.get(aliceId)!.hasLost).toBe(false);

    // Next draw comes from an empty library — the player loses, and the
    // extra draw does not put a card in hand
    newState = drawCard(newState, aliceId);
    expect(newState.players.get(aliceId)!.hasLost).toBe(true);
    expect(newState.zones.get(`${aliceId}-hand`)!.cardIds).toEqual([
      "last-card",
    ]);
    expect(newState.status).toBe("completed");
  });

  it("the draw step marks the active player lost when their library is empty", () => {
    const { state, aliceId, bobId } = twoPlayerStarted();
    setZoneCards(state, aliceId, "library", []);

    // Make it a non-first turn so the draw step fires (CR 103.4: the
    // starting player skips their first draw step)
    const turnState: GameState = {
      ...state,
      turn: { ...state.turn, isFirstTurn: false },
    };

    // Pass priority through the untap and upkeep steps until the draw step
    let guard = 0;
    let current = turnState;
    while (current.turn.currentPhase !== "draw" && guard++ < 12) {
      current = passPriority(current, current.priorityPlayerId!);
    }

    expect(current.turn.currentPhase).toBe("draw");

    const alice = current.players.get(aliceId)!;
    expect(alice.hasLost).toBe(true);
    expect(alice.lossReason).toContain("empty library");
    expect(current.status).toBe("completed");
    expect(current.winners).toEqual([bobId]);
  });

  it("the opening-hand draw (startGame) never triggers the CR 704.5c loss", () => {
    // CR 103.4 game setup: players may mulligan to a 0-card hand and a
    // short library simply draws out — no one loses during setup.
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);

    expect(state.status).toBe("in_progress");
    for (const player of state.players.values()) {
      expect(player.hasLost).toBe(false);
      expect(player.lossReason).toBeNull();
    }
  });

  it("startGame with a short deck draws out the library without loss", () => {
    let state = createInitialGameState(["Alice", "Bob"], 20, false);
    const [aliceId] = Array.from(state.players.keys());
    setZoneCards(state, aliceId, "library", ["card-a", "card-b"]);

    state = startGame(state);

    // Both cards were drawn into hand, the library is empty, but the
    // player is NOT lost — the 704.5c loss is for in-game draws only.
    expect(state.zones.get(`${aliceId}-hand`)!.cardIds).toEqual([
      "card-b",
      "card-a",
    ]);
    expect(state.zones.get(`${aliceId}-library`)!.cardIds).toEqual([]);
    expect(state.players.get(aliceId)!.hasLost).toBe(false);
    expect(state.status).toBe("in_progress");
  });
});
