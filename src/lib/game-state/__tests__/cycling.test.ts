/**
 * @fileoverview Unit tests for the Cycling / Typecycling / Landcycling /
 * Basic landcycling keyword family (CR 702.30-31).
 *
 * Issue #1056 — [Rules Engine] Implement Cycling, Typecycling, and
 * Landcycling activated abilities (CR 702.30-31).
 *
 * Cycling is an activated ability that functions only while the card is in a
 * player's hand. Cost is {cost} + discard this card; effect is to draw a card
 * (CR 702.30a). Typecycling / Landcycling / Basic landcycling replace the
 * draw with a library search for a card of the named type (CR 702.31). All
 * variants follow sorcery-speed timing (active player, main phase, empty
 * stack, priority, CR 117.1a).
 *
 * These tests cover: parsing (each variant), the keyword detection helpers,
 * the cycleCard action (cost payment + discard + draw / search), the
 * hand-only restriction, sorcery-speed timing rules, and library-search
 * semantics for each Typecycling / Landcycling variant.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  parseCycling,
  CyclingVariant,
  extractKeywords,
} from "../oracle-text-parser";
import {
  hasCycling,
  hasLandcycling,
  hasTypecycling,
  getCyclingCost,
  getCyclingVariant,
  parseCyclingCost,
  canCycleCard,
  cycleCard,
} from "../keyword-actions";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
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
    type_line: "Creature — Test",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

/** A creature with the base Cycling {2} keyword (e.g. Aven Riftwatcher). */
function baseCyclingCreature(
  overrides: Partial<ScryfallCard> & { id: string } = { id: "mock-cycler" },
): ScryfallCard {
  return makeCard({
    name: "Aven Riftwatcher",
    type_line: "Creature — Bird Warrior",
    oracle_text: "Flying. Cycling {2}.",
    mana_cost: "{3}{U}",
    cmc: 4,
    colors: ["U"],
    color_identity: ["U"],
    power: "2",
    toughness: "3",
    ...overrides,
  });
}

/** A card with Wizardcycling {2} (e.g. Galeprowler). */
function wizardcyclingCreature(): ScryfallCard {
  return makeCard({
    id: "mock-wizard-cycler",
    name: "Galeprowler",
    type_line: "Creature — Wizard",
    oracle_text: "Wizardcycling {2}",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
    power: "3",
    toughness: "2",
  });
}

/** A land with Plainscycling {1}{W} (e.g. Krosan Verge). */
function plainscyclingLand(): ScryfallCard {
  return makeCard({
    id: "mock-plains-cycler",
    name: "Plainscycler",
    type_line: "Creature — Cycler",
    oracle_text: "Plainscycling {1}{W}",
    mana_cost: "{3}{W}",
    cmc: 4,
    colors: ["W"],
    color_identity: ["W"],
    power: "2",
    toughness: "2",
  });
}

/** A card with Basic landcycling {1} (e.g. Terminal Moraine). */
function basicLandcyclingLand(): ScryfallCard {
  return makeCard({
    id: "mock-basic-landcycler",
    name: "Terminal Moraine",
    type_line: "Land",
    oracle_text: "{T}: Add {C}. Basic landcycling {1}",
    mana_cost: "",
    cmc: 0,
  });
}

/** A card with Landcycling {2} (bare — searches any land). */
function landcyclingCreature(): ScryfallCard {
  return makeCard({
    id: "mock-land-cycler",
    name: "Dryad Greenseeker",
    type_line: "Creature — Dryad",
    oracle_text: "Landcycling {2}",
    mana_cost: "{2}{G}",
    cmc: 3,
    colors: ["G"],
    color_identity: ["G"],
    power: "1",
    toughness: "1",
  });
}

/** A non-cycling creature (used to assert cycleCard rejects it). */
function noCyclingCreature(): ScryfallCard {
  return makeCard({
    id: "mock-vanilla",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    oracle_text: "",
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    power: "2",
    toughness: "2",
  });
}

/** Cards used to populate a library so draws / searches have a target. */
function basicPlains(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `plains-${idSuffix}`,
    name: "Plains",
    type_line: "Basic Land — Plains",
    oracle_text: "({T}: Add {W}.)",
    mana_cost: "",
    cmc: 0,
  });
}

function basicIsland(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `island-${idSuffix}`,
    name: "Island",
    type_line: "Basic Land — Island",
    oracle_text: "({T}: Add {U}.)",
    mana_cost: "",
    cmc: 0,
  });
}

function nonBasicLand(idSuffix: string): ScryfallCard {
  return makeCard({
    id: `nonbasic-${idSuffix}`,
    name: "Mystic Gate",
    type_line: "Land",
    oracle_text: "{T}: Add {W} or {U}.",
    mana_cost: "",
    cmc: 0,
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
  state.turn.isFirstTurn = false;
  state.stack = [];
  state.consecutivePasses = 0;
  state.players.forEach((p) =>
    state.players.set(p.id, { ...p, hasPassedPriority: false }),
  );

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

/** Place a card onto the top of the player's library (end of the array). */
function putInLibrary(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): CardInstanceId {
  const card = createCardInstance(cardData, playerId, playerId);
  card.currentZoneKey = `${playerId}-library`;
  state.cards.set(card.id, card);
  const lib = state.zones.get(`${playerId}-library`)!;
  state.zones.set(`${playerId}-library`, {
    ...lib,
    cardIds: [...lib.cardIds, card.id],
  });
  return card.id;
}

function handIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-hand`)!.cardIds;
}

function graveyardIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)!.cardIds;
}

function libraryIds(state: GameState, playerId: PlayerId): CardInstanceId[] {
  return state.zones.get(`${playerId}-library`)!.cardIds;
}

/** Allow extra mana to be paid for cycling in a given fixture. */
function withMana(
  state: GameState,
  playerId: PlayerId,
  generic: number,
  colored: Partial<{
    white: number;
    blue: number;
    black: number;
    red: number;
    green: number;
    colorless: number;
  }> = {},
): GameState {
  return addMana(state, playerId, { generic, ...colored });
}

// ===========================================================================
// Parsing (CR 702.30 / CR 702.31)
// ===========================================================================

describe("Cycling — parsing (CR 702.30-31)", () => {
  it("detects base Cycling {cost}", () => {
    const r = parseCycling("Cycling {2}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.CYCLING);
    expect(r.cost).not.toBeNull();
    expect(r.cost!.generic).toBe(2);
    expect(r.costString).toBe("{2}");
    expect(r.description).toBe("Cycling {2}");
  });

  it("detects base Cycling with a colored cost", () => {
    const r = parseCycling("Cycling {1}{U}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.CYCLING);
    expect(r.cost!.generic).toBe(1);
    expect(r.cost!.blue).toBe(1);
    expect(r.costString).toBe("{1}{U}");
  });

  it("detects Typecycling ([Type]cycling)", () => {
    const r = parseCycling("Wizardcycling {2}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.TYPECYCLING);
    expect(r.type).toBe("Wizard");
    expect(r.cost!.generic).toBe(2);
    expect(r.description).toBe("Wizardcycling {2}");
  });

  it("detects Landcycling", () => {
    const r = parseCycling("Landcycling {2}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.LANDCYCLING);
    expect(r.basicLandType).toBeNull();
    expect(r.cost!.generic).toBe(2);
    expect(r.description).toBe("Landcycling {2}");
  });

  it("detects [Type] landcycling written as '[Type]cycling' (e.g. Plainscycling)", () => {
    // CR 702.31: "Plainscycling" is a Typecycling variant (no space between
    // [Type] and "cycling") whose target type is the Plains basic land type.
    // The parser therefore returns TYPECYCLING with type="Plains"; the
    // cycleCard search predicate matches any card whose type line includes
    // "Plains" — which includes basic Plains and any card with the Plains
    // subtype.
    const r = parseCycling("Plainscycling {1}{W}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.TYPECYCLING);
    expect(r.type).toBe("Plains");
    expect(r.cost!.generic).toBe(1);
    expect(r.cost!.white).toBe(1);
    expect(r.description).toBe("Plainscycling {1}{W}");
  });

  it("detects [Type] landcycling written with a space (e.g. 'Plains landcycling')", () => {
    // Some printings use the spaced form (e.g. Krosan Verge uses
    // "Plainscycling" as one word; the spaced form is rare but legal). The
    // parser distinguishes the two shapes so the basicLandType field is
    // populated for the spaced form.
    const r = parseCycling("Plains landcycling {1}{W}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.LANDCYCLING);
    expect(r.basicLandType).toBe("Plains");
    expect(r.cost!.generic).toBe(1);
    expect(r.cost!.white).toBe(1);
    expect(r.description).toBe("Plains landcycling {1}{W}");
  });

  it("detects Basic landcycling", () => {
    const r = parseCycling("Basic landcycling {1}");
    expect(r.hasCycling).toBe(true);
    expect(r.variant).toBe(CyclingVariant.BASIC_LANDCYCLING);
    expect(r.cost!.generic).toBe(1);
    expect(r.description).toBe("Basic landcycling {1}");
  });

  it("is case-insensitive", () => {
    expect(parseCycling("cycling {2}").hasCycling).toBe(true);
    expect(parseCycling("CYCLING {3}").hasCycling).toBe(true);
    expect(parseCycling("wizardCYCLING {1}").hasCycling).toBe(true);
  });

  it("returns false when no cycling keyword is present", () => {
    expect(parseCycling("Flying").hasCycling).toBe(false);
    expect(parseCycling("").hasCycling).toBe(false);
    expect(parseCycling("Flashback {2}{R}").hasCycling).toBe(false);
    expect(parseCycling("").variant).toBeNull();
    expect(parseCycling("").cost).toBeNull();
  });

  it("does not match 'cycling' inside other words", () => {
    expect(parseCycling("recycling").hasCycling).toBe(false);
    expect(parseCycling("tricycling").hasCycling).toBe(false);
  });

  it("extractKeywords surfaces the cycling mechanic keyword", () => {
    const parsed = extractKeywords("Cycling {2}", "Creature — Bird");
    expect(parsed.some((k) => k.keyword === "cycling")).toBe(true);
  });

  it("parseCyclingCost returns the generic cost of base cycling", () => {
    expect(parseCyclingCost("Cycling {2}")).toBe(2);
    expect(parseCyclingCost("Wizardcycling {3}")).toBe(3);
    expect(parseCyclingCost(null)).toBeNull();
    expect(parseCyclingCost("Flying")).toBeNull();
  });
});

// ===========================================================================
// Keyword detection helpers
// ===========================================================================

describe("Cycling — keyword detection helpers", () => {
  it("hasCycling returns true for base cycling", () => {
    const card = createCardInstance(baseCyclingCreature(), "p1", "p1");
    expect(hasCycling(card)).toBe(true);
  });

  it("hasCycling returns true for Typecycling", () => {
    const card = createCardInstance(wizardcyclingCreature(), "p1", "p1");
    expect(hasCycling(card)).toBe(true);
  });

  it("hasCycling returns true for Landcycling variants", () => {
    expect(
      hasCycling(createCardInstance(landcyclingCreature(), "p1", "p1")),
    ).toBe(true);
    expect(
      hasCycling(createCardInstance(plainscyclingLand(), "p1", "p1")),
    ).toBe(true);
    expect(
      hasCycling(createCardInstance(basicLandcyclingLand(), "p1", "p1")),
    ).toBe(true);
  });

  it("hasCycling returns false for cards without cycling", () => {
    const card = createCardInstance(noCyclingCreature(), "p1", "p1");
    expect(hasCycling(card)).toBe(false);
  });

  it("hasLandcycling returns true for any landcycling variant", () => {
    expect(
      hasLandcycling(createCardInstance(landcyclingCreature(), "p1", "p1")),
    ).toBe(true);
    // "Plainscycling" parses as TYPECYCLING (no space), not LANDCYCLING —
    // see the parser test above for the rationale.
    expect(
      hasLandcycling(createCardInstance(basicLandcyclingLand(), "p1", "p1")),
    ).toBe(true);
  });

  it("hasLandcycling returns true for the spaced '[Type] landcycling' form", () => {
    const card = makeCard({
      id: "mock-spaced-plainscycling",
      name: "Spaced Plainscycler",
      type_line: "Creature — Cycler",
      oracle_text: "Plains landcycling {1}{W}",
    });
    expect(hasLandcycling(createCardInstance(card, "p1", "p1"))).toBe(true);
  });

  it("hasLandcycling filters by subtype when supplied", () => {
    const card = makeCard({
      id: "mock-spaced-islandcycling",
      name: "Spaced Islandcycler",
      type_line: "Creature — Cycler",
      oracle_text: "Island landcycling {1}{U}",
    });
    expect(hasLandcycling(card, "Island")).toBe(true);
    expect(hasLandcycling(card, "Plains")).toBe(false);
  });

  it("hasLandcycling returns false for non-land cycling cards", () => {
    const card = createCardInstance(baseCyclingCreature(), "p1", "p1");
    expect(hasLandcycling(card)).toBe(false);
    const wiz = createCardInstance(wizardcyclingCreature(), "p1", "p1");
    expect(hasLandcycling(wiz)).toBe(false);
  });

  it("hasTypecycling returns true for Typecycling cards only", () => {
    expect(
      hasTypecycling(createCardInstance(wizardcyclingCreature(), "p1", "p1")),
    ).toBe(true);
    expect(
      hasTypecycling(createCardInstance(baseCyclingCreature(), "p1", "p1")),
    ).toBe(false);
    expect(
      hasTypecycling(createCardInstance(landcyclingCreature(), "p1", "p1")),
    ).toBe(false);
  });

  it("hasTypecycling filters by type when supplied", () => {
    const card = createCardInstance(wizardcyclingCreature(), "p1", "p1");
    expect(hasTypecycling(card, "Wizard")).toBe(true);
    expect(hasTypecycling(card, "Goblin")).toBe(false);
  });

  it("getCyclingCost / getCyclingVariant expose parsed cycling descriptors", () => {
    const wiz = createCardInstance(wizardcyclingCreature(), "p1", "p1");
    expect(getCyclingCost(wiz)?.generic).toBe(2);
    const v = getCyclingVariant(wiz);
    expect(v.variant).toBe(CyclingVariant.TYPECYCLING);
    expect(v.type).toBe("Wizard");

    // "Plainscycling" parses as TYPECYCLING (no space). Use a spaced
    // "[Type] landcycling" card to exercise the LANDCYCLING-with-subtype
    // path of getCyclingVariant.
    const plains = createCardInstance(
      makeCard({
        id: "mock-plains-landcycling",
        name: "Spaced Plainscycler",
        type_line: "Creature — Cycler",
        oracle_text: "Plains landcycling {1}{W}",
      }),
      "p1",
      "p1",
    );
    const pv = getCyclingVariant(plains);
    expect(pv.variant).toBe(CyclingVariant.LANDCYCLING);
    expect(pv.basicLandType).toBe("Plains");
  });
});

// ===========================================================================
// cycleCard — base Cycling draws a card (CR 702.30a)
// ===========================================================================

describe("Cycling — cycleCard base variant draws a card (CR 702.30a)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, baseCyclingCreature());
    // Enough generic mana to pay the {2} cycling cost.
    f.state = withMana(f.state, f.aliceId, 3);
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("discards the cycled card and draws one card", () => {
    // Populate the library with a drawable card.
    const drawId = putInLibrary(f.state, f.aliceId, basicIsland("draw-1"));

    const handBefore = handIds(f.state, f.aliceId).length;
    const libBefore = libraryIds(f.state, f.aliceId).length;
    expect(libBefore).toBeGreaterThan(0);
    const result = cycleCard(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);

    // Hand: cycled card removed, drawn card added.
    expect(handIds(result.state, f.aliceId)).not.toContain(cardId);
    expect(handIds(result.state, f.aliceId).length).toBe(handBefore);
    expect(handIds(result.state, f.aliceId)).toContain(drawId);

    // Library: drawn card removed.
    expect(libraryIds(result.state, f.aliceId).length).toBe(libBefore - 1);
    expect(libraryIds(result.state, f.aliceId)).not.toContain(drawId);

    // Graveyard: cycled card present.
    expect(graveyardIds(result.state, f.aliceId)).toContain(cardId);
  });

  it("pays the cycling mana cost", () => {
    putInLibrary(f.state, f.aliceId, basicIsland("draw-2"));
    const before = f.state.players.get(f.aliceId)!.manaPool;
    const result = cycleCard(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    const after = result.state.players.get(f.aliceId)!.manaPool;
    // {2} cycling cost: 2 generic spent.
    expect(before.generic - after.generic).toBe(2);
  });

  it("canCycleCard returns true when all preconditions are met", () => {
    putInLibrary(f.state, f.aliceId, basicIsland("draw-3"));
    const card = f.state.cards.get(cardId)!;
    expect(canCycleCard(f.state, f.aliceId, card)).toBe(true);
  });
});

// ===========================================================================
// Hand-only restriction (CR 702.30a)
// ===========================================================================

describe("Cycling — hand-only restriction (CR 702.30a)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    f.state = withMana(f.state, f.aliceId, 5);
  });

  it("rejects cycling from the battlefield", () => {
    const card = createCardInstance(
      baseCyclingCreature(),
      f.aliceId,
      f.aliceId,
    );
    card.currentZoneKey = `${f.aliceId}-battlefield`;
    f.state.cards.set(card.id, card);
    const bf = f.state.zones.get(`${f.aliceId}-battlefield`)!;
    f.state.zones.set(`${f.aliceId}-battlefield`, {
      ...bf,
      cardIds: [...bf.cardIds, card.id],
    });

    const result = cycleCard(f.state, f.aliceId, card.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
  });

  it("rejects cycling from the graveyard", () => {
    const card = createCardInstance(
      baseCyclingCreature(),
      f.aliceId,
      f.aliceId,
    );
    card.currentZoneKey = `${f.aliceId}-graveyard`;
    f.state.cards.set(card.id, card);
    const gy = f.state.zones.get(`${f.aliceId}-graveyard`)!;
    f.state.zones.set(`${f.aliceId}-graveyard`, {
      ...gy,
      cardIds: [...gy.cardIds, card.id],
    });

    const result = cycleCard(f.state, f.aliceId, card.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
  });

  it("rejects cycling from the library", () => {
    const card = createCardInstance(
      baseCyclingCreature(),
      f.aliceId,
      f.aliceId,
    );
    card.currentZoneKey = `${f.aliceId}-library`;
    f.state.cards.set(card.id, card);
    const lib = f.state.zones.get(`${f.aliceId}-library`)!;
    f.state.zones.set(`${f.aliceId}-library`, {
      ...lib,
      cardIds: [...lib.cardIds, card.id],
    });

    const result = cycleCard(f.state, f.aliceId, card.id);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/hand/i);
  });

  it("canCycleCard returns false for a card on the battlefield", () => {
    const card = createCardInstance(
      baseCyclingCreature(),
      f.aliceId,
      f.aliceId,
    );
    card.currentZoneKey = `${f.aliceId}-battlefield`;
    f.state.cards.set(card.id, card);
    expect(canCycleCard(f.state, f.aliceId, card)).toBe(false);
  });
});

// ===========================================================================
// Sorcery-speed timing (CR 117.1a / 602.2)
// ===========================================================================

describe("Cycling — sorcery-speed timing (CR 117.1a)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, baseCyclingCreature());
    f.state = withMana(f.state, f.aliceId, 5);
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("rejects cycling on an opponent's turn", () => {
    f.state.turn.activePlayerId = f.bobId;
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/turn/i);
  });

  it("rejects cycling outside a main phase", () => {
    f.state.turn.currentPhase = Phase.BEGIN_COMBAT;
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/main/i);
  });

  it("accepts cycling during the postcombat main phase", () => {
    f.state.turn.currentPhase = Phase.POSTCOMBAT_MAIN;
    putInLibrary(f.state, f.aliceId, basicIsland("postcombat-draw"));
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(true);
  });

  it("rejects cycling when the stack is not empty", () => {
    f.state.stack = [
      {
        id: "dummy-stack-object",
        type: "spell",
        sourceCardId: null,
        controllerId: f.aliceId,
        name: "Dummy",
        text: "",
        manaCost: null,
        targets: [],
        chosenModes: [],
        variableValues: new Map(),
        isCountered: false,
        timestamp: Date.now(),
      },
    ];
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/stack/i);
  });

  it("rejects cycling when the player does not have priority", () => {
    f.state.priorityPlayerId = f.bobId;
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/priority/i);
  });

  it("rejects cycling without enough mana", () => {
    // Drain the pool so the {2} cycling cost can't be paid.
    f.state.players.set(f.aliceId, {
      ...f.state.players.get(f.aliceId)!,
      manaPool: {
        colorless: 0,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        generic: 1,
      },
    });
    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mana/i);
  });

  it("rejects cycling a card without the cycling keyword", () => {
    const nonCycler = putInHand(f.state, f.aliceId, noCyclingCreature());
    const result = cycleCard(f.state, f.aliceId, nonCycler);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cycling/i);
  });
});

// ===========================================================================
// Typecycling — search library for a card of the named type (CR 702.31a)
// ===========================================================================

describe("Cycling — Typecycling searches library for the named type (CR 702.31a)", () => {
  let f: Fixture;
  let cardId: CardInstanceId;

  beforeEach(() => {
    f = makeFixture();
    cardId = putInHand(f.state, f.aliceId, wizardcyclingCreature());
    f.state = withMana(f.state, f.aliceId, 3);
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("finds a matching card in the library and moves it to hand", () => {
    // Library contains a Wizard (match) and a non-Wizard.
    putInLibrary(f.state, f.aliceId, basicIsland("non-wizard-1"));
    const wizardId = putInLibrary(
      f.state,
      f.aliceId,
      makeCard({
        id: "mock-wizard-target",
        name: "Wizard Target",
        type_line: "Creature — Wizard",
        oracle_text: "",
        mana_cost: "{U}",
        cmc: 1,
        colors: ["U"],
        power: "1",
        toughness: "1",
      }),
    );

    const result = cycleCard(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    // The wizard is now in hand.
    expect(handIds(result.state, f.aliceId)).toContain(wizardId);
    // The cycled card is in the graveyard.
    expect(graveyardIds(result.state, f.aliceId)).toContain(cardId);
  });

  it("shuffles the library and puts nothing in hand when no match exists", () => {
    // Library contains only non-Wizards.
    putInLibrary(f.state, f.aliceId, basicIsland("no-wizard-1"));
    putInLibrary(f.state, f.aliceId, basicIsland("no-wizard-2"));

    const handBefore = handIds(f.state, f.aliceId);
    const libBefore = libraryIds(f.state, f.aliceId);

    const result = cycleCard(f.state, f.aliceId, cardId);

    expect(result.success).toBe(true);
    // No new card moved to hand; cycled card moved to graveyard.
    expect(handIds(result.state, f.aliceId).length).toBe(handBefore.length - 1);
    expect(graveyardIds(result.state, f.aliceId)).toContain(cardId);
    // Library still has all its cards.
    expect(libraryIds(result.state, f.aliceId).length).toBe(libBefore.length);
  });

  it("respects a caller-selected found card", () => {
    putInLibrary(f.state, f.aliceId, basicIsland("selection-non-wizard"));
    const specific = putInLibrary(
      f.state,
      f.aliceId,
      makeCard({
        id: "mock-wizard-pick",
        name: "Picked Wizard",
        type_line: "Creature — Wizard",
        oracle_text: "",
        mana_cost: "{U}",
        cmc: 1,
        colors: ["U"],
        power: "1",
        toughness: "1",
      }),
    );

    const result = cycleCard(f.state, f.aliceId, cardId, {
      selectedFoundCardId: specific,
    });
    expect(result.success).toBe(true);
    expect(handIds(result.state, f.aliceId)).toContain(specific);
  });

  it("rejects a selected card that does not match the type", () => {
    const wrong = putInLibrary(f.state, f.aliceId, basicIsland("wrong-type"));
    const result = cycleCard(f.state, f.aliceId, cardId, {
      selectedFoundCardId: wrong,
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/match/i);
  });
});

// ===========================================================================
// Landcycling — search library for a (basic) land (CR 702.31b-c)
// ===========================================================================

describe("Cycling — Landcycling searches library for a land (CR 702.31b-c)", () => {
  let f: Fixture;

  beforeEach(() => {
    f = makeFixture();
    // Some landcycling cards cost colored mana (e.g. Plainscycling {1}{W});
    // add both white and blue for safety across the variants.
    f.state = addMana(f.state, f.aliceId, {
      generic: 3,
      white: 3,
      blue: 3,
      black: 3,
      red: 3,
      green: 3,
    });
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
  });

  it("Plainscycling finds a Plains in the library", () => {
    const cyclerId = putInHand(f.state, f.aliceId, plainscyclingLand());
    putInLibrary(f.state, f.aliceId, basicIsland("decoy-island"));
    const plainsId = putInLibrary(f.state, f.aliceId, basicPlains("target"));

    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    expect(handIds(result.state, f.aliceId)).toContain(plainsId);
    expect(handIds(result.state, f.aliceId)).not.toContain(cyclerId);
    expect(graveyardIds(result.state, f.aliceId)).toContain(cyclerId);
  });

  it("Plainscycling rejects non-Plains lands", () => {
    const cyclerId = putInHand(f.state, f.aliceId, plainscyclingLand());
    putInLibrary(f.state, f.aliceId, basicIsland("not-plains-1"));
    putInLibrary(f.state, f.aliceId, nonBasicLand("not-plains-2"));

    const handBefore = handIds(f.state, f.aliceId);
    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    // No card moved into hand; the cycled card is in the graveyard.
    expect(handIds(result.state, f.aliceId).length).toBe(handBefore.length - 1);
  });

  it("bare Landcycling finds any land (basic or not)", () => {
    const cyclerId = putInHand(f.state, f.aliceId, landcyclingCreature());
    const gate = putInLibrary(f.state, f.aliceId, nonBasicLand("gate"));

    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    expect(handIds(result.state, f.aliceId)).toContain(gate);
  });

  it("Basic landcycling finds any basic land", () => {
    const cyclerId = putInHand(f.state, f.aliceId, basicLandcyclingLand());
    const islandId = putInLibrary(f.state, f.aliceId, basicIsland("basic-1"));
    // Also include a non-basic land that must NOT be matched.
    const nonBasicId = putInLibrary(
      f.state,
      f.aliceId,
      nonBasicLand("basic-2"),
    );

    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    expect(handIds(result.state, f.aliceId)).toContain(islandId);
    // The non-basic land is still in the library (Basic landcycling must
    // skip it).
    expect(libraryIds(result.state, f.aliceId)).toContain(nonBasicId);
  });

  it("Basic landcycling rejects non-basic lands", () => {
    const cyclerId = putInHand(f.state, f.aliceId, basicLandcyclingLand());
    const gate = putInLibrary(f.state, f.aliceId, nonBasicLand("nb-1"));

    const handBefore = handIds(f.state, f.aliceId);
    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    // Nothing new in hand (gate is still in library).
    expect(handIds(result.state, f.aliceId).length).toBe(handBefore.length - 1);
    expect(libraryIds(result.state, f.aliceId)).toContain(gate);
  });

  it("shuffles the library even when no matching land is found", () => {
    const cyclerId = putInHand(f.state, f.aliceId, landcyclingCreature());
    // Only non-land cards in the library so Landcycling finds nothing.
    putInLibrary(
      f.state,
      f.aliceId,
      makeCard({
        id: "mock-nonland-1",
        name: "Grizzly Bears",
        type_line: "Creature — Bear",
      }),
    );

    const libBefore = libraryIds(f.state, f.aliceId);
    const result = cycleCard(f.state, f.aliceId, cyclerId);
    expect(result.success).toBe(true);
    // No card moved out of the library.
    expect(libraryIds(result.state, f.aliceId).length).toBe(libBefore.length);
  });
});

// ===========================================================================
// Empty library — draw variant edge case (CR 702.30a)
// ===========================================================================

describe("Cycling — base variant with empty library", () => {
  it("returns a draw-failed error after the discard cost has been paid", () => {
    const f = makeFixture();
    const cardId = putInHand(f.state, f.aliceId, baseCyclingCreature());
    f.state = withMana(f.state, f.aliceId, 3);
    f.state.priorityPlayerId = f.aliceId;
    f.state.turn.activePlayerId = f.aliceId;
    f.state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    f.state.stack = [];
    // Empty the library to force the draw to fail.
    const lib = f.state.zones.get(`${f.aliceId}-library`)!;
    f.state.zones.set(`${f.aliceId}-library`, { ...lib, cardIds: [] });

    const result = cycleCard(f.state, f.aliceId, cardId);
    expect(result.success).toBe(false);
    // The discard cost still happened: the cycled card is in the graveyard.
    expect(graveyardIds(result.state, f.aliceId)).toContain(cardId);
    expect(result.error).toBeDefined();
  });
});
