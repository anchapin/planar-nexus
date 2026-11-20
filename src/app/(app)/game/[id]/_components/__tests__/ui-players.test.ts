import { describe, it, expect } from "@jest/globals";
import {
  createCardInstance,
  createInitialGameState,
  startGame,
} from "@/lib/game-state";
import type { CardInstance, GameState, ScryfallCard } from "@/lib/game-state";
import { buildUiPlayers, type UiPlayer } from "../ui-players";

/**
 * Issue #2918: `buildUiPlayers` must reproduce the old inline derivation's
 * values exactly while reusing references for everything unchanged, so the
 * memoized `PlayerArea` comparator (reference equality on zone arrays) can
 * actually bail out.
 */

function createMockCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: "mock-card-1",
    name: "Test Card",
    type_line: "Creature — Human",
    oracle_text: "",
    mana_cost: "{1}{W}",
    cmc: 2,
    colors: ["W"],
    color_identity: ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** Return a new state with `instance` placed in `playerId`'s `zone`. */
function withCardInZone(
  state: GameState,
  playerId: string,
  zone: string,
  instance: CardInstance,
): GameState {
  const cards = new Map(state.cards);
  cards.set(instance.id, instance);
  const zones = new Map(state.zones);
  const key = `${playerId}-${zone}`;
  const existing = zones.get(key)!;
  zones.set(key, { ...existing, cardIds: [...existing.cardIds, instance.id] });
  return { ...state, cards, zones };
}

interface Fixture {
  state: GameState;
  aliceId: string;
  bobId: string;
  creature: CardInstance;
  handCard: CardInstance;
  graveyardCard: CardInstance;
}

function makeFixture(): Fixture {
  let state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
  const [aliceId, bobId] = Array.from(state.players.keys());

  const creature = createCardInstance(
    createMockCard({ id: "alice-creature-data", name: "Alice Creature" }),
    aliceId,
    aliceId,
    { id: "alice-creature" },
  );
  const handCard = createCardInstance(
    createMockCard({ id: "alice-hand-data", name: "Alice Hand Card" }),
    aliceId,
    aliceId,
    { id: "alice-hand-card" },
  );
  const graveyardCard = createCardInstance(
    createMockCard({ id: "bob-gy-data", name: "Bob Graveyard Card" }),
    bobId,
    bobId,
    { id: "bob-graveyard-card" },
  );

  state = withCardInZone(state, aliceId, "battlefield", creature);
  state = withCardInZone(state, aliceId, "hand", handCard);
  state = withCardInZone(state, bobId, "graveyard", graveyardCard);

  return { state, aliceId, bobId, creature, handCard, graveyardCard };
}

function byId(players: UiPlayer[], id: string): UiPlayer {
  return players.find((p) => p.id === id)!;
}

describe("buildUiPlayers (#2918 structural sharing)", () => {
  it("(a) same state in -> identical array, player, zone and card-view references out", () => {
    const { state } = makeFixture();
    const first = buildUiPlayers(state, undefined, "Alice");
    const second = buildUiPlayers(state, first, "Alice");

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[0].battlefield).toBe(first[0].battlefield);
    expect(second[0].battlefield[0]).toBe(first[0].battlefield[0]);
  });

  it("(b) tapping one card rebuilds only that player, that zone and that card view", () => {
    const { state, aliceId, bobId, creature } = makeFixture();
    const first = buildUiPlayers(state, undefined, "Alice");

    const tappedState: GameState = {
      ...state,
      cards: new Map(state.cards).set(creature.id, {
        ...creature,
        isTapped: true,
      }),
    };
    const next = buildUiPlayers(tappedState, first, "Alice");

    const firstAlice = byId(first, aliceId);
    const nextAlice = byId(next, aliceId);
    expect(next).not.toBe(first);
    expect(nextAlice).not.toBe(firstAlice);
    expect(nextAlice.battlefield).not.toBe(firstAlice.battlefield);
    expect(nextAlice.battlefield[0]).not.toBe(firstAlice.battlefield[0]);
    expect(nextAlice.battlefield[0].tapped).toBe(true);
    // Untouched zones of the same player keep their references.
    expect(nextAlice.hand).toBe(firstAlice.hand);
    expect(nextAlice.graveyard).toBe(firstAlice.graveyard);
    // The other player is completely untouched.
    expect(byId(next, bobId)).toBe(byId(first, bobId));
  });

  it("(c) a life-total-only change rebuilds the player object but reuses every zone array", () => {
    const { state, aliceId, bobId } = makeFixture();
    const first = buildUiPlayers(state, undefined, "Alice");

    const alice = state.players.get(aliceId)!;
    const hurtState: GameState = {
      ...state,
      players: new Map(state.players).set(aliceId, { ...alice, life: 17 }),
    };
    const next = buildUiPlayers(hurtState, first, "Alice");

    const firstAlice = byId(first, aliceId);
    const nextAlice = byId(next, aliceId);
    expect(nextAlice).not.toBe(firstAlice);
    expect(nextAlice.lifeTotal).toBe(17);
    expect(nextAlice.hand).toBe(firstAlice.hand);
    expect(nextAlice.battlefield).toBe(firstAlice.battlefield);
    expect(nextAlice.graveyard).toBe(firstAlice.graveyard);
    expect(nextAlice.exile).toBe(firstAlice.exile);
    expect(nextAlice.library).toBe(firstAlice.library);
    expect(byId(next, bobId)).toBe(byId(first, bobId));
  });

  it("(d) values and ordering match the pre-change derivation (local player last)", () => {
    const { state, aliceId, bobId, creature, handCard, graveyardCard } =
      makeFixture();

    const players = buildUiPlayers(state, undefined, "Bob");
    expect(players.map((p) => p.name)).toEqual(["Alice", "Bob"]);

    const alice = byId(players, aliceId);
    expect(alice.lifeTotal).toBe(20);
    expect(alice.poisonCounters).toBe(0);
    expect(alice.battlefield.map((c) => c.id)).toEqual([creature.id]);
    expect(alice.hand.map((c) => c.id)).toEqual([handCard.id]);
    expect(alice.commandZone).toEqual([]);

    const view = alice.battlefield[0];
    expect(view.card).toBe(creature.cardData);
    expect(view.zone).toBe("battlefield");
    expect(view.playerId).toBe(aliceId);
    expect(view.tapped).toBe(false);
    expect(view.faceDown).toBe(false);

    const bob = byId(players, bobId);
    expect(bob.graveyard.map((c) => c.id)).toEqual([graveyardCard.id]);

    // commanderDamage is one shared frozen object, not a fresh {} per player.
    expect(alice.commanderDamage).toBe(bob.commanderDamage);
    expect(Object.isFrozen(alice.commanderDamage)).toBe(true);

    // Without a local player name the engine's iteration order is kept.
    const unsorted = buildUiPlayers(state, undefined);
    expect(unsorted.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });
});
