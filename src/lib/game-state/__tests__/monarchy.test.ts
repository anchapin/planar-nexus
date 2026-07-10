/**
 * Monarchy rule tests (CR 704.5p + CR 714.3) — issue #1225.
 *
 * Coverage:
 *   - No monarch at the start of the game.
 *   - First combat damage makes the dealing player the monarch.
 *   - The monarchy transfers when the current monarch is dealt combat damage
 *     by an opponent.
 *   - The monarchy replaces (does not stack) an existing monarch.
 *   - CR 714.3 draws a card at the monarch's end step.
 *   - `setMonarch` / `clearMonarch` helpers behave idempotently.
 */

import { createInitialGameState, startGame } from "../game-state";
import { dealDamageToPlayer } from "../player-actions";
import { checkStateBasedActions } from "../state-based-actions";
import { createCardInstance } from "../card-instance";
import {
  applyMonarchEndStepDraw,
  clearMonarch,
  drawCards,
  getMonarchId,
  resetMonarchyTracking,
  setMonarch,
} from "../keyword-actions";
import { detectMonarchyChangeTriggers } from "../trigger-system";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createMockAttacker(
  name: string,
  power: number,
  oracleText = "",
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: power.toString(),
    toughness: "2",
    keywords: [],
    oracle_text: oracleText,
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as unknown as ScryfallCard;
}

function putCreatureOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  attacker: ScryfallCard,
): CardInstanceId {
  const instance = createCardInstance(attacker, controllerId, controllerId);
  state.cards.set(instance.id, instance);
  const battlefield = state.zones.get(`${controllerId}-battlefield`);
  if (!battlefield) {
    throw new Error(`Battlefield zone missing for ${controllerId}`);
  }
  state.zones.set(`${controllerId}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, instance.id],
  });
  // Cached zone key so other helpers (isOnBattlefield, SBA) see the card.
  instance.currentZoneKey = `${controllerId}-battlefield`;
  return instance.id;
}

/** Put a few cards in the given player's library so end-step draw has work. */
function seedLibrary(state: GameState, owner: PlayerId, count: number) {
  const cardData: ScryfallCard = {
    id: `mock-lib-${owner}`,
    name: "Library Card",
    type_line: "Instant",
    mana_cost: "{0}",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "normal",
  } as unknown as ScryfallCard;
  const cards: CardInstanceId[] = [];
  for (let i = 0; i < count; i += 1) {
    const instance = createCardInstance(
      { ...cardData, id: `${cardData.id}-${i}` },
      owner,
      owner,
    );
    state.cards.set(instance.id, instance);
    cards.push(instance.id);
  }
  const library = state.zones.get(`${owner}-library`);
  if (!library) {
    throw new Error(`Library zone missing for ${owner}`);
  }
  state.zones.set(`${owner}-library`, {
    ...library,
    cardIds: [...cards, ...library.cardIds],
  });
}

function setupTwoPlayerState(): {
  state: GameState;
  alice: PlayerId;
  bob: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const [alice, bob] = Array.from(state.players.keys()) as PlayerId[];
  return { state, alice, bob };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Monarchy rule (CR 704.5p + CR 714.3) — issue #1225", () => {
  describe("initialisation", () => {
    it("starts with no monarch", () => {
      const { state } = setupTwoPlayerState();
      expect(getMonarchId(state)).toBeNull();
      for (const player of state.players.values()) {
        expect(player.isMonarch).toBe(false);
      }
    });
  });

  describe("first combat damage creates a monarch", () => {
    it("makes the dealing player the first monarch when no monarch exists", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const attackerId = putCreatureOnBattlefield(
        state,
        alice,
        createMockAttacker("Vanguard", 3),
      );
      expect(getMonarchId(state)).toBeNull();

      // Alice's creature deals 3 combat damage to Bob
      const next = dealDamageToPlayer(state, bob, 3, true, attackerId);
      expect(next.players.get(bob)?.lastCombatDamageFromPlayer).toBe(alice);

      // SBAs run; Alice should be the first monarch
      const sba = checkStateBasedActions(next);
      expect(sba.actionsPerformed).toBe(true);
      const monarchId = getMonarchId(sba.state);
      expect(monarchId).toBe(alice);
      expect(sba.state.players.get(alice)?.isMonarch).toBe(true);
      expect(sba.state.players.get(bob)?.isMonarch).toBe(false);
    });

    it("does NOT transfer monarchy from non-combat damage", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      // Make Bob the monarch first via setMonarch (simulates an earlier
      // exchange). Non-combat damage must not displace him.
      const seeded = setMonarch(state, bob).state;
      expect(getMonarchId(seeded)).toBe(bob);

      // Bob is the monarch. Alice bolts Bob for 3 NON-combat damage.
      const next = dealDamageToPlayer(seeded, bob, 3, false, undefined);
      expect(next.players.get(bob)?.lastCombatDamageFromPlayer ?? null).toBe(
        null,
      );

      const sba = checkStateBasedActions(next);
      // Monarch unchanged — non-combat damage is irrelevant.
      expect(getMonarchId(sba.state)).toBe(bob);
      expect(sba.state.players.get(bob)?.isMonarch).toBe(true);
      expect(sba.state.players.get(alice)?.isMonarch).toBe(false);
    });
  });

  describe("monarchy replacement (CR 704.5p)", () => {
    it("transfers the monarchy when an opponent deals combat damage to the monarch", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const seeded = setMonarch(state, alice).state;
      expect(getMonarchId(seeded)).toBe(alice);

      // Bob now attacks Alice with a 4/2.
      const attackerId = putCreatureOnBattlefield(
        seeded,
        bob,
        createMockAttacker("Challenger", 4),
      );
      const damagedAlice = dealDamageToPlayer(
        seeded,
        alice,
        2,
        true,
        attackerId,
      );
      expect(damagedAlice.players.get(alice)?.lastCombatDamageFromPlayer).toBe(
        bob,
      );

      const sba = checkStateBasedActions(damagedAlice);
      expect(sba.actionsPerformed).toBe(true);
      // Alice is no longer monarch; Bob is.
      const finalMonarch = getMonarchId(sba.state);
      expect(finalMonarch).toBe(bob);
      expect(sba.state.players.get(alice)?.isMonarch).toBe(false);
      expect(sba.state.players.get(bob)?.isMonarch).toBe(true);
    });

    it("does not create two simultaneous monarchs", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const seeded = setMonarch(state, alice).state;
      const attackerId = putCreatureOnBattlefield(
        seeded,
        bob,
        createMockAttacker("Usurper", 3),
      );
      const sba = checkStateBasedActions(
        dealDamageToPlayer(seeded, alice, 2, true, attackerId),
      );

      // Exactly one player holds the monarchy.
      const monarchs = Array.from(sba.state.players.values()).filter(
        (p) => p.isMonarch,
      );
      expect(monarchs).toHaveLength(1);
      expect(monarchs[0].id).toBe(bob);
    });

    it("back-to-back transfers always land on the most recent combat damage source", () => {
      // Alice is monarch → Bob hits her → Bob is monarch → Alice hits him
      // → Alice is monarch again. The chain converges to the last
      // combat-damager thanks to the iterative SBA loop.
      const { state, alice, bob } = setupTwoPlayerState();

      // Round 1: Alice is the (initial) monarch.
      let next = setMonarch(state, alice).state;
      const bobAttacker = putCreatureOnBattlefield(
        next,
        bob,
        createMockAttacker("Bob Striker", 2),
      );
      next = checkStateBasedActions(
        dealDamageToPlayer(next, alice, 1, true, bobAttacker),
      ).state;
      expect(getMonarchId(next)).toBe(bob);

      // Reset the per-turn tracking so the chain starts fresh for round 2.
      next = resetMonarchyTracking(next);

      // Round 2: Bob is the monarch, Alice retaliates.
      const aliceAttacker = putCreatureOnBattlefield(
        next,
        alice,
        createMockAttacker("Alice Striker", 2),
      );
      next = checkStateBasedActions(
        dealDamageToPlayer(next, bob, 1, true, aliceAttacker),
      ).state;
      expect(getMonarchId(next)).toBe(alice);
    });
  });

  describe("CR 714.3 — monarch draws at end of turn", () => {
    it("draws a card for the monarch on the end step", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const seeded = setMonarch(state, alice).state;
      seedLibrary(seeded, alice, 5);

      const draw = applyMonarchEndStepDraw(seeded);
      expect(draw.drewCard).toBe(true);
      expect(draw.drawnCount).toBe(1);

      const hand = draw.state.zones.get(`${alice}-hand`);
      expect(hand?.cardIds.length).toBe(1);
      // Bob's hand untouched.
      const bobHand = draw.state.zones.get(`${bob}-hand`);
      expect(bobHand?.cardIds.length).toBe(0);
    });

    it("is a no-op if there is no monarch", () => {
      const { state, alice } = setupTwoPlayerState();
      seedLibrary(state, alice, 5);

      const draw = applyMonarchEndStepDraw(state);
      expect(draw.drewCard).toBe(false);
      expect(draw.drawnCount).toBe(0);
      expect(getMonarchId(draw.state)).toBeNull();
    });
  });

  describe("helpers", () => {
    it("setMonarch clears the flag on every other player", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const withAlice = setMonarch(state, alice).state;
      expect(getMonarchId(withAlice)).toBe(alice);

      const withBob = setMonarch(withAlice, bob);
      expect(withBob.changed).toBe(true);
      expect(getMonarchId(withBob.state)).toBe(bob);
      expect(withBob.state.players.get(alice)?.isMonarch).toBe(false);
      expect(withBob.state.players.get(bob)?.isMonarch).toBe(true);
    });

    it("setMonarch is idempotent when called with the current monarch", () => {
      const { state, alice } = setupTwoPlayerState();
      const once = setMonarch(state, alice);
      const twice = setMonarch(once.state, alice);
      expect(once.changed).toBe(true);
      expect(twice.changed).toBe(false);
      expect(getMonarchId(twice.state)).toBe(alice);
    });

    it("clearMonarch removes the monarchy flag from every player", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      const seeded = setMonarch(state, alice).state;
      const cleared = clearMonarch(seeded);
      expect(cleared.changed).toBe(true);
      expect(getMonarchId(cleared.state)).toBeNull();
      expect(cleared.state.players.get(alice)?.isMonarch).toBe(false);
      expect(cleared.state.players.get(bob)?.isMonarch).toBe(false);
    });

    it("resetMonarchyTracking clears every player's lastCombatDamageFromPlayer", () => {
      const { state, alice, bob } = setupTwoPlayerState();
      state.players.set(alice, {
        ...state.players.get(alice)!,
        lastCombatDamageFromPlayer: bob,
      });
      state.players.set(bob, {
        ...state.players.get(bob)!,
        lastCombatDamageFromPlayer: alice,
      });

      const cleaned = resetMonarchyTracking(state);
      expect(
        cleaned.players.get(alice)?.lastCombatDamageFromPlayer ?? null,
      ).toBeNull();
      expect(
        cleaned.players.get(bob)?.lastCombatDamageFromPlayer ?? null,
      ).toBeNull();
    });
  });

  describe("trigger detection (issue #1225 — 'Whenever you become the monarch')", () => {
    it("emits a monarchy-change trigger for cards whose controller is the new monarch", () => {
      const { state, alice } = setupTwoPlayerState();
      const regalId = putCreatureOnBattlefield(
        state,
        alice,
        createMockAttacker(
          "Regal Behemoth",
          5,
          "Whenever you become the monarch, draw a card.",
        ),
      );
      const otherId = putCreatureOnBattlefield(
        state,
        alice,
        createMockAttacker("Vanilla", 1),
      );

      const withMonarch = setMonarch(state, alice).state;
      const triggers = detectMonarchyChangeTriggers(withMonarch, alice);
      const ids = triggers.map((t) => t.sourceCardId);
      expect(ids).toContain(regalId);
      expect(ids).not.toContain(otherId);
      const regalTrigger = triggers.find((t) => t.sourceCardId === regalId);
      expect(regalTrigger).toBeDefined();
      expect(regalTrigger?.triggerCondition).toBe("becomesMonarch");
      expect(regalTrigger?.context?.damageTarget).toBe(alice);
    });

    it("returns no triggers when no monarch is set", () => {
      const { state, alice } = setupTwoPlayerState();
      putCreatureOnBattlefield(
        state,
        alice,
        createMockAttacker(
          "Regal Behemoth",
          5,
          "Whenever you become the monarch, draw a card.",
        ),
      );
      expect(detectMonarchyChangeTriggers(state, alice)).toEqual([]);
    });
  });

  describe("interaction with draw replacement effects (regression smoke test)", () => {
    it("does not double-draw — applyMonarchEndStepDraw goes through drawCards", () => {
      const { state, alice } = setupTwoPlayerState();
      const seeded = setMonarch(state, alice).state;
      seedLibrary(seeded, alice, 4);

      const baseline = drawCards(seeded, alice, 1);
      const handAfterBaseline = baseline.state.zones.get(`${alice}-hand`)!
        .cardIds.length;

      const next = applyMonarchEndStepDraw(baseline.state);
      expect(next.state.zones.get(`${alice}-hand`)!.cardIds.length).toBe(
        handAfterBaseline + 1,
      );
    });
  });
});
