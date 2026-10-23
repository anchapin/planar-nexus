/**
 * Damage to Kaito while he is both a creature and a planeswalker (issue #2484).
 *
 * CR 120.3: damage dealt to an object that is both a creature and a
 * planeswalker is BOTH marked on it (as a creature) AND removes that many
 * loyalty counters (as a planeswalker). State-based actions then check both
 * consequences: lethal marked damage vs toughness (704.5g) and zero loyalty
 * (704.5i).
 *
 * The damage pipeline (dealDamageToCard) already applied both results; the
 * bug was that card-instance getPower/getToughness read the printed face —
 * a planeswalker face has no P/T — so a turn-creature-form permanent read
 * as 0/0 and the lethal-damage SBA destroyed Kaito on ANY marked damage.
 * getPower/getToughness now honour turnCreatureForm, mirroring
 * getPowerValue/getToughnessValue in evergreen-keywords.ts.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import {
  createCardInstance,
  getPower,
  getToughness,
  hasLethalDamage,
  isCreature,
} from "../card-instance";
import { addMana } from "../mana";
import {
  activateNinjutsu,
  dealDamageToCard,
  refreshTurnCreatureForms,
} from "../keyword-actions";
import { resolveCombatDamage } from "../combat";
import { checkStateBasedActions } from "../state-based-actions";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstance,
  CardInstanceId,
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

function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
  opts: { tapped?: boolean } = {},
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = false;
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
  "Ninjutsu {1}{U}{B} ({1}{U}{B}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.)\nDuring your turn, as long as Kaito has one or more loyalty counters on him, he's a 3/4 Ninja creature and has hexproof.";

const kaito = (): ScryfallCard =>
  makeCard({
    id: "kaito-bane-of-nightmares",
    name: "Kaito, Bane of Nightmares",
    type_line: "Legendary Planeswalker — Kaito",
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

/** Kaito on Alice's battlefield, in creature form on her turn, 4 loyalty. */
function dualKaito(fx: Fixture, loyalty = 4): CardInstance {
  const card = putOnBattlefield(fx.state, fx.aliceId, kaito());
  card.counters = [{ type: "loyalty", count: loyalty }];
  const s = refreshTurnCreatureForms(fx.state);
  const k = s.cards.get(card.id)!;
  expect(isCreature(k)).toBe(true);
  return k;
}

function loyaltyOf(card: CardInstance): number {
  return card.counters?.find((c) => c.type === "loyalty")?.count ?? 0;
}

describe("dual creature/planeswalker P/T (CR 120.3 plumbing)", () => {
  it("reads power/toughness from the turn creature form, not the planeswalker face", () => {
    const fx = makeFixture();
    const k = dualKaito(fx);
    expect(getPower(k)).toBe(3);
    expect(getToughness(k)).toBe(4);
    expect(hasLethalDamage(k)).toBe(false);
  });
});

describe("damage to dual-type Kaito", () => {
  it("noncombat damage marks damage AND removes loyalty; he survives the SBA", () => {
    const fx = makeFixture();
    const k = dualKaito(fx);

    const res = dealDamageToCard(fx.state, k.id, 2, false);
    const after = res.state.cards.get(k.id)!;
    expect(after.damage).toBe(2);
    expect(loyaltyOf(after)).toBe(2);

    const sba = checkStateBasedActions(res.state);
    expect(sba.state.zones.get(`${fx.aliceId}-battlefield`)!.cardIds).toContain(
      k.id,
    );
    expect(
      sba.state.zones.get(`${fx.aliceId}-graveyard`)!.cardIds,
    ).not.toContain(k.id);
    expect(sba.state.zones.get(`${fx.aliceId}-exile`)!.cardIds).not.toContain(
      k.id,
    );
  });

  it("lethal marked damage destroys him as a creature (704.5g), before loyalty runs out", () => {
    const fx = makeFixture();
    const k = dualKaito(fx, 5);

    const res = dealDamageToCard(fx.state, k.id, 4, false);
    const after = res.state.cards.get(k.id)!;
    expect(after.damage).toBe(4);
    expect(loyaltyOf(after)).toBe(1);

    const sba = checkStateBasedActions(res.state);
    expect(sba.state.zones.get(`${fx.aliceId}-graveyard`)!.cardIds).toContain(
      k.id,
    );
    expect(
      sba.state.zones.get(`${fx.aliceId}-battlefield`)!.cardIds,
    ).not.toContain(k.id);
  });

  it("zero loyalty exiles him (704.5i) even when the damage is not lethal", () => {
    const fx = makeFixture();
    const k = dualKaito(fx, 1);

    const res = dealDamageToCard(fx.state, k.id, 1, false);
    const after = res.state.cards.get(k.id)!;
    expect(after.damage).toBe(1);
    expect(loyaltyOf(after)).toBe(0);

    const sba = checkStateBasedActions(res.state);
    expect(sba.state.zones.get(`${fx.aliceId}-exile`)!.cardIds).toContain(k.id);
    expect(
      sba.state.zones.get(`${fx.aliceId}-graveyard`)!.cardIds,
    ).not.toContain(k.id);
  });

  it("combat damage to Kaito after ninjutsu applies both results and he survives", () => {
    const fx = makeFixture();
    const { state, aliceId, bobId } = fx;

    // Alice attacks Bob with an unblocked bear, then ninjutsus Kaito in.
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
    const kaitoId = putInHand(state, aliceId, kaito());
    const withMana = addMana(state, aliceId, {
      generic: 1,
      blue: 1,
      black: 1,
    });
    const ninjutsu = activateNinjutsu(withMana, aliceId, kaitoId, attacker.id);
    expect(ninjutsu.success).toBe(true);
    const s = ninjutsu.state;
    const k = s.cards.get(kaitoId)!;
    expect(isCreature(k)).toBe(true);
    expect(loyaltyOf(k)).toBe(4);

    // Bob blocks the ninjutsu'd Kaito with a 2/2 bear.
    const blocker = putOnBattlefield(s, bobId, bear("bear-b"));
    s.combat.blockers.set(kaitoId, [
      {
        cardId: blocker.id,
        attackerId: kaitoId,
        damageToDeal: 2,
        blockerOrder: 0,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ]);
    s.turn.currentPhase = Phase.COMBAT_DAMAGE;

    const combat = resolveCombatDamage(s);
    const after = combat.state.cards.get(kaitoId)!;
    // Both CR 120.3 results from the same combat damage event:
    expect(after.damage).toBe(2);
    expect(loyaltyOf(after)).toBe(2);

    const sba = checkStateBasedActions(combat.state);
    // 2 marked damage is not lethal to a 3/4 and loyalty is 2: Kaito stays.
    expect(sba.state.zones.get(`${aliceId}-battlefield`)!.cardIds).toContain(
      kaitoId,
    );
    // Kaito's own 3 power was lethal to the 2/2 blocker.
    expect(sba.state.zones.get(`${bobId}-graveyard`)!.cardIds).toContain(
      blocker.id,
    );
  });
});

describe("single-type regression", () => {
  it("an ordinary creature only marks damage and survives below lethal", () => {
    const fx = makeFixture();
    const b = putOnBattlefield(fx.state, fx.aliceId, bear("bear-a"));

    const res = dealDamageToCard(fx.state, b.id, 1, false);
    const after = res.state.cards.get(b.id)!;
    expect(after.damage).toBe(1);
    expect(after.counters ?? []).toHaveLength(0);

    const sba = checkStateBasedActions(res.state);
    expect(sba.state.zones.get(`${fx.aliceId}-battlefield`)!.cardIds).toContain(
      b.id,
    );
  });

  it("an ordinary planeswalker (not a creature) loses loyalty and is not destroyed by damage", () => {
    const fx = makeFixture();
    // Kaito on Bob's turn: no creature form, planeswalker only.
    fx.state.turn.activePlayerId = fx.bobId;
    const card = putOnBattlefield(fx.state, fx.aliceId, kaito());
    card.counters = [{ type: "loyalty", count: 4 }];
    const s = refreshTurnCreatureForms(fx.state);
    const k = s.cards.get(card.id)!;
    expect(isCreature(k)).toBe(false);

    const res = dealDamageToCard(s, k.id, 2, false);
    const after = res.state.cards.get(k.id)!;
    expect(loyaltyOf(after)).toBe(2);

    const sba = checkStateBasedActions(res.state);
    expect(sba.state.zones.get(`${fx.aliceId}-battlefield`)!.cardIds).toContain(
      k.id,
    );
    expect(
      sba.state.zones.get(`${fx.aliceId}-graveyard`)!.cardIds,
    ).not.toContain(k.id);
  });
});
