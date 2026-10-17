/**
 * Wave 4.8 follow-up 30 priority 5 (lane 71) (#2614
 * follow-up): the
 * `protectionFrom` per-pair-with-`"chosen"`-per-pair
 * extension. The follow-up 29 priority 5 inner
 * Zod union accepts multiple `"chosen"` entries
 * across nested arrays (e.g. `[["red", "chosen"],
 * ["green", "chosen"]]` = "protection from
 * red+chosen AND green+chosen"). The engine
 * consult reads the SAME `source.chosenProtectionFrom`
 * instance field for EACH `"chosen"` entry —
 * the resolved qualities are pushed once per
 * `"chosen"` entry, and the `protFrom` Set
 * dedupes at write time. v1 minimum: the
 * single-instance-field model (parallel to the
 * lane 52 `chosenColor` instance field). A
 * per-pair INDEPENDENT sentinel-resolution
 * map (a separate field per pair, distinct
 * from the shared per-pair map at
 * `source.chosenProtectionFromPerPair`)
 * is unbuilt; deferred since follow-up 31.
 * See wave4.8-closed.md §2. (The shared
 * per-pair map itself — the
 * `source.chosenProtectionFromPerPair`
 * field — IS shipped, at cards.ts:204;
 * this deferral is for an independent
 * map that no priority piece has
 * surfaced.)
 *
 * Three test groups:
 *   1. schema — `protectionFrom` parses the
 *      per-pair-with-`"chosen"`-per-pair form
 *      (multiple `"chosen"` entries across
 *      nested arrays). The follow-up 29 priority
 *      5 Zod union already accepts this form;
 *      the follow-up 30 priority 5 piece is a
 *      test surface that verifies the
 *      per-pair-per-pair resolution in
 *      `refreshScriptedStatics`.
 *   2. engine — `refreshScriptedStatics` consults
 *      the per-pair-per-pair `"chosen"`
 *      sentinel resolution (the same
 *      `source.chosenProtectionFrom` is read for
 *      each `"chosen"` entry; the Set dedupes
 *      duplicate resolved qualities at write
 *      time).
 *   3. regression — the follow-up 29 priority 5
 *      per-pair-only form (`[["red", "chosen"]]`)
 *      and the per-entry mixed form (`["red",
 *      "chosen"]` as an OUTER sentinel) still
 *      resolve correctly (regression guard for
 *      the follow-up 27 / 28 / 29 lane 71
 *      pieces).
 */
import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
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
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME =
  "Test Per-Pair Sentinel Multi Anthem (follow-up 30 priority 5)";

function makeAnthemCardDef(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? SOURCE_NAME,
    type_line: overrides.type_line ?? "Enchantment",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{W}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
    keywords: overrides.keywords ?? [],
    power: undefined,
    toughness: undefined,
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeTargetCardDef(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Target Creature",
    type_line: overrides.type_line ?? "Creature — Bear",
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
}

interface SetupResult {
  state: GameState;
  aliceId: PlayerId;
}

function setupGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return { state, aliceId: playerIds[0] };
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
  opts: { chosenProtectionFrom?: string | null } = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  if (opts.chosenProtectionFrom !== undefined) {
    card.chosenProtectionFrom = opts.chosenProtectionFrom;
  }
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

describe("Wave 4.8 follow-up 30 priority 5 — protectionFrom per-pair-with-'chosen'-per-pair", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.protectionFrom accepts the per-pair-with-'chosen'-per-pair form", () => {
    it("parses a protectionFrom with multiple per-pair 'chosen' entries across nested arrays", () => {
      // The per-pair-per-pair sentinel
      // form: `[["red", "chosen"], ["green",
      // "chosen"]]` = "protection from
      // red+chosen AND green+chosen". The
      // follow-up 29 priority 5 inner
      // Zod union already accepts this
      // form (the inner Zod union
      // `z.union([z.string(), z.literal
      // ("chosen")])` accepts multiple
      // `"chosen"` entries inside the
      // same nested array; the follow-up
      // 30 piece is a test surface that
      // verifies the per-pair-per-pair
      // resolution in
      // `refreshScriptedStatics`).
      const script = CardScriptSchema.parse({
        name: "Test Per-Pair-Per-Pair Sentinel Anthem",
        oracle:
          "Creatures you control have protection from red+chosen and green+chosen.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen and green+chosen.",
            affects: { controller: "you" },
            protectionFrom: [
              ["red", "chosen"],
              ["green", "chosen"],
            ],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([
        ["red", "chosen"],
        ["green", "chosen"],
      ]);
    });

    it("parses a protectionFrom with per-pair 'chosen' entries + literal outer entries", () => {
      // `[["red", "chosen"], "blue"]` =
      // "protection from red+chosen AND
      // blue". The `"chosen"` entry is
      // inside one nested array; the
      // other entry is a top-level
      // literal.
      const script = CardScriptSchema.parse({
        name: "Test Per-Pair-Per-Pair Mixed Anthem",
        oracle:
          "Creatures you control have protection from red+chosen and blue.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen and blue.",
            affects: { controller: "you" },
            protectionFrom: [["red", "chosen"], "blue"],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([["red", "chosen"], "blue"]);
    });
  });

  describe("engine — refreshScriptedStatics resolves the per-pair-with-'chosen'-per-pair form", () => {
    it("grants protection from red+chosen AND green+chosen when chosenProtectionFrom: 'white'", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"],
      // ["green", "chosen"]]` +
      // `chosenProtectionFrom: "white"`.
      // Resolved qualities: ["red", "white",
      // "green"] (the same
      // `chosenProtectionFrom` field is
      // read for BOTH `"chosen"` entries;
      // the Set dedupes "white" once). The
      // affected permanent (a bear) has
      // protection from red, green, AND
      // white.
      const anthem = makeAnthemCardDef({
        id: "perpair-perpair-sentinel-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red+chosen and green+chosen.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen and green+chosen.",
            affects: { controller: "you" },
            protectionFrom: [
              ["red", "chosen"],
              ["green", "chosen"],
            ],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "perpair-perpair-sentinel-target",
          name: "Per-Pair-Per-Pair Sentinel Target",
        }),
      );
      const anthemR = putOnBattlefield(targetR.state, aliceId, anthem, {
        chosenProtectionFrom: "white",
      });
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      // The bear has protection from
      // red (literal), green (literal),
      // and white (the resolved
      // chosenProtectionFrom — read once
      // per `"chosen"` entry, deduped by
      // the Set).
      expect(hasProtectionFrom(bearInst, "red")).toBe(true);
      expect(hasProtectionFrom(bearInst, "green")).toBe(true);
      expect(hasProtectionFrom(bearInst, "white")).toBe(true);
      // The bear does NOT have protection
      // from blue (a quality not in the
      // anthem).
      expect(hasProtectionFrom(bearInst, "blue")).toBe(false);
    });

    it("grants protection from red+chosen AND blue when chosenProtectionFrom is the same instance field (per-pair + literal case)", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"], "blue"]`
      // + `chosenProtectionFrom: "white"`.
      // Resolved qualities: ["red", "white",
      // "blue"] (the `"chosen"` entry
      // resolves to "white"; the Set dedupes
      // no duplicates here).
      const anthem = makeAnthemCardDef({
        id: "perpair-perpair-mixed-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red+chosen and blue.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen and blue.",
            affects: { controller: "you" },
            protectionFrom: [["red", "chosen"], "blue"],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "perpair-perpair-mixed-target",
          name: "Per-Pair-Per-Pair Mixed Target",
        }),
      );
      const anthemR = putOnBattlefield(targetR.state, aliceId, anthem, {
        chosenProtectionFrom: "white",
      });
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      // The bear has protection from
      // red, white (chosen), and blue.
      expect(hasProtectionFrom(bearInst, "red")).toBe(true);
      expect(hasProtectionFrom(bearInst, "white")).toBe(true);
      expect(hasProtectionFrom(bearInst, "blue")).toBe(true);
      // The bear does NOT have protection
      // from green.
      expect(hasProtectionFrom(bearInst, "green")).toBe(false);
    });

    it("resolves per-pair 'chosen' to null when chosenProtectionFrom is null (literals preserved; chosen skipped)", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"], ["green", "chosen"]]`
      // + `chosenProtectionFrom: null`
      // (the enter choice hasn't resolved
      // yet). The literal entries
      // (`"red"` + `"green"`) ARE
      // contributed to the resolved list
      // (the `"chosen"` additive is
      // independent of the literal
      // entries); only the `"chosen"`
      // entries are skipped. The bear
      // has protection from red and
      // green (the literal entries) but
      // NOT from white / blue (the
      // would-be resolved chosen
      // qualities).
      const anthem = makeAnthemCardDef({
        id: "perpair-perpair-null-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red+chosen and green+chosen.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen and green+chosen.",
            affects: { controller: "you" },
            protectionFrom: [
              ["red", "chosen"],
              ["green", "chosen"],
            ],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "perpair-perpair-null-target",
          name: "Per-Pair-Per-Pair Null Target",
        }),
      );
      // chosenProtectionFrom: null —
      // the enter choice hasn't
      // resolved. The literal entries
      // (`"red"` / `"green"`) are still
      // preserved; only the `"chosen"`
      // entries are skipped.
      const anthemR = putOnBattlefield(targetR.state, aliceId, anthem, {
        chosenProtectionFrom: null,
      });
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      // The bear has protection from
      // red and green (the literal
      // entries are preserved).
      expect(hasProtectionFrom(bearInst, "red")).toBe(true);
      expect(hasProtectionFrom(bearInst, "green")).toBe(true);
      // The bear does NOT have
      // protection from white or blue
      // (the `"chosen"` entry would
      // have resolved to
      // `chosenProtectionFrom` if it
      // were set; with null it skips).
      expect(hasProtectionFrom(bearInst, "white")).toBe(false);
      expect(hasProtectionFrom(bearInst, "blue")).toBe(false);
    });
  });

  describe("regression — follow-up 29 priority 5 per-pair form and OUTER 'chosen' sentinel still resolve correctly", () => {
    it("per-pair-only form [['red', 'chosen']] still resolves to red+chosen (regression guard)", () => {
      // The follow-up 29 priority 5
      // per-pair-only form
      // (`[["red", "chosen"]]`) still
      // resolves correctly when the
      // per-pair-per-pair extension is
      // in place — a regression guard.
      const anthem = makeAnthemCardDef({
        id: "perpair-only-regression-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "Creatures you control have protection from red+chosen.",
        statics: [
          {
            text: "Creatures you control have protection from red+chosen.",
            affects: { controller: "you" },
            protectionFrom: [["red", "chosen"]],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "perpair-only-regression-target",
          name: "Per-Pair Only Regression Target",
        }),
      );
      const anthemR = putOnBattlefield(targetR.state, aliceId, anthem, {
        chosenProtectionFrom: "green",
      });
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(true);
      expect(hasProtectionFrom(bearInst, "green")).toBe(true);
    });
  });
});
