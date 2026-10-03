/**
 * Channel ability word (issue #2300): Action News Crew.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  channelCard,
  parseChannel,
  parseChannelEffect,
} from "../keyword-actions";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
} from "../types";
import type { ScryfallCard } from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Creature — Test",
    oracle_text: "",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
    ...overrides,
  } as ScryfallCard;
}

const actionNewsCrew = (): ScryfallCard =>
  makeCard({
    id: "action-news-crew",
    name: "Action News Crew",
    type_line: "Creature — Human Citizen",
    oracle_text:
      "Vigilance\nChannel — {6}, Discard this card: Put a +1/+1 counter on each creature you control. Draw a card.",
    mana_cost: "{1}{W}",
    cmc: 2,
    colors: ["W"],
    power: "2",
    toughness: "2",
  });

const bear = (id: string): ScryfallCard =>
  makeCard({ id, name: "Bear", power: "2", toughness: "2" });

const rock = (id: string): ScryfallCard =>
  makeCard({
    id,
    name: "Rock",
    type_line: "Artifact",
    power: undefined,
    toughness: undefined,
  });

// ---------------------------------------------------------------------------
// Shared state scaffolding
// ---------------------------------------------------------------------------

interface Fixture {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function makeFixture(): Fixture {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);

  const ids = Array.from(state.players.keys());
  const aliceId = ids[0];
  const bobId = ids[1];

  state.status = "in_progress";
  state.priorityPlayerId = aliceId;
  state.turn.activePlayerId = aliceId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

  return { state, aliceId, bobId };
}

/**
 * Place a permanent on a player's battlefield. Default: untapped, NO summoning
 * sickness (mirrors the prowess fixture — convoke does not interact with
 * summoning sickness per CR 302.6, but tests that care about the flag can
 * pass `summoningSick: true`).
 */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { tapped?: boolean; summoningSick?: boolean } = {},
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = opts.summoningSick ?? false;
  card.isTapped = opts.tapped ?? false;
  card.currentZoneKey = `${playerId}-battlefield`;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card;
}

/** Place a card into a player's hand. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-hand`;
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

function putInLibrary(state: GameState, playerId: PlayerId, n: number) {
  for (let i = 0; i < n; i++) {
    const c = createCardInstance(bear(`lib-${i}`), playerId, playerId);
    c.currentZoneKey = `${playerId}-library`;
    state.cards.set(c.id, c);
    const lib = state.zones.get(`${playerId}-library`)!;
    state.zones.set(`${playerId}-library`, {
      ...lib,
      cardIds: [...lib.cardIds, c.id],
    });
  }
}

const plusOne = (state: GameState, id: CardInstanceId) =>
  state.cards.get(id)!.counters.find((c) => c.type === "+1/+1")?.count ?? 0;

describe("Channel — parsing", () => {
  it("parses Action News Crew's cost and effect", () => {
    const info = parseChannel(actionNewsCrew().oracle_text!);
    expect(info).toEqual({
      cost: "{6}",
      effect: "Put a +1/+1 counter on each creature you control. Draw a card.",
    });
    expect(parseChannelEffect(info!.effect)).toEqual([
      { kind: "counterEachYourCreature", counterType: "+1/+1", count: 1 },
      { kind: "draw", count: 1 },
    ]);
    expect(parseChannel("Vigilance")).toBeNull();
    expect(parseChannelEffect("Destroy target creature.")).toBeNull();
  });
});

describe("Channel — activation", () => {
  it("pays {6}, discards the card, counters your creatures and draws", () => {
    const fx = makeFixture();
    let state = fx.state;
    const me = fx.aliceId;
    const b1 = putOnBattlefield(state, me, bear("b1"));
    const b2 = putOnBattlefield(state, me, bear("b2"));
    const art = putOnBattlefield(state, me, rock("r1"));
    const theirs = putOnBattlefield(state, fx.bobId, bear("ob"));
    putInLibrary(state, me, 3);
    const crewId = putInHand(state, me, actionNewsCrew());
    state = addMana(state, me, { generic: 6 });
    const handBefore = state.zones.get(`${me}-hand`)!.cardIds.length;

    const r = channelCard(state, me, crewId);
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    expect(plusOne(r.state, b1.id)).toBe(1);
    expect(plusOne(r.state, b2.id)).toBe(1);
    expect(plusOne(r.state, art.id)).toBe(0);
    expect(plusOne(r.state, theirs.id)).toBe(0);
    expect(r.state.zones.get(`${me}-graveyard`)!.cardIds).toContain(crewId);
    // Discarded one, drew one.
    expect(r.state.zones.get(`${me}-hand`)!.cardIds.length).toBe(handBefore);
    expect(r.state.zones.get(`${me}-hand`)!.cardIds).not.toContain(crewId);
  });

  it("can be activated on an opponent's turn (no timing restriction)", () => {
    const fx = makeFixture();
    let state = fx.state;
    putInLibrary(state, fx.bobId, 2);
    const crewId = putInHand(state, fx.bobId, actionNewsCrew());
    state = addMana(state, fx.bobId, { generic: 6 });
    state = { ...state, priorityPlayerId: fx.bobId };
    expect(state.turn.activePlayerId).toBe(fx.aliceId);
    const r = channelCard(state, fx.bobId, crewId);
    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
  });

  it("rejects without enough mana, from the battlefield, or without priority", () => {
    const fx = makeFixture();
    let state = fx.state;
    const me = fx.aliceId;
    putInLibrary(state, me, 2);
    const crewId = putInHand(state, me, actionNewsCrew());
    state = addMana(state, me, { generic: 5 });
    const poor = channelCard(state, me, crewId);
    expect(poor.success).toBe(false);
    expect(poor.error).toMatch(/Not enough mana/);
    expect(poor.state.zones.get(`${me}-hand`)!.cardIds).toContain(crewId);

    const onField = putOnBattlefield(state, me, actionNewsCrew());
    expect(channelCard(state, me, onField.id).error).toMatch(/from your hand/);

    state = addMana(state, me, { generic: 1 });
    state = { ...state, priorityPlayerId: fx.bobId };
    expect(channelCard(state, me, crewId).error).toMatch(/priority/);
  });
});
