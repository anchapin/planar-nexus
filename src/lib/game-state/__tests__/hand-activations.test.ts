/**
 * Hand activations (issue #2479, epic #2300): channel and ninjutsu reachable
 * from a real game action, plus the AI's pick.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  activateFromHand,
  chooseAIHandActivation,
  getHandActivations,
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

const KAITO_TEXT =
  'Ninjutsu {1}{U}{B} ({1}{U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nDuring your turn, as long as Kaito has one or more loyalty counters on him, he\'s a 3/4 Ninja creature and has hexproof.\n+1: You get an emblem with "Ninjas you control get +1/+1."\n0: Surveil 2. Then draw a card for each opponent who lost life this turn.\n\u22122: Tap target creature. Put two stun counters on it.';

const kaito = (): ScryfallCard =>
  makeCard({
    id: "kaito-bane-of-nightmares",
    name: "Kaito, Bane of Nightmares",
    type_line: "Legendary Planeswalker \u2014 Kaito",
    oracle_text: KAITO_TEXT,
    mana_cost: "{2}{U}{B}",
    cmc: 4,
    colors: ["U", "B"],
    power: undefined,
    toughness: undefined,
    loyalty: "4",
  } as Partial<ScryfallCard> & { id: string });

const bear = (id: string): ScryfallCard =>
  makeCard({ id, name: "Bear", power: "2", toughness: "2" });

/** Alice attacks Bob with a bear; blockers are declared (none on the bear). */
function inBlockersStep(fx: Fixture, blocked = false) {
  const { state, aliceId, bobId } = fx;
  const attacker = putOnBattlefield(state, aliceId, bear("bear-a"), {
    tapped: true,
  });
  state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
  state.combat = {
    ...state.combat,
    inCombatPhase: true,
    attackers: [
      {
        cardId: attacker.id,
        defenderId: bobId,
        isAttackingPlaneswalker: false,
        damageToDeal: 2,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ],
    blockers: new Map(),
  };
  if (blocked) {
    const blocker = putOnBattlefield(state, bobId, bear("bear-b"));
    state.combat.blockers.set(attacker.id, [
      {
        cardId: blocker.id,
        attackerId: attacker.id,
        damageToDeal: 2,
        blockerOrder: 0,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ]);
  }
  const kaitoId = putInHand(state, aliceId, kaito());
  return { attacker, kaitoId };
}

const actionNewsCrew = (): ScryfallCard =>
  makeCard({
    id: "action-news-crew",
    name: "Action News Crew",
    type_line: "Creature \u2014 Human Citizen",
    oracle_text:
      "Vigilance\nChannel \u2014 {6}, Discard this card: Put a +1/+1 counter on each creature you control. Draw a card.",
    mana_cost: "{1}{W}",
    cmc: 2,
    colors: ["W"],
    power: "2",
    toughness: "2",
  });

const land = (id: string): ScryfallCard =>
  makeCard({
    id,
    name: "Plains",
    type_line: "Basic Land \u2014 Plains",
    mana_cost: "",
    cmc: 0,
    power: undefined,
    toughness: undefined,
  } as Partial<ScryfallCard> & { id: string });

describe("getHandActivations: channel", () => {
  it("offers channel for Action News Crew in hand with priority", () => {
    const fx = makeFixture();
    const id = putInHand(fx.state, fx.aliceId, actionNewsCrew());
    const options = getHandActivations(fx.state, fx.aliceId, id);
    expect(options).toHaveLength(1);
    expect(options[0].kind).toBe("channel");
    expect(options[0].label).toMatch(/^Channel \{6\}/);
  });

  it("offers nothing without priority or outside the hand", () => {
    const fx = makeFixture();
    const id = putInHand(fx.state, fx.aliceId, actionNewsCrew());
    expect(getHandActivations(fx.state, fx.bobId, id)).toEqual([]);
    const onBoard = putOnBattlefield(fx.state, fx.aliceId, actionNewsCrew());
    expect(getHandActivations(fx.state, fx.aliceId, onBoard.id)).toEqual([]);
  });

  it("activateFromHand channels: counters, a draw, the card in the graveyard", () => {
    const fx = makeFixture();
    const bearCard = putOnBattlefield(fx.state, fx.aliceId, bear("bear-a"));
    const id = putInHand(fx.state, fx.aliceId, actionNewsCrew());
    const state = addMana(fx.state, fx.aliceId, { generic: 6 });
    const handBefore = state.zones.get(`${fx.aliceId}-hand`)!.cardIds.length;
    const [option] = getHandActivations(state, fx.aliceId, id);
    const result = activateFromHand(state, fx.aliceId, option);
    expect(result.success).toBe(true);
    const s = result.state;
    expect(s.zones.get(`${fx.aliceId}-graveyard`)!.cardIds).toContain(id);
    // discarded one, drew one
    expect(s.zones.get(`${fx.aliceId}-hand`)!.cardIds.length).toBe(handBefore);
    const counters = s.cards.get(bearCard.id)!.counters;
    expect(counters.find((c) => c.type === "+1/+1")?.count).toBe(1);
  });

  it("activateFromHand fails cleanly without the mana", () => {
    const fx = makeFixture();
    const id = putInHand(fx.state, fx.aliceId, actionNewsCrew());
    const [option] = getHandActivations(fx.state, fx.aliceId, id);
    const result = activateFromHand(fx.state, fx.aliceId, option);
    expect(result.success).toBe(false);
    expect(result.state).toBe(fx.state);
  });
});

describe("getHandActivations: ninjutsu", () => {
  it("offers one option per unblocked attacker after blockers", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    const options = getHandActivations(fx.state, fx.aliceId, kaitoId);
    expect(options).toEqual([
      expect.objectContaining({ kind: "ninjutsu", attackerId: attacker.id }),
    ]);
    expect(options[0].label).toBe("Ninjutsu {1}{U}{B}: return Bear to hand");
  });

  it("offers nothing before blockers are declared", () => {
    const fx = makeFixture();
    const { kaitoId } = inBlockersStep(fx);
    fx.state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    expect(getHandActivations(fx.state, fx.aliceId, kaitoId)).toEqual([]);
  });

  it("activateFromHand puts Kaito in attacking and returns the bear", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    const state = addMana(fx.state, fx.aliceId, {
      generic: 1,
      blue: 1,
      black: 1,
    });
    const [option] = getHandActivations(state, fx.aliceId, kaitoId);
    const result = activateFromHand(state, fx.aliceId, option);
    expect(result.success).toBe(true);
    expect(result.state.combat.attackers.map((a) => a.cardId)).toEqual([
      kaitoId,
    ]);
    expect(result.state.zones.get(`${fx.aliceId}-hand`)!.cardIds).toContain(
      attacker.id,
    );
  });
});

describe("chooseAIHandActivation", () => {
  it("ninjutsus Kaito (3 power) in for a 2-power unblocked attacker", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    const pick = chooseAIHandActivation(fx.state, fx.aliceId);
    expect(pick).toEqual(
      expect.objectContaining({
        kind: "ninjutsu",
        cardId: kaitoId,
        attackerId: attacker.id,
      }),
    );
  });

  it("does not channel a card it can still cast this turn", () => {
    const fx = makeFixture();
    putOnBattlefield(fx.state, fx.aliceId, land("plains-1"));
    putOnBattlefield(fx.state, fx.aliceId, land("plains-2"));
    putInHand(fx.state, fx.aliceId, actionNewsCrew());
    expect(chooseAIHandActivation(fx.state, fx.aliceId)).toBeNull();
  });

  it("channels when the card costs more than its lands", () => {
    const fx = makeFixture();
    putOnBattlefield(fx.state, fx.aliceId, land("plains-1"));
    const id = putInHand(fx.state, fx.aliceId, actionNewsCrew());
    expect(chooseAIHandActivation(fx.state, fx.aliceId)).toEqual(
      expect.objectContaining({ kind: "channel", cardId: id }),
    );
  });
});
