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
import type { GameState, ManaPool, PlayerId, StackObject } from "../types";
import { resolveTopOfStack } from "../spell-casting";
import { counterSpell } from "../keyword-actions";
import { computeStateHash } from "../state-hash";
import { cloneGameState } from "../state-serialization";

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

// ---------------------------------------------------------------------------
// Stack Resolution Determinism (issue #1013)
//
// The stack is an ordered, LIFO data structure. In P2P multiplayer every peer
// must reach an identical state from identical inputs. These property-based
// tests assert that stack resolution is a pure function of its inputs:
//   1. Resolving the same stack repeatedly yields identical state hashes.
//   2. Resolution order is deterministic and (per the rules) order-dependent.
//   3. Counter spells resolve consistently regardless of how many are stacked.
// ---------------------------------------------------------------------------

const DETERMINISM_GAME_ID = "test-stack-determinism";

/**
 * Build a minimal, fully-specified StackObject with deterministic fields.
 * `sourceCardId` is intentionally null so resolution exercises the generic
 * "remove from stack" path without depending on card data, keeping the
 * determinism property independent of effect-resolution specifics.
 */
function makeStackObject(
  id: string,
  opts: { type?: "spell" | "ability"; name?: string; isCountered?: boolean } = {},
): StackObject {
  return {
    id,
    type: opts.type ?? "spell",
    sourceCardId: null,
    controllerId: "player-placeholder" as PlayerId,
    name: opts.name ?? `Spell ${id}`,
    text: "",
    manaCost: null,
    targets: [],
    chosenModes: [],
    variableValues: new Map<string, number>(),
    isCountered: opts.isCountered ?? false,
    timestamp: 0,
  };
}

/**
 * Create a fresh game state with the given stack. A normalized gameId is used so
 * hashes are comparable; the controller of every stack object is set to a real
 * player id present in the state.
 */
function buildStateWithStack(stack: StackObject[]): GameState {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const firstPlayer = Array.from(state.players.keys())[0] as PlayerId;
  const normalizedStack = stack.map((obj) => ({ ...obj, controllerId: firstPlayer }));
  return { ...state, gameId: DETERMINISM_GAME_ID, stack: normalizedStack };
}

/**
 * Resolve every object on the stack until it is empty. Each `resolveTopOfStack`
 * call removes exactly one object (countered or not), so the loop always
 * terminates; the guard is a safety net against regressions.
 */
function resolveEntireStack(state: GameState): GameState {
  let current = state;
  let guard = current.stack.length + 5;
  while (current.stack.length > 0 && guard-- > 0) {
    current = resolveTopOfStack(current);
  }
  return current;
}

describe("Property-based Tests: Stack Resolution Determinism", () => {
  // Generates a single spell/ability spec. `constantFrom` is typed as the
  // literal union so no casts are needed downstream.
  const spellSpecArb = fc.record({
    type: fc.constantFrom<"spell" | "ability">("spell", "ability"),
    name: fc.string({ minLength: 1, maxLength: 12 }),
  });

  // Acceptance criterion #1: identical stack states resolve to identical next
  // states across 100+ runs.
  it("resolving the same stack multiple times produces identical state hashes", () => {
    fc.assert(
      fc.property(
        fc.array(spellSpecArb, { minLength: 0, maxLength: 6 }),
        (specs) => {
          const base = buildStateWithStack(
            specs.map((s, i) => makeStackObject(`obj-${i}`, s)),
          );

          // Resolve the same stack independently several times. Every resulting
          // hash must be identical (resolution is a pure function of the input).
          const REPETITIONS = 10;
          const hashes: string[] = [];
          for (let r = 0; r < REPETITIONS; r++) {
            hashes.push(computeStateHash(resolveEntireStack(cloneGameState(base))));
          }
          const firstHash = hashes[0];
          for (const h of hashes) {
            expect(h).toBe(firstHash);
          }

          // Fully resolving the stack always empties it.
          expect(resolveEntireStack(cloneGameState(base)).stack.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Acceptance criterion #2: spell resolution order is deterministic (LIFO) and
  // order-dependent — i.e. stack operations are NOT commutative.
  it("spell resolution order is deterministic and order-dependent (fc.tuple)", () => {
    fc.assert(
      fc.property(
        fc.tuple(spellSpecArb, spellSpecArb),
        ([specP, specQ]) => {
          const p = makeStackObject("p", specP);
          const q = makeStackObject("q", specQ);

          // Forward stack: [p, q]  (q is on top). Reverse stack: [q, p] (p on top).
          const forward = buildStateWithStack([p, q]);
          const reverse = buildStateWithStack([q, p]);

          // Peer determinism: two independent resolutions of the same ordered
          // stack must reach the same state.
          expect(computeStateHash(resolveEntireStack(cloneGameState(forward)))).toBe(
            computeStateHash(resolveEntireStack(cloneGameState(forward))),
          );

          // LIFO: a single resolution always removes the top object.
          const forwardAfterOne = resolveTopOfStack(cloneGameState(forward));
          const reverseAfterOne = resolveTopOfStack(cloneGameState(reverse));
          expect(forwardAfterOne.stack.length).toBe(1);
          expect(reverseAfterOne.stack.length).toBe(1);

          // Non-commutativity: the object that remains depends on resolution
          // order. Forward leaves p on the stack; reverse leaves q.
          expect(forwardAfterOne.stack[0].id).toBe("p");
          expect(reverseAfterOne.stack[0].id).toBe("q");
          expect(forwardAfterOne.stack[0].id).not.toBe(reverseAfterOne.stack[0].id);

          // Despite differing removal order, fully resolving either yields an
          // empty stack.
          expect(resolveEntireStack(cloneGameState(forward)).stack.length).toBe(0);
          expect(resolveEntireStack(cloneGameState(reverse)).stack.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Acceptance criterion #3: counter spells resolve correctly and
  // deterministically, including counter-on-counter ordering.
  it("countering any subset of the stack resolves deterministically (counter-on-counter)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom<"spell" | "ability">("spell", "ability"),
            name: fc.string({ minLength: 1, maxLength: 12 }),
            counter: fc.boolean(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (entries) => {
          const stack = entries.map((e, i) => makeStackObject(`c-${i}`, e));
          let state = buildStateWithStack(stack);

          // Apply counters to the selected objects. Multiple counters are
          // supported (counter-on-counter).
          for (let i = 0; i < entries.length; i++) {
            if (entries[i].counter) {
              const result = counterSpell(state, `c-${i}`);
              expect(result.success).toBe(true);
              state = result.state;
            }
          }

          // Correctness: each countered object is flagged but still on the stack
          // until it is resolved.
          for (let i = 0; i < entries.length; i++) {
            const obj = state.stack.find((o) => o.id === `c-${i}`);
            expect(obj).toBeDefined();
            expect(obj!.isCountered).toBe(entries[i].counter);
          }

          // Determinism: two peers reach the identical resolved state.
          const hashA = computeStateHash(resolveEntireStack(cloneGameState(state)));
          const hashB = computeStateHash(resolveEntireStack(cloneGameState(state)));
          expect(hashA).toBe(hashB);

          // Full resolution always empties the stack, countered or not.
          expect(resolveEntireStack(cloneGameState(state)).stack.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
});
