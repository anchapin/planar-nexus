/**
 * Wave 4.8 follow-up 29 priority 4 (lane 32) (#2614
 * follow-up): `perCounter.perPair` — the per-pair
 * cross-type variant ("Nth counter of each unique
 * type").
 *
 * The follow-up 28 priority 1 piece shipped the
 * per-source Nth-counter `perCounter.ordinal?` field
 * — a cumulative sum of the first `ordinal`
 * counters of the resolved type on the source. This
 * piece extends `perCounter` with an OPTIONAL
 * `perPair?: { ordinal?: number }` arm. When set,
 * the per-pair takes precedence over the
 * `perCounter.ordinal?` arm (the per-pair is a
 * separate semantic from the per-counter Nth-
 * counter read).
 *
 * The per-pair read iterates ALL unique counter
 * types on the source, sums the cumulative sum of
 * the first `perPair.ordinal` counters of each
 * type. A source with 2 +1/+1 counters + 3 -1/-1
 * counters with `perPair.ordinal: 2` contributes 2
 * +1/+1 + 2 -1/-1 = 4 (NOT 2 + 3 = 5 — the
 * cross-type summation is per-pair, not per-counter
 * cumulative).
 *
 * The `perPair.ordinal` defaults to 1 (cumulative
 * sum of the FIRST counter of each unique type — a
 * "first counter per pair" read). The
 * `andPer.perCounter perPair` parallel ordinal
 * extension is unbuilt; deferred since follow-up 30.
 * See wave4.8-closed.md §2. (The
 * per-pair-with-sentinel extension also rides
 * follow-up 30.)
 *
 * Three test groups:
 *   1. schema — `perCounter.perPair` parses with
 *      the ordinal arm; rejects unknown sub-arm
 *      keys (the `.strict()` semantics).
 *   2. engine — `computeAnthemScalingCount`
 *      consults the `perPair` arm on the primary
 *      `perCounter` arm — a source with multiple
 *      counter types + the perPair ordinal
 *      contributes the per-pair cross-type sum
 *      (NOT the per-counter cumulative sum).
 *   3. regression — `perPair` unset preserves the
 *      follow-up 28 priority 1 per-counter
 *      Nth-counter semantic (the per-pair arm
 *      takes precedence ONLY when set).
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
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME = "Test Per-Pair Counter Ordinal Anthem (lane 32 priority 4)";

function makeSourceCardDef(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? SOURCE_NAME,
    type_line: overrides.type_line ?? "Creature — Cleric",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{W}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
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
  sourceId: CardInstanceId;
  source: CardInstance;
}

function setupGame(): SetupResult {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const playerIds = Array.from(state.players.keys()) as PlayerId[];
  const aliceId = playerIds[0];
  return {
    state,
    aliceId,
    sourceId: "" as CardInstanceId,
    source: undefined as unknown as CardInstance,
  };
}

function putOnBattlefield(
  state: GameState,
  controllerId: PlayerId,
  cardDef: ScryfallCard,
  opts: {
    counters?: Array<{ type: string; count: number }>;
    chosenCreatureType?: string | null;
  } = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  if (opts.counters) {
    card.counters = opts.counters;
  }
  if (opts.chosenCreatureType !== undefined) {
    card.chosenCreatureType = opts.chosenCreatureType;
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

/**
 * Register a per-pair anthem whose
 * `perCounter.perPair.ordinal` is 2. The anthem
 * grants: "This creature gets +1/+1 for the first 2
 * of each unique counter type on it." Source with 3
 * +1/+1 + 2 -1/-1 → 2 + 2 = 4.
 */
function registerPerPairOrdinalAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for the first 2 of each unique counter type on it.",
    statics: [
      {
        text: "This creature gets +1/+1 for the first 2 of each unique counter type on it.",
        affects: { self: true, controller: "you" },
        anthemScaling: {
          per: "creatures",
          perPower: 1,
          perToughness: 1,
          perCounter: {
            counter: "+1/+1",
            perPair: { ordinal: 2 },
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Register a per-pair anthem with the default
 * `perPair.ordinal: 1`. The anthem grants: "This
 * creature gets +1/+1 for the first counter of each
 * unique counter type on it." Source with 3 +1/+1 +
 * 2 -1/-1 → 1 + 1 = 2 (the "first counter per pair"
 * default).
 */
function registerPerPairDefaultAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for the first counter of each unique counter type on it.",
    statics: [
      {
        text: "This creature gets +1/+1 for the first counter of each unique counter type on it.",
        affects: { self: true, controller: "you" },
        anthemScaling: {
          per: "creatures",
          perPower: 1,
          perToughness: 1,
          perCounter: {
            counter: "+1/+1",
            perPair: {},
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 29 priority 4 — perCounter.perPair cross-type variant", () => {
  beforeEach(() => {
    resetCardScriptsForTests();
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — perCounter.perPair parses the per-pair ordinal arm", () => {
    it("accepts the perPair arm with an explicit ordinal (the cross-type variant)", () => {
      const parsed = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { self: true, controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: {
                counter: "+1/+1",
                perPair: { ordinal: 2 },
              },
            },
          },
        ],
      });
      expect(parsed.statics![0]?.anthemScaling?.perCounter?.perPair).toEqual({
        ordinal: 2,
      });
    });

    it("accepts the perPair arm without an ordinal (defaults to 1 — 'first counter per pair')", () => {
      const parsed = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { self: true, controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: {
                counter: "+1/+1",
                perPair: {},
              },
            },
          },
        ],
      });
      expect(parsed.statics![0]?.anthemScaling?.perCounter?.perPair).toEqual(
        {},
      );
    });

    it("accepts perCounter with both ordinal AND perPair (perPair takes precedence at consult time)", () => {
      const parsed = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle: "test",
        statics: [
          {
            text: "test",
            affects: { self: true, controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: {
                counter: "+1/+1",
                ordinal: 5,
                perPair: { ordinal: 2 },
              },
            },
          },
        ],
      });
      const eff = parsed.statics![0]?.anthemScaling?.perCounter;
      expect(eff?.ordinal).toBe(5);
      expect(eff?.perPair).toEqual({ ordinal: 2 });
    });

    it("rejects perPair.ordinal below 1 (`.int().min(1)`)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: SOURCE_NAME,
          oracle: "test",
          statics: [
            {
              text: "test",
              affects: { self: true, controller: "you" },
              anthemScaling: {
                per: "creatures",
                perPower: 1,
                perToughness: 1,
                perCounter: {
                  counter: "+1/+1",
                  perPair: { ordinal: 0 },
                },
              },
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown sub-arm key on perPair (`.strict()` semantics)", () => {
      // The `perPair` object is `.strict()` —
      // unknown keys throw.
      expect(() =>
        CardScriptSchema.parse({
          name: SOURCE_NAME,
          oracle: "test",
          statics: [
            {
              text: "test",
              affects: { self: true, controller: "you" },
              anthemScaling: {
                per: "creatures",
                perPower: 1,
                perToughness: 1,
                perCounter: {
                  counter: "+1/+1",
                  perPair: { sentinel: "chosen" },
                },
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — computeAnthemScalingCount consults perPair (cross-type sum)", () => {
    it("contributes 2 + 2 = 4 for source with 3 +1/+1 + 2 -1/-1 + perPair.ordinal: 2", () => {
      // The per-pair cross-type variant:
      // for each unique counter type, sum the
      // first `perPair.ordinal` counters of
      // that type; the total is the SUM across
      // all unique types. A source with 3
      // +1/+1 + 2 -1/-1 with `perPair.ordinal:
      // 2` contributes 2 + 2 = 4 (NOT 2 + 3 =
      // 5 — the cross-type summation is
      // per-pair).
      registerPerPairOrdinalAnthem();
      const setup = setupGame();
      const sourceDef = makeSourceCardDef({
        id: "perpair-source",
        name: SOURCE_NAME,
      });
      const placed = putOnBattlefield(setup.state, setup.aliceId, sourceDef, {
        counters: [
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "-1/-1", count: 1 },
          { type: "-1/-1", count: 1 },
        ],
      });
      const refreshed = refreshScriptedStatics(placed.state);
      const sourceInst = refreshed.cards.get(placed.cardId);
      expect(sourceInst).toBeDefined();
      if (!sourceInst) return;
      // `+1/+1` x 1 per counter entry — total
      // of 3 +1/+1 entries (3 separate stamping
      // events). The per-pair first-2 reads
      // the first 2 → 2.
      // `-1/-1` x 1 per counter entry — total
      // of 2 -1/-1 entries. The per-pair
      // first-2 reads the first 2 → 2.
      // Total: 2 + 2 = 4. `perPower: 1` +
      // `perToughness: 1` → +4/+4.
      expect(sourceInst.scriptStaticPT?.power).toBe(4);
      expect(sourceInst.scriptStaticPT?.toughness).toBe(4);
    });

    it("contributes 1 + 1 = 2 for source with 3 +1/+1 + 2 -1/-1 + perPair default (ordinal: 1)", () => {
      // The per-pair default is `ordinal: 1`
      // — the "first counter per pair" read.
      // A source with 3 +1/+1 + 2 -1/-1
      // contributes 1 + 1 = 2.
      registerPerPairDefaultAnthem();
      const setup = setupGame();
      const sourceDef = makeSourceCardDef({
        id: "perpair-default-source",
        name: SOURCE_NAME,
      });
      const placed = putOnBattlefield(setup.state, setup.aliceId, sourceDef, {
        counters: [
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "-1/-1", count: 1 },
          { type: "-1/-1", count: 1 },
        ],
      });
      const refreshed = refreshScriptedStatics(placed.state);
      const sourceInst = refreshed.cards.get(placed.cardId);
      expect(sourceInst).toBeDefined();
      if (!sourceInst) return;
      // Total: 1 + 1 = 2. `perPower: 1` +
      // `perToughness: 1` → +2/+2.
      expect(sourceInst.scriptStaticPT?.power).toBe(2);
      expect(sourceInst.scriptStaticPT?.toughness).toBe(2);
    });

    it("contributes 0 when source has no counters (empty source)", () => {
      // Regression guard: an empty source
      // contributes 0 (no counters, no pair
      // sum).
      registerPerPairOrdinalAnthem();
      const setup = setupGame();
      const sourceDef = makeSourceCardDef({
        id: "perpair-empty-source",
        name: SOURCE_NAME,
      });
      const placed = putOnBattlefield(setup.state, setup.aliceId, sourceDef);
      const refreshed = refreshScriptedStatics(placed.state);
      const sourceInst = refreshed.cards.get(placed.cardId);
      expect(sourceInst).toBeDefined();
      if (!sourceInst) return;
      // No counters → anthem is inert (the
      // `scriptStaticPT` ledger is not set
      // when the anthem doesn't apply a
      // bonus). The printed base P/T is
      // preserved.
      expect(sourceInst.scriptStaticPT).toBeUndefined();
    });

    it("contributes per-type cumulative across multiple counter types", () => {
      // A source with 2 +1/+1 + 2 -1/-1 + 3
      // charge counters with `perPair.ordinal:
      // 1` contributes 1 + 1 + 1 = 3 (the
      // "first counter per pair" default).
      registerPerPairDefaultAnthem();
      const setup = setupGame();
      const sourceDef = makeSourceCardDef({
        id: "perpair-three-types-source",
        name: SOURCE_NAME,
      });
      const placed = putOnBattlefield(setup.state, setup.aliceId, sourceDef, {
        counters: [
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "-1/-1", count: 1 },
          { type: "-1/-1", count: 1 },
          { type: "charge", count: 1 },
          { type: "charge", count: 1 },
          { type: "charge", count: 1 },
        ],
      });
      const refreshed = refreshScriptedStatics(placed.state);
      const sourceInst = refreshed.cards.get(placed.cardId);
      expect(sourceInst).toBeDefined();
      if (!sourceInst) return;
      // 3 unique types, first 1 of each
      // (the per-pair default ordinal: 1) → 3.
      expect(sourceInst.scriptStaticPT?.power).toBe(3);
      expect(sourceInst.scriptStaticPT?.toughness).toBe(3);
    });
  });

  describe("regression — perPair unset preserves the follow-up 28 priority 1 semantic", () => {
    it("uses the perCounter.ordinal? path when perPair is unset (regression guard for the precedence rule)", () => {
      // Regression guard: when `perPair` is
      // unset, the engine consults the
      // existing per-counter `ordinal?` arm
      // (the follow-up 28 priority 1
      // semantic). The per-pair takes
      // precedence ONLY when set.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "This creature gets +1/+1 for the first 2 +1/+1 counters on it.",
        statics: [
          {
            text: "This creature gets +1/+1 for the first 2 +1/+1 counters on it.",
            affects: { self: true, controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "+1/+1", ordinal: 2 },
            },
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      const setup = setupGame();
      const sourceDef = makeSourceCardDef({
        id: "no-perpair-source",
        name: SOURCE_NAME,
      });
      const placed = putOnBattlefield(setup.state, setup.aliceId, sourceDef, {
        counters: [
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "+1/+1", count: 1 },
          { type: "-1/-1", count: 5 },
        ],
      });
      const refreshed = refreshScriptedStatics(placed.state);
      const sourceInst = refreshed.cards.get(placed.cardId);
      expect(sourceInst).toBeDefined();
      if (!sourceInst) return;
      // No perPair — the per-counter ordinal
      // path is consulted: first 2 +1/+1
      // counters → 2 (NOT per-pair which
      // would be 2 + 1 = 3).
      expect(sourceInst.scriptStaticPT?.power).toBe(2);
      expect(sourceInst.scriptStaticPT?.toughness).toBe(2);
    });
  });
});
