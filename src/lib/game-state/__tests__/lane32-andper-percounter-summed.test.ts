/**
 * Wave 4.8 follow-up 28 priority 3 (#2614 follow-up):
 * `andPer.perCounterSummed` summed per-counter form.
 *
 * The follow-up 27 lane 32 piece 1/N substrate shipped
 * `andPer.perCounter: { counter: string | "chosen" }`
 * — the REPLACE form on the `andPer` AND-source. When
 * set, the `andPer` contribution REPLACES the
 * `andPer.per` state-derived count with the source's
 * own per-counter count (parallels the primary
 * `perCounter` REPLACES the primary `per`).
 *
 * This piece adds the SUMMED form:
 * `andPer.perCounterSummed: { counter: string |
 * "chosen", ordinal?: number }`. When set, the
 * per-counter count is SUMMED with the `andPer.per`
 * state-derived count (NOT replaced). The natural
 * read for "per creature AND per chosen counter"
 * anthems — the REPLACE form is a special case for
 * self-referential count sources; the SUM form is
 * the CORRECT shape for most "per + perCounter" use
 * cases. v1 minimum: the SUM arm lives alongside the
 * REPLACE arm (both are valid). When BOTH are set,
 * the SUM arm takes precedence.
 *
 * Three test groups:
 *   1. schema — `andPer.perCounterSummed` parses for
 *      a literal-counter arm and a sentinel arm + an
 *      ordinal variant.
 *   2. engine — `refreshScriptedStatics` consults the
 *      summed form: state-derived + per-counter count
 *      = SUM (NOT replaced). The ordinal variant
 *      applies to the summed form too.
 *   3. regression — the REPLACE form
 *      (`andPer.perCounter`) still resolves
 *      correctly (regression guard for the follow-up
 *      27 piece 1/N substrate). The unset-summed
 *      path still uses the existing REPLACE semantic.
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
  "Test AndPer-PerCounterSummed Compound Anthem (lane 32 priority 3)";

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

function makeTreasureCardDef(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Treasure",
    type_line: overrides.type_line ?? "Artifact — Treasure",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    power: undefined,
    toughness: undefined,
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
 * Register a SUMMED per-counter anthem whose
 * `andPer.perCounterSummed` arm carries a literal
 * counter type. The anthem grants: "Other creatures
 * you control get +1/+1 for each other creature you
 * control AND for each marker on this creature." When
 * the source has 2 marker counters and 3 other
 * creatures on the battlefield, the andPer contribution
 * is 3 (creatures) + 2 (markers) = 5, NOT 2 (replaced).
 */
function registerAndPerPerCounterSummedAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature.",
    statics: [
      {
        text:
          "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature.",
        affects: { controller: "you" },
        anthemScaling: {
          per: "other_creatures",
          perPower: 1,
          perToughness: 1,
          andPer: {
            per: "creatures",
            perCounterSummed: { counter: "marker" },
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

/**
 * Register a SUMMED chosen-counter + ordinal anthem.
 * The anthem grants: "Other creatures you control get
 * +1/+1 for each other creature you control AND for
 * each of the first 2 [chosen counter] on this
 * creature."
 */
function registerAndPerPerCounterSummedOrdinalAnthem(): void {
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
            perCounterSummed: { counter: "chosen", ordinal: 2 },
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 28 priority 3 — andPer.perCounterSummed summed form", () => {
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

  describe("schema — StaticSchema.anthemScaling.andPer accepts the perCounterSummed arm", () => {
    it("parses an andPer.perCounterSummed literal-counter arm", () => {
      const script = CardScriptSchema.parse({
        name: "Test AndPer-PerCounterSummed Literal Anthem",
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                perCounterSummed: { counter: "marker" },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: {
            per: string;
            perCounterSummed?: { counter: string; ordinal?: number };
          };
        };
      };
      expect(stat.anthemScaling?.andPer?.per).toBe("creatures");
      expect(stat.anthemScaling?.andPer?.perCounterSummed?.counter).toBe(
        "marker",
      );
    });

    it("parses an andPer.perCounterSummed: { counter: 'chosen' } sentinel arm", () => {
      const script = CardScriptSchema.parse({
        name: "Test AndPer-Chosen-Counter-Summed Anthem",
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each [chosen counter] on this creature.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each [chosen counter] on this creature.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                perCounterSummed: { counter: "chosen" },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: {
            perCounterSummed?: { counter: string; ordinal?: number };
          };
        };
      };
      expect(
        stat.anthemScaling?.andPer?.perCounterSummed?.counter,
      ).toBe("chosen");
    });

    it("parses an andPer.perCounterSummed arm carrying an ordinal variant", () => {
      const script = CardScriptSchema.parse({
        name: "Test AndPer-PerCounterSummed-Ordinal Anthem",
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 markers on this creature.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each of the first 2 markers on this creature.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                perCounterSummed: { counter: "marker", ordinal: 2 },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: {
            perCounterSummed?: { counter: string; ordinal?: number };
          };
        };
      };
      expect(
        stat.anthemScaling?.andPer?.perCounterSummed?.counter,
      ).toBe("marker");
      expect(
        stat.anthemScaling?.andPer?.perCounterSummed?.ordinal,
      ).toBe(2);
    });
  });

  describe("engine — refreshScriptedStatics consults andPer.perCounterSummed (SUM, not REPLACE)", () => {
    it("sums the state-derived count AND the per-counter count (SUM, not REPLACE)", () => {
      // The source has 2 marker counters and
      // chosenCreatureType is unset (the
      // `perCounterSummed: { counter: "marker" }`
      // uses the literal "marker" type). The
      // anthem's andPer is
      // `{ per: "creatures", perCounterSummed:
      // { counter: "marker" } }`. The state-
      // derived count for `per: "creatures"` =
      // 3 (the source + 2 buddies — note: the
      // source itself counts as a creature under
      // the SUM arm). The per-counter count = 2
      // (the source's own marker counters). The
      // SUM is 3 + 2 = 5. The compound count
      // (primary `per: "other_creatures"` + the
      // andPer SUM) is 2 + 5 = 7 → buddy gets
      // +7/+7. The REPLACE form would have given
      // 2 + 2 = 4 (the andPer REPLACES the state-
      // derived count).
      registerAndPerPerCounterSummedAnthem();
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-summed-buddy-1" }),
      );
      const buddy2R = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-summed-buddy-2" }),
      );
      const sourceR = putOnBattlefield(
        buddy2R.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-summed-source" }),
        {
          counters: [{ type: "marker", count: 2 }],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // The compound count for the buddy's
      // anthem effect: primary `per:
      // "other_creatures"` (count=2 — the 2
      // buddies, excluding the source) +
      // andPer.perCounterSummed (state-derived
      // count for `per: "creatures"` = 3 [the
      // source + 2 buddies] + per-counter count
      // = 2 [the source's own markers] = 5).
      // Compound is 2 + 5 = 7. The buddy's
      // `scriptStaticPT` is +7/+7. (The REPLACE
      // form would give 2 + 2 = 4.)
      expect(buddy.scriptStaticPT?.power).toBe(7);
      expect(buddy.scriptStaticPT?.toughness).toBe(7);
    });

    it("returns the state-derived count only when andPer.perCounterSummed is unset (regression — unset path)", () => {
      // Regression guard: when
      // `andPer.perCounterSummed` is NOT set,
      // the `andPer.per` state-derived count is
      // consulted (the pre-existing follow-up 25
      // piece 2/N semantic). The summed arm
      // does NOT change the unset path. Use the
      // SAME source card name (SOURCE_NAME) so
      // the script lookup finds the registered
      // anthem on the source card.
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each Treasure you control.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each Treasure you control.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: { per: "treasures" },
            },
          },
        ],
      });
      registerCardScripts([script]);
      // Place buddy + treasure first; source last
      // (script lookup reads the source's name).
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-summed-fallback-buddy" }),
      );
      const treasureR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeTreasureCardDef({ id: "andPer-summed-fallback-treasure-1" }),
      );
      const sourceR = putOnBattlefield(
        treasureR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-summed-fallback-source" }),
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // 1 other_creature (the buddy) + 1
      // treasure = 2. The anthem contributes
      // +2/+2 to the buddy. (No summed
      // per-counter arm is consulted.)
      expect(buddy.scriptStaticPT?.power).toBe(2);
      expect(buddy.scriptStaticPT?.toughness).toBe(2);
    });

    it("the SUM arm takes precedence when BOTH perCounter and perCounterSummed are set", () => {
      // When BOTH `andPer.perCounter` (REPLACE)
      // and `andPer.perCounterSummed` (SUM) are
      // set, the SUM arm takes precedence
      // (the SUM is the natural read; the
      // REPLACE arm is the self-referential
      // special case). The anthem grants:
      // primary `per: "other_creatures"`
      // (count=1 — just the buddy) +
      // andPer.perCounterSummed
      // (state-derived count for `per:
      // "creatures"` = 2 [the source + buddy] +
      // per-counter count = 2 [the source's own
      // markers] = 4). Compound = 1 + 4 = 5 →
      // buddy gets +5/+5. (The REPLACE arm would
      // give 1 + 2 = 3.)
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature (BOTH replace and summed arms set).",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature (BOTH replace and summed arms set).",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                // BOTH arms set — the SUM arm
                // takes precedence.
                perCounter: { counter: "marker" },
                perCounterSummed: { counter: "marker" },
              },
            },
          },
        ],
      });
      registerCardScripts([script]);
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-precedence-buddy" }),
      );
      const sourceR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-precedence-source" }),
        {
          counters: [{ type: "marker", count: 2 }],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // Compound count = primary (1
      // other_creature = the buddy) +
      // andPer.perCounterSummed (state-derived
      // count for `per: "creatures"` = 2
      // [the source + buddy] + per-counter count
      // = 2 [markers] = 4). The SUM arm takes
      // precedence over the REPLACE arm. The
      // buddy's `scriptStaticPT` is +5/+5. (The
      // REPLACE arm would give 1 + 2 = 3.)
      expect(buddy.scriptStaticPT?.power).toBe(5);
      expect(buddy.scriptStaticPT?.toughness).toBe(5);
    });

    it("the SUM arm respects the ordinal field (cumulative sum of the first N markers)", () => {
      // The source has 3 marker counters. The
      // anthem's andPer is
      // `{ per: "creatures", perCounterSummed:
      // { counter: "chosen", ordinal: 2 } }`.
      // The state-derived count for `per:
      // "creatures"` = 2 (the source + buddy).
      // The per-counter count (with ordinal=2)
      // = cumulative sum of the first 2
      // markers = 1+1 = 2. The SUM is 2 + 2 =
      // 4. The compound count (primary +
      // andPer SUM) is 1 + 4 = 5 → buddy gets
      // +5/+5. (The REPLACE form would give
      // 1 + 2 = 3.)
      registerAndPerPerCounterSummedOrdinalAnthem();
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-summed-ord-buddy" }),
      );
      const sourceR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-summed-ord-source" }),
        {
          counters: [
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
            { type: "marker", count: 1 },
          ],
          // The SUM arm uses `counter: "chosen"`
          // — the sentinel resolves to
          // chosenCreatureType when set; the
          // test's `chosenCreatureType: "marker"`
          // resolves the type.
          chosenCreatureType: "marker",
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // Compound count = primary (1
      // other_creature = the buddy) +
      // andPer.perCounterSummed (state-derived
      // count = 2 [the source + buddy] +
      // per-counter count = 2 [first 2 of 3
      // markers with ordinal=2] = 4). Compound
      // is 1 + 4 = 5. The buddy's
      // `scriptStaticPT` is +5/+5.
      expect(buddy.scriptStaticPT?.power).toBe(5);
      expect(buddy.scriptStaticPT?.toughness).toBe(5);
    });
  });

  describe("regression — the existing REPLACE form (andPer.perCounter) still resolves correctly", () => {
    it("the REPLACE form REPLACES the state-derived count (follow-up 27 piece 1/N substrate)", () => {
      // Regression guard: when
      // `andPer.perCounter` is set AND
      // `andPer.perCounterSummed` is unset, the
      // REPLACE semantic from follow-up 27
      // piece 1/N is preserved. The per-counter
      // count REPLACES the state-derived count.
      // This is a SPECIAL case for self-
      // referential count sources; the SUM form
      // covers 90%+ of use cases.
      resetCardScriptsForTests();
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature (REPLACE form).",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control and each marker on this creature (REPLACE form).",
            affects: { controller: "you" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              andPer: {
                per: "creatures",
                perCounter: { counter: "marker" },
              },
            },
          },
        ],
      });
      registerCardScripts([script]);
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-replace-buddy" }),
      );
      const sourceR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-replace-source" }),
        {
          counters: [{ type: "marker", count: 3 }],
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // The REPLACE form: primary (1
      // other_creature = the buddy) +
      // andPer.perCounter (REPLACES the
      // state-derived count; per-counter count
      // = 3 [the source's own markers]). The
      // andPer contribution is 3 (NOT the
      // state-derived count of 2 [the source +
      // buddy]). Compound is 1 + 3 = 4. The
      // buddy's `scriptStaticPT` is +4/+4.
      // (The SUM form would give 1 + 5 = 6.)
      expect(buddy.scriptStaticPT?.power).toBe(4);
      expect(buddy.scriptStaticPT?.toughness).toBe(4);
    });
  });
});