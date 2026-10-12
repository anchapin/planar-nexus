/**
 * Wave 4.8 follow-up 3 lane 64 — affinity / cost reduction (#2614 follow-up)
 *
 * Extends the existing `affinity` field with a `color` arm (CR 702.41) so
 * cards like "affinity for [color]" (the v1 color-based family) can be
 * scripted. The existing `subtype` arm (Sapling Nursery, "affinity for
 * Forests") is preserved; the new arm is added via a discriminated
 * union. Both arms support an explicit `reduction_per_match` (default
 * `1` to match CR 702.41a).
 *
 * What this lane covers:
 *  - Schema accepts the new `color` arm on `CardScriptSchema.affinity`.
 *  - `affinityReduction` in `spell-casting/affinity.ts` counts cards of
 *    the named color the controller controls at cast time.
 *  - `castSpell` subtracts the saving from the printed generic mana
 *    cost (clamped to {0} per CR 601.2f).
 *  - "any" matches any non-colorless card.
 *  - The existing `subtype` arm still works (Sapling Nursery regression).
 *
 * What this lane deliberately leaves out of scope (separate lanes):
 *  - Multi-color affinity discounts ("affinity for artifacts AND creatures").
 *  - Activated-ability cost reduction via the new field (the lane 21
 *    `cost.pay_life` arm covers that; the new affinity is a cast-time
 *    reduction only).
 *  - Affinity for "any creature" (no script-level arm for the v1
 *    minimum; the test harness covers the synthetic cases).
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { castSpell } from "../spell-casting";
import { affinityReduction } from "../spell-casting/affinity";
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
import { RAW_CARD_SCRIPTS } from "../card-scripts/cards/index.generated";
import {
  getCardScript,
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { CardScriptSchema } from "../card-scripts/schema";

function makeCard(overrides: Partial<ScryfallCard> & { id: string }): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Card",
    type_line: overrides.type_line ?? "Creature",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "",
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    color_identity: overrides.color_identity ?? [],
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
  cardData: ScryfallCard,
  owner: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, owner, owner);
  state.cards.set(card.id, card);
  const hand = state.zones.get(`${owner}-hand`)!;
  state.zones.set(`${owner}-hand`, {
    ...hand,
    cardIds: [...hand.cardIds, card.id],
  });
  return { state, cardId: card.id };
}

function addCreatureToBattlefield(
  state: GameState,
  cardData: ScryfallCard,
  controller: PlayerId,
): { state: GameState; cardId: CardInstanceId } {
  const card = createCardInstance(cardData, controller, controller);
  state.cards.set(card.id, card);
  const battlefield = state.zones.get(`${controller}-battlefield`)!;
  state.zones.set(`${controller}-battlefield`, {
    ...battlefield,
    cardIds: [...battlefield.cardIds, card.id],
  });
  return { state, cardId: card.id };
}

function mainPhaseState(state: GameState, activePlayer: PlayerId): GameState {
  return {
    ...state,
    turn: {
      ...state.turn,
      currentPhase: Phase.PRECOMBAT_MAIN,
      activePlayerId: activePlayer,
    },
    stack: [],
    priorityPlayerId: activePlayer,
  };
}

describe("Wave 4.8 follow-up 3 lane 64 — affinity / cost reduction", () => {
  beforeAll(() => {
    registerCardScripts(RAW_CARD_SCRIPTS);
  });
  afterAll(() => {
    resetCardScriptsForTests();
  });

  // ---------------------------------------------------------------------
  // Schema: parse the new color arm
  // ---------------------------------------------------------------------
  it("CardScriptSchema parses the new affinity color arm", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Color Affinity",
      oracle: "This spell costs {1} less to cast for each red permanent you control.",
      affinity: { color: "R" },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // The discriminated union collapses to the parsed shape.
      const aff = result.data.affinity as
        | { color: string; reduction_per_match: number }
        | { subtype: string; reduction_per_match: number }
        | undefined;
      expect(aff).toBeDefined();
      if (aff && "color" in aff) {
        expect(aff.color).toBe("R");
        expect(aff.reduction_per_match).toBe(1);
      }
    }
  });

  it("CardScriptSchema parses the affinity subtype arm (Sapling Nursery shape)", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Subtype Affinity",
      oracle: "This spell costs {1} less to cast for each Forest you control.",
      affinity: { subtype: "Forest" },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const aff = result.data.affinity as
        | { color: string; reduction_per_match: number }
        | { subtype: string; reduction_per_match: number }
        | undefined;
      expect(aff).toBeDefined();
      if (aff && "subtype" in aff) {
        expect(aff.subtype).toBe("Forest");
        expect(aff.reduction_per_match).toBe(1);
      }
    }
  });

  it("CardScriptSchema parses an explicit reduction_per_match", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic High Affinity",
      oracle: "This spell costs {2} less to cast for each Forest you control.",
      affinity: { subtype: "Forest", reduction_per_match: 2 },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const aff = result.data.affinity as
        | { color: string; reduction_per_match: number }
        | { subtype: string; reduction_per_match: number }
        | undefined;
      if (aff && "subtype" in aff) {
        expect(aff.reduction_per_match).toBe(2);
      }
    }
  });

  it("CardScriptSchema rejects an affinity without subtype or color", () => {
    const result = CardScriptSchema.safeParse({
      name: "Synthetic Broken Affinity",
      oracle: "Broken.",
      affinity: {},
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Sample card
  // ---------------------------------------------------------------------
  it("Dragonlord's Servant fixture declares affinity.subtype with reduction_per_match=1", () => {
    const cardsDir = join(__dirname, "..", "card-scripts", "cards");
    const fixture = JSON.parse(
      readFileSync(join(cardsDir, "dragonlords_servant.json"), "utf8"),
    ) as {
      name: string;
      affinity?: { subtype?: string; reduction_per_match?: number };
    };
    expect(fixture.name).toBe("Dragonlord's Servant");
    expect(fixture.affinity?.subtype).toBe("Dragon");
    expect(fixture.affinity?.reduction_per_match).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Engine: affinityReduction reads the new color arm
  // ---------------------------------------------------------------------
  it("affinityReduction returns 0 when no card has the script", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    expect(affinityReduction(state, aliceId, "Unknown Card")).toBe(0);
  });

  it("affinityReduction counts subtype matches (Sapling Nursery shape) on the battlefield", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    // Sapling Nursery uses the existing subtype arm with `Forest`.
    // Add two forests to the battlefield. The fixture should report
    // a reduction of 2.
    for (let i = 0; i < 2; i++) {
      const forest = makeCard({
        id: `forest-${i}`,
        name: `Forest ${i}`,
        type_line: "Basic Land — Forest",
        colors: [],
      });
      addCreatureToBattlefield(state, forest, aliceId);
    }
    // Use a synthetic script registered via getCardScript path —
    // since the script index already has Sapling Nursery, we just
    // call the existing one.
    expect(affinityReduction(state, aliceId, "Sapling Nursery")).toBe(2);
  });

  it("affinityReduction counts color matches for the new color arm", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    // Register a synthetic script with the new color arm.
    const synthetic = {
      name: "Test Color Affinity",
      oracle: "Test.",
      affinity: { color: "R" },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    };
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      // Synthetic card object — bypasses the strict typing of the
      // `CardScript` array; the test harness verifies the schema
      // parses it in the first test of the file.
      synthetic as never,
    ]);
    try {
      // Add two red creatures and one blue creature to the
      // battlefield. The synthetic script should report a
      // reduction of 2 (only red matches color: "R").
      const redA = makeCard({
        id: "red-a",
        name: "Red A",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      const redB = makeCard({
        id: "red-b",
        name: "Red B",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      const blueC = makeCard({
        id: "blue-c",
        name: "Blue C",
        type_line: "Creature — Merfolk",
        colors: ["U"],
      });
      addCreatureToBattlefield(state, redA, aliceId);
      addCreatureToBattlefield(state, redB, aliceId);
      addCreatureToBattlefield(state, blueC, aliceId);
      expect(affinityReduction(state, aliceId, "Test Color Affinity")).toBe(2);
    } finally {
      resetCardScriptsForTests();
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("affinityReduction for 'any' color arm counts all non-colorless cards", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    const synthetic = {
      name: "Test Any Color Affinity",
      oracle: "Test.",
      affinity: { color: "any" },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    };
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      // Synthetic card object — bypasses the strict typing of the
      // `CardScript` array; the test harness verifies the schema
      // parses it in the first test of the file.
      synthetic as never,
    ]);
    try {
      // One colored, one colorless. The "any" arm should count 1.
      const colored = makeCard({
        id: "any-colored",
        name: "Any Colored",
        type_line: "Creature — Human",
        colors: ["W"],
      });
      const colorless = makeCard({
        id: "any-colorless",
        name: "Any Colorless",
        type_line: "Artifact Creature — Construct",
        colors: [],
      });
      addCreatureToBattlefield(state, colored, aliceId);
      addCreatureToBattlefield(state, colorless, aliceId);
      expect(affinityReduction(state, aliceId, "Test Any Color Affinity")).toBe(1);
    } finally {
      resetCardScriptsForTests();
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("affinityReduction respects an explicit reduction_per_match on the subtype arm", () => {
    const { state, aliceId } = setupTwoPlayerGame();
    const synthetic = {
      name: "Test High Subtype Affinity",
      oracle: "Test.",
      affinity: { subtype: "Goblin", reduction_per_match: 2 },
      spell: [{ op: "Draw", amount: 1, who: "you" }],
    };
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      // Synthetic card object — bypasses the strict typing of the
      // `CardScript` array; the test harness verifies the schema
      // parses it in the first test of the file.
      synthetic as never,
    ]);
    try {
      // 2 Goblins on the battlefield × 2 per match = 4.
      const goblinA = makeCard({
        id: "goblin-a",
        name: "Goblin A",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      const goblinB = makeCard({
        id: "goblin-b",
        name: "Goblin B",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      addCreatureToBattlefield(state, goblinA, aliceId);
      addCreatureToBattlefield(state, goblinB, aliceId);
      expect(affinityReduction(state, aliceId, "Test High Subtype Affinity")).toBe(4);
    } finally {
      resetCardScriptsForTests();
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  // ---------------------------------------------------------------------
  // End-to-end: castSpell subtracts the saving
  // ---------------------------------------------------------------------
  it("castSpell subtracts the affinity saving from the printed generic cost", () => {
    const { state: initial, aliceId } = setupTwoPlayerGame();
    // Synthetic "Test Color Affinity" sorcery with affinity: { color: "R" }
    // and printed cost {2}{R} (3 total). With 2 red creatures on the
    // battlefield, the saving is 2 → effective cost is {R}.
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      // Synthetic card object — bypasses the strict typing of the
      // `CardScript` array; the test harness verifies the schema
      // parses it in the first test of the file.
      {
        name: "Test Color Affinity",
        oracle: "Test.",
        affinity: { color: "R" },
        spell: [{ op: "Draw", amount: 1, who: "you" }],
      },
    ]);
    try {
      const cardData = makeCard({
        id: "tca-cast",
        name: "Test Color Affinity",
        type_line: "Sorcery",
        mana_cost: "{2}{R}",
        cmc: 3,
        colors: ["R"],
        color_identity: ["R"],
        oracle_text: "Test.",
      });
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        cardData,
        aliceId,
      );
      // Add 2 red creatures to the battlefield.
      const redA = makeCard({
        id: "tca-red-a",
        name: "Red A",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      const redB = makeCard({
        id: "tca-red-b",
        name: "Red B",
        type_line: "Creature — Goblin",
        colors: ["R"],
      });
      addCreatureToBattlefield(sWithCard, redA, aliceId);
      addCreatureToBattlefield(sWithCard, redB, aliceId);

      // Provide exactly {R} mana (1 red). Without affinity, the cast
      // would fail (printed {2}{R} = 3). With 2 red creatures
      // controlled, the saving is 2 → effective cost {R}, and the
      // cast succeeds.
      const sWithMana = addMana(sWithCard, aliceId, { red: 1 });
      const s = mainPhaseState(sWithMana, aliceId);

      const result = castSpell(s, aliceId, cardId, [], [], 0, false);
      expect(result.success).toBe(true);
    } finally {
      resetCardScriptsForTests();
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("castSpell clamps the affinity saving to {0} (CR 601.2f)", () => {
    const { state: initial, aliceId } = setupTwoPlayerGame();
    // 4 red creatures × 1 saving per match = 4 saving. Printed cost
    // is {1}{R} = 2 total. After saving: max(0, 2 - 4) = 0. With
    // exactly {R} mana, the cast should succeed (the colored {R}
    // covers the colored part; the generic is reduced to 0).
    registerCardScripts([
      ...RAW_CARD_SCRIPTS,
      // Synthetic card object — bypasses the strict typing of the
      // `CardScript` array; the test harness verifies the schema
      // parses it in the first test of the file.
      {
        name: "Test Color Affinity",
        oracle: "Test.",
        affinity: { color: "R" },
        spell: [{ op: "Draw", amount: 1, who: "you" }],
      },
    ]);
    try {
      const cardData = makeCard({
        id: "tca-clamp",
        name: "Test Color Affinity",
        type_line: "Sorcery",
        mana_cost: "{1}{R}",
        cmc: 2,
        colors: ["R"],
        color_identity: ["R"],
        oracle_text: "Test.",
      });
      const { state: sWithCard, cardId } = addCardToHand(
        initial,
        cardData,
        aliceId,
      );
      // Add 4 red creatures.
      for (let i = 0; i < 4; i++) {
        const red = makeCard({
          id: `clamp-red-${i}`,
          name: `Clamp Red ${i}`,
          type_line: "Creature — Goblin",
          colors: ["R"],
        });
        addCreatureToBattlefield(sWithCard, red, aliceId);
      }

      const sWithMana = addMana(sWithCard, aliceId, { red: 1 });
      const s = mainPhaseState(sWithMana, aliceId);

      const result = castSpell(s, aliceId, cardId, [], [], 0, false);
      expect(result.success).toBe(true);
    } finally {
      resetCardScriptsForTests();
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  // ---------------------------------------------------------------------
  // Existing subtype arm (Sapling Nursery) regression
  // ---------------------------------------------------------------------
  it("Sapling Nursery (subtype arm) still resolves without a regression", () => {
    const script = getCardScript("Sapling Nursery");
    expect(script).toBeDefined();
    expect(script?.affinity).toBeDefined();
    const aff = script?.affinity as
      | { subtype: string; reduction_per_match: number }
      | { color: string; reduction_per_match: number }
      | undefined;
    expect(aff).toBeDefined();
    if (aff && "subtype" in aff) {
      expect(aff.subtype).toBe("Forest");
      // Default reduction_per_match is 1.
      expect(aff.reduction_per_match).toBe(1);
    } else {
      throw new Error("expected subtype arm on Sapling Nursery");
    }
  });
});
