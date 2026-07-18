/**
 * @fileoverview Unit tests for Renown (CR 702.100) and Tribute (CR 702.101).
 *
 * Issue #1412 — [Rules Engine] Implement Renown and Tribute ETB triggered
 * abilities (CR 702.100, CR 702.101).
 *
 * Coverage:
 *
 *   Parsing:
 *     - parseRenown detects "Renown N" and parses N
 *     - parseTribute detects "Tribute N" and parses N
 *     - Word-boundary anchoring (no false matches inside other words)
 *
 *   Renown keyword action:
 *     - Renown creature ETBs → N +1/+1 counters placed + renowned=true
 *     - Renown is idempotent (already-renowned creature does not re-trigger)
 *     - Non-creature / non-renown cards are no-ops
 *
 *   Tribute keyword action:
 *     - Tribute creature ETBs → tribute_offer WaitingChoice surfaced
 *     - Accept path: cost is paid, card.tributePaid=true (effect suppressed)
 *     - Decline path: card.tributePaid=false (effect fires)
 *     - Insufficient mana at resolution: offer remains pending
 *     - Idempotency: same card cannot be queued twice
 *     - Queue semantics: multiple tributes entering same pass are surfaced one at a time
 *     - Negative: 1-player (Commander no-opponent) scenario surfaces no offer
 *
 *   Trigger-system wiring:
 *     - detectRenownEtbTriggers synthesises a renown ETB trigger
 *     - detectTributeEtbTriggers synthesises a tribute ETB trigger
 *     - Renowned creatures do not produce a renown trigger
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { parseRenown, parseTribute } from "../oracle-text-parser";
import {
  processRenownOnEtb,
  processTributeOnEtb,
  resolveTributeChoice,
  createTributeWaitingChoice,
  hasPendingTributeOffer,
  TRIBUTE_CHOICE_TYPE,
} from "../keyword-actions";
import {
  detectRenownEtbTriggers,
  detectTributeEtbTriggers,
} from "../trigger-system";
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
    type_line: "Creature — Human",
    oracle_text: "",
    mana_cost: "{2}{W}",
    cmc: 3,
    colors: ["W"],
    color_identity: ["W"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

/**
 * A creature with Renown 1.
 *
 *   "Renown 1 (When this creature deals combat damage to a player, if it
 *   isn't renowned, put a +1/+1 counter on it.)"
 */
function renownCreature(count = 1): ScryfallCard {
  return makeCard({
    id: `mock-renown-creature-${count}`,
    name: "Knight of the Pilgrim's Road",
    type_line: "Creature — Knight",
    oracle_text: `Renown ${count} (When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it.)`,
    mana_cost: "{2}{W}",
    cmc: 3,
    power: "3",
    toughness: "3",
  });
}

/**
 * A creature with Tribute N.
 *
 *   "Tribute N (As this creature enters the battlefield, an opponent of
 *   your choice may pay N. If they don't, sacrifice this creature.)"
 */
function tributeCreature(count = 2): ScryfallCard {
  return makeCard({
    id: `mock-tribute-creature-${count}`,
    name: "Fanatic of Rhonas",
    type_line: "Creature — Snake Druid",
    oracle_text: `Tribute ${count} (As this creature enters the battlefield, an opponent of your choice may pay ${count}. If they don't, sacrifice this creature.)`,
    mana_cost: "{3}{G}",
    cmc: 4,
    power: "4",
    toughness: "4",
  });
}

/** A creature without Renown or Tribute (chaff for negative tests). */
function chaffCreature(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `chaff-${idSuffix}`,
    name: `Chaff ${idSuffix}`,
    type_line: "Creature — Human",
    oracle_text: "Vigilance",
    mana_cost: "{1}{W}",
    cmc: 2,
    power: "1",
    toughness: "1",
  });
}

// ---------------------------------------------------------------------------
// Shared state scaffolding (mirrors the Corpse/Blitz fixtures)
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

/** Battlefield creature IDs for a player. */
function battlefieldIds(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.zones.get(`${playerId}-battlefield`)!.cardIds;
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
  const p = state.players.get(playerId)!.manaPool;
  return p.colorless + p.white + p.blue + p.black + p.red + p.green + p.generic;
}

/** Count +1/+1 counters on a card (0 if none). */
function p1p1Count(state: GameState, cardId: CardInstanceId): number {
  const card = state.cards.get(cardId);
  if (!card) return 0;
  const counter = card.counters.find((c) => c.type === "+1/+1");
  return counter?.count ?? 0;
}

// ===========================================================================
// Parsing — Renown (CR 702.100)
// ===========================================================================

describe("Renown — parsing (CR 702.100)", () => {
  it("parseRenown detects 'Renown N' and parses N", () => {
    const r = parseRenown(
      "Renown 1 (When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it.)",
    );
    expect(r.hasRenown).toBe(true);
    expect(r.renownCount).toBe(1);
    expect(r.description).toBe("Renown 1");
  });

  it("parseRenown handles larger counts", () => {
    const r = parseRenown(
      "Renown 3 (When this creature deals combat damage to a player, ...)",
    );
    expect(r.hasRenown).toBe(true);
    expect(r.renownCount).toBe(3);
    expect(r.description).toBe("Renown 3");
  });

  it("parseRenown is case-insensitive", () => {
    expect(parseRenown("renown 2").renownCount).toBe(2);
    expect(parseRenown("RENOWN 5").renownCount).toBe(5);
  });

  it("parseRenown returns hasRenown=false when the keyword is absent", () => {
    expect(parseRenown("Flying").hasRenown).toBe(false);
    expect(
      parseRenown("When this creature enters the battlefield").hasRenown,
    ).toBe(false);
    expect(parseRenown("").hasRenown).toBe(false);
  });

  it("parseRenown does not match 'renowned' or 'unrenowned' (word-boundary guard)", () => {
    expect(parseRenown("This creature is renowned.").hasRenown).toBe(false);
    expect(parseRenown("If it isn't renowned, ...").hasRenown).toBe(false);
    expect(parseRenown("Unrenowned creatures get -1/-1.").hasRenown).toBe(
      false,
    );
  });

  it("parseRenown rejects text that lacks an integer N", () => {
    expect(parseRenown("Renown — keyword ability reference").hasRenown).toBe(
      false,
    );
  });
});

// ===========================================================================
// Parsing — Tribute (CR 702.101)
// ===========================================================================

describe("Tribute — parsing (CR 702.101)", () => {
  it("parseTribute detects 'Tribute N' and parses N", () => {
    const r = parseTribute(
      "Tribute 2 (As this creature enters the battlefield, an opponent of your choice may pay 2.)",
    );
    expect(r.hasTribute).toBe(true);
    expect(r.tributeCount).toBe(2);
    expect(r.description).toBe("Tribute 2");
  });

  it("parseTribute handles larger counts", () => {
    const r = parseTribute("Tribute 4 (As this creature enters...)");
    expect(r.hasTribute).toBe(true);
    expect(r.tributeCount).toBe(4);
  });

  it("parseTribute is case-insensitive", () => {
    expect(parseTribute("tribute 3").tributeCount).toBe(3);
    expect(parseTribute("TRIBUTE 1").tributeCount).toBe(1);
  });

  it("parseTribute returns hasTribute=false when the keyword is absent", () => {
    expect(parseTribute("Flying").hasTribute).toBe(false);
    expect(
      parseTribute("When this creature enters the battlefield").hasTribute,
    ).toBe(false);
    expect(parseTribute("").hasTribute).toBe(false);
  });

  it("parseTribute does not match 'tributes' or 'tributary' (word-boundary guard)", () => {
    expect(parseTribute("The player tributes 2 life.").hasTribute).toBe(false);
    expect(parseTribute("A tributary of the river.").hasTribute).toBe(false);
    expect(parseTribute("Pays tributes to the king.").hasTribute).toBe(false);
  });

  it("parseTribute rejects text that lacks an integer N", () => {
    expect(parseTribute("Tribute — keyword ability reference").hasTribute).toBe(
      false,
    );
  });
});

// ===========================================================================
// processRenownOnEtb — Renown ETB action (CR 702.100a)
// ===========================================================================

describe("Renown — processRenownOnEtb fires on ETB (CR 702.100a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("(a) Renown creature ETBs → gains N +1/+1 counters and renowned=true", () => {
    const id = putOnBattlefield(f.state, f.aliceId, renownCreature(2));
    expect(p1p1Count(f.state, id)).toBe(0);
    expect(f.state.cards.get(id)!.renowned ?? false).toBe(false);

    const res = processRenownOnEtb(f.state, id);

    expect(res.applied).toBe(true);
    expect(p1p1Count(res.state, id)).toBe(2);
    expect(res.state.cards.get(id)!.renowned).toBe(true);
    expect(battlefieldIds(res.state, f.aliceId)).toContain(id);
  });

  it("(b) already-renowned creature does NOT re-trigger (CR 702.100b — flicker guard)", () => {
    const id = putOnBattlefield(f.state, f.aliceId, renownCreature(1));
    const first = processRenownOnEtb(f.state, id);
    expect(first.applied).toBe(true);
    expect(p1p1Count(first.state, id)).toBe(1);

    // Simulate a flicker: the same card instance "enters" again. CR 702.100b
    // prevents the trigger from firing a second time for the same instance.
    const second = processRenownOnEtb(first.state, id);
    expect(second.applied).toBe(false);
    expect(p1p1Count(second.state, id)).toBe(1); // unchanged
    expect(second.state.cards.get(id)!.renowned).toBe(true);
  });

  it("does nothing for a non-creature card carrying Renown text (CR 702.100 — 'creature')", () => {
    const enchantCard = makeCard({
      id: "enchant-renown",
      name: "Weird Enchantment",
      type_line: "Enchantment",
      oracle_text: "Renown 1 (This shouldn't trigger off a non-creature.)",
    });
    const id = putOnBattlefield(f.state, f.aliceId, enchantCard);

    const res = processRenownOnEtb(f.state, id);
    expect(res.applied).toBe(false);
    expect(p1p1Count(res.state, id)).toBe(0);
    expect(res.state.cards.get(id)!.renowned ?? false).toBe(false);
  });

  it("does nothing for a creature without Renown", () => {
    const id = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    const res = processRenownOnEtb(f.state, id);
    expect(res.applied).toBe(false);
    expect(p1p1Count(res.state, id)).toBe(0);
  });

  it("does nothing when the card ID is not present in state", () => {
    const res = processRenownOnEtb(f.state, "nonexistent-card-id");
    expect(res.applied).toBe(false);
  });

  it("respects different N values", () => {
    const id3 = putOnBattlefield(f.state, f.aliceId, renownCreature(3));
    const res3 = processRenownOnEtb(f.state, id3);
    expect(res3.applied).toBe(true);
    expect(p1p1Count(res3.state, id3)).toBe(3);

    const id5 = putOnBattlefield(res3.state, f.aliceId, renownCreature(5));
    const res5 = processRenownOnEtb(res3.state, id5);
    expect(res5.applied).toBe(true);
    expect(p1p1Count(res5.state, id5)).toBe(5);
  });
});

// ===========================================================================
// processTributeOnEtb — Tribute ETB action (CR 702.101a)
// ===========================================================================

describe("Tribute — processTributeOnEtb surfaces an opponent offer (CR 702.101a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.bobId, { generic: 10 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("Tribute creature ETBs → tribute_offer WaitingChoice surfaced to an opponent", () => {
    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));

    expect(hasPendingTributeOffer(f.state)).toBe(false);
    expect(f.state.pendingTributeOffers ?? []).toHaveLength(0);

    const res = processTributeOnEtb(f.state, id);

    expect(res.applied).toBe(true);
    expect(hasPendingTributeOffer(res.state)).toBe(true);
    expect(res.state.waitingChoice?.type).toBe(TRIBUTE_CHOICE_TYPE);
    // The choice goes to an OPPONENT of the controller (Alice controls the
    // creature; Bob is the opponent).
    expect(res.state.waitingChoice?.playerId).toBe(f.bobId);
    expect(res.state.pendingTributeOffers ?? []).toEqual([id]);
    expect(battlefieldIds(res.state, f.aliceId)).toContain(id);
  });

  it("the surfaced choice offers accept/decline options for the right card", () => {
    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));
    const res = processTributeOnEtb(f.state, id);

    const choices = res.state.waitingChoice!.choices;
    expect(choices.map((c) => String(c.value))).toEqual(
      expect.arrayContaining([`accept:${id}`, `decline:${id}`]),
    );
  });

  it("does nothing for a non-creature card carrying Tribute text", () => {
    const enchantCard = makeCard({
      id: "enchant-tribute",
      name: "Weird Enchantment",
      type_line: "Enchantment",
      oracle_text: "Tribute 1 (Shouldn't trigger off a non-creature.)",
    });
    const id = putOnBattlefield(f.state, f.aliceId, enchantCard);

    const res = processTributeOnEtb(f.state, id);
    expect(res.applied).toBe(false);
    expect(hasPendingTributeOffer(res.state)).toBe(false);
  });

  it("does nothing for a creature without Tribute", () => {
    const id = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    const res = processTributeOnEtb(f.state, id);
    expect(res.applied).toBe(false);
    expect(hasPendingTributeOffer(res.state)).toBe(false);
  });

  it("is idempotent — a second call for the same card is a no-op", () => {
    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(1));
    const first = processTributeOnEtb(f.state, id);
    expect(first.applied).toBe(true);

    const second = processTributeOnEtb(first.state, id);
    expect(second.applied).toBe(false);
    expect(second.state.pendingTributeOffers ?? []).toEqual([id]);
    expect(hasPendingTributeOffer(second.state)).toBe(true);
  });

  it("does nothing when the card ID is not present in state", () => {
    const res = processTributeOnEtb(f.state, "nonexistent-card-id");
    expect(res.applied).toBe(false);
  });
});

// ===========================================================================
// resolveTributeChoice — accept path (CR 702.101b — suppression)
// ===========================================================================

describe("Tribute — resolveTributeChoice accept path (CR 702.101b)", () => {
  let f: Fixture;
  let tributeId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.bobId, { generic: 5 });
    tributeId = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));
    const fired = processTributeOnEtb(f.state, tributeId);
    expect(fired.applied).toBe(true);
    f.state = fired.state;
  });

  it("accept pays the cost and marks the card as tributePaid=true (effect suppressed)", () => {
    const manaBefore = totalMana(f.state, f.bobId);
    expect(f.state.cards.get(tributeId)!.tributePaid).toBeUndefined();

    const res = resolveTributeChoice(f.state, f.bobId, `accept:${tributeId}`);
    expect(res.success).toBe(true);

    expect(totalMana(res.state, f.bobId)).toBe(manaBefore - 2);
    expect(res.state.cards.get(tributeId)!.tributePaid).toBe(true);
    expect(res.state.waitingChoice).toBeNull();
    expect(res.state.pendingTributeOffers ?? []).toHaveLength(0);
    expect(res.description).toMatch(/suppress/i);
  });

  it("accept fails when the opponent cannot afford the cost", () => {
    setMana(f.state, f.bobId, { generic: 1 });
    // Re-surface the choice so isValid reflects the new (smaller) pool.
    f.state = {
      ...f.state,
      waitingChoice: createTributeWaitingChoice(f.state, tributeId),
    };

    const manaBefore = totalMana(f.state, f.bobId);

    const res = resolveTributeChoice(f.state, f.bobId, `accept:${tributeId}`);
    expect(res.success).toBe(false);
    expect(totalMana(res.state, f.bobId)).toBe(manaBefore);
    expect(res.state.cards.get(tributeId)!.tributePaid).toBeUndefined();
    // Offer remains pending so the caller can submit "decline" instead.
    expect(res.state.waitingChoice?.type).toBe(TRIBUTE_CHOICE_TYPE);
    expect(res.state.pendingTributeOffers ?? []).toEqual([tributeId]);
  });

  it("the 'accept' option is marked invalid in the choice when mana is insufficient", () => {
    setMana(f.state, f.bobId, { generic: 0 });
    f.state = {
      ...f.state,
      waitingChoice: createTributeWaitingChoice(f.state, tributeId),
    };
    const acceptOption = f.state.waitingChoice!.choices.find((c) =>
      String(c.value).startsWith("accept:"),
    );
    expect(acceptOption).toBeDefined();
    expect(acceptOption!.isValid).toBe(false);
    // Decline is always valid.
    const declineOption = f.state.waitingChoice!.choices.find((c) =>
      String(c.value).startsWith("decline:"),
    );
    expect(declineOption!.isValid).toBe(true);
  });

  it("rejects a choice value that is not one of the recorded options", () => {
    const res = resolveTributeChoice(f.state, f.bobId, "bogus:value");
    expect(res.success).toBe(false);
    expect(res.state.waitingChoice?.type).toBe(TRIBUTE_CHOICE_TYPE);
  });

  it("rejects resolution by the wrong player", () => {
    const res = resolveTributeChoice(f.state, f.aliceId, `accept:${tributeId}`);
    expect(res.success).toBe(false);
    expect(res.description).toMatch(/not this player/i);
  });

  it("rejects resolution when no tribute offer is pending", () => {
    f.state = { ...f.state, waitingChoice: null };
    const res = resolveTributeChoice(f.state, f.bobId, `accept:${tributeId}`);
    expect(res.success).toBe(false);
    expect(res.description).toMatch(/no pending/i);
  });
});

// ===========================================================================
// resolveTributeChoice — decline path (CR 702.101 — effect fires)
// ===========================================================================

describe("Tribute — resolveTributeChoice decline path", () => {
  let f: Fixture;
  let tributeId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.bobId, { generic: 5 });
    tributeId = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));
    const fired = processTributeOnEtb(f.state, tributeId);
    expect(fired.applied).toBe(true);
    f.state = fired.state;
  });

  it("decline marks tributePaid=false so the secondary effect fires", () => {
    const manaBefore = totalMana(f.state, f.bobId);

    const res = resolveTributeChoice(f.state, f.bobId, `decline:${tributeId}`);
    expect(res.success).toBe(true);

    // Real-state assertions: nothing spent, flag set to false.
    expect(totalMana(res.state, f.bobId)).toBe(manaBefore);
    expect(res.state.cards.get(tributeId)!.tributePaid).toBe(false);
    expect(res.state.waitingChoice).toBeNull();
    expect(res.state.pendingTributeOffers ?? []).toHaveLength(0);
    expect(res.description).toMatch(/decline/i);
    expect(res.description).toMatch(/effect fires/i);
  });
});

// ===========================================================================
// Queue semantics — multiple tributes entering the same pass
// ===========================================================================

describe("Tribute — multiple tributes entering same pass are queued", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    setMana(f.state, f.bobId, { generic: 10 });
    f.state.priorityPlayerId = f.aliceId;
  });

  it("two tributes entering same pass: both queued, surfaced one at a time", () => {
    const t1 = putOnBattlefield(f.state, f.aliceId, tributeCreature(1));
    const t2 = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));

    const r1 = processTributeOnEtb(f.state, t1);
    expect(r1.applied).toBe(true);
    expect(r1.state.pendingTributeOffers ?? []).toEqual([t1]);
    expect(r1.state.waitingChoice?.type).toBe(TRIBUTE_CHOICE_TYPE);

    // Second tribute fires while the first offer is still pending. It should
    // be queued but NOT clobber the in-flight choice.
    const r2 = processTributeOnEtb(r1.state, t2);
    expect(r2.applied).toBe(true);
    expect(r2.state.pendingTributeOffers ?? []).toEqual([t1, t2]);
    expect(r2.state.waitingChoice?.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: `accept:${t1}` }),
      ]),
    );

    // Resolving the first offer surfaces the second.
    const decline = resolveTributeChoice(r2.state, f.bobId, `decline:${t1}`);
    expect(decline.success).toBe(true);
    expect(decline.state.pendingTributeOffers ?? []).toEqual([t2]);
    expect(decline.state.waitingChoice?.type).toBe(TRIBUTE_CHOICE_TYPE);
    expect(decline.state.waitingChoice?.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: `accept:${t2}` }),
      ]),
    );

    // Resolve the second offer.
    const accept = resolveTributeChoice(decline.state, f.bobId, `accept:${t2}`);
    expect(accept.success).toBe(true);
    expect(accept.state.pendingTributeOffers ?? []).toHaveLength(0);
    expect(accept.state.waitingChoice).toBeNull();
  });

  it("a tribute entering while a NON-tribute choice is pending is queued but not surfaced", () => {
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

    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(1));
    const res = processTributeOnEtb(f.state, id);
    expect(res.applied).toBe(true);
    expect(res.state.pendingTributeOffers ?? []).toEqual([id]);
    expect(res.state.waitingChoice?.type).toBe("priority");
  });
});

// ===========================================================================
// 1-player scenario (Commander's "no opposing player" case)
// ===========================================================================

describe("Tribute — no-opponent scenario (Commander negative)", () => {
  it("createTributeWaitingChoice returns null when there is no opposing player", () => {
    const f = makeFixture();
    // Remove the second player to simulate a single-player state (extreme
    // Commander edge case where all opponents have lost).
    const ids = Array.from(f.state.players.keys());
    const opponentId = ids.find((id) => id !== f.aliceId)!;
    f.state.players.delete(opponentId);

    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(2));
    const choice = createTributeWaitingChoice(f.state, id);
    expect(choice).toBeNull();
  });
});

// ===========================================================================
// Trigger-system detection wiring
// ===========================================================================

describe("Trigger-system — detectRenownEtbTriggers (CR 702.100)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("synthesises a renown ETB trigger for a renown creature", () => {
    const id = putOnBattlefield(f.state, f.aliceId, renownCreature(2));
    const triggers = detectRenownEtbTriggers(f.state, id, f.aliceId);

    expect(triggers).toHaveLength(1);
    const t = triggers[0]!;
    expect(t.sourceCardId).toBe(id);
    expect(t.triggeringPlayerId).toBe(f.aliceId);
    expect(t.triggerCondition).toBe("entersBattlefield");
    expect(t.effect).toContain("Renown 2");
    expect(t.effect).toMatch(/\+1\/\+1/i);
  });

  it("synthesises no trigger for an already-renowned creature (CR 702.100b)", () => {
    const id = putOnBattlefield(f.state, f.aliceId, renownCreature(1));
    // Mark it renowned and call again — should be a no-op.
    const card = f.state.cards.get(id)!;
    f.state.cards.set(id, { ...card, renowned: true });

    const triggers = detectRenownEtbTriggers(f.state, id, f.aliceId);
    expect(triggers).toHaveLength(0);
  });

  it("synthesises no trigger for a creature without Renown", () => {
    const id = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    const triggers = detectRenownEtbTriggers(f.state, id, f.aliceId);
    expect(triggers).toHaveLength(0);
  });

  it("synthesises no trigger when the card is not on the battlefield", () => {
    // Card never added to state.
    const triggers = detectRenownEtbTriggers(
      f.state,
      "nonexistent-id",
      f.aliceId,
    );
    expect(triggers).toHaveLength(0);
  });
});

describe("Trigger-system — detectTributeEtbTriggers (CR 702.101)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
  });

  it("synthesises a tribute ETB trigger for a tribute creature", () => {
    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(3));
    const triggers = detectTributeEtbTriggers(f.state, id, f.aliceId);

    expect(triggers).toHaveLength(1);
    const t = triggers[0]!;
    expect(t.sourceCardId).toBe(id);
    expect(t.triggeringPlayerId).toBe(f.aliceId);
    expect(t.triggerCondition).toBe("entersBattlefield");
    expect(t.effect).toContain("Tribute 3");
  });

  it("synthesises no trigger for a creature without Tribute", () => {
    const id = putOnBattlefield(f.state, f.aliceId, chaffCreature("a"));
    const triggers = detectTributeEtbTriggers(f.state, id, f.aliceId);
    expect(triggers).toHaveLength(0);
  });

  it("synthesises no trigger when the card is not on the battlefield", () => {
    const triggers = detectTributeEtbTriggers(
      f.state,
      "nonexistent-id",
      f.aliceId,
    );
    expect(triggers).toHaveLength(0);
  });

  it("still synthesises a trigger even after the card's tributePaid has been set (engine records the trigger regardless of the suppression flag)", () => {
    // The suppression flag is consumed by the secondary "if its tribute wasn't
    // paid" triggered ability on resolution; the primary Tribute trigger is
    // always recorded for replay/state-hash consumers.
    const id = putOnBattlefield(f.state, f.aliceId, tributeCreature(1));
    const card = f.state.cards.get(id)!;
    f.state.cards.set(id, { ...card, tributePaid: true });

    const triggers = detectTributeEtbTriggers(f.state, id, f.aliceId);
    expect(triggers).toHaveLength(1);
  });
});

// ===========================================================================
// Zone helper sanity (guards the test scaffolding itself)
// ===========================================================================

describe("Renown/Tribute — test scaffolding zone keys", () => {
  it("battlefield zone key resolves to the right zone type", () => {
    const f = makeFixture();
    expect(f.state.zones.get(`${f.aliceId}-battlefield`)!.type).toBe(
      ZoneType.BATTLEFIELD,
    );
  });
});
