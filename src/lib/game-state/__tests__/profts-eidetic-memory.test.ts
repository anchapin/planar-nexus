/**
 * Proft's Eidetic Memory (issue #2428): "When Proft's Eidetic Memory enters,
 * draw a card. You have no maximum hand size. At the beginning of combat on
 * your turn, if you've drawn more than one card this turn, put X +1/+1
 * counters on target creature you control, where X is the number of cards
 * you've drawn this turn minus one."
 */
import { describe, it, expect } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
  passPriority,
  drawCard,
} from "../game-state";
import { createCardInstance } from "../card-instance";
import { drawCards } from "../keyword-actions/draw";
import {
  cardsDrawnThisTurn,
  detectBeginningOfCombatTriggers,
  drawnMoreThanThreshold,
  parseCountersFromDraws,
} from "../keyword-actions/cards-drawn";
import { getTriggeredAbilitiesFromCard } from "../trigger-system/types";
import { resolveTopOfStack } from "../spell-casting/resolve";
import { Phase } from "../types";
import type { GameState, PlayerId, CardInstance } from "../types";
import type { ScryfallCard } from "../types";

const PROFT_TEXT =
  "When Proft's Eidetic Memory enters, draw a card.\nYou have no maximum hand size.\nAt the beginning of combat on your turn, if you've drawn more than one card this turn, put X +1/+1 counters on target creature you control, where X is the number of cards you've drawn this turn minus one.";

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

function proft(): ScryfallCard {
  return makeCard({
    id: "proft",
    name: "Proft's Eidetic Memory",
    type_line: "Legendary Enchantment",
    oracle_text: PROFT_TEXT,
    mana_cost: "{1}{U}",
    cmc: 2,
    power: undefined,
    toughness: undefined,
  });
}

function seedLibrary(state: GameState, playerId: PlayerId, n: number): void {
  const key = `${playerId}-library`;
  const lib = state.zones.get(key)!;
  const ids = [...lib.cardIds];
  for (let i = 0; i < n; i++) {
    const c = createCardInstance(
      makeCard({ id: `lib-${playerId}-${i}`, name: `Filler ${i}` }),
      playerId,
      playerId,
    );
    c.currentZoneKey = key;
    state.cards.set(c.id, c);
    ids.push(c.id);
  }
  state.zones.set(key, { ...lib, cardIds: ids });
}

function setDrawn(state: GameState, playerId: PlayerId, n: number): void {
  const p = state.players.get(playerId)!;
  state.players.set(playerId, { ...p, cardsDrawnThisTurn: n });
}

function toBeginCombat(
  state: GameState,
  aliceId: PlayerId,
  bobId: PlayerId,
): GameState {
  let s = passPriority(state, aliceId);
  s = passPriority(s, bobId);
  return s;
}

function plusCounters(card: CardInstance | undefined): number {
  return card?.counters.find((c) => c.type === "+1/+1")?.count ?? 0;
}

describe("Proft's Eidetic Memory (#2428)", () => {
  it("parses the beginning-of-combat trigger with its intervening if", () => {
    const combat = getTriggeredAbilitiesFromCard(proft()).find(
      (a) => a.trigger.event === "beginningOfCombat",
    );
    expect(combat).toBeDefined();
    expect(combat!.interveningIf).toMatch(
      /drawn more than one card this turn/i,
    );
    expect(drawnMoreThanThreshold(combat!.interveningIf!)).toBe(1);
    expect(
      parseCountersFromDraws(combat!.effect.toLowerCase(), "p" as PlayerId),
    ).toEqual({ offset: -1, playerId: "p" });
  });

  it("counts draws from every draw path", () => {
    const { state, aliceId } = makeFixture();
    seedLibrary(state, aliceId, 5);
    const before = cardsDrawnThisTurn(state, aliceId);
    const afterKeyword = drawCards(state, aliceId, 2).state;
    expect(cardsDrawnThisTurn(afterKeyword, aliceId)).toBe(before + 2);
    const afterTurnDraw = drawCard(afterKeyword, aliceId);
    expect(cardsDrawnThisTurn(afterTurnDraw, aliceId)).toBe(before + 3);
  });

  it("puts X = drawn - 1 counters on your best creature at beginning of combat", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, aliceId, proft());
    const small = putOnBattlefield(
      state,
      aliceId,
      makeCard({ id: "s", name: "Small", power: "1", toughness: "1" }),
    );
    const big = putOnBattlefield(
      state,
      aliceId,
      makeCard({ id: "b", name: "Big", power: "3", toughness: "3" }),
    );
    setDrawn(state, aliceId, 3);

    let s = toBeginCombat(state, aliceId, bobId);
    expect(s.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0].targets[0]?.targetId).toBe(big.id);

    s = resolveTopOfStack(s);
    expect(s.stack).toHaveLength(0);
    expect(plusCounters(s.cards.get(big.id))).toBe(2);
    expect(plusCounters(s.cards.get(small.id))).toBe(0);
  });

  it("does not trigger after only one draw", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, aliceId, proft());
    putOnBattlefield(
      state,
      aliceId,
      makeCard({ id: "c", name: "Bear", power: "2", toughness: "2" }),
    );
    setDrawn(state, aliceId, 1);
    const s = toBeginCombat(state, aliceId, bobId);
    expect(s.turn.currentPhase).toBe(Phase.BEGIN_COMBAT);
    expect(s.stack).toHaveLength(0);
  });

  it("only triggers on its controller's turn", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, bobId, proft());
    putOnBattlefield(
      state,
      bobId,
      makeCard({ id: "c", name: "Bear", power: "2", toughness: "2" }),
    );
    setDrawn(state, bobId, 4);
    expect(detectBeginningOfCombatTriggers(state, aliceId)).toHaveLength(0);
    expect(detectBeginningOfCombatTriggers(state, bobId)).toHaveLength(1);
  });

  it("is removed when there is no creature to target", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, aliceId, proft());
    setDrawn(state, aliceId, 3);
    const s = toBeginCombat(state, aliceId, bobId);
    expect(s.stack).toHaveLength(0);
  });

  it("resolving its trigger does not re-run its enters trigger", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, aliceId, proft());
    putOnBattlefield(
      state,
      aliceId,
      makeCard({ id: "c", name: "Bear", power: "2", toughness: "2" }),
    );
    setDrawn(state, aliceId, 2);
    let s = toBeginCombat(state, aliceId, bobId);
    s = resolveTopOfStack(s);
    expect(s.stack).toHaveLength(0);
  });

  it("re-checks the intervening if on resolution (CR 603.4)", () => {
    const { state, aliceId, bobId } = makeFixture();
    putOnBattlefield(state, aliceId, proft());
    const bear = putOnBattlefield(
      state,
      aliceId,
      makeCard({ id: "c", name: "Bear", power: "2", toughness: "2" }),
    );
    setDrawn(state, aliceId, 3);
    let s = toBeginCombat(state, aliceId, bobId);
    expect(s.stack).toHaveLength(1);
    setDrawn(s, aliceId, 1);
    s = resolveTopOfStack(s);
    expect(s.stack).toHaveLength(0);
    expect(plusCounters(s.cards.get(bear.id))).toBe(0);
  });

  it("resets the draw count when the next turn begins", () => {
    const { state, aliceId, bobId } = makeFixture();
    state.turn.currentPhase = Phase.CLEANUP;
    setDrawn(state, aliceId, 4);
    setDrawn(state, bobId, 2);
    const s = passPriority(passPriority(state, aliceId), bobId);
    expect(s.turn.activePlayerId).toBe(bobId);
    expect(cardsDrawnThisTurn(s, aliceId)).toBe(0);
    expect(cardsDrawnThisTurn(s, bobId)).toBe(0);
  });
});
