/**
 * Ninjutsu (issue #2300): Kaito, Bane of Nightmares.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance, isCreature } from "../card-instance";
import { addMana } from "../mana";
import {
  activateNinjutsu,
  parseNinjutsu,
  parseTurnCreatureForm,
  refreshTurnCreatureForms,
} from "../keyword-actions";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { hasHexproofStrict } from "../keyword-actions/hexproof";
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

describe("parsing", () => {
  it("reads Kaito's ninjutsu cost and turn creature form", () => {
    expect(parseNinjutsu(KAITO_TEXT)).toBe("{1}{U}{B}");
    expect(parseTurnCreatureForm(KAITO_TEXT)).toEqual({
      power: 3,
      toughness: 4,
      subtype: "Ninja",
      hexproof: true,
    });
    expect(parseNinjutsu("Flying")).toBeNull();
  });
});

describe("activateNinjutsu", () => {
  it("swaps an unblocked attacker for Kaito, tapped and attacking as a 3/4", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    const state = addMana(fx.state, fx.aliceId, {
      generic: 1,
      blue: 1,
      black: 1,
    });

    const result = activateNinjutsu(state, fx.aliceId, kaitoId, attacker.id);
    expect(result.success).toBe(true);
    const s = result.state;

    expect(s.zones.get(`${fx.aliceId}-hand`)!.cardIds).toContain(attacker.id);
    expect(s.zones.get(`${fx.aliceId}-battlefield`)!.cardIds).toContain(
      kaitoId,
    );
    const k = s.cards.get(kaitoId)!;
    expect(k.isTapped).toBe(true);
    expect(k.counters.find((c) => c.type === "loyalty")?.count).toBe(4);
    expect(isCreature(k)).toBe(true);
    expect(getEffectivePower(k)).toBe(3);
    expect(getEffectiveToughness(k)).toBe(4);
    expect(hasHexproofStrict(k)).toBe(true);

    expect(s.combat.attackers.map((a) => a.cardId)).toEqual([kaitoId]);
    expect(s.combat.attackers[0].defenderId).toBe(fx.bobId);
    expect(s.combat.attackers[0].damageToDeal).toBe(3);
  });

  it("rejects a blocked attacker", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx, true);
    const state = addMana(fx.state, fx.aliceId, {
      generic: 1,
      blue: 1,
      black: 1,
    });
    const result = activateNinjutsu(state, fx.aliceId, kaitoId, attacker.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked/);
  });

  it("rejects activation before blockers are declared", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    fx.state.turn.currentPhase = Phase.DECLARE_ATTACKERS;
    const state = addMana(fx.state, fx.aliceId, {
      generic: 1,
      blue: 1,
      black: 1,
    });
    const result = activateNinjutsu(state, fx.aliceId, kaitoId, attacker.id);
    expect(result.success).toBe(false);
  });

  it("rejects activation without enough mana and leaves state unchanged", () => {
    const fx = makeFixture();
    const { attacker, kaitoId } = inBlockersStep(fx);
    const state = addMana(fx.state, fx.aliceId, { generic: 3 });
    const result = activateNinjutsu(state, fx.aliceId, kaitoId, attacker.id);
    expect(result.success).toBe(false);
    expect(result.state).toBe(state);
  });
});

describe("refreshTurnCreatureForms", () => {
  it("makes Kaito a creature only on his controller's turn", () => {
    const fx = makeFixture();
    const card = putOnBattlefield(fx.state, fx.aliceId, kaito());
    card.counters = [{ type: "loyalty", count: 4 }];

    let s = refreshTurnCreatureForms(fx.state);
    expect(isCreature(s.cards.get(card.id)!)).toBe(true);

    s.turn = { ...s.turn, activePlayerId: fx.bobId };
    s = refreshTurnCreatureForms(s);
    const k = s.cards.get(card.id)!;
    expect(isCreature(k)).toBe(false);
    expect(hasHexproofStrict(k)).toBe(false);
  });

  it("is not a creature with no loyalty counters", () => {
    const fx = makeFixture();
    const card = putOnBattlefield(fx.state, fx.aliceId, kaito());
    card.counters = [];
    const s = refreshTurnCreatureForms(fx.state);
    expect(isCreature(s.cards.get(card.id)!)).toBe(false);
    expect(s).toBe(fx.state);
  });
});
