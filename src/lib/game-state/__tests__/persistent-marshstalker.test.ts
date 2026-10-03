/**
 * Persistent Marshstalker (issue #2428): "This creature gets +1/+0 for each
 * other Rat you control. Threshold — Whenever you attack with one or more
 * Rats, if there are seven or more cards in your graveyard, you may pay
 * {2}{B}. If you do, return this card from your graveyard to the battlefield
 * tapped and attacking."
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { declareAttackers } from "../combat/declaration";
import { refreshTribalAnthems } from "../keyword-actions/tribal-anthem";
import { getEffectivePower } from "../evergreen-keywords";
import { parseAttackReturn } from "../keyword-actions/attack-return";
import { resolveWaitingChoice } from "../spell-casting/choices";
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

const MARSHSTALKER_TEXT =
  "This creature gets +1/+0 for each other Rat you control.\nThreshold \u2014 Whenever you attack with one or more Rats, if there are seven or more cards in your graveyard, you may pay {2}{B}. If you do, return this card from your graveyard to the battlefield tapped and attacking.";

const marshstalker = (): ScryfallCard =>
  makeCard({
    id: "persistent-marshstalker",
    name: "Persistent Marshstalker",
    type_line: "Creature \u2014 Rat Berserker",
    oracle_text: MARSHSTALKER_TEXT,
    mana_cost: "{1}{B}",
    cmc: 2,
    colors: ["B"],
    power: "3",
    toughness: "1",
  });

const rat = (id: string): ScryfallCard =>
  makeCard({ id, name: "Rat", type_line: "Creature \u2014 Rat", power: "1" });

const bear = (): ScryfallCard =>
  makeCard({ id: "bear", name: "Bear", type_line: "Creature \u2014 Bear" });

function putInGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-graveyard`;
  state.cards.set(card.id, card);
  const gy = state.zones.get(`${playerId}-graveyard`)!;
  state.zones.set(`${playerId}-graveyard`, {
    ...gy,
    cardIds: [...gy.cardIds, card.id],
  });
  return card.id;
}

function fillGraveyard(state: GameState, playerId: PlayerId, n: number) {
  for (let i = 0; i < n; i++) {
    putInGraveyard(
      state,
      playerId,
      makeCard({ id: `gy-${i}`, name: "Filler", type_line: "Instant" }),
    );
  }
}

function giveMana(state: GameState, playerId: PlayerId, black: number, c = 0) {
  const p = state.players.get(playerId)!;
  state.players.set(playerId, {
    ...p,
    manaPool: { ...p.manaPool, black, colorless: c },
  });
}

function attack(
  state: GameState,
  attackerIds: CardInstanceId[],
  defenderId: PlayerId,
): GameState {
  state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
  const res = declareAttackers(
    state,
    attackerIds.map((cardId) => ({ cardId, defenderId })),
  );
  expect(res.success).toBe(true);
  return res.state;
}

describe("Persistent Marshstalker", () => {
  it("parses the graveyard attack return", () => {
    expect(parseAttackReturn(MARSHSTALKER_TEXT)).toEqual({
      subtype: "Rat",
      minGraveyard: 7,
      cost: "{2}{B}",
    });
  });

  it("gets +1/+0 for each other Rat you control, not other types or opponents' Rats", () => {
    const { state, aliceId, bobId } = makeFixture();
    const ms = putOnBattlefield(state, aliceId, marshstalker());
    putOnBattlefield(state, aliceId, rat("r1"));
    putOnBattlefield(state, aliceId, rat("r2"));
    putOnBattlefield(state, aliceId, bear());
    putOnBattlefield(state, bobId, rat("r3"));
    const next = refreshTribalAnthems(state);
    const card = next.cards.get(ms.id)!;
    expect(getEffectivePower(card)).toBe(5);
    expect(card.tribalAnthemPT?.toughness ?? 0).toBe(0);
  });

  it("offers the return when you attack with a Rat at threshold, and paying puts it in tapped and attacking", () => {
    const { state, aliceId, bobId } = makeFixture();
    const attacker = putOnBattlefield(state, aliceId, rat("r1"));
    const msId = putInGraveyard(state, aliceId, marshstalker());
    fillGraveyard(state, aliceId, 6);
    giveMana(state, aliceId, 1, 2);

    let next = attack(state, [attacker.id], bobId);
    expect(next.waitingChoice?.type).toBe("attack_return_offer");
    expect(next.waitingChoice?.playerId).toBe(aliceId);

    const res = resolveWaitingChoice(next, aliceId, `pay:${msId}`);
    expect(res.success).toBe(true);
    next = res.state;
    expect(next.waitingChoice).toBeNull();
    expect(next.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(msId);
    expect(next.zones.get(`${aliceId}-graveyard`)!.cardIds).not.toContain(msId);
    expect(next.cards.get(msId)!.isTapped).toBe(true);
    const entry = next.combat.attackers.find((a) => a.cardId === msId);
    expect(entry?.defenderId).toBe(bobId);
    const pool = next.players.get(aliceId)!.manaPool;
    expect(pool.black).toBe(0);
    expect(pool.colorless).toBe(0);
  });

  it("declining leaves it in the graveyard and spends nothing", () => {
    const { state, aliceId, bobId } = makeFixture();
    const attacker = putOnBattlefield(state, aliceId, rat("r1"));
    const msId = putInGraveyard(state, aliceId, marshstalker());
    fillGraveyard(state, aliceId, 6);
    giveMana(state, aliceId, 3);

    const next = attack(state, [attacker.id], bobId);
    const res = resolveWaitingChoice(next, aliceId, [`decline:${msId}`]);
    expect(res.success).toBe(true);
    expect(res.state.waitingChoice).toBeNull();
    expect(res.state.zones.get(`${aliceId}-graveyard`)!.cardIds).toContain(
      msId,
    );
    expect(res.state.players.get(aliceId)!.manaPool.black).toBe(3);
  });

  it("does not trigger below threshold or without an attacking Rat", () => {
    const below = makeFixture();
    const r = putOnBattlefield(below.state, below.aliceId, rat("r1"));
    putInGraveyard(below.state, below.aliceId, marshstalker());
    fillGraveyard(below.state, below.aliceId, 5);
    expect(attack(below.state, [r.id], below.bobId).waitingChoice).toBeFalsy();

    const noRat = makeFixture();
    const b = putOnBattlefield(noRat.state, noRat.aliceId, bear());
    putInGraveyard(noRat.state, noRat.aliceId, marshstalker());
    fillGraveyard(noRat.state, noRat.aliceId, 6);
    expect(attack(noRat.state, [b.id], noRat.bobId).waitingChoice).toBeFalsy();
  });

  it("can't pay without black mana", () => {
    const { state, aliceId, bobId } = makeFixture();
    const attacker = putOnBattlefield(state, aliceId, rat("r1"));
    const msId = putInGraveyard(state, aliceId, marshstalker());
    fillGraveyard(state, aliceId, 6);
    giveMana(state, aliceId, 0, 5);

    const next = attack(state, [attacker.id], bobId);
    const pay = next.waitingChoice!.choices.find(
      (c) => c.value === `pay:${msId}`,
    );
    expect(pay?.isValid).toBe(false);
    expect(resolveWaitingChoice(next, aliceId, `pay:${msId}`).success).toBe(
      false,
    );
  });
});
