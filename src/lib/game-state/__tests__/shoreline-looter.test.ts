/**
 * Shoreline Looter (issue #2428): "Whenever this creature deals combat damage
 * to a player, draw a card. Then discard a card unless there are seven or more
 * cards in your graveyard."
 */
import { describe, it, expect } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { resolveCombatDamage } from "../combat/resolution";
import { resolveTopOfStack } from "../spell-casting/resolve";
import { parseTriggeredAbilities } from "../oracle-text-parser/abilities";
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

const LOOTER_TEXT =
  "This creature can't be blocked.\nThreshold \u2014 Whenever this creature deals combat damage to a player, draw a card. Then discard a card unless there are seven or more cards in your graveyard.";

const looter = (): ScryfallCard =>
  makeCard({
    id: "shoreline-looter",
    name: "Shoreline Looter",
    type_line: "Creature \u2014 Rat Rogue",
    oracle_text: LOOTER_TEXT,
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
    power: "1",
    toughness: "1",
  });

const filler = (id: string): ScryfallCard =>
  makeCard({ id, name: "Filler", type_line: "Instant", oracle_text: "" });

function putInZone(
  state: GameState,
  playerId: PlayerId,
  zone: "graveyard" | "library",
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const card = createCardInstance(filler(`${zone}-${i}`), playerId, playerId);
    card.currentZoneKey = `${playerId}-${zone}`;
    state.cards.set(card.id, card);
    const z = state.zones.get(`${playerId}-${zone}`)!;
    state.zones.set(`${playerId}-${zone}`, {
      ...z,
      cardIds: [...z.cardIds, card.id],
    });
  }
}

const zoneSize = (state: GameState, key: string): number =>
  state.zones.get(key)?.cardIds.length ?? 0;

/** Alice attacks Bob with an unblocked Shoreline Looter. */
function attackWithLooter(graveyardCards: number) {
  const { state, aliceId, bobId } = makeFixture();
  // Clear starting hand/library so counts are exact.
  for (const z of ["hand", "library", "graveyard"]) {
    const key = `${aliceId}-${z}`;
    state.zones.set(key, { ...state.zones.get(key)!, cardIds: [] });
  }
  putInZone(state, aliceId, "library", 3);
  putInZone(state, aliceId, "graveyard", graveyardCards);
  putInHand(state, aliceId, filler("hand-card"));
  const attacker = putOnBattlefield(state, aliceId, looter(), { tapped: true });
  state.turn.currentPhase = Phase.COMBAT_DAMAGE;
  state.combat = {
    ...state.combat,
    inCombatPhase: true,
    attackers: [
      {
        cardId: attacker.id,
        defenderId: bobId,
        isAttackingPlaneswalker: false,
        damageToDeal: 1,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ],
    blockers: new Map(),
  };
  return { state, aliceId, bobId, looterId: attacker.id };
}

describe("Shoreline Looter combat-damage trigger (#2428)", () => {
  it("parses a self combat-damage-to-a-player trigger and keeps the Then rider", () => {
    const [ability] = parseTriggeredAbilities(LOOTER_TEXT);
    expect(ability.trigger.event).toBe("dealsCombatDamageToPlayer");
    expect(ability.effect.toLowerCase()).toContain("draw a card");
    expect(ability.effect.toLowerCase()).toContain("then discard a card");
  });

  it("does not treat 'a creature you control' as a self trigger", () => {
    const [ability] = parseTriggeredAbilities(
      "Whenever a creature you control deals combat damage to a player, draw a card.",
    );
    expect(ability.trigger.event).not.toBe("dealsCombatDamageToPlayer");
  });

  it("puts the trigger on the stack after unblocked damage to a player", () => {
    const { state, bobId, looterId } = attackWithLooter(0);
    const result = resolveCombatDamage(state);
    expect(result.success).toBe(true);
    expect(result.state.players.get(bobId)!.life).toBe(19);
    expect(result.state.stack).toHaveLength(1);
    expect(result.state.stack[0].sourceCardId).toBe(looterId);
  });

  it("draws then discards when below threshold", () => {
    const { state, aliceId } = attackWithLooter(2);
    let s = resolveCombatDamage(state).state;
    s = resolveTopOfStack(s);
    expect(s.stack).toHaveLength(0);
    expect(zoneSize(s, `${aliceId}-library`)).toBe(2);
    expect(zoneSize(s, `${aliceId}-hand`)).toBe(1);
    expect(zoneSize(s, `${aliceId}-graveyard`)).toBe(3);
  });

  it("draws without discarding at threshold (seven or more in graveyard)", () => {
    const { state, aliceId } = attackWithLooter(7);
    let s = resolveCombatDamage(state).state;
    s = resolveTopOfStack(s);
    expect(zoneSize(s, `${aliceId}-library`)).toBe(2);
    expect(zoneSize(s, `${aliceId}-hand`)).toBe(2);
    expect(zoneSize(s, `${aliceId}-graveyard`)).toBe(7);
  });

  it("does not trigger when the attacker is blocked", () => {
    const { state, bobId, looterId } = attackWithLooter(0);
    const blocker = putOnBattlefield(
      state,
      bobId,
      makeCard({ id: "wall", name: "Wall", power: "0", toughness: "4" }),
    );
    state.combat.blockers.set(looterId, [
      {
        cardId: blocker.id,
        attackerId: looterId,
        damageToDeal: 0,
        blockerOrder: 0,
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ]);
    const result = resolveCombatDamage(state);
    expect(result.state.stack).toHaveLength(0);
  });
});
