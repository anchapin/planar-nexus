/**
 * Tests for Mutate Mechanic (CR 702.140)
 * Issue #819
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import type { GameState, CardInstanceId, ScryfallCard } from "../types";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import {
  hasMutate,
  canCastWithMutate,
  applyMutate,
  getMutatedCreatureTopCard,
  getMutatedCreatureText,
  getMutatedStack,
  isPartOfMutateStack,
  getMutateBaseId,
  splitMutateStack,
} from "../mutate";

// Helper to create a mock creature with mutate
function createMutateCreature(
  name: string,
  power: number,
  toughness: number,
  cmc: number,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: "Creature — Elemental",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: ["Mutate"],
    oracle_text: `${name} has mutate. When it enters the battlefield, create a 1/1 white Soldier token.`,
    mana_cost: "{2}{U}",
    cmc,
    colors: ["U"],
    color_identity: ["U"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

// Helper to create a target creature
function createTargetCreature(
  name: string,
  power: number,
  toughness: number,
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: "Creature — Beast",
    power: power.toString(),
    toughness: toughness.toString(),
    keywords: [],
    oracle_text: "",
    mana_cost: "{2}{G}",
    cmc: 3,
    colors: ["G"],
    color_identity: ["G"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

describe("Mutate Mechanic (CR 702.140)", () => {
  let state: GameState;
  let playerId: CardInstanceId;
  let opponentId: CardInstanceId;

  beforeEach(() => {
    state = createInitialGameState(["Alice", "Bob"], 20, false);
    state = startGame(state);
    const playerIds = Array.from(state.players.keys());
    playerId = playerIds[0];
    opponentId = playerIds[1];
  });

  describe("hasMutate", () => {
    it("should return true for cards with Mutate keyword", () => {
      const card = createMutateCreature("Test Creature", 3, 3, 4);
      expect(hasMutate(card)).toBe(true);
    });

    it("should return true for cards with mutate in oracle text", () => {
      const card = {
        id: "test-no-keyword",
        name: "Test",
        keywords: [],
        oracle_text: "Mutate {3}{U}",
        type_line: "Creature — Test",
        cmc: 3,
        colors: [],
        color_identity: [],
        legalities: { standard: "legal" },
      } as ScryfallCard;
      expect(hasMutate(card)).toBe(true);
    });

    it("should return false for cards without mutate", () => {
      const card = createTargetCreature("Regular Creature", 2, 2);
      expect(hasMutate(card)).toBe(false);
    });
  });

  describe("canCastWithMutate", () => {
    it("should allow casting mutate card onto a creature you control", () => {
      // Create a creature on battlefield (target)
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      // Add creature to battlefield zone
      const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
      if (battlefieldZone) {
        state.zones.set(`${playerId}-battlefield`, {
          ...battlefieldZone,
          cardIds: [...battlefieldZone.cardIds, targetCard.id],
        });
      }

      // Create mutate card in hand
      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      // Add mutate card to hand
      const handZone = state.zones.get(`${playerId}-hand`);
      if (handZone) {
        state.zones.set(`${playerId}-hand`, {
          ...handZone,
          cardIds: [...handZone.cardIds, mutateCard.id],
        });
      }

      // Give player priority
      state.priorityPlayerId = playerId;

      const result = canCastWithMutate(state, playerId, mutateCard.id, targetCard.id);
      expect(result.canCast).toBe(true);
    });

    it("should reject casting mutate onto non-creature", () => {
      const nonCreatureData = {
        id: "test-land",
        name: "Test Land",
        type_line: "Land",
        keywords: [],
        oracle_text: "",
        mana_cost: "",
        cmc: 0,
        colors: [],
        color_identity: [],
        legalities: { standard: "legal" },
      } as ScryfallCard;
      const nonCreature = createCardInstance(nonCreatureData, playerId, playerId);
      state.cards.set(nonCreature.id, nonCreature);

      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      state.priorityPlayerId = playerId;

      const result = canCastWithMutate(state, playerId, mutateCard.id, nonCreature.id);
      expect(result.canCast).toBe(false);
      expect(result.reason).toBe("Target is not a creature");
    });

    it("should reject casting mutate onto creature you don't control", () => {
      // Create creature controlled by opponent
      const targetCardData = createTargetCreature("Opponent Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, opponentId, opponentId);
      state.cards.set(targetCard.id, targetCard);

      // Add to opponent's battlefield
      const battlefieldZone = state.zones.get(`${opponentId}-battlefield`);
      if (battlefieldZone) {
        state.zones.set(`${opponentId}-battlefield`, {
          ...battlefieldZone,
          cardIds: [...battlefieldZone.cardIds, targetCard.id],
        });
      }

      // Create mutate card
      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      state.priorityPlayerId = playerId;

      const result = canCastWithMutate(state, playerId, mutateCard.id, targetCard.id);
      expect(result.canCast).toBe(false);
      expect(result.reason).toBe("You do not control this creature");
    });
  });

  describe("applyMutate", () => {
    it("should merge mutate card with target creature", () => {
      // Create target creature
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      // Create mutate card
      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const result = applyMutate(state, mutateCard.id, targetCard.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(targetCard.id)?.mutatedCardIds).toContain(
        mutateCard.id,
      );
      expect(result.state.cards.get(mutateCard.id)?.mutateBaseId).toBe(
        targetCard.id,
      );
      expect(result.state.cards.get(targetCard.id)?.isMutated).toBe(true);
    });

    it("should track highest CMC component correctly", () => {
      // Create target creature with lower CMC (3)
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      // Create mutate card with higher CMC (4)
      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const result = applyMutate(state, mutateCard.id, targetCard.id);

      expect(result.success).toBe(true);
      // Higher CMC is the mutate card
      expect(result.state.cards.get(targetCard.id)?.highestCmcComponentId).toBe(
        mutateCard.id,
      );
    });

    it("should handle error for non-existent cards", () => {
      const result = applyMutate(state, "nonexistent", "also-nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Card not found");
    });
  });

  describe("getMutatedCreatureTopCard", () => {
    it("should return base creature when no mutations", () => {
      const cardData = createTargetCreature("Beast", 2, 2);
      const card = createCardInstance(cardData, playerId, playerId);
      state.cards.set(card.id, card);

      const topCard = getMutatedCreatureTopCard(state, card.id);
      expect(topCard?.id).toBe(card.id);
    });

    it("should return null for non-existent card", () => {
      const topCard = getMutatedCreatureTopCard(state, "nonexistent");
      expect(topCard).toBeNull();
    });
  });

  describe("getMutatedStack", () => {
    it("should return all cards in mutate stack", () => {
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const result = applyMutate(state, mutateCard.id, targetCard.id);
      state = result.state;

      const stack = getMutatedStack(state, targetCard.id);
      expect(stack.length).toBe(2);
      expect(stack[0].id).toBe(targetCard.id);
      expect(stack[1].id).toBe(mutateCard.id);
    });
  });

  describe("isPartOfMutateStack", () => {
    it("should return true for mutated card", () => {
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const result = applyMutate(state, mutateCard.id, targetCard.id);
      state = result.state;

      // The component is part of a stack
      expect(isPartOfMutateStack(state, mutateCard.id)).toBe(true);
      // The base creature has mutations
      expect(isPartOfMutateStack(state, targetCard.id)).toBe(true);
    });

    it("should return false for regular card", () => {
      const cardData = createTargetCreature("Regular", 2, 2);
      const card = createCardInstance(cardData, playerId, playerId);
      state.cards.set(card.id, card);

      expect(isPartOfMutateStack(state, card.id)).toBe(false);
    });
  });

  describe("splitMutateStack", () => {
    it("should separate merged cards when split is called on base", () => {
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const mergeResult = applyMutate(state, mutateCard.id, targetCard.id);
      state = mergeResult.state;

      // Split the stack
      const result = splitMutateStack(state, targetCard.id);

      expect(result.success).toBe(true);
      expect(result.state.cards.get(mutateCard.id)?.mutateBaseId).toBeNull();
      expect(result.state.cards.get(targetCard.id)?.mutatedCardIds).toEqual([]);
    });

    it("should remove component from stack when split is called on component", () => {
      const targetCardData = createTargetCreature("Beast", 2, 2);
      const targetCard = createCardInstance(targetCardData, playerId, playerId);
      state.cards.set(targetCard.id, targetCard);

      const mutateCardData = createMutateCreature("Mutate Creature", 3, 3, 4);
      const mutateCard = createCardInstance(mutateCardData, playerId, playerId);
      state.cards.set(mutateCard.id, mutateCard);

      const mergeResult = applyMutate(state, mutateCard.id, targetCard.id);
      state = mergeResult.state;

      // Split from the component's perspective
      const result = splitMutateStack(state, mutateCard.id);

      expect(result.success).toBe(true);
      // The component should no longer have merge info
      expect(result.state.cards.get(mutateCard.id)?.mutateBaseId).toBeNull();
      // The base should no longer reference this component
      expect(result.state.cards.get(targetCard.id)?.mutatedCardIds).not.toContain(
        mutateCard.id,
      );
    });
  });
});