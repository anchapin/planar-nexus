/**
 * Property-Based Tests for Magic Rules
 *
 * Uses fast-check to test game invariants with randomly generated inputs.
 * This catches edge cases that manual testing would miss.
 */

import fc from "fast-check";
import { resolveCombatDamage } from "../combat";
import {
  createInitialGameState,
  startGame,
  passPriority,
  drawCard,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana as addManaToPool, activateManaAbility } from "../mana";
import type { ScryfallCard } from "@/app/actions";
import type { GameState, ManaPool, PlayerId } from "../types";

// Helper to create a basic land
function createBasicLand(
  type: "plains" | "island" | "swamp" | "mountain" | "forest",
): ScryfallCard {
  const landTypes = {
    plains: { name: "Plains", mana: { white: 1 }, color: "W" },
    island: { name: "Island", mana: { blue: 1 }, color: "U" },
    swamp: { name: "Swamp", mana: { black: 1 }, color: "B" },
    mountain: { name: "Mountain", mana: { red: 1 }, color: "R" },
    forest: { name: "Forest", mana: { green: 1 }, color: "G" },
  };
  const info = landTypes[type];

  return {
    id: `basic-${type}`,
    name: info.name,
    type_line: `Basic Land — ${info.name}`,
    keywords: [],
    oracle_text: `T: Add ${info.color}.`,
    mana_cost: "",
    cmc: 0,
    colors: [],
    legalities: { standard: "legal", commander: "legal" },
    color_identity: [info.color as "W" | "U" | "B" | "R" | "G"],
    card_faces: undefined,
  };
}

// Helper to create a creature
function createCreature(
  name: string,
  power: number,
  toughness: number,
): ScryfallCard {
  return {
    id: `creature-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Elf",
    keywords: [],
    oracle_text: "",
    mana_cost: "{G}",
    cmc: 1,
    colors: ["green"],
    legalities: { standard: "legal", commander: "legal" },
    color_identity: ["G"],
    card_faces: undefined,
    power: power.toString(),
    toughness: toughness.toString(),
  };
}

describe("Property-based Tests: Game Invariants", () => {
  describe("Mana invariants", () => {
    it("adding mana should increase pool by exact amount", () => {
      fc.assert(
        fc.property(
          fc.record({
            white: fc.integer({ min: 0, max: 10 }),
            blue: fc.integer({ min: 0, max: 10 }),
            black: fc.integer({ min: 0, max: 10 }),
            red: fc.integer({ min: 0, max: 10 }),
            green: fc.integer({ min: 0, max: 10 }),
            colorless: fc.integer({ min: 0, max: 10 }),
            generic: fc.integer({ min: 0, max: 10 }),
          }),
          (manaToAdd) => {
            let state = createInitialGameState(["Player1"], 20, false);
            state = startGame(state);
            const playerId = Array.from(state.players.keys())[0];

            const originalPool = state.players.get(playerId)!.manaPool;
            const resultState = addManaToPool(state, playerId, manaToAdd);
            const newPool = resultState.players.get(playerId)!.manaPool;

            expect(newPool.white).toBe(
              originalPool.white + (manaToAdd.white ?? 0),
            );
            expect(newPool.blue).toBe(
              originalPool.blue + (manaToAdd.blue ?? 0),
            );
            expect(newPool.black).toBe(
              originalPool.black + (manaToAdd.black ?? 0),
            );
            expect(newPool.red).toBe(originalPool.red + (manaToAdd.red ?? 0));
            expect(newPool.green).toBe(
              originalPool.green + (manaToAdd.green ?? 0),
            );
            expect(newPool.colorless).toBe(
              originalPool.colorless + (manaToAdd.colorless ?? 0),
            );
            expect(newPool.generic).toBe(
              originalPool.generic + (manaToAdd.generic ?? 0),
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("mana pool should never have negative values", () => {
      fc.assert(
        fc.property(
          fc.record({
            white: fc.integer({ min: 0, max: 10 }),
            blue: fc.integer({ min: 0, max: 10 }),
            black: fc.integer({ min: 0, max: 10 }),
            red: fc.integer({ min: 0, max: 10 }),
            green: fc.integer({ min: 0, max: 10 }),
            colorless: fc.integer({ min: 0, max: 10 }),
            generic: fc.integer({ min: 0, max: 10 }),
          }),
          (initialMana) => {
            let state = createInitialGameState(["Player1"], 20, false);
            state = startGame(state);
            const playerId = Array.from(state.players.keys())[0];

            // Add initial mana
            state = addManaToPool(state, playerId, initialMana);
            const pool = state.players.get(playerId)!.manaPool;

            // All values should be non-negative
            expect(pool.white).toBeGreaterThanOrEqual(0);
            expect(pool.blue).toBeGreaterThanOrEqual(0);
            expect(pool.black).toBeGreaterThanOrEqual(0);
            expect(pool.red).toBeGreaterThanOrEqual(0);
            expect(pool.green).toBeGreaterThanOrEqual(0);
            expect(pool.colorless).toBeGreaterThanOrEqual(0);
            expect(pool.generic).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("activating a basic land should add the correct mana type", () => {
      const landTypes: Array<{
        type: "plains" | "island" | "swamp" | "mountain" | "forest";
        color: keyof ManaPool;
      }> = [
        { type: "plains", color: "white" },
        { type: "island", color: "blue" },
        { type: "swamp", color: "black" },
        { type: "mountain", color: "red" },
        { type: "forest", color: "green" },
      ];

      fc.assert(
        fc.property(fc.constantFrom(...landTypes), ({ type, color }) => {
          let state = createInitialGameState(["Player1"], 20, false);
          state = startGame(state);
          const playerId = Array.from(state.players.keys())[0];

          const landCard = createBasicLand(type);
          const cardId = "land-1";
          const instance = createCardInstance(landCard, playerId, playerId);
          state.cards.set(cardId, instance);
          state.zones.get(`${playerId}-battlefield`)!.cardIds.push(cardId);

          const poolBefore = { ...state.players.get(playerId)!.manaPool };
          const result = activateManaAbility(state, playerId, cardId, 0);

          if (result.success) {
            const poolAfter = result.state.players.get(playerId)!.manaPool;
            expect(poolAfter[color]).toBe(poolBefore[color] + 1);
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("Combat invariants", () => {
    it("unblocked creatures should deal damage equal to their power to the player", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 20 }), (power) => {
          let state = createInitialGameState(["Alice", "Bob"], 20, false);
          state = startGame(state);
          const aliceId = Array.from(state.players.keys())[0] as PlayerId;
          const bobId = Array.from(state.players.keys())[1] as PlayerId;

          // Alice has a creature
          const creature = createCreature("Attacker", power, 1);
          const cardId = "creature-1";
          const instance = createCardInstance(creature, aliceId, aliceId);
          state.cards.set(cardId, instance);
          state.zones.get(`${aliceId}-battlefield`)!.cardIds.push(cardId);

          // Set up combat state
          state.combat.inCombatPhase = true;
          state.combat.attackers = [
            {
              cardId: cardId,
              defenderId: bobId,
              isAttackingPlaneswalker: false,
              damageToDeal: power,
              hasFirstStrike: false,
              hasDoubleStrike: false,
            },
          ];

          const bobLifeBefore = state.players.get(bobId)!.life;
          const result = resolveCombatDamage(state);

          if (result.success) {
            const bobLifeAfter = result.state.players.get(bobId)!.life;
            expect(bobLifeAfter).toBe(bobLifeBefore - power);
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  describe("Card instance invariants", () => {
    it("newly created cards should have hasSummoningSickness: true", () => {
      fc.assert(
        fc.property(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            power: fc.integer({ min: 0, max: 20 }),
            toughness: fc.integer({ min: 0, max: 20 }),
          }),
          ({ name, power, toughness }) => {
            const card = createCreature(name, power, toughness);
            const playerId = "player-1";
            const instance = createCardInstance(card, playerId, playerId);

            // All permanents should have summoning sickness when created
            expect(instance.hasSummoningSickness).toBe(true);
          },
        ),
        { numRuns: 50 },
      );
    });

    it("cards should not be tapped when created", () => {
      fc.assert(
        fc.property(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            power: fc.integer({ min: 0, max: 20 }),
            toughness: fc.integer({ min: 0, max: 20 }),
          }),
          ({ name, power, toughness }) => {
            const card = createCreature(name, power, toughness);
            const playerId = "player-1";
            const instance = createCardInstance(card, playerId, playerId);

            // Cards should not be tapped when created
            expect(instance.isTapped).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe("Turn progression invariants", () => {
    it("drawing a card should increase hand size (or do nothing if library empty)", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 3 }), (initialDraws) => {
          let state = createInitialGameState(["Player1"], 20, false);
          state = startGame(state);
          const playerId = Array.from(state.players.keys())[0];

          // Draw initial cards
          for (let i = 0; i < initialDraws; i++) {
            const result = drawCard(state, playerId);
            if (result) {
              state = result;
            }
          }

          const handBefore = state.zones.get(`${playerId}-hand`)!.cardIds
            .length;
          const drawResult = drawCard(state, playerId);
          if (drawResult) {
            state = drawResult;
            const handAfter = state.zones.get(`${playerId}-hand`)!.cardIds
              .length;
            // Hand should either increase by 1 or stay same (if library empty)
            expect(handAfter).toBeGreaterThanOrEqual(handBefore);
          }
        }),
        { numRuns: 20 },
      );
    });

    it("turn number should always be positive", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), (turns) => {
          let state = createInitialGameState(["P1", "P2"], 20, false);
          state = startGame(state);
          const playerIds = Array.from(state.players.keys());

          // Advance several turns
          for (let i = 0; i < turns; i++) {
            state = passPriority(state, playerIds[0]);
            state = passPriority(state, playerIds[1]);
          }

          expect(state.turn.turnNumber).toBeGreaterThan(0);
        }),
        { numRuns: 30 },
      );
    });
  });

  describe("Game state invariants", () => {
    it("player should always have valid life total", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (startingLife) => {
          let state = createInitialGameState(["Player1"], startingLife, false);
          state = startGame(state);
          const playerId = Array.from(state.players.keys())[0];

          const life = state.players.get(playerId)!.life;

          // Life should always be non-negative
          expect(life).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 50 },
      );
    });

    it("zones should always have valid card arrays", () => {
      let state = createInitialGameState(["P1", "P2"], 20, false);
      state = startGame(state);
      const playerId = Array.from(state.players.keys())[0];

      // Draw some cards
      for (let i = 0; i < 3; i++) {
        state = drawCard(state, playerId);
      }

      // All zone card arrays should be valid
      const zones = ["hand", "battlefield", "graveyard", "library", "exile"];
      for (const zoneName of zones) {
        const zone = state.zones.get(`${playerId}-${zoneName}`);
        expect(zone).toBeDefined();
        expect(Array.isArray(zone!.cardIds)).toBe(true);
        // Card IDs should be unique within a zone
        const uniqueIds = new Set(zone!.cardIds);
        expect(uniqueIds.size).toBe(zone!.cardIds.length);
      }
    });
  });
});
