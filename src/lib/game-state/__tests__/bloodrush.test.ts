/**
 * Bloodrush (CR 702.103, issue #2951): the bloodrush ability word — an
 * activated ability from hand that discards the card and pumps a target
 * attacking creature until end of turn.
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import {
  activateBloodrush,
  hasBloodrush,
  parseBloodrush,
} from "../keyword-actions";
import { getEffectivePower, getEffectiveToughness } from "../evergreen-keywords";
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

/** A 4/4 creature with a bloodrush ability. */
const bloodrushCard = (): ScryfallCard =>
  makeCard({
    id: "bloodrush-4-4",
    name: "Bloodrush Brute",
    type_line: "Creature — Beast",
    oracle_text:
      "Bloodrush — {2}{B}, Discard this card: Target creature gets +4/+4 until end of turn.",
    mana_cost: "{3}{B}",
    cmc: 4,
    colors: ["B"],
    power: "4",
    toughness: "4",
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
  state.turn.currentPhase = Phase.DECLARE_BLOCKERS;
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
): CardInstance {
  const card = createCardInstance(cardData, playerId, playerId);
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

/** Alice attacks Bob with `attacker`; blockers are declared (none). */
function declareAttack(
  state: GameState,
  attacker: CardInstance,
  defenderId: PlayerId,
): void {
  state.combat = {
    ...state.combat,
    inCombatPhase: true,
    attackers: [
      {
        cardId: attacker.id,
        defenderId,
        isAttackingPlaneswalker: false,
        damageToDeal: 2,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ],
    blockers: new Map(),
  };
}

describe("Bloodrush — parsing", () => {
  it("parses the bloodrush cost and ignores cards without it", () => {
    expect(parseBloodrush(bloodrushCard().oracle_text!)).toBe("{2}{B}");
    expect(hasBloodrush(bloodrushCard().oracle_text!)).toBe(true);
    expect(parseBloodrush("Vigilance")).toBeNull();
    expect(parseBloodrush("")).toBeNull();
    expect(hasBloodrush(bear("b").oracle_text!)).toBe(false);
  });
});

describe("Bloodrush — activation", () => {
  it("pays the cost, discards the card and pumps the attacking target", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const cardId = putInHand(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 2, black: 1 });

    const result = activateBloodrush(withMana, me, cardId, attacker.id);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const after = result.state;
    // The discarded card is in the graveyard and no longer in hand.
    expect(after.zones.get(`${me}-graveyard`)!.cardIds).toContain(cardId);
    expect(after.zones.get(`${me}-hand`)!.cardIds).not.toContain(cardId);
    // The 2/2 attacker is now a 6/6 until end of turn.
    expect(getEffectivePower(after.cards.get(attacker.id)!)).toBe(6);
    expect(getEffectiveToughness(after.cards.get(attacker.id)!)).toBe(6);
  });

  it("rejects a card that is not in hand", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const onField = putOnBattlefield(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 2, black: 1 });

    const result = activateBloodrush(withMana, me, onField.id, attacker.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/from your hand/);
    expect(result.state).toBe(withMana);
  });

  it("rejects without priority", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const cardId = putInHand(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 2, black: 1 });
    const noPriority = { ...withMana, priorityPlayerId: fx.bobId };

    const result = activateBloodrush(noPriority, me, cardId, attacker.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/priority/);
    expect(result.state).toBe(noPriority);
  });

  it("rejects a target that is not attacking", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const idle = putOnBattlefield(state, me, bear("bear-idle"));
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const cardId = putInHand(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 2, black: 1 });

    const result = activateBloodrush(withMana, me, cardId, idle.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not attacking/);
    expect(result.state).toBe(withMana);
  });

  it("rejects a target that is not a creature", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const stone = putOnBattlefield(state, me, rock("rock-a"));
    const cardId = putInHand(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 2, black: 1 });

    const result = activateBloodrush(withMana, me, cardId, stone.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a creature/);
    expect(result.state).toBe(withMana);
  });

  it("rejects an unaffordable cost and leaves the state unchanged", () => {
    const fx = makeFixture();
    const state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const cardId = putInHand(state, me, bloodrushCard());
    const withMana = addMana(state, me, { generic: 1 });

    const result = activateBloodrush(withMana, me, cardId, attacker.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not enough mana/);
    expect(result.state).toBe(withMana);
    expect(result.state.zones.get(`${me}-hand`)!.cardIds).toContain(cardId);
    expect(getEffectivePower(result.state.cards.get(attacker.id)!)).toBe(2);
  });

  it("expires at the end of the turn", () => {
    const fx = makeFixture();
    let state = fx.state;
    const me = fx.aliceId;
    const attacker = putOnBattlefield(state, me, bear("bear-a"));
    declareAttack(state, attacker, fx.bobId);
    const cardId = putInHand(state, me, bloodrushCard());
    state = addMana(state, me, { generic: 2, black: 1 });

    const result = activateBloodrush(state, me, cardId, attacker.id);
    expect(result.success).toBe(true);
    state = result.state;
    expect(getEffectivePower(state.cards.get(attacker.id)!)).toBe(6);

    // Advance past the cleanup step into the next turn: the until-end-of-turn
    // pump is cleared by the engine's existing cleanup handling.
    for (let i = 0; i < 20; i++) {
      if (state.turn.currentPhase === Phase.UNTAP) break;
      state = passPriority(state, state.priorityPlayerId!);
    }
    expect(state.turn.currentPhase).toBe(Phase.UNTAP);
    expect(getEffectivePower(state.cards.get(attacker.id)!)).toBe(2);
    expect(getEffectiveToughness(state.cards.get(attacker.id)!)).toBe(2);
  });
});
