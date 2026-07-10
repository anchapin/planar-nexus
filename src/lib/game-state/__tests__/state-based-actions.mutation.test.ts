/**
 * Mutation-targeted edge cases for `state-based-actions.ts`.
 *
 * Issue #1395: Stryker mutation suites for the rules engine. The companion file
 * `state-based-actions.test.ts` covers the happy paths; these tests pin down
 * the boundary/off-by-one mutants that Stryker otherwise reports as surviving:
 *
 *  - Counter-derived toughness math (SBA 704.5g): the `+ plusOneCounters -
 *    minusOneCounters` arithmetic and the `<= 0` floor.
 *  - +1/+1 / -1/-1 counter annihilation (SBA 704.5q): `Math.min` vs `Math.max`.
 *  - Indestructible with lethal damage (SBA 704.5f): the `!hasIndestructible`
 *    gate.
 *  - 0-loyalty planeswalker is EXILED, not destroyed (SBA 704.5i, GS-H4).
 *  - Commander-damage boundary at exactly 21 (CR 903.10a).
 *  - Per-player legend-rule scoping (QA-C5 / CR 704.5u).
 *  - Per-controller planeswalker-uniqueness grouping (CR 704.5j).
 *  - `checkStateBasedActions` stability: a settled board yields no further
 *    mutation on a second pass (idempotency).
 */

import {
  checkStateBasedActions,
  canDraw,
} from "../state-based-actions";
import {
  findLegendaryViolations,
  LEGENDARY_CHOICE_TYPE,
} from "../legendary-rule";
import {
  createInitialGameState,
  startGame,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { dealDamageToCard } from "../keyword-actions";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "@/app/actions";

function mockCreature(
  name: string,
  power: number,
  toughness: number,
  keywords: string[] = [],
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `Creature — ${name}`,
    power: String(power),
    toughness: String(toughness),
    keywords,
    oracle_text: keywords.join(" "),
    mana_cost: "{1}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function mockPlaneswalker(name: string, pwType: string): ScryfallCard {
  return {
    id: `mock-pw-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: `Legendary Planeswalker — ${pwType}`,
    loyalty: "5",
    keywords: [],
    oracle_text: "",
    mana_cost: "{3}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeGame(players = 2): { state: GameState; ids: PlayerId[] } {
  let state = createInitialGameState(
    players === 1 ? ["Alice"] : ["Alice", "Bob"],
    20,
    false,
  );
  state = startGame(state);
  return { state, ids: Array.from(state.players.keys()) };
}

/** Place a card on a player's battlefield, wiring `currentZoneKey` for the SBA
 * fast path so the card is found via both lookup strategies. */
function placeOnBf(
  state: GameState,
  cardData: ScryfallCard,
  controllerId: PlayerId,
): CardInstanceId {
  const card = createCardInstance(cardData, controllerId, controllerId);
  card.hasSummoningSickness = false;
  const zoneKey = `${controllerId}-battlefield`;
  card.currentZoneKey = zoneKey;
  const bf = state.zones.get(zoneKey)!;
  state.zones.set(zoneKey, { ...bf, cardIds: [...bf.cardIds, card.id] });
  state.cards.set(card.id, card);
  return card.id;
}

function onBf(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
}

describe("SBA mutation edge cases (#1395)", () => {
  // -------------------------------------------------------------------------
  // Counter-derived toughness (SBA 704.5g)
  // -------------------------------------------------------------------------
  describe("toughness derived from -1/-1 counters (SBA 704.5g)", () => {
    it("destroys a creature that reaches 0 toughness via -1/-1 counters only", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockCreature("Host", 3, 3), ids[0]);
      const card = state.cards.get(id)!;
      card.counters = [{ type: "-1/-1", count: 3 }];

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      expect(onBf(result.state, ids[0])).not.toContain(id);
      expect(
        result.state.zones.get(`${ids[0]}-graveyard`)!.cardIds,
      ).toContain(id);
    });

    it("keeps a creature whose -1/-1 counters leave toughness positive", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockCreature("Bear", 2, 3), ids[0]);
      state.cards.get(id)!.counters = [{ type: "-1/-1", count: 2 }];

      const result = checkStateBasedActions(state);

      expect(onBf(result.state, ids[0])).toContain(id);
    });

    it("counts +1/+1 counters toward effective toughness (kills the `+ plusOneCounters` mutant)", () => {
      const { state, ids } = makeGame(1);
      // Base 1 + one +1/+1 = 2 → survives; a mutant that SUBTRACTS the
      // +1/+1 bonus computes 0 and wrongly destroys the creature.
      const id = placeOnBf(state, mockCreature("Bearer", 1, 1), ids[0]);
      state.cards.get(id)!.counters = [{ type: "+1/+1", count: 1 }];

      const result = checkStateBasedActions(state);

      expect(onBf(result.state, ids[0])).toContain(id);
    });
  });

  // -------------------------------------------------------------------------
  // Counter annihilation (SBA 704.5q)
  // -------------------------------------------------------------------------
  describe("+1/+1 and -1/-1 counter annihilation (SBA 704.5q)", () => {
    it("removes the smaller count from each (kills Math.min→Math.max)", () => {
      const { state, ids } = makeGame(1);
      // Base toughness 5 keeps effective toughness positive (5 + 1 - 2 = 4)
      // so the creature survives the 704.5g check and reaches the 704.5q
      // annihilation pass. Unequal counts so min (1) differs from max (2).
      const id = placeOnBf(state, mockCreature("Growth", 5, 5), ids[0]);
      state.cards.get(id)!.counters = [
        { type: "+1/+1", count: 1 },
        { type: "-1/-1", count: 2 },
      ];

      const result = checkStateBasedActions(state);
      const after = result.state.cards.get(id)!;
      const plus = after.counters.find((c) => c.type === "+1/+1");
      const minus = after.counters.find((c) => c.type === "-1/-1");

      expect(plus).toBeUndefined(); // 1 - 1 = 0, filtered out
      expect(minus?.count).toBe(1); // 2 - 1 = 1 remains
      expect(result.actionsPerformed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Indestructible (SBA 704.5f)
  // -------------------------------------------------------------------------
  describe("indestructible with lethal damage (SBA 704.5f)", () => {
    it("does not destroy an indestructible creature with lethal damage", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockCreature("God", 4, 4, ["Indestructible"]), ids[0]);
      const damaged = dealDamageToCard(state, id, 4, true).state;

      const result = checkStateBasedActions(damaged);

      expect(onBf(result.state, ids[0])).toContain(id);
      expect(
        result.state.zones.get(`${ids[0]}-graveyard`)!.cardIds,
      ).not.toContain(id);
    });
  });

  // -------------------------------------------------------------------------
  // 0-loyalty planeswalker — exile, NOT destroy (GS-H4)
  // -------------------------------------------------------------------------
  describe("0-loyalty planeswalker is exiled, not destroyed (GS-H4)", () => {
    it("sends a 0-loyalty planeswalker to exile and NOT to the graveyard", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockPlaneswalker("Walker", "Jace"), ids[0]);
      state.cards.get(id)!.counters = [{ type: "loyalty", count: 0 }];

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      expect(result.state.zones.get(`${ids[0]}-exile`)!.cardIds).toContain(id);
      // The distinguishing assertion: a mutant that routes 0-loyalty PWs through
      // `cardsToDestroy` would land the card in the graveyard instead.
      expect(
        result.state.zones.get(`${ids[0]}-graveyard`)!.cardIds,
      ).not.toContain(id);
    });

    it("keeps a planeswalker with positive loyalty", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockPlaneswalker("Walker", "Jace"), ids[0]);
      state.cards.get(id)!.counters = [{ type: "loyalty", count: 3 }];

      const result = checkStateBasedActions(state);

      expect(onBf(result.state, ids[0])).toContain(id);
    });
  });

  // -------------------------------------------------------------------------
  // Commander damage boundary (CR 903.10a)
  // -------------------------------------------------------------------------
  describe("commander damage boundary (CR 903.10a)", () => {
    it("makes a player lose at exactly 21 commander damage (kills >= → >)", () => {
      const { state, ids } = makeGame();
      const alice = state.players.get(ids[0])!;
      alice.commanderDamage.set("cmd-1", 21);

      const result = checkStateBasedActions(state);

      expect(result.actionsPerformed).toBe(true);
      expect(result.state.players.get(ids[0])?.hasLost).toBe(true);
    });

    it("does NOT make a player lose at 20 commander damage", () => {
      const { state, ids } = makeGame();
      state.players.get(ids[0])!.commanderDamage.set("cmd-1", 20);

      const result = checkStateBasedActions(state);

      expect(result.state.players.get(ids[0])?.hasLost).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Per-player legend-rule scoping (QA-C5 / CR 704.5u)
  // -------------------------------------------------------------------------
  describe("per-player legend-rule scoping (QA-C5)", () => {
    it("reports a violation only for the controller with duplicates", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      const legend = mockCreature("Jace, Mock", 1, 1);
      legend.type_line = "Legendary Creature — Jace";
      placeOnBf(state, legend, alice);
      placeOnBf(state, legend, alice);
      placeOnBf(state, legend, bob); // Bob's single copy is legal.

      const violations = findLegendaryViolations(state);

      expect(violations).toHaveLength(1);
      expect(violations[0].controllerId).toBe(alice);
      expect(violations[0].candidateIds).toHaveLength(2);
    });

    it("checkStateBasedActions surfaces exactly one legend choice for Alice", () => {
      const { state, ids } = makeGame();
      const [alice, bob] = ids;
      const legend = mockCreature("Jace, Mock", 1, 1);
      legend.type_line = "Legendary Creature — Jace";
      placeOnBf(state, legend, alice);
      placeOnBf(state, legend, alice);
      placeOnBf(state, legend, bob);

      const result = checkStateBasedActions(state);

      expect(result.state.waitingChoice?.type).toBe(LEGENDARY_CHOICE_TYPE);
      // Bob's battlefield is untouched by the pending choice.
      expect(onBf(result.state, bob)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Planeswalker uniqueness grouping (CR 704.5j)
  // -------------------------------------------------------------------------
  describe("planeswalker uniqueness (CR 704.5j)", () => {
    it("destroys the duplicate when one controller has two same-type planeswalkers", () => {
      const { state, ids } = makeGame(1);
      const a = placeOnBf(state, mockPlaneswalker("Jace One", "Jace"), ids[0]);
      const b = placeOnBf(state, mockPlaneswalker("Jace Two", "Jace"), ids[0]);
      state.cards.get(a)!.counters = [{ type: "loyalty", count: 3 }];
      state.cards.get(b)!.counters = [{ type: "loyalty", count: 3 }];

      const result = checkStateBasedActions(state);

      const bf = onBf(result.state, ids[0]);
      expect(bf).toHaveLength(1);
      expect(bf.includes(a) || bf.includes(b)).toBe(true);
    });

    it("keeps both planeswalkers of different types", () => {
      const { state, ids } = makeGame(1);
      const a = placeOnBf(state, mockPlaneswalker("Jace", "Jace"), ids[0]);
      const b = placeOnBf(
        state,
        mockPlaneswalker("Chandra", "Chandra"),
        ids[0],
      );
      state.cards.get(a)!.counters = [{ type: "loyalty", count: 3 }];
      state.cards.get(b)!.counters = [{ type: "loyalty", count: 3 }];

      const result = checkStateBasedActions(state);

      const bf = onBf(result.state, ids[0]);
      expect(bf).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency / stability
  // -------------------------------------------------------------------------
  describe("checkStateBasedActions stability", () => {
    it("a second pass over a settled board performs no further actions", () => {
      const { state, ids } = makeGame(1);
      const id = placeOnBf(state, mockCreature("Doomed", 3, 3), ids[0]);
      state.cards.get(id)!.counters = [{ type: "-1/-1", count: 3 }];

      const first = checkStateBasedActions(state);
      expect(first.actionsPerformed).toBe(true);

      const second = checkStateBasedActions(first.state);
      expect(second.actionsPerformed).toBe(false);
      // Battlefield identity is stable across the second (no-op) pass.
      expect(onBf(second.state, ids[0])).toEqual(onBf(first.state, ids[0]));
    });
  });

  // -------------------------------------------------------------------------
  // canDraw boundary
  // -------------------------------------------------------------------------
  describe("canDraw boundary", () => {
    it("returns false for an empty library and true for a non-empty one", () => {
      const { state, ids } = makeGame();
      const libKey = `${ids[0]}-library`;
      const before = state.zones.get(libKey)!.cardIds.length;

      expect(canDraw(state, ids[0])).toBe(before > 0);

      state.zones.set(libKey, {
        ...state.zones.get(libKey)!,
        cardIds: [],
      });
      expect(canDraw(state, ids[0])).toBe(false);
    });
  });
});
