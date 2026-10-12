/**
 * Wave 4.8 follow-up 10 lane 78 — Cross-zones copy
 * (#2614 follow-up). The until-EOT copy family (lane
 * 75 / 75b / 75c / 75d / 75e) overlays the target's
 * printed `cardData` onto the source's `cardData`. v1
 * required the target to be on the battlefield
 * (`currentZoneKey?.endsWith("-battlefield")`). Lane
 * 78 removes the battlefield-only constraint — the
 * overlay applies for any target whose zone is in
 * `state.zones` (a "tracked zone"). Cross-zones copy
 * is battlefield-zone-only for the SOURCE (the source
 * must be on the battlefield for the static to apply)
 * but the target can be in any zone the engine tracks
 * (graveyard, exile, hand, library, command).
 *
 * Background: CR 707.2 "copy a card that's not in play"
 * is the canonical example — a `become_copy` static
 * that points at a card in a graveyard is valid.
 * v1's battlefield-only constraint incorrectly dropped
 * the overlay for graveyard / hand / exile / library
 * targets. Lane 78 fixes the constraint by checking
 * `state.zones.has(target.currentZoneKey)` instead of
 * the zone suffix.
 *
 * Coverage:
 * - Source copies a target in graveyard (CR 707.2
 *   "copy a card that's not in play") → overlay
 *   applies (target's printed `cardData` overlaid
 *   onto the source's `cardData`).
 * - Source copies a target in exile → overlay
 *   applies.
 * - Source copies a target in hand → overlay
 *   applies.
 * - Source copies a target in an untracked zone
 *   (a zone key that's NOT in `state.zones`) →
 *   overlay is dropped.
 * - Aura overlay (lane 75d) on an enchanted card
 *   whose chosen target is in graveyard → overlay
 *   applies (Aura mirror of the static path).
 *
 * Test harness pattern: synthetic card scripts
 * registered via `CardScriptSchema.parse +
 * registerCardScripts` (the lane 49/52/55/59/60/62/63
 * /64/65/66/67/68/69/70/71/72/73/74/75/75a/75b/75c/75d/76/77
 * pattern). The test exercises the refresh path via
 * `refreshScriptedStatics` (static path) and
 * `refreshAuraBonuses` (Aura path) and inspects the
 * source's overlaid `cardData` + `animatedUntilEndOfTurn`
 * (printed backup) + `copyOfTargetId` ledger.
 */
import { describe, it, expect, afterAll } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
  registerCardDataForTests,
  resetCardDataForTests,
} from "../card-scripts/registry";
import { refreshScriptedStatics } from "../keyword-actions/scripted-statics";
import { refreshAuraBonuses } from "../keyword-actions/aura-bonus";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Cross-Zones Copy (lane 78)";

/**
 * Grizzly Bears — a vanilla 2/2 green bear (no
 * keywords, no static). The "target" in the
 * cross-zones scenarios.
 */
const GRIZZLY_BEARS: ScryfallCard = {
  id: "mock-grizzly-bears-78",
  name: "Grizzly Bears",
  type_line: "Creature — Bear",
  oracle_text: "",
  mana_cost: "{1}{G}",
  cmc: 2,
  colors: ["G"],
  color_identity: ["G"],
  keywords: [],
  power: "2",
  toughness: "2",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

/**
 * Serra Angel — a vanilla 4/4 white angel with
 * flying and vigilance. The "target" in the exile
 * scenario.
 */
const SERRA_ANGEL: ScryfallCard = {
  id: "mock-serra-angel-78",
  name: "Serra Angel",
  type_line: "Creature — Angel",
  oracle_text: "Flying, vigilance",
  mana_cost: "{3}{W}",
  cmc: 4,
  colors: ["W"],
  color_identity: ["W"],
  keywords: ["flying", "vigilance"],
  power: "4",
  toughness: "4",
  legalities: { standard: "legal" },
  layout: "normal",
} as ScryfallCard;

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
}

function setupTwoPlayerGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return { state, aliceId: playerIds[0] };
}

function makeShapeChanger(
  overrides: Partial<ScryfallCard> & { id: string; name: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{U}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["U"],
    color_identity: overrides.color_identity ?? ["U"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "0",
    toughness: overrides.toughness ?? "0",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
  options: Partial<CardInstance> = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random()
    .toString(36)
    .slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
    ...options,
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

/**
 * Add a card directly to a named zone (not just the
 * battlefield). Updates both `state.cards` and the
 * zone's `cardIds` list so the engine's
 * `battlefieldCards` / `state.zones.has` checks
 * reflect the placement.
 */
function putInZone(
  state: GameState,
  zoneKey: string,
  cardDef: ScryfallCard,
  controllerId: PlayerId,
  options: Partial<CardInstance> = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `card-${cardDef.id}-${Math.random()
    .toString(36)
    .slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: zoneKey,
    ...options,
  });
  const newCards = new Map(state.cards);
  newCards.set(cardId, card);
  const newZones = new Map(state.zones);
  const zone = newZones.get(zoneKey);
  if (zone) {
    newZones.set(zoneKey, { ...zone, cardIds: [...zone.cardIds, cardId] });
  }
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

/**
 * Register the source's `become_copy` static script
 * pointing at the given target id.
 */
function registerBecomeCopyScript(
  sourceName: string,
  targetId: string,
): void {
  const script: CardScript = CardScriptSchema.parse({
    name: sourceName,
    oracle:
      "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
    statics: [
      {
        text:
          "As long as this is in play, it's a copy of [chosen permanent] until end of turn.",
        affects: { controller: "you" },
        become_copy: {
          target: targetId,
          until: "end_of_turn",
        },
      },
    ],
  });
  registerCardScripts([script]);
}

/**
 * Register the Aura's `become_copy` arm pointing at
 * the given target id. The Aura's enchanted card gets
 * the overlay (lane 75d).
 */
function registerAuraCopyScript(auraName: string, targetId: string): void {
  const script: CardScript = CardScriptSchema.parse({
    name: auraName,
    oracle:
      "Enchanted creature is a copy of [chosen permanent] until end of turn.",
    aura: {
      text:
        "Enchanted creature is a copy of [chosen permanent] until end of turn.",
      static: {
        text:
          "Enchanted creature is a copy of [chosen permanent] until end of turn.",
        become_copy: {
          target: targetId,
          until: "end_of_turn",
        },
      },
    },
  });
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 10 lane 78 — Cross-zones copy", () => {
  afterAll(() => {
    resetCardScriptsForTests();
    resetCardDataForTests();
  });

  it("rolls the graveyard target's printed cardData onto the source (CR 707.2)", () => {
    // Setup: Grizzly Bears (the target) in Alice's
    // graveyard. Then a shapeshifter (the source)
    // on Alice's battlefield with lane 75's
    // `become_copy` static pointing at the bear.
    //
    // After `refreshScriptedStatics`:
    // - The bear's printed `cardData` is overlaid
    //   onto the source's `cardData` (name,
    //   type_line, P/T, colors, keywords).
    // - The source's printed `cardData` is
    //   preserved under `animatedUntilEndOfTurn`.
    // - `copyOfTargetId` is set to the bear's id.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    // Place the bear in Alice's graveyard (the
    // target is NOT on the battlefield).
    const { state: withGrizzly, cardId: grizzlyId } = putInZone(
      state,
      `${aliceId}-graveyard`,
      GRIZZLY_BEARS,
      aliceId,
    );
    const SOURCE_NAME = `${HOST_NAME} graveyard source`;
    registerBecomeCopyScript(SOURCE_NAME, grizzlyId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withGrizzly,
      aliceId,
      makeShapeChanger({ id: "src-78-gy", name: SOURCE_NAME }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // The source overlays the bear's printed
    // characteristics (lane 78: graveyard is a
    // tracked zone, so the overlay applies).
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe("Creature — Bear");
    expect(source?.cardData.power).toBe("2");
    expect(source?.cardData.toughness).toBe("2");
    // Source's printed `cardData` is preserved
    // under `animatedUntilEndOfTurn` so the EOT
    // cleanup rolls it back.
    expect(source?.animatedUntilEndOfTurn?.cardData.name).toBe(SOURCE_NAME);
    // `copyOfTargetId` is set to the bear's id
    // (the bear is in graveyard, not battlefield,
    // but lane 78 allows the overlay for tracked
    // zones).
    expect(source?.copyOfTargetId).toBe(grizzlyId);
    // The bear itself is unchanged.
    const bear = refreshed.cards.get(grizzlyId);
    expect(bear?.cardData.name).toBe("Grizzly Bears");
    expect(bear?.currentZoneKey).toBe(`${aliceId}-graveyard`);
  });

  it("rolls the exile target's printed cardData onto the source", () => {
    // The target is in Alice's exile zone. The
    // overlay applies (exile is a tracked zone).
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([SERRA_ANGEL]);
    const { state: withAngel, cardId: angelId } = putInZone(
      state,
      `${aliceId}-exile`,
      SERRA_ANGEL,
      aliceId,
    );
    const SOURCE_NAME = `${HOST_NAME} exile source`;
    registerBecomeCopyScript(SOURCE_NAME, angelId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withAngel,
      aliceId,
      makeShapeChanger({ id: "src-78-exile", name: SOURCE_NAME }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe("Serra Angel");
    expect(source?.cardData.type_line).toBe("Creature — Angel");
    expect(source?.cardData.power).toBe("4");
    expect(source?.cardData.toughness).toBe("4");
    expect(source?.cardData.keywords).toEqual(["flying", "vigilance"]);
    expect(source?.copyOfTargetId).toBe(angelId);
  });

  it("rolls the hand target's printed cardData onto the source", () => {
    // The target is in Alice's hand. The overlay
    // applies (hand is a tracked zone).
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    const { state: withBear, cardId: bearId } = putInZone(
      state,
      `${aliceId}-hand`,
      GRIZZLY_BEARS,
      aliceId,
    );
    const SOURCE_NAME = `${HOST_NAME} hand source`;
    registerBecomeCopyScript(SOURCE_NAME, bearId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      withBear,
      aliceId,
      makeShapeChanger({ id: "src-78-hand", name: SOURCE_NAME }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    expect(source?.cardData.name).toBe("Grizzly Bears");
    expect(source?.cardData.type_line).toBe("Creature — Bear");
    expect(source?.cardData.power).toBe("2");
    expect(source?.copyOfTargetId).toBe(bearId);
  });

  it("drops the overlay when the target is in an untracked zone", () => {
    // The target's `currentZoneKey` is set to a
    // zone key that's NOT in `state.zones` (a
    // non-existent / untracked zone). Lane 78's
    // "in a tracked zone" check
    // (`state.zones.has(target.currentZoneKey)`)
    // returns false → overlay is dropped.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    // Add the bear to `state.cards` but with an
    // untracked zone key. The engine doesn't
    // expect this zone to exist; the overlay
    // drops.
    const bearId = `card-bear-untracked-78` as CardInstanceId;
    const bearCard = createCardInstance(
      GRIZZLY_BEARS,
      aliceId,
      aliceId,
      {
        id: bearId,
        currentZoneKey: `${aliceId}-limbo`,
      },
    );
    const newCards = new Map(state.cards);
    newCards.set(bearId, bearCard);
    const stateWithBear = { ...state, cards: newCards };
    const SOURCE_NAME = `${HOST_NAME} untracked source`;
    registerBecomeCopyScript(SOURCE_NAME, bearId);
    const { state: withSource, cardId: sourceId } = putOnBattlefield(
      stateWithBear,
      aliceId,
      makeShapeChanger({ id: "src-78-untracked", name: SOURCE_NAME }),
    );
    const refreshed = refreshScriptedStatics(withSource);
    const source = refreshed.cards.get(sourceId);
    // Overlay dropped: source's printed `cardData`
    // is unchanged. `animatedUntilEndOfTurn` is
    // undefined; `copyOfTargetId` is cleared (the
    // source had no prior overlay).
    expect(source?.cardData.name).toBe(SOURCE_NAME);
    expect(source?.cardData.type_line).toBe("Creature — Shapeshifter");
    expect(source?.animatedUntilEndOfTurn).toBeUndefined();
    expect(source?.copyOfTargetId).toBeUndefined();
  });

  it("rolls the graveyard target's printed cardData onto the enchanted card (Aura mirror)", () => {
    // Setup: Grizzly Bears in Alice's graveyard.
    // Then a shapeshifter (the enchanted card) on
    // Alice's battlefield, enchanted by an Aura
    // with lane 75d's `become_copy` arm pointing at
    // the bear.
    //
    // After `refreshAuraBonuses`:
    // - The enchanted card overlays the bear's
    //   printed characteristics.
    // - `copyOfTargetId` is set to the bear's id.
    const { state, aliceId } = setupTwoPlayerGame();
    registerCardDataForTests([GRIZZLY_BEARS]);
    const { state: withBear, cardId: bearId } = putInZone(
      state,
      `${aliceId}-graveyard`,
      GRIZZLY_BEARS,
      aliceId,
    );
    const ENCHANTED_NAME = `${HOST_NAME} enchanted`;
    const { state: withEnchanted, cardId: enchantedId } = putOnBattlefield(
      withBear,
      aliceId,
      makeShapeChanger({ id: "ench-78-gy", name: ENCHANTED_NAME }),
    );
    // Place the Aura attached to the enchanted
    // card.
    const auraName = `${HOST_NAME} aura graveyard`;
    const auraCardDef: ScryfallCard = {
      id: "mock-aura-78-gy",
      name: auraName,
      type_line: "Enchantment Aura",
      oracle_text: "",
      mana_cost: "{2}{U}",
      cmc: 3,
      colors: ["U"],
      color_identity: ["U"],
      keywords: [],
      power: undefined,
      toughness: undefined,
      legalities: { standard: "legal" },
      layout: "aura",
    } as ScryfallCard;
    registerAuraCopyScript(auraName, bearId);
    const { state: withAura, cardId: auraId } = putOnBattlefield(
      withEnchanted,
      aliceId,
      auraCardDef,
    );
    // Attach the Aura to the enchanted card.
    const newCards = new Map(withAura.cards);
    const auraCard = newCards.get(auraId);
    if (!auraCard) throw new Error("aura not found");
    newCards.set(auraId, { ...auraCard, attachedToId: enchantedId });
    const stateAttached = {
      ...withAura,
      cards: newCards,
      lastModifiedAt: Date.now(),
    };
    const refreshed = refreshAuraBonuses(stateAttached);
    const enchanted = refreshed.cards.get(enchantedId);
    // The enchanted card overlays the bear's
    // printed characteristics (lane 78: graveyard
    // is a tracked zone, so the Aura's overlay
    // applies).
    expect(enchanted?.cardData.name).toBe("Grizzly Bears");
    expect(enchanted?.cardData.type_line).toBe("Creature — Bear");
    expect(enchanted?.cardData.power).toBe("2");
    expect(enchanted?.copyOfTargetId).toBe(bearId);
    // The enchanted card's printed `cardData` is
    // preserved under `animatedUntilEndOfTurn`.
    expect(enchanted?.animatedUntilEndOfTurn?.cardData.name).toBe(
      ENCHANTED_NAME,
    );
  });
});