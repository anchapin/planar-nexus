/**
 * Wave 4.8 follow-up 29 priority 5 (lane 71) (#2614
 * follow-up): `protectionFrom` per-pair `"chosen"`
 * sentinel — a `"chosen"` sentinel entry inside
 * the nested array (a "pair").
 *
 * The follow-up 28 priority 2 piece shipped the
 * nested-array "pair" form
 * (`protectionFrom: Array<string | string[] | "chosen">`)
 * — the array-aware entry shape. Each nested
 * array is a "pair" of literal qualities (e.g.
 * `["red", "green"]` = "protection from the
 * red/green pair"). The `"chosen"` sentinel
 * resolution was at the OUTER entry level (the
 * `"chosen"` literal was a sibling of the pair
 * entry, not a member).
 *
 * This piece extends the per-entry nested array
 * to ALSO accept a `"chosen"` sentinel entry (the
 * per-pair sentinel). The Zod union now accepts
 * `[["red", "chosen"], "blue"]` = "protection
 * from red+chosen AND blue". The engine consult
 * FLATTENS each nested array to its literal
 * entries AND resolves the `"chosen"` entry via
 * `source.chosenProtectionFrom`. The resulting
 * quality is added to the flattened list
 * (alongside the literal entries).
 *
 * Three test groups:
 *   1. schema — `protectionFrom` parses for the
 *      per-pair `"chosen"` sentinel form
 *       (single `"chosen"` inside the nested
 *       array, multiple `"chosen"` entries in
 *       different nested arrays, per-pair
 *       sentinel + outer sentinel).
 *   2. engine — `refreshScriptedStatics` consults
 *      the per-pair `"chosen"` sentinel
 *      resolution (`source.chosenProtectionFrom`
 *      is read for each per-pair `"chosen"`
 *      entry).
 *   3. regression — the flat literal form
 *      (`["red"]`) and the per-entry mixed form
 *      (`["red", "chosen"]` as an OUTER
 *      sentinel) still parse and resolve
 *      correctly (regression guard for the
 *      follow-up 26 / 27 / 28 lane 71 pieces).
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
  "Test Per-Pair Sentinel Anthem (lane 71 priority 5)";

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

describe("Wave 4.8 follow-up 29 priority 5 — protectionFrom per-pair 'chosen' sentinel", () => {
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

  describe("schema — StaticSchema.protectionFrom accepts the per-pair 'chosen' sentinel", () => {
    it("parses a protectionFrom array with a per-pair 'chosen' sentinel entry", () => {
      // The per-pair `"chosen"` sentinel:
      // `[["red", "chosen"], "blue"]` =
      // "protection from red+chosen AND blue".
      // The `"chosen"` entry is inside the
      // nested array (a member of the pair).
      const script = CardScriptSchema.parse({
        name: "Test Per-Pair Sentinel Anthem",
        oracle:
          "Creatures you control have protection from red+chosen and blue.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen and blue.",
            affects: { controller: "you" },
            protectionFrom: [["red", "chosen"], "blue"],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([
        ["red", "chosen"],
        "blue",
      ]);
    });

    it("parses a protectionFrom array with per-pair 'chosen' as the only entry", () => {
      // The per-pair-only sentinel form:
      // `[["red", "chosen"]]` = "protection from
      // red+chosen" (no outer sentinel). The
      // nested array has the `"chosen"` entry
      // alongside `"red"`.
      const script = CardScriptSchema.parse({
        name: "Test Per-Pair Sentinel Only Anthem",
        oracle: "Creatures you control have protection from red+chosen.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen.",
            affects: { controller: "you" },
            protectionFrom: [["red", "chosen"]],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([["red", "chosen"]]);
    });

    it("parses a protectionFrom array with multiple per-pair 'chosen' entries in different nested arrays", () => {
      // `[["red", "chosen"], ["green", "chosen"]]`
      // = "protection from red+chosen AND
      // green+chosen". Each nested array's
      // `"chosen"` entry resolves independently
      // — both contribute
      // `source.chosenProtectionFrom` to the
      // resolved list (the Set dedupes at
      // write time).
      const script = CardScriptSchema.parse({
        name: "Test Multi Per-Pair Sentinel Anthem",
        oracle:
          "Creatures you control have protection from red+chosen and green+chosen.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen and green+chosen.",
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

    it("rejects a per-pair nested array with only a 'chosen' entry (MIN 2 enforced at the Zod layer)", () => {
      // `[["chosen"]]` is a 1-element nested
      // array with no literal entries — the
      // `.min(2)` constraint rejects it (the
      // v1 minimum requires at least 2 entries
      // in the nested array to avoid confusion
      // with the flat literal form).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Per-Pair Only Sentinel Anthem",
          oracle: "Creatures you control have protection from chosen.",
          statics: [
            {
              text:
                "Creatures you control have protection from chosen.",
              affects: { controller: "you" },
              protectionFrom: [["chosen"]],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects a per-pair nested array with an empty string entry (`.min(1)` per entry)", () => {
      // `[["red", ""]]` — the empty string
      // entry is rejected at the Zod layer
      // (`z.string().min(1)`).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Per-Pair Empty Anthem",
          oracle: "test",
          statics: [
            {
              text: "test",
              affects: { controller: "you" },
              protectionFrom: [["red", ""]],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — refreshScriptedStatics resolves the per-pair 'chosen' sentinel", () => {
    it("grants protection from red+chosen AND blue when chosenProtectionFrom: 'green'", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"], "blue"]`
      // + `chosenProtectionFrom: "green"`.
      // Resolved qualities: ["red", "green",
      // "blue"]. The affected permanent (a
      // bear) has protection from red,
      // green, AND blue.
      const anthem = makeAnthemCardDef({
        id: "perpair-sentinel-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red+chosen and blue.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen and blue.",
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
          id: "perpair-sentinel-target",
          name: "Per-Pair Sentinel Target",
        }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        anthem,
        { chosenProtectionFrom: "green" },
      );
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "green")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "blue")).toBe(
        true,
      );
      // The bear does NOT have protection
      // from white (a quality not in the
      // anthem).
      expect(hasProtectionFrom(bearInst, "white")).toBe(
        false,
      );
    });

    it("grants protection from red+chosen when only the per-pair form is set (no outer 'chosen' sentinel)", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"]]`
      // + `chosenProtectionFrom: "green"`.
      // Resolved qualities: ["red", "green"].
      const anthem = makeAnthemCardDef({
        id: "perpair-only-sentinel-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "Creatures you control have protection from red+chosen.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen.",
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
          id: "perpair-only-target",
          name: "Per-Pair Only Target",
        }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        anthem,
        { chosenProtectionFrom: "green" },
      );
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "green")).toBe(
        true,
      );
      // No blue (the anthem doesn't grant it).
      expect(hasProtectionFrom(bearInst, "blue")).toBe(
        false,
      );
    });

    it("resolves the per-pair 'chosen' sentinel per nested array (regression guard for the per-entry-level resolution)", () => {
      // Anthem:
      // `protectionFrom: [["red", "chosen"], ["green", "chosen"]]`
      // + `chosenProtectionFrom: "white"`.
      // Resolved qualities: ["red", "white",
      // "green"] (the Set dedupes "white"
      // once). The bear has protection from
      // red, green, AND white.
      const anthem = makeAnthemCardDef({
        id: "multi-perpair-sentinel-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red+chosen and green+chosen.",
        statics: [
          {
            text:
              "Creatures you control have protection from red+chosen and green+chosen.",
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
          id: "multi-perpair-target",
          name: "Multi Per-Pair Target",
        }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        anthem,
        { chosenProtectionFrom: "white" },
      );
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "green")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "white")).toBe(
        true,
      );
    });
  });

  describe("regression — flat literal form and per-entry mixed form still resolve correctly", () => {
    it("flat literal `['red']` still grants protection from red (regression guard)", () => {
      const anthem = makeAnthemCardDef({
        id: "flat-literal-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "Creatures you control have protection from red.",
        statics: [
          {
            text: "Creatures you control have protection from red.",
            affects: { controller: "you" },
            protectionFrom: ["red"],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "flat-literal-target",
          name: "Flat Literal Target",
        }),
      );
      const anthemR = putOnBattlefield(targetR.state, aliceId, anthem);
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(
        true,
      );
    });

    it("outer 'chosen' sentinel form `['red', 'chosen']` still resolves per-entry (regression guard)", () => {
      // The OUTER `"chosen"` sentinel (a
      // sibling of `"red"` at the top level of
      // the array, NOT inside a nested
      // array) still resolves per-entry — a
      // regression guard for the follow-up 27
      // lane 71 piece 3/N per-entry mixed
      // form.
      const anthem = makeAnthemCardDef({
        id: "outer-sentinel-anthem",
      });
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red and chosen.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and chosen.",
            affects: { controller: "you" },
            protectionFrom: ["red", "chosen"],
          },
        ],
      });
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({
          id: "outer-sentinel-target",
          name: "Outer Sentinel Target",
        }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        anthem,
        { chosenProtectionFrom: "green" },
      );
      const refreshed = refreshScriptedStatics(anthemR.state);
      const bearInst = refreshed.cards.get(targetR.cardId);
      expect(bearInst).toBeDefined();
      if (!bearInst) return;
      expect(hasProtectionFrom(bearInst, "red")).toBe(
        true,
      );
      expect(hasProtectionFrom(bearInst, "green")).toBe(
        true,
      );
    });
  });
});