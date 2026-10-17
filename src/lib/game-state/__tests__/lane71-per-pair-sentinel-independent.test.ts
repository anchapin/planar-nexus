/**
 * Wave 4.8 follow-up 31 priority 4 (lane 71)
 * (#2614 follow-up):
 * `chosenProtectionFromPerPair` per-pair
 * independent sentinel-resolution field on
 * `CardInstance` — the per-pair
 * `Record<number, string | null>` map keyed
 * by the outer `protectionFrom` array index.
 *
 * The follow-up 26 priority 3 piece shipped
 * the single-instance `chosenProtectionFrom`
 * field. The follow-up 30 priority 5 piece
 * shipped the per-pair `"chosen"` sentinel
 * semantics — a `"chosen"` entry INSIDE a
 * nested array (a "pair") is resolved via
 * `source.chosenProtectionFrom`. That
 * semantic applies the SAME chosen quality
 * to every `"chosen"` entry in every nested
 * array.
 *
 * This piece extends the per-pair consult
 * with an OPTIONAL per-pair independent
 * sentinel-resolution map. The map is keyed
 * by the outer `protectionFrom` array index
 * (the same index that
 * `refreshScriptedStatics` iterates). The
 * value is the chosen protection quality for
 * that nested array (a string like `"white"`
 * / `"red"` / etc.) or `null` when no
 * sentinel-resolution is needed for that
 * nested array (the consult falls back to the
 * single-instance `chosenProtectionFrom`
 * field).
 *
 * The per-pair map takes PRECEDENCE over
 * the single-instance `chosenProtectionFrom`
 * field when set, the index is present, and
 * the value is non-null. The per-pair map is
 * OPTIONAL (parallel to `chosenTypeAdditions?`
 * / `chosenColorAdditions?`).
 *
 * Four test groups:
 *   1. schema — the
 *      `chosenProtectionFromPerPair` field is
 *      OPTIONAL on `CardInstance`; a CardInstance
 *      without the field compiles and the
 *      consult reads it.
 *   2. engine — per-pair independent resolution
 *      (each pair resolves to its own chosen
 *      quality).
 *   3. fallback — partial per-pair map (some
 *      pairs have a per-pair value, others fall
 *      back to the single-instance field);
 *      empty per-pair map (all pairs fall back
 *      to the single-instance field); null
 *      per-pair value (the single-instance
 *      field is consulted for that pair).
 *   4. regression — the flat literal form
 *      (`["red"]`) still resolves correctly
 *      (regression guard for the follow-up 22
 *      / 23 / 24 / 25 / 26 lane 71 pieces).
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
} from "@jest/globals";
import {
  CardScriptSchema,
  type CardScript,
} from "../card-scripts/schema";
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

const SOURCE_NAME =
  "Test Per-Pair Independent Sentinel Anthem (lane 71 priority 4)";
const TARGET_NAME = "Per-Pair Independent Sentinel Target";

function makeAnthemCardDef(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
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
  overrides: Partial<ScryfallCard> & { id: string; name: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name,
    type_line: overrides.type_line ?? "Creature — Bear",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{1}{G}",
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ["G"],
    color_identity: overrides.color_identity ?? ["G"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "2",
    toughness: overrides.toughness ?? "2",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function setupSinglePlayerGame(): {
  state: GameState;
  playerId: PlayerId;
} {
  let state = createInitialGameState(["Alice"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  return { state, playerId: playerIds[0] };
}

function registerAnthem(
  protectionFrom: readonly (string | string[])[] | string,
  nameSuffix: string = "",
): string {
  resetCardScriptsForTests();
  const fullName = `${SOURCE_NAME}${nameSuffix ? ` ${nameSuffix}` : ""}`;
  const script: CardScript = CardScriptSchema.parse({
    name: fullName,
    oracle: "Per-pair independent sentinel anthem.",
    statics: [
      {
        text: "Per-pair independent sentinel anthem.",
        affects: { controller: "you" },
        protectionFrom,
      },
    ],
  });
  registerCardScripts([{ ...script, name: fullName }]);
  return fullName;
}

function putAnthemOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
  chosenProtectionFrom: string | null = null,
  chosenProtectionFromPerPair?: Record<number, string | null>,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `anthem-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  // Stamp the chosen-quality field
  // (parallel to the follow-up 26
  // priority 3 `resolveEnterChoice`
  // path) AND the per-pair map (the
  // follow-up 31 priority 4
  // extension). Both are read by
  // `refreshScriptedStatics` when
  // resolving the `"chosen"`
  // sentinel entries in the
  // anthem's `protectionFrom`
  // array.
  card.chosenProtectionFrom = chosenProtectionFrom;
  if (chosenProtectionFromPerPair) {
    card.chosenProtectionFromPerPair = chosenProtectionFromPerPair;
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

function putTargetOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
): { state: GameState; cardId: CardInstanceId } {
  const cardId = `target-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
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

describe("Wave 4.8 follow-up 31 priority 4 — chosenProtectionFromPerPair per-pair independent sentinel-resolution field", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  beforeEach(() => {
    resetCardScriptsForTests();
  });

  describe("schema — the chosenProtectionFromPerPair field is OPTIONAL on CardInstance", () => {
    it("accepts a CardInstance without a chosenProtectionFromPerPair field (the field is OPTIONAL)", () => {
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        ["red", "chosen"],
        "no-per-pair",
      );
      const anthem = makeAnthemCardDef({
        id: "no-per-pair-anthem",
        name: anthemName,
      });
      // Place the anthem on the
      // battlefield with NO
      // `chosenProtectionFromPerPair`
      // field (the field is
      // OPTIONAL).
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance chosenProtectionFrom
        // chosenProtectionFromPerPair is intentionally OMITTED.
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "no-per-pair-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // The single-instance
      // chosenProtectionFrom is
      // consulted (the per-pair map
      // is omitted, so the consult
      // falls back).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(true);
    });

    it("accepts a CardInstance with an explicit empty chosenProtectionFromPerPair map (the consult reads it)", () => {
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        [["red", "chosen"]],
        "empty-per-pair",
      );
      const anthem = makeAnthemCardDef({
        id: "empty-per-pair-anthem",
        name: anthemName,
      });
      // The per-pair map is `{}` —
      // the index for the only pair
      // is NOT present in the map;
      // every pair falls back to the
      // single-instance field.
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance fallback
        {}, // empty per-pair map (no indices present)
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "empty-per-pair-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // "red" is the literal
      // entry; "blue" is the
      // single-instance fallback
      // (consulted because the
      // per-pair map is empty).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(true);
    });
  });

  describe("engine — per-pair independent sentinel resolution", () => {
    it("resolves each pair to its own chosen quality (per-pair map consult)", () => {
      // The anthem has
      // `protectionFrom: [["red", "chosen"], ["green", "chosen"]]`
      // — TWO nested arrays, each
      // with a `"chosen"` sentinel
      // entry. The per-pair map is
      // `{ 0: "white", 1: "blue" }` —
      // the first pair resolves to
      // white, the second pair
      // resolves to blue. The
      // resulting quality set is
      // `{red, white, green, blue}`
      // (two pairs × two qualities
      // each).
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        [["red", "chosen"], ["green", "chosen"]],
        "per-pair-independent",
      );
      const anthem = makeAnthemCardDef({
        id: "per-pair-independent-anthem",
        name: anthemName,
      });
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance fallback (ignored — the per-pair map covers both pairs)
        { 0: "white", 1: "blue" }, // per-pair map
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "per-pair-independent-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // The target has protection
      // from red (literal in pair
      // 0) + white (per-pair pair
      // 0) + green (literal in
      // pair 1) + blue (per-pair
      // pair 1).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "white")).toBe(true);
      expect(hasProtectionFrom(targetInst, "green")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(true);
    });
  });

  describe("fallback — partial per-pair map and null per-pair value", () => {
    it("partial per-pair map: indices not present fall back to the single-instance field", () => {
      // The anthem has
      // `protectionFrom: [["red", "chosen"], ["green", "chosen"]]`.
      // The per-pair map is
      // `{ 0: "white" }` — only the
      // first pair has a per-pair
      // value; the second pair has
      // no per-pair value (the
      // index is not in the map),
      // so it falls back to the
      // single-instance
      // `chosenProtectionFrom:
      // "blue"`. The resulting
      // quality set is
      // `{red, white, green, blue}`.
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        [["red", "chosen"], ["green", "chosen"]],
        "partial-per-pair",
      );
      const anthem = makeAnthemCardDef({
        id: "partial-per-pair-anthem",
        name: anthemName,
      });
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance fallback
        { 0: "white" }, // partial per-pair map (only pair 0)
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "partial-per-pair-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // The target has protection
      // from red + white (pair 0,
      // per-pair map) + green +
      // blue (pair 1,
      // single-instance fallback).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "white")).toBe(true);
      expect(hasProtectionFrom(targetInst, "green")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(true);
    });

    it("null per-pair value: the single-instance field is consulted (the per-pair entry is a no-op)", () => {
      // The anthem has
      // `protectionFrom: [["red", "chosen"], ["green", "chosen"]]`.
      // The per-pair map is
      // `{ 0: null, 1: "blue" }` —
      // the first pair has an
      // explicit null per-pair
      // value (no
      // sentinel-resolution for
      // that pair; the consult
      // falls back to the
      // single-instance field).
      // The second pair has a
      // per-pair value ("blue").
      // The resulting quality set
      // is `{red, blue, green,
      // blue}` → deduped to
      // `{red, blue, green}`.
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        [["red", "chosen"], ["green", "chosen"]],
        "null-per-pair",
      );
      const anthem = makeAnthemCardDef({
        id: "null-per-pair-anthem",
        name: anthemName,
      });
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance fallback
        { 0: null, 1: "blue" }, // per-pair map with null at index 0
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "null-per-pair-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // The first pair (per-pair
      // null) falls back to the
      // single-instance field
      // ("blue"); the second pair
      // uses the per-pair value
      // ("blue"). The resulting
      // qualities are red, green,
      // and blue (deduped).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "green")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(true);
    });
  });

  describe("regression — the flat literal form still resolves correctly", () => {
    it("flat literal form ['red'] still resolves to protection from red (regression guard)", () => {
      // The flat literal form
      // (no nested arrays, no
      // `"chosen"` entries) is the
      // v1 minimum from the
      // follow-up 22 / 23 / 24 /
      // 25 / 26 lane 71 pieces.
      // The per-pair map (if set)
      // is ignored because there
      // are no per-pair `"chosen"`
      // entries to resolve.
      const setup = setupSinglePlayerGame();
      const anthemName = registerAnthem(
        ["red"],
        "flat-literal",
      );
      const anthem = makeAnthemCardDef({
        id: "flat-literal-anthem",
        name: anthemName,
      });
      const anthemR = putAnthemOnBattlefield(
        setup.state,
        setup.playerId,
        anthem,
        "blue", // single-instance (ignored — no "chosen" entries)
        { 0: "white" }, // per-pair map (ignored — no "chosen" entries)
      );
      const targetR = putTargetOnBattlefield(
        anthemR.state,
        setup.playerId,
        makeTargetCardDef({
          id: "flat-literal-target",
          name: TARGET_NAME,
        }),
      );
      const updated = refreshScriptedStatics(targetR.state);
      const targetInst = updated.cards.get(targetR.cardId);
      expect(targetInst).toBeDefined();
      if (!targetInst) return;
      // "red" is the only literal
      // entry; "blue" / "white"
      // are NOT in the resulting
      // quality set (no `"chosen"`
      // entries to resolve).
      expect(hasProtectionFrom(targetInst, "red")).toBe(true);
      expect(hasProtectionFrom(targetInst, "blue")).toBe(false);
      expect(hasProtectionFrom(targetInst, "white")).toBe(false);
    });
  });
});