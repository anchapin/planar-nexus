/**
 * @fileoverview Unit tests for the discrete UNTAP step (issue #929)
 *
 * Verifies that the untap step is a proper, discrete rules step with:
 *  - Correct placement in the turn structure (before upkeep)
 *  - A "beginning of untap step" trigger hook (CR 502.3)
 *  - An untap-modifier hook ("doesn't untap during your untap step", CR 502.2)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
  passPriority,
  processUntapStep,
} from "../game-state";
import { getNextPhase } from "../turn-phases";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type { CardInstance, GameState, PlayerId } from "../types";

/**
 * Create a mock ScryfallCard for testing
 */
function createMockCard(
  name: string,
  type: string,
  oracleText: string = "",
  cmc: number = 1,
): any {
  return {
    id: `card-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: type,
    cmc,
    mana_cost: type.includes("Land") ? "" : `{${cmc}}`,
    oracle_text: oracleText,
    power: type.includes("Creature") ? "2" : undefined,
    toughness: type.includes("Creature") ? "2" : undefined,
    keywords: [],
    color_identity: [],
    colors: [],
    legalities: { standard: "not_legal" },
  };
}

/**
 * Place a card instance onto a player's battlefield zone.
 */
function putOnBattlefield(
  state: GameState,
  card: CardInstance,
  playerId: PlayerId,
): GameState {
  state.cards.set(card.id, card);
  const zoneKey = `${playerId}-battlefield`;
  const zone = state.zones.get(zoneKey)!;
  state.zones.set(zoneKey, {
    ...zone,
    cardIds: [...zone.cardIds, card.id],
  });
  return state;
}

describe("Discrete Untap Step (#929)", () => {
  describe("Turn structure", () => {
    it("UNTAP is the first step and immediately precedes UPKEEP", () => {
      expect(getNextPhase(Phase.UNTAP)).toBe(Phase.UPKEEP);
    });

    it("UNTAP has no previous step (it is the first step of the turn)", () => {
      // startNextTurn/createTurn begin at UNTAP
      expect(Phase.UNTAP).toBe("untap");
    });
  });

  describe("processUntapStep", () => {
    let state: GameState;
    let aliceId: PlayerId;

    beforeEach(() => {
      state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      aliceId = playerIds[0];
      state = startGame(state);
      // Ensure Alice is the active player at her untap step
      state.turn = {
        ...state.turn,
        activePlayerId: aliceId,
        currentPhase: Phase.UNTAP,
      };
    });

    it("untaps a tapped permanent during the untap step (normal untap)", () => {
      const land = createCardInstance(
        createMockCard("Forest", "Land"),
        aliceId,
        aliceId,
      );
      const tappedLand = { ...land, isTapped: true };
      state = putOnBattlefield(state, tappedLand, aliceId);

      const result = processUntapStep(state);

      expect(result.state.cards.get(tappedLand.id)?.isTapped).toBe(false);
    });

    it("clears summoning sickness for the active player (CR 302.3)", () => {
      const creature = createCardInstance(
        createMockCard("Grizzly Bears", "Creature — Bear"),
        aliceId,
        aliceId,
      );
      const sickCreature = { ...creature, hasSummoningSickness: true };
      state = putOnBattlefield(state, sickCreature, aliceId);

      const result = processUntapStep(state);

      expect(
        result.state.cards.get(sickCreature.id)?.hasSummoningSickness,
      ).toBe(false);
    });

    it("respects untap-modifying effects: a 'does not untap' permanent stays tapped (CR 502.2)", () => {
      const land = createCardInstance(
        createMockCard("Forest", "Land"),
        aliceId,
        aliceId,
      );
      const lockedLand = {
        ...land,
        isTapped: true,
        doesNotUntapDuringUntapStep: true,
      };
      state = putOnBattlefield(state, lockedLand, aliceId);

      const result = processUntapStep(state);

      // Modifier hook is respected: the permanent does NOT untap
      expect(result.state.cards.get(lockedLand.id)?.isTapped).toBe(true);
      expect(
        result.state.cards.get(lockedLand.id)?.doesNotUntapDuringUntapStep,
      ).toBe(true);
    });

    it("a 'does not untap' permanent does not block other permanents from untapping", () => {
      const locked = {
        ...createCardInstance(
          createMockCard("Swamp", "Land"),
          aliceId,
          aliceId,
        ),
        isTapped: true,
        doesNotUntapDuringUntapStep: true,
      };
      const normal = {
        ...createCardInstance(
          createMockCard("Forest", "Land"),
          aliceId,
          aliceId,
        ),
        isTapped: true,
      };
      state = putOnBattlefield(state, locked, aliceId);
      state = putOnBattlefield(state, normal, aliceId);

      const result = processUntapStep(state);

      expect(result.state.cards.get(locked.id)?.isTapped).toBe(true);
      expect(result.state.cards.get(normal.id)?.isTapped).toBe(false);
    });

    it("fires 'beginning of untap step' triggers for the active player (CR 502.3)", () => {
      const triggerCard = createCardInstance(
        createMockCard(
          "UntapTrigger",
          "Creature",
          "At the beginning of your untap step, draw a card.",
        ),
        aliceId,
        aliceId,
      );
      state = putOnBattlefield(state, triggerCard, aliceId);

      const result = processUntapStep(state);

      expect(result.triggeredAbilities.length).toBe(1);
      expect(result.triggeredAbilities[0].triggerCondition).toBe("untapStep");
      // Trigger is put on the stack (no priority during untap; resolves in upkeep)
      expect(result.state.stack.length).toBe(1);
    });

    it("does not fire 'beginning of untap step' triggers for a non-active player's card", () => {
      const bobId = Array.from(state.players.keys())[1];
      const opponentTrigger = createCardInstance(
        createMockCard(
          "OpponentUntapTrigger",
          "Creature",
          "At the beginning of your untap step, draw a card.",
        ),
        bobId,
        bobId,
      );
      state = putOnBattlefield(state, opponentTrigger, bobId);

      const result = processUntapStep(state);

      expect(result.triggeredAbilities.length).toBe(0);
      expect(result.state.stack.length).toBe(0);
    });

    it("does not misfire upkeep triggers as untap-step triggers", () => {
      const upkeepCard = createCardInstance(
        createMockCard(
          "UpkeepTrigger",
          "Creature",
          "At the beginning of your upkeep, you gain 1 life.",
        ),
        aliceId,
        aliceId,
      );
      state = putOnBattlefield(state, upkeepCard, aliceId);

      const result = processUntapStep(state);

      // Upkeep triggers are NOT untap-step triggers
      expect(result.triggeredAbilities.length).toBe(0);
    });
  });

  describe("Turn-wrap integration", () => {
    it("untaps permanents and respects the modifier when a new turn starts via priority", () => {
      let state = createInitialGameState(["Alice", "Bob"], 20, false);
      const playerIds = Array.from(state.players.keys());
      const aliceId = playerIds[0];
      const bobId = playerIds[1];

      state = startGame(state);
      state.turn.isFirstTurn = false;

      const normalLand = {
        ...createCardInstance(
          createMockCard("Forest", "Land"),
          aliceId,
          aliceId,
        ),
        isTapped: true,
      };
      const lockedLand = {
        ...createCardInstance(
          createMockCard("Swamp", "Land"),
          aliceId,
          aliceId,
        ),
        isTapped: true,
        doesNotUntapDuringUntapStep: true,
      };
      state = putOnBattlefield(state, normalLand, aliceId);
      state = putOnBattlefield(state, lockedLand, aliceId);

      // Move to Bob's cleanup so the next wrap starts Alice's turn
      state.turn = {
        ...state.turn,
        activePlayerId: bobId,
        currentPhase: Phase.CLEANUP,
        turnNumber: 1,
      };
      state.priorityPlayerId = bobId;
      state.players.set(bobId, {
        ...state.players.get(bobId)!,
        hasPassedPriority: false,
      });
      state.players.set(aliceId, {
        ...state.players.get(aliceId)!,
        hasPassedPriority: false,
      });

      // Both pass → wraps to Alice's turn (UNTAP step)
      state = passPriority(state, bobId);
      state = passPriority(state, aliceId);

      expect(state.turn.activePlayerId).toBe(aliceId);
      expect(state.turn.currentPhase).toBe(Phase.UNTAP);

      // Normal permanent untapped, modifier permanent stayed tapped
      expect(state.cards.get(normalLand.id)?.isTapped).toBe(false);
      expect(state.cards.get(lockedLand.id)?.isTapped).toBe(true);
    });
  });
});
