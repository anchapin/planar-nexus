/**
 * Wave 4.8 follow-up 6 lane 74 — Multi-quality protection
 * (multi-color / multi-quality) (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * that grant protection from multiple qualities via a single
 * static: "creatures you control have protection from red and
 * from blue" (Akoumep Halberd pattern), or "creatures you
 * control have protection from red and from everything"
 * (Niveous Wisps pattern). The v1 minimum for lane 74 is a
 * test-suite addition: the schema already accepts a
 * `protectionFrom: string[]` of any length (the substrate is
 * the lane 71 `StaticSchema.protectionFrom` arm), and the
 * engine's `hasProtectionFrom` already loops over the array
 * via `perInstance.some(...)` (so multi-quality protection is
 * data-driven; no engine change is needed).
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `protectionFrom: string[]` — optional arm on the static
 *   slot. v1 supports any length (lane 71 single-color
 *   substrate; lane 74 verifies multi-color / multi-quality).
 *
 * Engine (card-scripts/keyword-actions/scripted-statics.ts +
 * evergreen-keywords.ts):
 *   `refreshScriptedStatics` collects `protectionFrom`
 *   values from each static that affects the target and
 *   stamps them on the target's `protectionFrom` ledger.
 *   The field is read by `hasProtectionFrom` via
 *   `perInstance.some((q) => q === color)` — multi-quality
 *   protection is data-driven.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70/71/72/73
 * pattern). The test exercises the refresh path via the
 * engine's `refreshScriptedStatics` (the same call sites the
 * engine uses for a real cast) and inspects the affected
 * permanent's `protectionFrom` field.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { hasProtectionFrom } from "../evergreen-keywords";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Multi-Quality Protection Anthem (lane 74)";

const SCRIPT_MULTI_QUALITY: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Creatures you control have protection from red and from blue.",
  statics: [
    {
      text: "Creatures you control have protection from red and from blue.",
      affects: { controller: "you" },
      protectionFrom: ["red", "blue"],
    },
  ],
});

const SCRIPT_MULTI_QUALITY_WITH_EVERYTHING: CardScript =
  CardScriptSchema.parse({
    name: HOST_NAME + " (with everything)",
    oracle:
      "Creatures you control have protection from red and from everything.",
    statics: [
      {
        text: "Creatures you control have protection from red and from everything.",
        affects: { controller: "you" },
        protectionFrom: ["red", "everything"],
      },
    ],
  });

function makeSourceCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? HOST_NAME,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

const VANILLA_CREATURE: ScryfallCard = {
  id: "mock-vanilla-creature-74",
  name: "Vanilla Creature",
  type_line: "Creature — Human",
  oracle_text: "",
  mana_cost: "{2}",
  cmc: 2,
  colors: [],
  color_identity: [],
  keywords: [],
  power: "2",
  toughness: "2",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

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

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const bfKey = `${controllerId}-battlefield`;
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

describe("Wave 4.8 follow-up 6 lane 74 — multi-quality protection", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([SCRIPT_MULTI_QUALITY]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("accepts the v1 multi-quality protectionFrom: string[] arm", () => {
    // Sanity check on the schema: the script parses and the
    // static carries the multi-quality protection arm.
    const parsed = CardScriptSchema.parse(SCRIPT_MULTI_QUALITY);
    expect(parsed.statics?.[0]?.protectionFrom).toEqual(["red", "blue"]);
  });

  it("accepts protectionFrom: [color, 'everything'] (Niveous Wisps pattern)", () => {
    // Sanity check on the schema: a color + the "everything"
    // quality is allowed in v1.
    const parsed = CardScriptSchema.parse(
      SCRIPT_MULTI_QUALITY_WITH_EVERYTHING,
    );
    expect(parsed.statics?.[0]?.protectionFrom).toEqual([
      "red",
      "everything",
    ]);
  });

  it("stamps both qualities on the affected creature after refresh", () => {
    // Source: multi-quality anthem on Alice's battlefield.
    // Target: vanilla creature Alice controls. After
    // `refreshScriptedStatics`, the target's
    // `protectionFrom` ledger carries `["red", "blue"]`.
    const { state, aliceId } = setupTwoPlayerGame();
    const s = putOnBattlefield(state, aliceId, makeSourceCard({ id: "anthem-multi" })).state;
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      s,
      aliceId,
      VANILLA_CREATURE,
    );
    const refreshed = refreshScriptedStatics(withTarget);
    const target = refreshed.cards.get(targetId);
    expect(target).toBeDefined();
    expect(target?.protectionFrom).toEqual(expect.arrayContaining(["red", "blue"]));
    expect(target?.protectionFrom).toHaveLength(2);
    // hasProtectionFrom: red AND blue are protected, black
    // is not. The per-instance loop is the substrate.
    expect(hasProtectionFrom(target!, "red")).toBe(true);
    expect(hasProtectionFrom(target!, "blue")).toBe(true);
    expect(hasProtectionFrom(target!, "black")).toBe(false);
  });

  it("does NOT stamp protectionFrom on a creature the anthem does not affect", () => {
    // Multi-quality anthem's `affects.controller` is "you"
    // — only Alice's creatures get the protection. Bob's
    // creature does not.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const s = putOnBattlefield(state, aliceId, makeSourceCard({ id: "anthem-multi-bob" })).state;
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      s,
      bobId,
      VANILLA_CREATURE,
    );
    const refreshed = refreshScriptedStatics(withTarget);
    const target = refreshed.cards.get(targetId);
    expect(target).toBeDefined();
    expect(target?.protectionFrom).toBeUndefined();
    expect(hasProtectionFrom(target!, "red")).toBe(false);
    expect(hasProtectionFrom(target!, "blue")).toBe(false);
  });
});
