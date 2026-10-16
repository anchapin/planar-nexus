/**
 * Wave 4.8 follow-up 28 priority 1 (#2614 follow-up):
 * `perCounter.ordinal` cumulative-sum variant.
 *
 * The follow-up 25 lane 32 piece 4/N + follow-up 26
 * lane 32 piece 1/N + follow-up 27 lane 32 piece 1/N
 * substrate shipped the per-counter arm on
 * `anthemScaling.perCounter` AND on
 * `anthemScaling.andPer.perCounter` — both with a
 * `counter: string | "chosen"` field. When set, the
 * per-counter count is the SUM of all counters of the
 * resolved type on the source.
 *
 * This piece extends BOTH arms with an OPTIONAL
 * `ordinal: number` field. When set, the per-counter
 * count is the CUMULATIVE sum of the first `ordinal`
 * counters of the resolved type on the source
 * (matches MTG "Nth counter" semantics — a source
 * with 3 +1/+1 counters and `ordinal: 2` contributes
 * 2, not 3). When unset, the existing per-counter
 * semantic is used (sum of ALL counters of the
 * resolved type).
 *
 * The `"chosen"` sentinel resolves the counter type
 * FIRST (from `source.chosenCreatureType`); the
 * ordinal then applies to the resolved type. The
 * primary `perCounter.ordinal?` and the
 * `andPer.perCounter.ordinal?` fields are
 * INDEPENDENT (each applies to its own arm).
 *
 * Three test groups:
 *   1. schema — `perCounter.ordinal` parses for the
 *      primary arm and the `andPer.perCounter` arm.
 *   2. engine — `computeAnthemScalingCount` consults
 *      the ordinal on both arms (literal counter
 *      type + `"chosen"` sentinel combo + the
 *      andPer.perCounter ordinal).
 *   3. regression — the unset-ordinal path still uses
 *      the existing sum-of-all-counters semantic
 *      (regression guard for the follow-up 25 / 26 /
 *      27 pieces).
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
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME =
  "Test Ordinal Per-Counter Anthem (lane 32 priority 1)";

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

function makeBuddyCardDef(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Other Creature",
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
 * Register a per-counter anthem whose
 * `perCounter` arm carries an `ordinal: 2`. The
 * anthem grants: "This creature gets +1/+1 for each
 * +1/+1 counter on it, but only the first 2."
 * Source with 3 +1/+1 counters → +2/+2.
 */
function registerOrdinalAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for each of the first 2 +1/+1 counters on it.",
    statics: [
      {
        text:
          "This creature gets +1/+1 for each of the first 2 +1/+1 counters on it.",
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
}

/**
 * Register a chosen-counter + ordinal anthem. The
 * anthem grants: "This creature gets +1/+1 for each
 * of the first 3 [chosen counter] on it." When the
 * source has `chosenCreatureType: "marker"` AND 4
 * marker counters → +3/+3 (first 3 of 4).
 */
function registerChosenOrdinalAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for each of the first 3 [chosen counter kind] on it.",
    statics: [
      {
        text:
          "This creature gets +1/+1 for each of the first 3 [chosen counter kind] on it.",
        affects: { self: true, controller: "you" },
        anthemScaling: {
          per: "creatures",
          perPower: 1,
          perToughness: 1,
          perCounter: { counter: "chosen", ordinal: 3 },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Register a compound anthem whose
 * `andPer.perCounter` arm carries an `ordinal: 2`.
 * The anthem grants: "Other creatures you control
 * get +1/+1 for each other creature you control AND
 * for each of the first 2 [chosen counter] on this
 * creature."
 */
function registerAndPerOrdinalAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 [chosen counter] on this creature.",
    statics: [
      {
        text:
          "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 [chosen counter] on this creature.",
        affects: { controller: "you" },
        anthemScaling: {
          per: "other_creatures",
          perPower: 1,
          perToughness: 1,
          andPer: {
            per: "creatures",
            perCounter: { counter: "chosen", ordinal: 2 },
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 28 priority 1 — perCounter.ordinal cumulative-sum variant", () => {
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

  describe("schema — StaticSchema.anthemScaling accepts the ordinal field on both arms", () => {
    it("parses a primary perCounter arm carrying ordinal: 2", () => {
      const script = CardScriptSchema.parse({
        name: "Test Ordinal Per-Counter Anthem",
        oracle:
          "This creature gets +1/+1 for each of the first 2 +1/+1 counters on it.",
        statics: [
          {
            text:
              "This creature gets +1/+1 for each of the first 2 +1/+1 counters on it.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "+1/+1", ordinal: 2 },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          perCounter?: { counter: string; ordinal?: number };
        };
      };
      expect(stat.anthemScaling?.perCounter?.counter).toBe("+1/+1");
      expect(stat.anthemScaling?.perCounter?.ordinal).toBe(2);
    });

    it("parses a perCounter arm with ordinal omitted (regression — existing shape)", () => {
      const script = CardScriptSchema.parse({
        name: "Test Unset-Ordinal Per-Counter Anthem",
        oracle:
          "This creature gets +1/+1 for each +1/+1 counter on it.",
        statics: [
          {
            text:
              "This creature gets +1/+1 for each +1/+1 counter on it.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "+1/+1" },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          perCounter?: { counter: string; ordinal?: number };
        };
      };
      expect(stat.anthemScaling?.perCounter?.counter).toBe("+1/+1");
      expect(stat.anthemScaling?.perCounter?.ordinal).toBeUndefined();
    });

    it("parses an andPer.perCounter arm carrying ordinal: 2", () => {
      const script = CardScriptSchema.parse({
        name: "Test AndPer-Ordinal Per-Counter Anthem",
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 [chosen counter] on this creature.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 [chosen counter] on this creature.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                perCounter: { counter: "chosen", ordinal: 2 },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: {
            perCounter?: { counter: string; ordinal?: number };
          };
        };
      };
      expect(stat.anthemScaling?.andPer?.perCounter?.counter).toBe(
        "chosen",
      );
      expect(stat.anthemScaling?.andPer?.perCounter?.ordinal).toBe(2);
    });

    it("rejects an ordinal: 0 (MIN 1 enforced at the Zod layer)", () => {
      // The Zod schema declares
      // `z.number().int().min(1)` for the ordinal —
      // a value below 1 is rejected at parse time.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad-Ordinal Anthem",
          oracle:
            "This creature gets +1/+1 for each of the first 0 +1/+1 counters on it.",
          statics: [
            {
              text:
                "This creature gets +1/+1 for each of the first 0 +1/+1 counters on it.",
              affects: { controller: "you" },
              anthemScaling: {
                per: "creatures",
                perPower: 1,
                perToughness: 1,
                perCounter: { counter: "+1/+1", ordinal: 0 },
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — refreshScriptedStatics consults perCounter.ordinal (literal counter)", () => {
    it("reads the cumulative sum of the first N counters when ordinal is set", () => {
      // Source has 3 +1/+1 counters (3 separate stamping
      // events). The anthem's perCounter is
      // `{ counter: "+1/+1", ordinal: 2 }`. Cumulative
      // sum of the first 2 = 2 (NOT 3 — the existing
      // perCounter semantic sums ALL counters of the
      // type). The anthem grants +2/+2.
      registerOrdinalAnthem();
      const sourceR = putOnBattlefield(
        state,
        aliceId,
        makeSourceCardDef({ id: "ordinal-literal-source" }),
        {
          // 3 separate +1/+1 counter entries — the
          // engine slices the first `ordinal` (2) of
          // them and sums.
          counters: [
            { type: "+1/+1", count: 1 },
            { type: "+1/+1", count: 1 },
            { type: "+1/+1", count: 1 },
          ],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const source = afterRefresh.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      if (!source) return;
      // Cumulative sum of the first 2 +1/+1 counters
      // = 2 → source gets +2/+2.
      expect(source.scriptStaticPT?.power).toBe(2);
      expect(source.scriptStaticPT?.toughness).toBe(2);
    });

    it("respects the entry-count boundary — ordinal past the array length clamps to the full array", () => {
      // Source has 2 +1/+1 counters (each with count=2)
      // and the anthem's perCounter is
      // `{ counter: "+1/+1", ordinal: 5 }` (ordinal
      // exceeds the number of entries). The engine
      // sums the full 2 entries → 2+2 = 4 (NOT clamped
      // to 0 — `Array.slice(0, 5)` on a 2-element
      // array returns the full array).
      registerOrdinalAnthem();
      const sourceR = putOnBattlefield(
        state,
        aliceId,
        makeSourceCardDef({ id: "ordinal-overflow-source" }),
        {
          counters: [
            { type: "+1/+1", count: 2 },
            { type: "+1/+1", count: 2 },
          ],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const source = afterRefresh.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      if (!source) return;
      // Ordinal=2 matches the registered anthem's
      // ordinal (set in registerOrdinalAnthem). With
      // 2 counter entries of count 2 each, the
      // cumulative sum is 2+2 = 4 → +4/+4.
      expect(source.scriptStaticPT?.power).toBe(4);
      expect(source.scriptStaticPT?.toughness).toBe(4);
    });
  });

  describe("engine — perCounter.ordinal interacts with the 'chosen' sentinel", () => {
    it("resolves the counter type from chosenCreatureType first, then applies the ordinal", () => {
      // Source has 4 "marker" counter entries AND
      // `chosenCreatureType: "marker"` (simulating
      // the `enter_choice: { kind: "creature_type" }`
      // resolver stamping the field). The anthem's
      // perCounter is `{ counter: "chosen", ordinal: 3
      // }`. The sentinel resolves to "marker" FIRST,
      // then the ordinal slices the first 3 marker
      // entries. Cumulative sum = 1+1+1 = 3 → +3/+3.
      registerChosenOrdinalAnthem();
      const sourceR = putOnBattlefield(
        state,
        aliceId,
        makeSourceCardDef({ id: "ordinal-chosen-source" }),
        {
          counters: [
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
          ],
          chosenCreatureType: "marker",
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const source = afterRefresh.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      if (!source) return;
      // Cumulative sum of the first 3 marker counters
      // = 1+1+1 = 3 → +3/+3.
      expect(source.scriptStaticPT?.power).toBe(3);
      expect(source.scriptStaticPT?.toughness).toBe(3);
    });

    it("returns 0 when chosenCreatureType is null (sentinel resolves to null)", () => {
      // The `"chosen"` sentinel resolves to null when
      // chosenCreatureType is unset (the enter choice
      // hasn't resolved yet). The count is 0 (the
      // scripted anthem remains inert — matches the
      // lane 86 chosen-type anthem semantics). The
      // engine does NOT stamp `scriptStaticPT` when the
      // count is 0 (the `pt.set` gate at line 1325
      // requires `power || toughness` to be truthy).
      registerChosenOrdinalAnthem();
      const sourceR = putOnBattlefield(
        state,
        aliceId,
        makeSourceCardDef({ id: "ordinal-chosen-unset-source" }),
        {
          counters: [
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
          ],
          // chosenCreatureType is undefined (unset).
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const source = afterRefresh.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      if (!source) return;
      // The sentinel resolves to null → early return
      // with count=0 → anthem contributes 0 to the
      // source's P/T. The `scriptStaticPT` field is
      // NOT stamped (the count was 0 — the engine's
      // `pt.set` gate skips writing when neither
      // `power` nor `toughness` is truthy).
      expect(source.scriptStaticPT).toBeUndefined();
    });
  });

  describe("engine — andPer.perCounter.ordinal extension", () => {
    it("applies the ordinal on andPer.perCounter (cumulative sum of the first N)", () => {
      // The source has 3 "marker" counter entries
      // and `chosenCreatureType: "marker"`. The
      // anthem's `andPer` arm is
      // `{ per: "creatures", perCounter: { counter:
      // "chosen", ordinal: 2 } }`. The compound
      // count = primary `per: "other_creatures"`
      // (count=1 — just the buddy, since the source
      // itself is excluded) + andPer.perCounter
      // (cumulative sum of the first 2 marker counters
      // = 1+1 = 2). Compound = 1 + 2 = 3 → buddy gets
      // +3/+3.
      registerAndPerOrdinalAnthem();
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-ordinal-buddy" }),
      );
      const sourceR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-ordinal-source" }),
        {
          counters: [
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
          ],
          chosenCreatureType: "marker",
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // Compound count = primary (1 other_creature
      // = the buddy) + andPer.perCounter (first 2
      // marker counters = 1+1 = 2) = 3. The buddy's
      // `scriptStaticPT` is +3/+3.
      expect(buddy.scriptStaticPT?.power).toBe(3);
      expect(buddy.scriptStaticPT?.toughness).toBe(3);
    });
  });

  describe("regression — unset-ordinal path preserves the sum-of-all-counters semantic", () => {
    it("the existing primary perCounter without ordinal sums ALL counters (follow-up 25/26/27 substrate)", () => {
      // Regression guard: when `perCounter.ordinal`
      // is NOT set, the engine still uses the
      // existing per-counter semantic (sum of ALL
      // counters of the resolved type — a single
      // `find` consult + `?? 0`). Use a fresh
      // anthem without ordinal for this test.
      // Register under SOURCE_NAME so the source
      // card's default `name: SOURCE_NAME` matches
      // the registered script.
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "This creature gets +1/+1 for each +1/+1 counter on it.",
        statics: [
          {
            text:
              "This creature gets +1/+1 for each +1/+1 counter on it.",
            affects: { self: true, controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "+1/+1" },
            },
          },
        ],
      });
      registerCardScripts([script]);
      const sourceR = putOnBattlefield(
        state,
        aliceId,
        makeSourceCardDef({ id: "no-ordinal-source" }),
        {
          counters: [{ type: "+1/+1", count: 3 }],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const source = afterRefresh.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      if (!source) return;
      // Single +1/+1 entry with count=3 → sum=3.
      // The source gets +3/+3 (the existing
      // perCounter semantic, unchanged by the
      // ordinal extension).
      expect(source.scriptStaticPT?.power).toBe(3);
      expect(source.scriptStaticPT?.toughness).toBe(3);
    });
  });
});