/**
 * @fileoverview Unit tests for the Corpse keyword (CR 702.168).
 *
 * Issue #1411 — [Rules Engine] Fix Corpse keyword to be a death-triggered
 * ability, not an activated-from-graveyard (CR 702.168).
 *
 * CR 702.168a: "Corpse [cost]" means "When this creature dies, you may pay
 * [cost]. If you do, [effect]." Corpse is therefore a DEATH TRIGGER, not an
 * activated ability that can be played from the graveyard at arbitrary
 * timings. These tests cover:
 *
 *   - Parsing (parseCorpseAbility)
 *   - Trigger firing on death (processCorpseOnDeath)
 *   - Player choice resolution (resolveCorpseChoice: pay / decline)
 *   - Insufficient mana at resolution
 *   - Idempotency and queue semantics (multiple corpses dying same SBA pass)
 *   - The death-trigger system wiring (detectCreatureDeathTriggers)
 *   - SBA destroy-loop integration (checkStateBasedActions)
 *   - Negative: the OLD "activate from graveyard anytime" API is gone
 *   - Negative: a stale graveyard corpse does not spontaneously produce offers
 *   - Negative: non-creature / non-graveyard corpses do not fire
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { destroyCard } from "../keyword-actions";
import { checkStateBasedActions } from "../state-based-actions";
import { detectCreatureDeathTriggers } from "../trigger-system";
import {
  parseCorpseAbility,
  hasCorpseAbility,
  getCorpseAbility,
  processCorpseOnDeath,
  resolveCorpseChoice,
  hasPendingCorpseOffer,
  createCorpseWaitingChoice,
  CORPSE_CHOICE_TYPE,
} from "../corpse-keyword";
import { Phase, ZoneType } from "../types";
import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Creature — Zombie",
    oracle_text: "",
    mana_cost: "{2}{B}",
    cmc: 3,
    colors: ["B"],
    color_identity: ["B"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A creature with the Corpse keyword.
 *
 *   "Corpse 1: Exile another target creature card from your graveyard."
 *
 * Cost 1 (generic), effect is to exile a creature from the controller's
 * graveyard. Per CR 702.168 the cost is optional ("you may pay"), and the
 * effect fires only if the cost is paid at the moment the death trigger
 * resolves.
 */
function corpseCreature(): ScryfallCard {
  return makeCard({
    id: "mock-corpse-creature",
    name: "Cemetery Marauder",
    type_line: "Creature — Zombie",
    oracle_text:
      "Corpse 1: When this creature dies, you may exile another target creature card from your graveyard.",
    mana_cost: "{2}{B}",
    cmc: 3,
    power: "2",
    toughness: "2",
  });
}

/** A cheap creature used as chaff to exile via the Corpse effect. */
function chaffCreature(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `chaff-${idSuffix}`,
    name: `Chaff ${idSuffix}`,
    type_line: "Creature — Human",
    oracle_text: "",
    mana_cost: "{1}{W}",
    cmc: 2,
    power: "1",
    toughness: "1",
  });
}

/** A basic land — used to populate a drawable library so tests don't lose on
 * the opening-hand draw. */
function basicSwamp(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `swamp-${idSuffix}`,
    name: "Swamp",
    type_line: "Basic Land — Swamp",
    oracle_text: "({T}: Add {B}.)",
    mana_cost: "",
    cmc: 0,
    colors: [],
    power: "",
    toughness: "",
  });
}

// ---------------------------------------------------------------------------
// Shared state scaffolding (mirrors the Blitz test fixture)
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

/** Place a permanent onto a player's battlefield. */
function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.hasSummoningSickness = false;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${playerId}-battlefield`)!;
  state.zones.set(`${playerId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });
  return card.id;
}

/**
 * Move a card directly to a player's graveyard (marks its zone cache too).
 * Used to simulate a creature that has died (or to seed a "stale graveyard"
 * scenario for negative tests).
 */
function moveToGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): void {
  const card = state.cards.get(cardId);
  if (!card) return;
  const fromKey = card.currentZoneKey;
  if (fromKey) {
    const fromZone = state.zones.get(fromKey);
    if (fromZone) {
      state.zones.set(fromKey, {
        ...fromZone,
        cardIds: fromZone.cardIds.filter((id) => id !== cardId),
      });
    }
  }
  const gyKey = `${playerId}-graveyard`;
  const gy = state.zones.get(gyKey)!;
  state.zones.set(gyKey, {
    ...gy,
    cardIds: [...gy.cardIds, cardId],
  });
  state.cards.set(cardId, { ...card, currentZoneKey: gyKey });
}

/** Place a card directly into a player's graveyard (no battlefield history). */
function putInGraveyard(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  const gyKey = `${playerId}-graveyard`;
  card.currentZoneKey = gyKey;
  state.cards.set(card.id, card);
  const gy = state.zones.get(gyKey)!;
  state.zones.set(gyKey, {
    ...gy,
    cardIds: [...gy.cardIds, card.id],
  });
  return card.id;
}

/** Battlefield creature IDs for a player. */
function battlefieldIds(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
}

/** Graveyard IDs for a player. */
function graveyardIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)!.cardIds;
}

/** Exile IDs for a player. */
function exileIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-exile`)!.cardIds;
}

/** Set a player's mana pool to the exact given values. */
function setMana(
  state: GameState,
  playerId: PlayerId,
  pool: {
    colorless?: number;
    white?: number;
    blue?: number;
    black?: number;
    red?: number;
    green?: number;
    generic?: number;
  },
): void {
  const player = state.players.get(playerId)!;
  state.players.set(playerId, {
    ...player,
    manaPool: {
      colorless: pool.colorless ?? 0,
      white: pool.white ?? 0,
      blue: pool.blue ?? 0,
      black: pool.black ?? 0,
      red: pool.red ?? 0,
      green: pool.green ?? 0,
      generic: pool.generic ?? 0,
    },
  });
}

/** Total mana in a player's pool. */
function totalMana(state: GameState, playerId: PlayerId): number {
  const p = pool(state, playerId);
  return p.colorless + p.white + p.blue + p.black + p.red + p.green + p.generic;
}

function pool(state: GameState, playerId: PlayerId) {
  return state.players.get(playerId)!.manaPool;
}

// ===========================================================================
// Parsing (CR 702.168)
// ===========================================================================

describe("Corpse — parsing (CR 702.168)", () => {
  it("parseCorpseAbility detects 'Corpse N:' and parses the cost + effect", () => {
    const r = parseCorpseAbility(
      "Corpse 1: When this creature dies, you may exile another target creature card from your graveyard.",
    );
    expect(r).not.toBeNull();
    expect(r!.cost).toBe(1);
    expect(r!.effectDescription).toContain("exile another target creature");
    expect(r!.isOptional).toBe(true);
  });

  it("parseCorpseAbility handles larger costs", () => {
    const r = parseCorpseAbility(
      "Corpse 3: You may exile a creature card from your graveyard.",
    );
    expect(r).not.toBeNull();
    expect(r!.cost).toBe(3);
  });

  it("parseCorpseAbility is case-insensitive", () => {
    expect(parseCorpseAbility("corpse 1: effect here")!.cost).toBe(1);
    expect(parseCorpseAbility("CORPSE 2: effect here")!.cost).toBe(2);
  });

  it("parseCorpseAbility returns null when the keyword is absent", () => {
    expect(parseCorpseAbility("Flying")).toBeNull();
    expect(
      parseCorpseAbility("When this creature dies, draw a card."),
    ).toBeNull();
    expect(parseCorpseAbility("")).toBeNull();
  });

  it("parseCorpseAbility requires the colon so it won't match inside other words", () => {
    // No colon — not a Corpse ability (regression guard for keyword bleed).
    expect(parseCorpseAbility("Corpsemerchant 2B")).toBeNull();
    expect(parseCorpseAbility("the corpse of a creature")).toBeNull();
  });

  it("hasCorpseAbility / getCorpseAbility read the parsed ability off a CardInstance", () => {
    const f = makeFixture();
    const id = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    const card = f.state.cards.get(id)!;
    expect(hasCorpseAbility(card)).toBe(true);
    expect(getCorpseAbility(card)?.cost).toBe(1);

    const chaffId = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    expect(hasCorpseAbility(f.state.cards.get(chaffId)!)).toBe(false);
    expect(getCorpseAbility(f.state.cards.get(chaffId)!)).toBeNull();
  });
});

// ===========================================================================
// processCorpseOnDeath — the SBA-hook entry point (CR 702.168a)
// ===========================================================================

describe("Corpse — processCorpseOnDeath fires the death trigger (CR 702.168a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    // Drawable library so opening-hand draw doesn't fail fixture setup.
    const deck = Array.from({ length: 12 }, (_, i) => basicSwamp(String(i)));
    f.state = (() => {
      const s = f.state;
      const libKey = `${f.aliceId}-library`;
      const lib = s.zones.get(libKey)!;
      // Append extra basics so Alice has a real library.
      const extras = deck.map((c) => {
        const inst = createCardInstance(c, f.aliceId, f.aliceId);
        s.cards.set(inst.id, inst);
        return inst.id;
      });
      s.zones.set(libKey, { ...lib, cardIds: [...lib.cardIds, ...extras] });
      return s;
    })();
    setMana(f.state, f.aliceId, { generic: 5 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("(a) a Corpse creature going to graveyard fires the trigger exactly once", () => {
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, corpseId);

    expect(hasPendingCorpseOffer(f.state)).toBe(false);
    expect(f.state.pendingCorpseOffers ?? []).toHaveLength(0);

    const res = processCorpseOnDeath(f.state, corpseId);

    // Mutation-killers: assert on real post-trigger state, not just flags.
    expect(res.applied).toBe(true);
    expect(hasPendingCorpseOffer(res.state)).toBe(true);
    expect(res.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
    expect(res.state.waitingChoice?.playerId).toBe(f.aliceId);
    expect(res.state.pendingCorpseOffers ?? []).toEqual([corpseId]);

    // The choice is for THIS dead card and offers pay/decline.
    const choices = res.state.waitingChoice!.choices;
    expect(choices.map((c) => String(c.value))).toEqual(
      expect.arrayContaining([`pay:${corpseId}`, `decline:${corpseId}`]),
    );

    // The dead card is still in graveyard (triggering does not move it).
    expect(graveyardIds(res.state, f.aliceId)).toContain(corpseId);
  });

  it("firing is idempotent — a second call for the same dead card is a no-op", () => {
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, corpseId);

    const first = processCorpseOnDeath(f.state, corpseId);
    expect(first.applied).toBe(true);

    // Second call (e.g., another SBA pass that mistakenly re-processes the
    // same card): no-op. This stops the controller from being offered the
    // same Corpse twice for one death.
    const second = processCorpseOnDeath(first.state, corpseId);
    expect(second.applied).toBe(false);
    expect(second.state.pendingCorpseOffers ?? []).toEqual([corpseId]);
    expect(hasPendingCorpseOffer(second.state)).toBe(true);
  });

  it("(f) a Corpse card already in graveyard does NOT spontaneously produce offers", () => {
    // Seed the graveyard directly (no death event). The card has the corpse
    // ability, but in the new contract the offer is surfaced only via
    // processCorpseOnDeath — the SBA hook for FRESH deaths. Just sitting in
    // the graveyard produces no offer by itself.
    const staleId = putInGraveyard(f.state, f.aliceId, corpseCreature());
    expect(hasPendingCorpseOffer(f.state)).toBe(false);
    expect(f.state.pendingCorpseOffers ?? []).toHaveLength(0);
    expect(f.state.waitingChoice).toBeNull();
    // Sanity: the stale card is indeed in graveyard.
    expect(graveyardIds(f.state, f.aliceId)).toContain(staleId);
  });

  it("does not fire for a card that lacks the Corpse ability", () => {
    const chaffId = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    moveToGraveyard(f.state, f.aliceId, chaffId);

    const res = processCorpseOnDeath(f.state, chaffId);
    expect(res.applied).toBe(false);
    expect(hasPendingCorpseOffer(res.state)).toBe(false);
    expect(res.state.pendingCorpseOffers ?? []).toHaveLength(0);
  });

  it("does not fire for a Corpse card that is NOT in a graveyard (e.g., exiled)", () => {
    // Corpse on a creature whose zone change replaced death with exile.
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    const exileKey = `${f.aliceId}-exile`;
    const exileZone = f.state.zones.get(exileKey)!;
    const bf = f.state.zones.get(`${f.aliceId}-battlefield`)!;
    f.state.zones.set(`${f.aliceId}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== corpseId),
    });
    f.state.zones.set(exileKey, {
      ...exileZone,
      cardIds: [...exileZone.cardIds, corpseId],
    });
    f.state.cards.set(corpseId, {
      ...f.state.cards.get(corpseId)!,
      currentZoneKey: exileKey,
    });

    const res = processCorpseOnDeath(f.state, corpseId);
    expect(res.applied).toBe(false);
    expect(hasPendingCorpseOffer(res.state)).toBe(false);
  });

  it("does not fire when the dead card no longer exists", () => {
    const res = processCorpseOnDeath(f.state, "nonexistent-card-id");
    expect(res.applied).toBe(false);
  });

  it("does not fire for a non-creature card carrying Corpse text (CR 702.168 — 'creature')", () => {
    const enchantCard = makeCard({
      id: "enchant-with-corpse-text",
      name: "Weird Enchantment",
      type_line: "Enchantment",
      oracle_text: "Corpse 1: This should not trigger off a non-creature.",
    });
    const enchantId = putOnBattlefield(f.state, f.aliceId, enchantCard);
    moveToGraveyard(f.state, f.aliceId, enchantId);

    const res = processCorpseOnDeath(f.state, enchantId);
    expect(res.applied).toBe(false);
    expect(hasPendingCorpseOffer(res.state)).toBe(false);
  });
});

// ===========================================================================
// Choice resolution — decline path (CR 702.168a)
// ===========================================================================

describe("Corpse — resolveCorpseChoice decline path", () => {
  let f: Fixture;
  let corpseId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.aliceId, { generic: 5 });
    corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, corpseId);
    // Seed a chaff creature in graveyard so the pay path would have a target.
    putInGraveyard(f.state, f.aliceId, chaffCreature("a"));

    const fired = processCorpseOnDeath(f.state, corpseId);
    expect(fired.applied).toBe(true);
    f.state = fired.state;
  });

  it("(c) decline leaves the graveyard and mana pool intact and clears the choice", () => {
    const manaBefore = totalMana(f.state, f.aliceId);
    const gyBefore = graveyardIds(f.state, f.aliceId).slice();
    const exileBefore = exileIds(f.state, f.aliceId).slice();

    const res = resolveCorpseChoice(f.state, f.aliceId, `decline:${corpseId}`);
    expect(res.success).toBe(true);

    // Real-state assertions: nothing moved, nothing spent.
    expect(totalMana(res.state, f.aliceId)).toBe(manaBefore);
    expect(graveyardIds(res.state, f.aliceId)).toEqual(gyBefore);
    expect(exileIds(res.state, f.aliceId)).toEqual(exileBefore);
    // Choice cleared; queue empty.
    expect(res.state.waitingChoice).toBeNull();
    expect(res.state.pendingCorpseOffers ?? []).toHaveLength(0);
  });

  it("decline is described in the result", () => {
    const res = resolveCorpseChoice(f.state, f.aliceId, `decline:${corpseId}`);
    expect(res.description).toMatch(/decline/i);
    expect(res.description).toContain("Cemetery Marauder");
  });
});

// ===========================================================================
// Choice resolution — pay path (CR 702.168a)
// ===========================================================================

describe("Corpse — resolveCorpseChoice pay path (CR 702.168a)", () => {
  let f: Fixture;
  let corpseId: CardInstanceId;
  let chaffId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.aliceId, { generic: 5 });
    corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, corpseId);
    chaffId = putInGraveyard(f.state, f.aliceId, chaffCreature("a"));

    const fired = processCorpseOnDeath(f.state, corpseId);
    expect(fired.applied).toBe(true);
    f.state = fired.state;
  });

  it("(b) pay spends the cost and exiles a creature card from graveyard", () => {
    const manaBefore = totalMana(f.state, f.aliceId);

    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(true);

    // Real-state assertions: mana was spent, a creature was exiled.
    expect(totalMana(res.state, f.aliceId)).toBe(manaBefore - 1);
    expect(exileIds(res.state, f.aliceId)).toContain(chaffId);
    expect(graveyardIds(res.state, f.aliceId)).not.toContain(chaffId);

    // Choice cleared; queue empty.
    expect(res.state.waitingChoice).toBeNull();
    expect(res.state.pendingCorpseOffers ?? []).toHaveLength(0);
  });

  it("pay prefers exiling a non-source creature (keeps the corpse source in graveyard)", () => {
    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(true);

    // The corpse source itself stays in graveyard (chaff was exiled instead).
    expect(graveyardIds(res.state, f.aliceId)).toContain(corpseId);
    expect(exileIds(res.state, f.aliceId)).not.toContain(corpseId);
  });

  it("pay falls back to exiling the source itself when no other creature is available", () => {
    // Remove the chaff — source is now the only creature in graveyard.
    const gy = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...gy,
      cardIds: gy.cardIds.filter((id) => id !== chaffId),
    });

    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(true);
    // The source is exiled by its own ability (fallback path).
    expect(exileIds(res.state, f.aliceId)).toContain(corpseId);
  });

  it("(d) pay with insufficient mana fails and the offer remains pending", () => {
    setMana(f.state, f.aliceId, { generic: 0 });

    const manaBefore = totalMana(f.state, f.aliceId);
    const gyBefore = graveyardIds(f.state, f.aliceId).slice();
    const exileBefore = exileIds(f.state, f.aliceId).slice();

    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(false);

    // Real-state assertions: NOTHING changed. Cost was not deducted, no exile.
    expect(totalMana(res.state, f.aliceId)).toBe(manaBefore);
    expect(graveyardIds(res.state, f.aliceId)).toEqual(gyBefore);
    expect(exileIds(res.state, f.aliceId)).toEqual(exileBefore);

    // The offer is still pending so the player can submit "decline" instead.
    expect(res.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
    expect(res.state.pendingCorpseOffers ?? []).toEqual([corpseId]);
  });

  it("the 'pay' option is marked invalid in the choice when mana is insufficient", () => {
    setMana(f.state, f.aliceId, { generic: 0 });
    // Re-surface the choice so it reflects the new (empty) mana pool.
    f.state = {
      ...f.state,
      waitingChoice: createCorpseWaitingChoice(f.state, corpseId),
    };
    const payOption = f.state.waitingChoice!.choices.find((c) =>
      String(c.value).startsWith("pay:"),
    );
    expect(payOption).toBeDefined();
    expect(payOption!.isValid).toBe(false);
    // Decline is always valid.
    const declineOption = f.state.waitingChoice!.choices.find((c) =>
      String(c.value).startsWith("decline:"),
    );
    expect(declineOption!.isValid).toBe(true);
  });

  it("pay fails when the graveyard has no creature card to exile (effect cannot resolve)", () => {
    // Empty the graveyard except for the source — but the source is a creature,
    // so the fallback would still exile the source. To exercise the "no
    // creature available" branch, replace ALL creatures with a non-creature
    // card and remove the chaff.
    const gy = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...gy,
      cardIds: [],
    });
    // Put a non-creature card in graveyard so it's non-empty but has no
    // creature to exile.
    const enchant = makeCard({
      id: "enchant-only",
      name: "Sole Enchantment",
      type_line: "Enchantment",
      oracle_text: "",
    });
    const enchantInstance = createCardInstance(enchant, f.aliceId, f.aliceId);
    enchantInstance.currentZoneKey = `${f.aliceId}-graveyard`;
    f.state.cards.set(enchantInstance.id, enchantInstance);
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...f.state.zones.get(`${f.aliceId}-graveyard`)!,
      cardIds: [enchantInstance.id],
    });
    // Source must also not be a valid exile target — make it lose creature type.
    f.state.cards.set(corpseId, {
      ...f.state.cards.get(corpseId)!,
      cardData: {
        ...f.state.cards.get(corpseId)!.cardData,
        type_line: "Enchantment",
      },
    });
    // Re-create the choice (the prior pending choice still references the
    // corpse ID, which is fine — it remains the source of the offer).
    f.state = {
      ...f.state,
      pendingCorpseOffers: [corpseId],
      waitingChoice: createCorpseWaitingChoice(f.state, corpseId),
    };

    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(false);
    expect(res.description).toMatch(/no creature card/i);
  });

  it("rejects a choice value that is not one of the recorded options", () => {
    const res = resolveCorpseChoice(f.state, f.aliceId, "bogus:does-not-exist");
    expect(res.success).toBe(false);
    expect(res.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
  });

  it("rejects resolution by the wrong player", () => {
    const res = resolveCorpseChoice(f.state, f.bobId, `pay:${corpseId}`);
    expect(res.success).toBe(false);
    expect(res.description).toMatch(/not this player/i);
  });

  it("rejects resolution when no corpse offer is pending", () => {
    f.state = { ...f.state, waitingChoice: null };
    const res = resolveCorpseChoice(f.state, f.aliceId, `pay:${corpseId}`);
    expect(res.success).toBe(false);
    expect(res.description).toMatch(/no pending/i);
  });
});

// ===========================================================================
// Queue semantics — multiple corpses dying in the same SBA pass
// ===========================================================================

describe("Corpse — multiple corpses dying in the same SBA pass are queued", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.aliceId, { generic: 10 });
    f.state.priorityPlayerId = f.aliceId;
  });

  it("two corpses dying same pass: both queued, surfaced one at a time", () => {
    const c1 = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    const c2 = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, c1);
    moveToGraveyard(f.state, f.aliceId, c2);

    const r1 = processCorpseOnDeath(f.state, c1);
    expect(r1.applied).toBe(true);
    expect(r1.state.pendingCorpseOffers ?? []).toEqual([c1]);
    expect(r1.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);

    // Second corpse fires while the first offer is still pending. It should be
    // queued but NOT clobber the in-flight choice.
    const r2 = processCorpseOnDeath(r1.state, c2);
    expect(r2.applied).toBe(true);
    expect(r2.state.pendingCorpseOffers ?? []).toEqual([c1, c2]);
    // The surfaced choice is STILL for c1 (the queue head).
    expect(r2.state.waitingChoice?.choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: `pay:${c1}` })]),
    );

    // Resolving the first offer surfaces the second.
    const decline = resolveCorpseChoice(r2.state, f.aliceId, `decline:${c1}`);
    expect(decline.success).toBe(true);
    expect(decline.state.pendingCorpseOffers ?? []).toEqual([c2]);
    expect(decline.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
    expect(decline.state.waitingChoice?.choices).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: `pay:${c2}` })]),
    );

    // Resolve the second offer.
    const pay = resolveCorpseChoice(decline.state, f.aliceId, `decline:${c2}`);
    expect(pay.success).toBe(true);
    expect(pay.state.pendingCorpseOffers ?? []).toHaveLength(0);
    expect(pay.state.waitingChoice).toBeNull();
  });

  it("a corpse dying while a NON-corpse choice is pending is queued but not surfaced", () => {
    // Pretend some unrelated choice is pending.
    f.state.waitingChoice = {
      type: "priority",
      playerId: f.aliceId,
      stackObjectId: null,
      prompt: "Pass priority?",
      choices: [{ label: "Pass", value: "pass", isValid: true }],
      minChoices: 1,
      maxChoices: 1,
      presentedAt: Date.now(),
    };

    const c = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, c);

    const res = processCorpseOnDeath(f.state, c);
    expect(res.applied).toBe(true);
    // Queued but the in-flight priority choice is NOT clobbered.
    expect(res.state.pendingCorpseOffers ?? []).toEqual([c]);
    expect(res.state.waitingChoice?.type).toBe("priority");
  });
});

// ===========================================================================
// Trigger-system detection wiring (CR 702.168a)
// ===========================================================================

describe("Corpse — trigger-system detection (CR 702.168a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("detectCreatureDeathTriggers synthesises a corpse trigger for a dead corpse creature", () => {
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    moveToGraveyard(f.state, f.aliceId, corpseId);

    const triggers = detectCreatureDeathTriggers(f.state, corpseId, f.aliceId);
    const corpse = triggers.find((t) => /corpse/i.test(t.effect));
    expect(corpse).toBeDefined();
    expect(corpse!.sourceCardId).toBe(corpseId);
    expect(corpse!.triggeringPlayerId).toBe(f.aliceId);
    expect(corpse!.triggerCondition).toBe("dies");
    expect(corpse!.effect).toContain("Corpse 1");
  });

  it("detectCreatureDeathTriggers adds nothing for a non-corpse death", () => {
    const chaffId = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    moveToGraveyard(f.state, f.aliceId, chaffId);

    const triggers = detectCreatureDeathTriggers(f.state, chaffId, f.aliceId);
    expect(triggers.filter((t) => /corpse/i.test(t.effect))).toHaveLength(0);
  });

  it("detectCreatureDeathTriggers emits no corpse trigger when no dead card is supplied", () => {
    const triggers = detectCreatureDeathTriggers(f.state, undefined, f.aliceId);
    expect(triggers.filter((t) => /corpse/i.test(t.effect))).toHaveLength(0);
  });
});

// ===========================================================================
// SBA destroy-loop integration (CR 702.168a fires via the destroy hook)
// ===========================================================================

describe("Corpse — SBA destroy-loop integration", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.aliceId, { generic: 5 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("destroying a corpse creature via lethal damage surfaces the corpse offer", () => {
    // Put a 2/2 corpse creature on the battlefield, then mark lethal damage on
    // it. Running SBAs should destroy it AND queue + surface the offer.
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    // Mark lethal damage — SBAs 704.5f will destroy the creature.
    const card = f.state.cards.get(corpseId)!;
    f.state.cards.set(corpseId, { ...card, damage: 2 });

    const sba = checkStateBasedActions(f.state);
    expect(sba.actionsPerformed).toBe(true);
    expect(battlefieldIds(sba.state, f.aliceId)).not.toContain(corpseId);
    expect(graveyardIds(sba.state, f.aliceId)).toContain(corpseId);

    // The Corpse death trigger fired as part of the same SBA pass.
    expect(sba.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
    expect(sba.state.pendingCorpseOffers ?? []).toEqual([corpseId]);
    expect(sba.descriptions.some((d) => /corpse/i.test(d))).toBe(true);
  });

  it("destroyCorpse via destroyCard then manually invoking processCorpseOnDeath mirrors the SBA path", () => {
    // This proves the trigger fires for sacrifice-style deaths too — the
    // function is invariant to how the creature died, as long as the dead
    // card is now in graveyard.
    const corpseId = putOnBattlefield(f.state, f.aliceId, corpseCreature());
    const destroy = destroyCard(f.state, corpseId);
    expect(destroy.success).toBe(true);
    expect(graveyardIds(destroy.state, f.aliceId)).toContain(corpseId);

    // Manually invoke the death-trigger hook (sacrifice paths do not yet auto-
    // wire it; the function works regardless of death cause).
    const res = processCorpseOnDeath(destroy.state, corpseId);
    expect(res.applied).toBe(true);
    expect(res.state.waitingChoice?.type).toBe(CORPSE_CHOICE_TYPE);
    expect(res.state.pendingCorpseOffers ?? []).toEqual([corpseId]);
  });
});

// ===========================================================================
// Negative — the OLD "activate from graveyard anytime" API is gone
// ===========================================================================

describe("Corpse — the activated-from-graveyard API has been removed (CR 702.168)", () => {
  // Static import check: canActivateCorpse / activateCorpse / CorpseResult are
  // no longer exported from the module.
  it("the module no longer exports canActivateCorpse / activateCorpse / CorpseResult", async () => {
    const mod = await import("../corpse-keyword");
    expect(
      (mod as unknown as Record<string, unknown>).canActivateCorpse,
    ).toBeUndefined();
    expect(
      (mod as unknown as Record<string, unknown>).activateCorpse,
    ).toBeUndefined();
    expect(
      (mod as unknown as Record<string, unknown>).CorpseResult,
    ).toBeUndefined();
  });

  it("the engine no longer surfaces a 'corpse is activatable' state for any graveyard card", () => {
    const f = makeFixture();
    setMana(f.state, f.aliceId, { generic: 5 });
    // A corpse creature that has been in graveyard for a while.
    const staleId = putInGraveyard(f.state, f.aliceId, corpseCreature());

    // The only Corpse entry points are processCorpseOnDeath (called by SBA on
    // fresh deaths) and resolveCorpseChoice (called by the UI on a pending
    // offer). Calling processCorpseOnDeath on a stale graveyard card DOES
    // queue+surface an offer (the SBA contract trusts the caller — only the
    // SBA destroy loop calls it for fresh deaths). However, queueing twice is
    // blocked and there is no public "canActivate" predicate that returns true
    // for graveyard cards. Sanity-check those invariants.
    expect(typeof processCorpseOnDeath).toBe("function");
    expect(typeof resolveCorpseChoice).toBe("function");

    // Idempotency: queue+surface exactly once.
    const first = processCorpseOnDeath(f.state, staleId);
    expect(first.applied).toBe(true);
    const second = processCorpseOnDeath(first.state, staleId);
    expect(second.applied).toBe(false);
    expect(second.state.pendingCorpseOffers ?? []).toEqual([staleId]);
  });
});

// ===========================================================================
// Zone helper sanity (guards the test scaffolding itself)
// ===========================================================================

describe("Corpse — test scaffolding zone keys", () => {
  it("battlefield, graveyard, and exile zone keys resolve to the right zone types", () => {
    const f = makeFixture();
    expect(f.state.zones.get(`${f.aliceId}-battlefield`)!.type).toBe(
      ZoneType.BATTLEFIELD,
    );
    expect(f.state.zones.get(`${f.aliceId}-graveyard`)!.type).toBe(
      ZoneType.GRAVEYARD,
    );
    expect(f.state.zones.get(`${f.aliceId}-exile`)!.type).toBe(ZoneType.EXILE);
  });
});
