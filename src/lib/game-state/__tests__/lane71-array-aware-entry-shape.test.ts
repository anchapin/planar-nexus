/**
 * Wave 4.8 follow-up 28 priority 2 (#2614 follow-up):
 * `protectionFrom` array-aware entry shape (nested-
 * array "pair" form).
 *
 * The follow-up 27 lane 71 piece 3/N substrate shipped
 * `protectionFrom: Array<string | "chosen">` — the
 * per-entry mixed form (literal qualities AND the
 * chosen sentinel in the same arm). Each entry is
 * resolved independently; the chosen sentinel reads
 * `source.chosenProtectionFrom`.
 *
 * This piece extends the per-entry union with a
 * nested-array "pair" form. The Zod union now also
 * accepts a per-entry array of ≥ 2 literal qualities
 * (a "pair") — e.g.
 * `protectionFrom: [["red", "green"]]` = "protection
 * from the red/green pair". A
 * `[["red", "green"], "chosen"]` entry grants
 * protection from the red/green pair AND the chosen
 * quality in the same anthem. A 1-element nested
 * array is REJECTED at the Zod layer (`.min(2)`) to
 * avoid confusion with the flat literal form.
 *
 * The engine FLATTENS each nested array to its
 * literal entries (a `[["red", "green"]]` entry
 * contributes `["red", "green"]` to the resolved
 * qualities list). The `"chosen"` entry is still
 * resolved independently of the pair-flattening
 * (parallel entry-level resolution). v1 minimum:
 * per-entry nested arrays are flattened; a per-pair
 * sentinel (e.g. `[["red", "chosen"], "blue"]` =
 * "protection from red+chosen AND blue") rides a
 * future lane.
 *
 * Three test groups:
 *   1. schema — `protectionFrom` parses for the
 *      pair-only form, the pair + sentinel union, and
 *      REJECTS the 1-element nested array.
 *   2. engine — `refreshScriptedStatics` consults the
 *      pair form (flattening, pair + sentinel union,
 *      pair-only case).
 *   3. regression — the flat literal form
 *      (`["red"]`) and the per-entry mixed form
 *      (`["red", "chosen"]`) still parse and resolve
 *      correctly (regression guard for the follow-up
 *      26 / 27 lane 71 pieces).
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
  "Test Array-Aware Entry Shape Anthem (lane 71 priority 2)";

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

describe("Wave 4.8 follow-up 28 priority 2 — protectionFrom array-aware entry shape", () => {
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

  describe("schema — StaticSchema.protectionFrom accepts the nested-array pair form", () => {
    it("parses a protectionFrom array with a single nested-array pair entry", () => {
      // The pair form: a per-entry array of ≥ 2
      // literal qualities (e.g. `["red", "green"]`).
      // The engine flattens each pair entry to its
      // literal qualities at consult time.
      const script = CardScriptSchema.parse({
        name: "Test Pair-Only Anthem",
        oracle:
          "Creatures you control have protection from red and green.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and green.",
            affects: { controller: "you" },
            protectionFrom: [["red", "green"]],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([["red", "green"]]);
    });

    it("parses a protectionFrom array mixing a pair entry AND the chosen sentinel", () => {
      // The pair + sentinel union: a per-entry
      // array with a nested-array pair entry AND
      // the `"chosen"` sentinel. The engine
      // resolves each entry independently (the
      // pair is flattened; the sentinel reads
      // `source.chosenProtectionFrom`).
      const script = CardScriptSchema.parse({
        name: "Test Pair + Chosen Anthem",
        oracle:
          "Creatures you control have protection from the red/green pair and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from the red/green pair and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: [["red", "green"], "chosen"],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([["red", "green"], "chosen"]);
    });

    it("parses a protectionFrom array with multiple pair entries", () => {
      // Two pair entries (e.g. the red/green pair
      // AND the white/blue pair). Each pair is
      // flattened independently. v1 minimum
      // doesn't require deduplication across
      // pairs; the `protFrom` Set consult dedupes
      // at write time.
      const script = CardScriptSchema.parse({
        name: "Test Multi-Pair Anthem",
        oracle:
          "Creatures you control have protection from red/green and white/blue.",
        statics: [
          {
            text:
              "Creatures you control have protection from red/green and white/blue.",
            affects: { controller: "you" },
            protectionFrom: [
              ["red", "green"],
              ["white", "blue"],
            ],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: (string | string[])[];
      };
      expect(stat.protectionFrom).toEqual([
        ["red", "green"],
        ["white", "blue"],
      ]);
    });

    it("rejects a 1-element nested array (typo guard — `.min(2)`)", () => {
      // The Zod layer enforces `.min(2)` on each
      // nested array. A 1-element nested array
      // (e.g. `[["red"]]`) is rejected to avoid
      // confusion with the flat literal form
      // (`["red"]`).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test 1-Element Pair Anthem",
          oracle: "Creatures you control have protection from red.",
          statics: [
            {
              text:
                "Creatures you control have protection from red.",
              affects: { controller: "you" },
              protectionFrom: [["red"]],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an empty nested array (`.min(2)` covers both bounds)", () => {
      // The Zod layer enforces `.min(2)` — a
      // 0-element nested array is also rejected
      // (the array must contain at least 2
      // literal qualities to qualify as a "pair").
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Pair Anthem",
          oracle: "Creatures you control have protection from nothing.",
          statics: [
            {
              text:
                "Creatures you control have protection from nothing.",
              affects: { controller: "you" },
              protectionFrom: [[]],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — refreshScriptedStatics consults the array-aware entry shape", () => {
    it("flattens each pair entry to its literal qualities on the per-target ledger", () => {
      // Register a pair-only anthem:
      // `protectionFrom: [["red", "green"]]`. The
      // anthem grants protection from BOTH "red"
      // AND "green" to each affected creature.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red and green.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and green.",
            affects: { controller: "you" },
            protectionFrom: [["red", "green"]],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      // Place target first; anthem second (script
      // lookup reads the source's name).
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "pair-only-target" }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "pair-only-anthem" }),
      );
      const afterRefresh = refreshScriptedStatics(anthemR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The target's `protectionFrom` ledger is
      // stamped with the FLATTENED pair: "red" +
      // "green" (the nested array
      // `[["red", "green"]]` is flattened to its
      // literal entries at consult time).
      expect(target.protectionFrom?.sort()).toEqual(["green", "red"]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
      expect(hasProtectionFrom(target, "green")).toBe(true);
      // The target is NOT protected from blue or
      // black (the pair form only contributes
      // "red" and "green" — no other qualities).
      expect(hasProtectionFrom(target, "blue")).toBe(false);
      expect(hasProtectionFrom(target, "black")).toBe(false);
    });

    it("resolves the pair + sentinel union (pair flattened; sentinel reads chosenProtectionFrom)", () => {
      // Register a pair + sentinel anthem:
      // `protectionFrom: [["red", "green"], "chosen"]`
      // + `chosenProtectionFrom: "blue"`. The
      // anthem grants protection from "red",
      // "green" (the pair) AND "blue" (the
      // resolved chosen quality). The chosen
      // sentinel resolution is INDEPENDENT of the
      // pair-flattening (parallel entry-level
      // resolution).
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red/green and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red/green and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: [["red", "green"], "chosen"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "pair-sentinel-target" }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "pair-sentinel-anthem" }),
        { chosenProtectionFrom: "blue" },
      );
      const afterRefresh = refreshScriptedStatics(anthemR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The pair `["red", "green"]` is flattened
      // AND the sentinel resolves to "blue" (the
      // source's `chosenProtectionFrom`). The
      // target's `protectionFrom` ledger is
      // stamped with all three qualities.
      expect(target.protectionFrom?.sort()).toEqual([
        "blue",
        "green",
        "red",
      ]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
      expect(hasProtectionFrom(target, "green")).toBe(true);
      expect(hasProtectionFrom(target, "blue")).toBe(true);
      // The target is NOT protected from black or
      // white (the pair + sentinel union only
      // contributes the three resolved qualities).
      expect(hasProtectionFrom(target, "black")).toBe(false);
      expect(hasProtectionFrom(target, "white")).toBe(false);
    });

    it("falls through to the literal entries only when chosen sentinel is null (pair still flattened)", () => {
      // Register the same pair + sentinel anthem
      // as above, but with `chosenProtectionFrom:
      // null` (the enter choice hasn't resolved).
      // The pair is STILL flattened to its literal
      // entries; the `"chosen"` entry contributes
      // 0 qualities. The target is protected from
      // "red" + "green" (the pair) but NOT from
      // any resolved chosen quality.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red/green and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red/green and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: [["red", "green"], "chosen"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "pair-sentinel-unset-target" }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "pair-sentinel-unset-anthem" }),
        { chosenProtectionFrom: null },
      );
      const afterRefresh = refreshScriptedStatics(anthemR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The pair `["red", "green"]` is flattened;
      // the `"chosen"` entry contributes 0
      // qualities (the sentinel is null). The
      // target's `protectionFrom` ledger has only
      // the pair's literal entries.
      expect(target.protectionFrom?.sort()).toEqual(["green", "red"]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
      expect(hasProtectionFrom(target, "green")).toBe(true);
      // No chosen quality resolved → the target is
      // NOT protected from "blue" (or any other
      // quality that would have come from the
      // chosen sentinel).
      expect(hasProtectionFrom(target, "blue")).toBe(false);
    });
  });

  describe("regression — flat literal form and per-entry mixed form still resolve correctly", () => {
    it("the flat literal form `[\"red\"]` (no chosen) goes through the eager else-branch (no flattening)", () => {
      // Regression guard: a flat literal array
      // (e.g. `["red"]`) is handled by the eager
      // `else` branch — the per-entry branch is
      // NOT engaged (no `"chosen"` sentinel AND no
      // nested array). The engine iterates the
      // literal array and stamps "red" on the
      // target.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "Creatures you control have protection from red.",
        statics: [
          {
            text:
              "Creatures you control have protection from red.",
            affects: { controller: "you" },
            protectionFrom: ["red"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "flat-literal-target" }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "flat-literal-anthem" }),
      );
      const afterRefresh = refreshScriptedStatics(anthemR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The flat literal `["red"]` is stamped on
      // the target's `protectionFrom` ledger.
      expect(target.protectionFrom?.sort()).toEqual(["red"]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
    });

    it("the per-entry mixed form `[\"red\", \"chosen\"]` still resolves correctly (no regression on follow-up 27 lane 71 piece 3/N)", () => {
      // Regression guard: the per-entry mixed form
      // (literal + sentinel) from the follow-up 27
      // lane 71 piece 3/N substrate still resolves
      // correctly. The `"chosen"` entry reads
      // `source.chosenProtectionFrom`; the literal
      // entry contributes as-is. v1 minimum: no
      // regression on the multi-quality sentinel
      // path.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: ["red", "chosen"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "per-entry-mixed-target" }),
      );
      const anthemR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "per-entry-mixed-anthem" }),
        { chosenProtectionFrom: "blue" },
      );
      const afterRefresh = refreshScriptedStatics(anthemR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The mixed form `["red", "chosen"]`
      // resolves to "red" (literal) + "blue"
      // (resolved sentinel).
      expect(target.protectionFrom?.sort()).toEqual(["blue", "red"]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
      expect(hasProtectionFrom(target, "blue")).toBe(true);
    });
  });
});