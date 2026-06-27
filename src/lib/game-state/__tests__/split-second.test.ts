/**
 * @fileoverview Unit tests for the Split second keyword (CR 702.60).
 *
 * Issue #1062 — [Rules Engine] Implement Split Second keyword.
 *
 * Split second (CR 702.60):
 * - 702.60a: static ability that functions only while the spell with split
 *   second is on the stack.
 * - 702.60b: while such a spell is on the stack, players can't cast other
 *   spells or activate abilities that aren't mana abilities. Triggered
 *   abilities and special actions (e.g. morph face-up) remain legal.
 * - 702.60c: multiple instances are redundant.
 *
 * These tests cover: parsing, cast-blocking, non-mana-ability blocking,
 * triggered-ability allowance, mana-ability allowance, and restriction
 * lifting once the spell leaves the stack.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { canCastSpell, castSpell } from "../spell-casting";
import {
  canActivateAbility,
  activateAbility,
  checkTriggeredAbilities,
} from "../abilities";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { parseSplitSecond } from "../oracle-text-parser";
import { hasSplitSecondOnStack } from "../auto-pass-priority";
import { Phase } from "../types";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "{1}{R}",
    cmc: 2,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** A split-second spell (e.g. Sudden Shock). */
function splitSecondSpell(): ScryfallCard {
  return makeCard({
    id: "mock-sudden-shock",
    name: "Sudden Shock",
    type_line: "Instant",
    oracle_text: "Split second (As you cast this spell, ...)",
    mana_cost: "{1}{R}",
    cmc: 2,
  });
}

/** A generic instant that an opponent might want to cast in response. */
function vanillaInstant(): ScryfallCard {
  return makeCard({
    id: "mock-counterspell",
    name: "Counterspell",
    type_line: "Instant",
    oracle_text: "Draw a card.",
    mana_cost: "{1}{U}",
    cmc: 2,
    colors: ["U"],
  });
}

/** Creature whose {T} draws a card (a non-mana activated ability). */
function tapDrawCreature(): ScryfallCard {
  return makeCard({
    id: "mock-tap-draw",
    name: "Tap Drawer",
    type_line: "Creature — Human",
    oracle_text: "{T}: Draw a card.",
    mana_cost: "{1}{U}",
    cmc: 2,
    power: "1",
    toughness: "1",
  });
}

/** Creature whose {T} adds mana (a mana ability — legal under split second). */
function tapManaCreature(): ScryfallCard {
  return makeCard({
    id: "mock-tap-mana",
    name: "Mana Dude",
    type_line: "Creature — Elf",
    oracle_text: "{T}: Add {G}.",
    mana_cost: "{G}",
    cmc: 1,
    power: "0",
    toughness: "1",
  });
}

/** Creature with an "enters the battlefield" triggered ability. */
function etfTriggerCreature(): ScryfallCard {
  return makeCard({
    id: "mock-etb-trigger",
    name: "ETB Trigger",
    type_line: "Creature — Human",
    oracle_text: "When this creature enters the battlefield, draw a card.",
    mana_cost: "{1}{U}",
    cmc: 2,
    power: "1",
    toughness: "1",
  });
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

/** Place a card into a player's hand and the global card map. */
function putInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${playerId}-hand`)!;
  state.zones.set(`${playerId}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return card.id;
}

/** Place a permanent onto a player's battlefield (summoning-sickness free). */
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
 * Push a split-second spell onto the stack, simulating it having been cast.
 * Mirrors how castSpell stamps the marker (see spell-casting.ts).
 */
function pushSplitSecondSpell(
  state: GameState,
  controllerId: PlayerId,
): StackObject {
  const data = splitSecondSpell();
  const card = createCardInstance(data, controllerId, controllerId);
  state.cards.set(card.id, card);
  const obj: StackObject = {
    id: "ss-spell-on-stack",
    type: "spell",
    sourceCardId: card.id,
    controllerId,
    name: data.name,
    text: data.oracle_text ?? "",
    manaCost: data.mana_cost ?? null,
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    splitSecond: true,
  };
  state.stack = [...state.stack, obj];
  return obj;
}

/** Push a non-split-second spell onto the stack (control case). */
function pushPlainSpell(state: GameState, controllerId: PlayerId): StackObject {
  const obj: StackObject = {
    id: "plain-spell-on-stack",
    type: "spell",
    sourceCardId: null,
    controllerId,
    name: "Plain Instant",
    text: "",
    manaCost: "{U}",
    targets: [],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  };
  state.stack = [...state.stack, obj];
  return obj;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Split second — parsing (CR 702.60)", () => {
  it("detects 'Split second' in oracle text", () => {
    expect(
      parseSplitSecond("Split second (As you cast this spell, ...)")
        .hasSplitSecond,
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseSplitSecond("split second").hasSplitSecond).toBe(true);
    expect(parseSplitSecond("SPLIT SECOND").hasSplitSecond).toBe(true);
  });

  it("returns false when the keyword is absent", () => {
    expect(parseSplitSecond("Draw a card.").hasSplitSecond).toBe(false);
    expect(parseSplitSecond("").hasSplitSecond).toBe(false);
  });

  it("does not match substrings inside other words", () => {
    // word-boundary anchored: must not match "splitsecondish" style noise
    expect(parseSplitSecond("Some splitsecondish text").hasSplitSecond).toBe(
      false,
    );
  });

  it("produces a description only when present (CR 702.60c redundancy)", () => {
    const present = parseSplitSecond("Split second");
    expect(present.description).toBe("Split second");
    const absent = parseSplitSecond("Flying");
    expect(absent.description).toBe("");
  });
});

describe("Split second — stack presence helper", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("is false on an empty stack", () => {
    expect(hasSplitSecondOnStack(f.state)).toBe(false);
  });

  it("is true when a split-second spell is on the stack", () => {
    pushSplitSecondSpell(f.state, f.aliceId);
    expect(hasSplitSecondOnStack(f.state)).toBe(true);
  });

  it("is false when only a plain spell is on the stack", () => {
    pushPlainSpell(f.state, f.aliceId);
    expect(hasSplitSecondOnStack(f.state)).toBe(false);
  });

  it("lifts as soon as the split-second spell leaves the stack", () => {
    pushSplitSecondSpell(f.state, f.aliceId);
    expect(hasSplitSecondOnStack(f.state)).toBe(true);
    f.state.stack = [];
    expect(hasSplitSecondOnStack(f.state)).toBe(false);
  });
});

describe("Split second — casting is blocked while active (CR 702.60b)", () => {
  let f: Fixture;
  let responseCardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    // Alice has an instant she'd like to cast in response.
    responseCardId = putInHand(f.state, f.aliceId, vanillaInstant());
    f.state = addMana(f.state, f.aliceId, {
      blue: 2,
      generic: 5,
    });
    f.state.priorityPlayerId = f.aliceId;
  });

  it("canCastSpell rejects while a split-second spell is on the stack", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const result = canCastSpell(f.state, f.aliceId, responseCardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toMatch(/split second/i);
  });

  it("castSpell is rejected via ValidationService while split second is active", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const result = castSpell(f.state, f.aliceId, responseCardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/split second/i);
    // The response spell must NOT have been added to the stack.
    expect(result.state.stack.length).toBe(1);
  });

  it("casting is allowed again once the split-second spell leaves the stack", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    expect(canCastSpell(f.state, f.aliceId, responseCardId).canCast).toBe(
      false,
    );

    // Resolve/counter/remove the split-second spell → stack empties.
    f.state.stack = [];
    expect(canCastSpell(f.state, f.aliceId, responseCardId).canCast).toBe(true);
  });
});

describe("Split second — non-mana abilities are blocked (CR 702.60b)", () => {
  let f: Fixture;
  let drawCreatureId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    drawCreatureId = putOnBattlefield(f.state, f.aliceId, tapDrawCreature());
    f.state.priorityPlayerId = f.aliceId;
  });

  it("canActivateAbility rejects a non-mana ability while split second is active", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const result = canActivateAbility(f.state, f.aliceId, drawCreatureId, 0);
    expect(result.canActivate).toBe(false);
    expect(result.reason).toMatch(/split second/i);
  });

  it("activateAbility reports failure for a non-mana ability under split second", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const result = activateAbility(f.state, f.aliceId, drawCreatureId, 0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/split second/i);
    // No new object added to the stack from this activation.
    expect(result.state.stack.length).toBe(1);
  });

  it("the non-mana ability is legal again once the split-second spell leaves", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    expect(
      canActivateAbility(f.state, f.aliceId, drawCreatureId, 0).canActivate,
    ).toBe(false);

    f.state.stack = [];
    expect(
      canActivateAbility(f.state, f.aliceId, drawCreatureId, 0).canActivate,
    ).toBe(true);
  });
});

describe("Split second — mana abilities remain legal (CR 702.60b exception)", () => {
  let f: Fixture;
  let manaCreatureId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    manaCreatureId = putOnBattlefield(f.state, f.aliceId, tapManaCreature());
    f.state.priorityPlayerId = f.aliceId;
  });

  it("canActivateAbility permits a mana ability under split second", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const result = canActivateAbility(f.state, f.aliceId, manaCreatureId, 0);
    expect(result.canActivate).toBe(true);
  });

  it("activateAbility resolves a mana ability (CR 605) without using the stack", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const stackBefore = f.state.stack.length;
    const result = activateAbility(f.state, f.aliceId, manaCreatureId, 0);

    expect(result.success).toBe(true);
    // Mana abilities resolve immediately and never add to the stack, so the
    // split-second spell remains the only object on the stack.
    expect(result.state.stack.length).toBe(stackBefore);
    const player = result.state.players.get(f.aliceId);
    expect(player?.manaPool.green).toBeGreaterThanOrEqual(1);
  });
});

describe("Split second — triggered abilities remain legal (CR 702.60b/c)", () => {
  let f: Fixture;
  let etbCreatureId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    etbCreatureId = putOnBattlefield(f.state, f.aliceId, etfTriggerCreature());
    f.state.priorityPlayerId = f.aliceId;
  });

  it("a triggered ability still goes on the stack while split second is active", () => {
    pushSplitSecondSpell(f.state, f.bobId);
    const stackBefore = f.state.stack.length;

    const result = checkTriggeredAbilities(f.state, "entersBattlefield", {
      sourceCardId: etbCreatureId,
    });

    // Triggered abilities are not "cast" or "activated" — they are exempt
    // from the split-second restriction and must be allowed to go on stack.
    expect(result.abilities.length).toBeGreaterThan(0);
    expect(result.state.stack.length).toBeGreaterThan(stackBefore);
  });

  it("triggered-ability path does not consult split second when the stack is empty", () => {
    // Control case: trigger works normally with no split-second present.
    const stackBefore = f.state.stack.length;
    const result = checkTriggeredAbilities(f.state, "entersBattlefield", {
      sourceCardId: etbCreatureId,
    });
    expect(result.abilities.length).toBeGreaterThan(0);
    expect(result.state.stack.length).toBeGreaterThan(stackBefore);
  });
});

describe("Split second — castSpell stamps the marker onto the stack object", () => {
  let f: Fixture;
  let ssCardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    ssCardId = putInHand(f.state, f.aliceId, splitSecondSpell());
    f.state = addMana(f.state, f.aliceId, { red: 1, generic: 5 });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("a split-second spell parsed from oracle text carries splitSecond=true on the stack", () => {
    const result = castSpell(f.state, f.aliceId, ssCardId);
    expect(result.success).toBe(true);
    expect(result.state.stack.length).toBe(1);
    expect(result.state.stack[0].splitSecond).toBe(true);
    // The helper now sees it.
    expect(hasSplitSecondOnStack(result.state)).toBe(true);
  });

  it("a non-split-second spell does not set splitSecond", () => {
    const plainId = putInHand(f.state, f.aliceId, vanillaInstant());
    f.state = addMana(f.state, f.aliceId, { blue: 2, generic: 5 });
    const result = castSpell(f.state, f.aliceId, plainId);
    expect(result.success).toBe(true);
    expect(result.state.stack[0].splitSecond).toBeFalsy();
  });
});
