/**
 * Tests for Linked Effects System (CR 607)
 * Issue #820
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import type {
  GameState,
  CardInstanceId,
  ScryfallCard,
  PlayerId,
  LinkedEffect,
} from "../types";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import {
  registerLinkedEffect,
  removeLinkedEffectsFromSource,
  getLinkedEffectsForSource,
  getLinkedEffectById,
  createLinkedEffect,
  detectLinkedEffectPattern,
  handleFirstAbilityResolution,
  handleSecondAbilityResolution,
  applyLinkedLifeGain,
} from "../linked-effects";

// Helper to create a card with damage-to-life linked effect
function createDamageLifeCard(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: "Creature — Dragon",
    power: "3",
    toughness: "3",
    keywords: [],
    oracle_text: `When ${name} deals damage to a player, you gain that much life.`,
    mana_cost: "{3}{R}",
    cmc: 4,
    colors: ["R"],
    color_identity: ["R"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

// Helper to create a card with copy-counter linked effect
function createCopyCounterCard(name: string): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: "Sorcery",
    keywords: [],
    oracle_text: `When you copy a card, the copy gets +1/+1 counters equal to the number of counters on the original.`,
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
    card_faces: undefined,
    layout: "normal",
    legalities: { standard: "legal", commander: "legal" },
  } as ScryfallCard;
}

describe("Linked Effects System (CR 607)", () => {
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

  describe("createLinkedEffect", () => {
    it("should create a damage-life linked effect", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );

      expect(effect.sourceCardId).toBe("card-1");
      expect(effect.linkType).toBe("damage_life");
      expect(effect.damageAmount).toBe(3);
    });

    it("should create a copy-counter linked effect", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "copy_counter",
        {},
      );

      expect(effect.linkType).toBe("copy_counter");
    });
  });

  describe("registerLinkedEffect", () => {
    it("should register a linked effect in the game state", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );

      const newState = registerLinkedEffect(state, effect);

      const effects = getLinkedEffectsForSource(newState, "card-1");
      expect(effects.length).toBe(1);
      expect(effects[0].id).toBe(effect.id);
    });

    it("should allow multiple linked effects from same source", () => {
      const effect1 = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );
      const effect2 = createLinkedEffect(
        "card-1",
        "ability-3",
        "ability-4",
        "copy_counter",
        {},
      );

      let newState = registerLinkedEffect(state, effect1);
      newState = registerLinkedEffect(newState, effect2);

      const effects = getLinkedEffectsForSource(newState, "card-1");
      expect(effects.length).toBe(2);
    });
  });

  describe("getLinkedEffectsForSource", () => {
    it("should return empty array for card with no linked effects", () => {
      const effects = getLinkedEffectsForSource(state, "nonexistent");
      expect(effects.length).toBe(0);
    });

    it("should return linked effects for source card", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );

      const newState = registerLinkedEffect(state, effect);
      const effects = getLinkedEffectsForSource(newState, "card-1");

      expect(effects.length).toBe(1);
      expect(effects[0].damageAmount).toBe(3);
    });
  });

  describe("getLinkedEffectById", () => {
    it("should return linked effect by ID", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 5 },
      );

      const newState = registerLinkedEffect(state, effect);
      const found = getLinkedEffectById(newState, effect.id);

      expect(found?.damageAmount).toBe(5);
    });

    it("should return undefined for non-existent ID", () => {
      const found = getLinkedEffectById(state, "nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("removeLinkedEffectsFromSource", () => {
    it("should remove all linked effects from a source card", () => {
      const effect1 = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );
      const effect2 = createLinkedEffect(
        "card-1",
        "ability-3",
        "ability-4",
        "copy_counter",
        {},
      );

      let newState = registerLinkedEffect(state, effect1);
      newState = registerLinkedEffect(newState, effect2);

      expect(getLinkedEffectsForSource(newState, "card-1").length).toBe(2);

      const cleanedState = removeLinkedEffectsFromSource(newState, "card-1");
      expect(getLinkedEffectsForSource(cleanedState, "card-1").length).toBe(0);
    });

    it("should not affect other cards' linked effects", () => {
      const effect1 = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );
      const effect2 = createLinkedEffect(
        "card-2",
        "ability-3",
        "ability-4",
        "copy_counter",
        {},
      );

      let newState = registerLinkedEffect(state, effect1);
      newState = registerLinkedEffect(newState, effect2);

      const cleanedState = removeLinkedEffectsFromSource(newState, "card-1");

      expect(getLinkedEffectsForSource(cleanedState, "card-1").length).toBe(0);
      expect(getLinkedEffectsForSource(cleanedState, "card-2").length).toBe(1);
    });
  });

  describe("detectLinkedEffectPattern", () => {
    it("should detect damage-to-life pattern", () => {
      const text = "When Fire Dragon deals damage to a player, you gain that much life.";
      expect(detectLinkedEffectPattern(text)).toBe("damage_life");
    });

    it("should detect copy-to-counter pattern", () => {
      const text = "When you copy a card, the copy gets +1/+1 counters equal to the number of counters on the original.";
      expect(detectLinkedEffectPattern(text)).toBe("copy_counter");
    });

    it("should return null for non-linked effect text", () => {
      const text = "When this creature enters the battlefield, draw a card.";
      expect(detectLinkedEffectPattern(text)).toBeNull();
    });
  });

  describe("handleFirstAbilityResolution", () => {
    it("should create and register linked effect when first ability resolves", () => {
      const newState = handleFirstAbilityResolution(
        state,
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 4 },
      );

      const effects = getLinkedEffectsForSource(newState, "card-1");
      expect(effects.length).toBe(1);
      expect(effects[0].damageAmount).toBe(4);
    });
  });

  describe("handleSecondAbilityResolution", () => {
    it("should find and remove linked effect when second ability resolves", () => {
      // First register a linked effect
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 3 },
      );
      let newState = registerLinkedEffect(state, effect);

      // Now resolve the second ability
      const result = handleSecondAbilityResolution(newState, "card-1", "ability-2");

      expect(result.linkedEffect).not.toBeNull();
      expect(result.linkedEffect?.damageAmount).toBe(3);
      expect(result.error).toBeUndefined();

      // Linked effect should be consumed
      const effects = getLinkedEffectsForSource(result.state, "card-1");
      expect(effects.length).toBe(0);
    });

    it("should return error when no linked effect found", () => {
      const result = handleSecondAbilityResolution(state, "card-1", "nonexistent-ability");

      expect(result.linkedEffect).toBeNull();
      expect(result.error).toBe("No linked effect found for this ability");
    });
  });

  describe("applyLinkedLifeGain", () => {
    it("should apply life gain from linked damage effect", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "damage_life",
        { damageAmount: 5 },
      );

      const newState = registerLinkedEffect(state, effect);
      const player = newState.players.get(playerId);
      const initialLife = player?.life ?? 0;

      const updatedState = applyLinkedLifeGain(newState, playerId, effect);

      const updatedPlayer = updatedState.players.get(playerId);
      expect(updatedPlayer?.life).toBe(initialLife + 5);
    });

    it("should not apply life gain for copy_counter effects", () => {
      const effect = createLinkedEffect(
        "card-1",
        "ability-1",
        "ability-2",
        "copy_counter",
        {},
      );

      const player = state.players.get(playerId);
      const initialLife = player?.life ?? 0;

      const updatedState = applyLinkedLifeGain(state, playerId, effect);

      const updatedPlayer = updatedState.players.get(playerId);
      expect(updatedPlayer?.life).toBe(initialLife);
    });
  });
});