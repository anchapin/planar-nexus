/**
 * Wave 4.8 follow-up 6 lane 72 — X-spent-on-creature-spells
 * (creature payment) (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * with the "tap a creature you control rather than pay the
 * generic portion of this spell's cost" pattern (Llawan,
 * War Tax — the "spend this mana only on creature spells" /
 * "creature spells cost {1} more to cast" family). The v1
 * minimum adds a `creature_payment: { creature_only: true,
 * generic: number }` arm on the existing `additionalCosts`
 * object (parallel to lane 69's `mana_restriction`).
 *
 * Schema (card-scripts/schema.ts, CardScriptSchema):
 *   `additionalCosts.creature_payment: { creature_only:
 *   true, generic: number }` — v1 enforces `creature_only
 *   === true` (no shape variants in v1) and `generic >= 1`.
 *   The engine reads the field at cast time and auto-applies
 *   the creature payment when the player can't pay the
 *   printed cost but CAN tap `generic` untapped creatures
 *   they control. The deduction happens by collecting the
 *   creatures, reducing `totalGeneric` by `generic`, and
 *   tapping the creatures in the post-spend step. The
 *   per-instance `creaturePayment` field on the StackObject
 *   carries the same shape so resolve-time effects can
 *   reference it.
 *
 * Engine:
 *   `castSpell` (spell-casting/cast.ts) reads the
 *   `creature_payment` field, validates that the player has
 *   at least `generic` untapped creatures they control, and
 *   reduces the generic total. The cast path pushes
 *   `"creature_payment"` to `alternativeCostsUsed` and stamps
 *   `creaturePayment` on the StackObject. The cast fails
 *   ("Not enough energy (mana) available...") if the player
 *   can't pay the cost under either path.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71
 * pattern).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { castSpell, canCastSpell } from "../spell-casting/cast";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Creature Payment (lane 72)";

const SCRIPT_CREATURE_PAYMENT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Destroy target creature. (You may tap an untapped creature you control rather than pay the generic portion of this spell's cost.)",
  spell: [{ op: "Draw", amount: 1 }],
  additionalCosts: {
    creature_payment: {
      creature_only: true,
      generic: 1,
    },
  },
});

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Instant",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}{B}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ["B"],
    color_identity: overrides.color_identity ?? ["B"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeCreature(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-creature-${overrides.id}`,
    name: overrides.name ?? "Mock Grizzly Bears",
    type_line: overrides.type_line ?? "Creature — Bear",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}{G}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ["G"],
    color_identity: overrides.color_identity ?? ["G"],
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return {
    state,
    aliceId: playerIds[0],
    bobId: playerIds[1],
  };
}

function addCardToHand(
  state: GameState,
  playerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-card-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, playerId, playerId, {
    id: cardId,
    currentZoneKey: `${playerId}-hand`,
  });
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const handKey = `${playerId}-hand`;
  const hand = newZones.get(handKey);
  if (!hand) throw new Error("hand zone not found");
  newZones.set(handKey, { ...hand, cardIds: [...hand.cardIds, cardId] });
  const nextState: GameState = {
    ...state,
    cards: newCards,
    zones: newZones,
    lastModifiedAt: Date.now(),
  };
  return {
    state: {
      ...nextState,
      turn: {
        ...nextState.turn,
        activePlayerId: playerId,
        currentPhase: Phase.PRECOMBAT_MAIN,
      },
      priorityPlayerId: playerId,
      stack: [],
      status: "in_progress",
    },
    cardId,
  };
}

/**
 * Add a creature to a player's battlefield (untapped by default).
 */
function addCreatureToBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardDef: ScryfallCard,
  tapped: boolean = false,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-card-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, playerId, playerId, {
    id: cardId,
    currentZoneKey: `${playerId}-battlefield`,
  });
  // If `tapped` is requested, mutate the card's `isTapped`.
  const cardWithTapped: typeof card = tapped
    ? { ...card, isTapped: true }
    : card;
  const newCards = new Map(state.cards);
  newCards.set(cardId, cardWithTapped);
  const newZones = new Map(state.zones);
  const bfKey = `${playerId}-battlefield`;
  const bf = newZones.get(bfKey);
  if (!bf) throw new Error("battlefield zone not found");
  newZones.set(bfKey, { ...bf, cardIds: [...bf.cardIds, cardId] });
  return {
    state: {
      ...state,
      cards: newCards,
      zones: newZones,
      lastModifiedAt: Date.now(),
    },
    cardId,
  };
}

describe("Wave 4.8 follow-up 6 lane 72 — creature payment", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_CREATURE_PAYMENT]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script that declares creature_only: false (v1 requires true)", () => {
    // Schema guard: the v1 minimum requires `creature_only:
    // true`; a follow-up lane could add a multi-shape variant.
    expect(() =>
      CardScriptSchema.parse({
        name: "Creature payment false guard (lane 72)",
        oracle: "test",
        spell: [{ op: "Draw", amount: 1 }],
        additionalCosts: {
          creature_payment: { creature_only: false, generic: 1 },
        },
      }),
    ).toThrow();
  });

  it("rejects the script when generic is zero (v1 generic >= 1)", () => {
    // Schema-level guard: zero generic is rejected.
    expect(() =>
      CardScriptSchema.parse({
        name: "Zero generic (lane 72)",
        oracle: "test",
        spell: [{ op: "Draw", amount: 1 }],
        additionalCosts: {
          creature_payment: { creature_only: true, generic: 0 },
        },
      }),
    ).toThrow();
  });

  it("accepts the v1 single-creature-payment arm on the additionalCosts slot", () => {
    // Sanity check on the schema: the script is parseable and
    // carries the creature payment on `additionalCosts.creature_payment`.
    const parsed = CardScriptSchema.parse(SCRIPT_CREATURE_PAYMENT);
    expect(parsed.additionalCosts?.creature_payment).toEqual({
      creature_only: true,
      generic: 1,
    });
  });

  it("can cast normally with 1B in the pool (printed cost {1}{B} is payable)", () => {
    // The creature payment is a *permissive* alternative, not
    // a forced path: when the player has enough mana for the
    // printed cost, the engine pays the printed cost and does
    // NOT stamp `creaturePayment` on the StackObject. The
    // `"creature_payment"` entry must NOT appear in
    // `alternativeCostsUsed` either.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { black: 1, generic: 1 });
    const cardDef = makeCard({ id: "normal-b-pay" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const canCast = canCastSpell(withCard, aliceId, cardId);
    expect(canCast.canCast).toBe(true);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const stackObject = result.state.stack.at(-1);
    expect(stackObject).toBeDefined();
    expect(stackObject?.alternativeCostsUsed ?? []).not.toContain(
      "creature_payment",
    );
    expect(stackObject?.creaturePayment).toBeUndefined();
    // The pool after the cast is drained of both black + generic.
    const finalPool = result.state.players.get(aliceId)?.manaPool;
    expect(finalPool?.black).toBe(0);
    expect(finalPool?.generic).toBe(0);
  });

  it("applies the creature payment when the player has 1 black + 0 generic + 1 untapped creature", () => {
    // Player has 1 black in the pool (covers the B pip)
    // and 0 generic. They control 1 untapped Grizzly
    // Bears. The printed cost {1}{B} needs 1 black + 1
    // generic. Without the creature payment, the cast
    // fails (not enough generic). With the creature
    // payment, the engine taps the creature to cover the
    // generic 1.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { black: 1 });
    // Add an untapped creature to the battlefield.
    const creature = makeCreature({ id: "untapped-bear" });
    s = addCreatureToBattlefield(s, aliceId, creature).state;
    const cardDef = makeCard({ id: "creature-pay-untapped" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const canCast = canCastSpell(withCard, aliceId, cardId);
    expect(canCast.canCast).toBe(true);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const stackObject = result.state.stack.at(-1);
    expect(stackObject).toBeDefined();
    expect(stackObject?.alternativeCostsUsed).toContain("creature_payment");
    expect(stackObject?.creaturePayment).toEqual({
      generic: 1,
      tappedCreatures: expect.arrayContaining([expect.any(String)]),
    });
    // The creature is now tapped.
    const tappedCreatureId = stackObject?.creaturePayment?.tappedCreatures[0];
    expect(tappedCreatureId).toBeDefined();
    const finalCreature = result.state.cards.get(tappedCreatureId!);
    expect(finalCreature?.isTapped).toBe(true);
  });

  it("fails when the player has 0 black AND 0 generic AND 1 untapped creature (B pip can't be paid)", () => {
    // Player has 0 black, 0 generic, but 1 untapped
    // creature. The creature payment covers the generic,
    // but the spell also needs 1 black pip which the
    // player doesn't have. Cast fails.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    const creature = makeCreature({ id: "no-black-but-creature" });
    s = addCreatureToBattlefield(s, aliceId, creature).state;
    const cardDef = makeCard({ id: "creature-cant-pay-black" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Not enough colored mana/);
    // The creature is still untapped (not affected by
    // the failed cast).
    const creatureId = Array.from(result.state.cards.values()).find(
      (c) => c.controllerId === aliceId,
    )?.id;
    const finalCreature = result.state.cards.get(creatureId!);
    expect(finalCreature?.isTapped).toBe(false);
  });

  it("applies the creature payment alongside B (player has B but no generic; taps a creature for the 1)", () => {
    // Player has 1 black in the pool but no generic. Printed
    // cost {1}{B} needs 1 black + 1 generic. The creature
    // payment kicks in: tap a creature to pay the generic 1.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    s = addMana(s, aliceId, { black: 1 });
    const creature = makeCreature({ id: "untapped-bear-mixed" });
    s = addCreatureToBattlefield(s, aliceId, creature).state;
    const cardDef = makeCard({ id: "creature-pay-mixed" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const stackObject = result.state.stack.at(-1);
    expect(stackObject?.alternativeCostsUsed).toContain("creature_payment");
    expect(stackObject?.creaturePayment?.generic).toBe(1);
    // The black pip is drained from the pool.
    const finalPool = result.state.players.get(aliceId)?.manaPool;
    expect(finalPool?.black).toBe(0);
  });

  it("fails when the player has 0 mana AND 0 untapped creatures", () => {
    // No mana + no creatures = cast fails. The colored
    // mana check (1 black pip required, 0 black in pool)
    // fires first with "Not enough colored mana" — the
    // creature payment can only cover the generic, not
    // the colored pip.
    const { state, aliceId } = setupTwoPlayerGame();
    const cardDef = makeCard({ id: "no-mana-no-creatures" });
    const { state: withCard, cardId } = addCardToHand(state, aliceId, cardDef);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Not enough colored mana/);
  });

  it("fails when the player has only a tapped creature (cannot tap for cost)", () => {
    // Player has 0 mana + 1 tapped creature. Tapping a
    // tapped creature is not allowed, so the creature
    // payment can't be applied and the cast fails. The
    // colored-mana check fires first because 0 black is
    // in the pool.
    const { state, aliceId } = setupTwoPlayerGame();
    let s = state;
    const creature = makeCreature({ id: "tapped-bear" });
    s = addCreatureToBattlefield(s, aliceId, creature, /* tapped */ true).state;
    const cardDef = makeCard({ id: "tapped-creature-only" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Not enough colored mana/);
  });

  it("does not tap an opponent's creature (must be controlled by the caster)", () => {
    // Bob has an untapped creature; Alice has no mana and
    // no creatures. The creature payment requires Alice to
    // tap one of HER creatures; Bob's creature is invalid.
    // The colored-mana check fires first (Alice has 0
    // black).
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    let s = state;
    const creature = makeCreature({ id: "opponent-bear" });
    s = addCreatureToBattlefield(s, bobId, creature).state;
    const cardDef = makeCard({ id: "opponent-only-creature" });
    const { state: withCard, cardId } = addCardToHand(s, aliceId, cardDef);

    const result = castSpell(withCard, aliceId, cardId);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/Not enough colored mana/);
    // Bob's creature is still untapped (not affected by
    // the failed cast).
    const bobCreatureId = Array.from(s.cards.values()).find(
      (c) => c.controllerId === bobId,
    )?.id;
    const finalBobCreature = result.state.cards.get(bobCreatureId!);
    expect(finalBobCreature?.isTapped).toBe(false);
  });
});
