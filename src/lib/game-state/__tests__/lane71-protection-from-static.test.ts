/**
 * Wave 4.8 follow-up 5 lane 71 — Protection-from static
 * (#2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards
 * that grant protection to other creatures via a static:
 * "creatures you control have protection from [color]" or
 * "creatures you control have protection from [quality]". The
 * v1 minimum adds a `protectionFrom: string[]` arm on
 * `StaticSchema` that the engine stamps on each affected
 * permanent's per-instance `protectionFrom: string[]`
 * field.
 *
 * Schema (card-scripts/schema.ts, StaticSchema):
 *   `protectionFrom: string[]` — optional arm on the static
 *   slot. v1 supports a single color (e.g. `["red"]`) and
 *   the "everything" quality (`["everything"]`). Multi-
 *   color and "choose-a-quality" protection are follow-up
 *   lanes.
 *
 * Engine (card-scripts/keyword-actions/scripted-statics.ts):
 *   `refreshScriptedStatics` collects `protectionFrom`
 *   values from each static that affects the target and
 *   stamps them on the target's `protectionFrom` ledger.
 *   The field is read by `hasProtectionFrom` in
 *   `evergreen-keywords.ts` alongside the parsed keyword
 *   list and the regex fallback — a creature with
 *   `protectionFrom: ["red"]` cannot be the target of a
 *   red spell (CR 702.16a), cannot be blocked by a red
 *   creature (CR 702.16d), and cannot be dealt damage by a
 *   red source (CR 702.16c). Battlefield-zone-only
 *   semantics: the field is cleared when the source
 *   leaves the battlefield.
 *
 * Test harness pattern: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts` (the
 * lane 49/52/55/59/60/62/63/64/65/66/67/68/69/70 pattern).
 * The test exercises the refresh path via the engine's
 * `refreshScriptedStatics` (the same call sites the engine
 * uses for a real cast) and inspects the affected
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

const HOST_NAME = "Test Protection From Red Anthem (lane 71)";

const PROTECTION_FROM_RED_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Creatures you control have protection from red.",
  statics: [
    {
      text: "Creatures you control have protection from red.",
      affects: { controller: "you" },
      protectionFrom: ["red"],
    },
  ],
});

function makeCard(
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

/**
 * Adds a card directly to the named player's battlefield.
 */
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

describe("Wave 4.8 follow-up 5 lane 71 — protection-from static", () => {
  beforeAll(() => {
    resetCardScriptsForTests();
    registerCardScripts([PROTECTION_FROM_RED_SCRIPT]);
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  it("rejects a script with an unknown protectionFrom entry (empty string)", () => {
    // Schema guard: every entry must be at least 1 character.
    expect(() =>
      CardScriptSchema.parse({
        name: "Bad protectionFrom (lane 71)",
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { controller: "you" },
            protectionFrom: [""],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts the v1 protectionFrom schema (single color)", () => {
    // Sanity check: the script parses and the static carries
    // the protection arm.
    const parsed = CardScriptSchema.parse(PROTECTION_FROM_RED_SCRIPT);
    expect(parsed.statics?.[0]?.protectionFrom).toEqual(["red"]);
  });

  it("stamps protectionFrom on each affected creature after refresh", () => {
    // Source: the protection-from-red anthem on Alice's
    // battlefield. Target: a vanilla creature Alice
    // controls. After `refreshScriptedStatics`, the
    // target's `protectionFrom` ledger carries `["red"]`.
    const { state, aliceId } = setupTwoPlayerGame();
    const sourceCardDef: ScryfallCard = makeCard({ id: "anthem-source" });
    const targetCardDef: ScryfallCard = {
      id: "mock-vanilla-creature",
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
    const s = putOnBattlefield(state, aliceId, sourceCardDef).state;
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      s,
      aliceId,
      targetCardDef,
    );
    const refreshed = refreshScriptedStatics(withTarget);
    const target = refreshed.cards.get(targetId);
    expect(target).toBeDefined();
    expect(target?.protectionFrom).toEqual(["red"]);
    // hasProtectionFrom consults the field. Red is
    // protected; blue is not.
    expect(hasProtectionFrom(target!, "red")).toBe(true);
    expect(hasProtectionFrom(target!, "blue")).toBe(false);
  });

  it("does NOT stamp protectionFrom on a creature the anthem does not affect", () => {
    // The anthem's `affects.controller` is "you" — only
    // Alice's creatures get the protection. Bob's
    // creature does not.
    const { state, aliceId, bobId } = setupTwoPlayerGame();
    const sourceCardDef: ScryfallCard = makeCard({ id: "anthem-source" });
    const targetCardDef: ScryfallCard = {
      id: "mock-bobs-creature",
      name: "Bob's Creature",
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
    const s = putOnBattlefield(state, aliceId, sourceCardDef).state;
    const { state: withTarget, cardId: targetId } = putOnBattlefield(
      s,
      bobId,
      targetCardDef,
    );
    const refreshed = refreshScriptedStatics(withTarget);
    const target = refreshed.cards.get(targetId);
    expect(target).toBeDefined();
    expect(target?.protectionFrom).toBeUndefined();
    expect(hasProtectionFrom(target!, "red")).toBe(false);
  });
});