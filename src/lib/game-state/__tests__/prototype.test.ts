/**
 * @fileoverview Direct unit tests for the Prototype keyword module
 * (src/lib/game-state/prototype.ts, CR 702.152).
 *
 * Issue #1718 — prototype.ts was one of the rules-engine modules with zero
 * direct test references. These tests pin the module's public surface:
 * keyword detection, prototype-info parsing, cast legality (priority, hand
 * membership, mana affordability), prototype card creation, effective
 * characteristics (P/T / mana cost while prototyped), and the initialize /
 * transform lifecycle per CR 702.152.
 */

import { describe, it, expect } from "@jest/globals";
import {
  canCastAsPrototype,
  createPrototypeCard,
  getPrototypeInfo,
  getPrototypeManaCost,
  getPrototypeManaCostForSpell,
  getPrototypePower,
  getPrototypeToughness,
  hasPrototype,
  initializePrototype,
  isPrototypePermanent,
  transformFromPrototype,
} from "../prototype";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "../types";
import type { ScryfallCard } from "../types";

// ---------------------------------------------------------------------------
// Mock card helpers
// ---------------------------------------------------------------------------

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Artifact Creature — Construct",
    oracle_text: "",
    mana_cost: "{7}",
    cmc: 7,
    power: "5",
    toughness: "4",
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** A canonical Prototype card (anonymous with a real prototype line). */
function prototypeCard(): ScryfallCard {
  return makeCard({
    id: "mock-prototype-card",
    name: "Skysovereign Replica",
    oracle_text: "Prototype {2}{U} — 1/1\nFlying",
    mana_cost: "{7}",
    cmc: 7,
    power: "5",
    toughness: "4",
    keywords: ["Prototype"],
  });
}

function instanceFrom(
  cardData: ScryfallCard,
  overrides: Partial<CardInstance> = {},
): CardInstance {
  return { ...createCardInstance(cardData, "p1", "p1"), ...overrides };
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

  return { state, aliceId, bobId };
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

// ---------------------------------------------------------------------------
// Keyword detection & info parsing
// ---------------------------------------------------------------------------

describe("hasPrototype", () => {
  it("is true when the keyword list contains Prototype", () => {
    const card = instanceFrom(prototypeCard());
    expect(hasPrototype(card)).toBe(true);
  });

  it("is false for a card without the keyword", () => {
    const card = instanceFrom(makeCard({ id: "plain", keywords: [] }));
    expect(hasPrototype(card)).toBe(false);
  });
});

describe("getPrototypeInfo", () => {
  it("parses cost and alternative power/toughness from the oracle text", () => {
    const info = getPrototypeInfo(instanceFrom(prototypeCard()));
    expect(info.hasPrototype).toBe(true);
    expect(info.prototypePower).toBe(1);
    expect(info.prototypeToughness).toBe(1);
    expect(info.prototypeManaCost).toBe("{2}{U}");
  });

  it("reports no prototype for oracle text without a prototype line", () => {
    const info = getPrototypeInfo(
      instanceFrom(makeCard({ id: "plain", oracle_text: "Flying" })),
    );
    expect(info.hasPrototype).toBe(false);
    expect(info.prototypePower).toBeNull();
    expect(info.prototypeToughness).toBeNull();
    expect(info.prototypeManaCost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cast legality (canCastAsPrototype)
// ---------------------------------------------------------------------------

describe("canCastAsPrototype", () => {
  it("allows casting when the card is in hand, caster has priority, and mana suffices", () => {
    const f = makeFixture();
    const cardId = putInHand(f.state, f.aliceId, prototypeCard());
    f.state = addMana(f.state, f.aliceId, { blue: 1, generic: 4 });

    const result = canCastAsPrototype(f.state, f.aliceId, cardId);
    expect(result.canCast).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects an unknown card instance", () => {
    const f = makeFixture();
    const result = canCastAsPrototype(f.state, f.aliceId, "no-such-card");
    expect(result.canCast).toBe(false);
    expect(result.reason).toBe("Card not found");
  });

  it("rejects a card without the Prototype keyword", () => {
    const f = makeFixture();
    const cardId = putInHand(
      f.state,
      f.aliceId,
      makeCard({ id: "plain", oracle_text: "Flying", keywords: [] }),
    );
    const result = canCastAsPrototype(f.state, f.aliceId, cardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toBe("Card does not have prototype");
  });

  it("rejects when the player does not have priority", () => {
    const f = makeFixture();
    const cardId = putInHand(f.state, f.aliceId, prototypeCard());
    f.state.priorityPlayerId = f.bobId;

    const result = canCastAsPrototype(f.state, f.aliceId, cardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toBe("You do not have priority");
  });

  it("rejects when the card is not in the player's hand", () => {
    const f = makeFixture();
    const card = createCardInstance(prototypeCard(), f.aliceId, f.aliceId);
    card.currentZoneKey = `${f.aliceId}-library`;
    f.state.cards.set(card.id, card);

    const result = canCastAsPrototype(f.state, f.aliceId, card.id);
    expect(result.canCast).toBe(false);
    expect(result.reason).toBe("Card is not in hand");
  });

  it("rejects when the player cannot afford the prototype cost", () => {
    const f = makeFixture();
    const cardId = putInHand(f.state, f.aliceId, prototypeCard());
    // Empty pool: {2}{U} is unaffordable.
    f.state = addMana(f.state, f.aliceId, { generic: 0 });

    const result = canCastAsPrototype(f.state, f.aliceId, cardId);
    expect(result.canCast).toBe(false);
    expect(result.reason).toBe("Not enough mana for prototype cost");
  });
});

// ---------------------------------------------------------------------------
// Prototype card creation & effective characteristics
// ---------------------------------------------------------------------------

describe("createPrototypeCard", () => {
  it("returns an instance for the given owner/controller with the printed card data intact", () => {
    const cardData = prototypeCard();
    const info = getPrototypeInfo(instanceFrom(cardData));
    const instance = createPrototypeCard(cardData, "p1", "p2", info);

    // createCardInstance only merges id/isToken/tokenData from its options,
    // so the prototype flags are assigned by the casting layer after
    // creation (the same post-create assignment the engine's own callers
    // use for special instances). Here we pin what the factory itself
    // guarantees: identity and the unmodified printed characteristics.
    expect(instance.ownerId).toBe("p1");
    expect(instance.controllerId).toBe("p2");
    expect(instance.cardData.mana_cost).toBe("{7}");
    expect(instance.cardData.name).toBe(cardData.name);
    expect(getPrototypeInfo(instance).hasPrototype).toBe(true);
  });
});

describe("getPrototypePower / getPrototypeToughness", () => {
  it("use the prototype values while prototyped", () => {
    const card = instanceFrom(prototypeCard(), {
      isPrototype: true,
      prototypePower: 1,
      prototypeToughness: 1,
    });
    expect(getPrototypePower(card)).toBe(1);
    expect(getPrototypeToughness(card)).toBe(1);
  });

  it("fall back to printed values when not prototyped", () => {
    const card = instanceFrom(prototypeCard());
    expect(getPrototypePower(card)).toBe(5);
    expect(getPrototypeToughness(card)).toBe(4);
  });

  it('treat variable ("*") values as 0', () => {
    const card = instanceFrom(
      makeCard({ id: "star", power: "*", toughness: "*" }),
    );
    expect(getPrototypePower(card)).toBe(0);
    expect(getPrototypeToughness(card)).toBe(0);
  });

  it("return null when the characteristic is missing", () => {
    const card = instanceFrom(
      makeCard({ id: "nostats", power: undefined, toughness: undefined }),
    );
    expect(getPrototypePower(card)).toBeNull();
    expect(getPrototypeToughness(card)).toBeNull();
  });
});

describe("getPrototypeManaCost", () => {
  it("returns the prototype cost while prototyped", () => {
    const card = instanceFrom(prototypeCard(), {
      isPrototype: true,
      prototypeManaCost: "{2}{U}",
    });
    expect(getPrototypeManaCost(card)).toBe("{2}{U}");
  });

  it("returns the printed cost otherwise, and null when absent", () => {
    expect(getPrototypeManaCost(instanceFrom(prototypeCard()))).toBe("{7}");
    expect(
      getPrototypeManaCost(
        instanceFrom(makeCard({ id: "free", mana_cost: undefined })),
      ),
    ).toBeNull();
  });
});

describe("getPrototypeManaCostForSpell", () => {
  it("parses the prototype cost while prototyped", () => {
    const card = instanceFrom(prototypeCard(), {
      isPrototype: true,
      prototypeManaCost: "{2}{U}",
    });
    const parsed = getPrototypeManaCostForSpell(card);
    expect(parsed).not.toBeNull();
    expect(parsed!.generic).toBe(2);
    expect(parsed!.blue).toBe(1);
  });

  it("parses the printed cost otherwise", () => {
    const parsed = getPrototypeManaCostForSpell(instanceFrom(prototypeCard()));
    expect(parsed).not.toBeNull();
    expect(parsed!.generic).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: initialize / transform / predicate
// ---------------------------------------------------------------------------

describe("initializePrototype", () => {
  it("stashes prototype metadata WITHOUT setting isPrototype (CR 702.152: set at cast time)", () => {
    const card = initializePrototype(instanceFrom(prototypeCard()));
    expect(card.isPrototype).toBe(false);
    expect(card.prototypePower).toBe(1);
    expect(card.prototypeToughness).toBe(1);
    expect(card.prototypeManaCost).toBe("{2}{U}");
  });

  it("returns the card unchanged when it has no prototype", () => {
    const card = instanceFrom(makeCard({ id: "plain" }));
    const result = initializePrototype(card);
    expect(result.prototypePower ?? null).toBeNull();
    expect(result.prototypeToughness ?? null).toBeNull();
  });
});

describe("transformFromPrototype", () => {
  it("clears prototype fields on a prototype permanent", () => {
    const card = instanceFrom(prototypeCard(), {
      isPrototype: true,
      prototypePower: 1,
      prototypeToughness: 1,
      prototypeManaCost: "{2}{U}",
    });
    const reverted = transformFromPrototype(card);
    expect(reverted.isPrototype).toBe(false);
    expect(reverted.prototypePower).toBeNull();
    expect(reverted.prototypeToughness).toBeNull();
    expect(reverted.prototypeManaCost).toBeNull();
  });

  it("returns a non-prototype card as-is", () => {
    const card = instanceFrom(prototypeCard());
    expect(transformFromPrototype(card)).toBe(card);
  });
});

describe("isPrototypePermanent", () => {
  it("tracks the isPrototype flag", () => {
    expect(
      isPrototypePermanent(
        instanceFrom(prototypeCard(), { isPrototype: true }),
      ),
    ).toBe(true);
    expect(isPrototypePermanent(instanceFrom(prototypeCard()))).toBe(false);
  });
});
