/**
 * Wave 4.8 follow-up 27 lane 32 piece 1/N (#2614 follow-up):
 * `andPer.perCounter` self-referential per-counter arm
 * on the AND-source.
 *
 * The lane 32 piece 4/N (follow-up 25) + piece 1/N
 * (follow-up 26) substrate shipped the PRIMARY
 * `perCounter: { counter: string | "chosen" }` arm on
 * `anthemScaling` — when set, REPLACES the primary
 * `per` state-derived count with the source's own
 * per-counter count.
 *
 * This piece extends the `andPer` AND-source with a
 * parallel `andPer.perCounter` arm. When set, the
 * `andPer` contribution to the compound count
 * becomes the SOURCE's own per-counter count
 * (REPLACES the `andPer.per` state-derived count).
 * The `andPer.perCounter.counter` accepts the
 * `"chosen"` sentinel — the engine resolves the
 * counter type from `source.chosenCreatureType`
 * (parallel to the primary `perCounter` sentinel and
 * the `perSubtype: "chosen"` sentinel).
 *
 * The `andPer.perCounter` arm is INDEPENDENT from the
 * `andPer.per` enum + `andPer.perSubtype` filter —
 * they are not both consulted in the same pass. When
 * `andPer.perCounter` is set, the `andPer.per` and
 * `andPer.perSubtype` fields are ignored.
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

const SOURCE_NAME =
  "Test AndPer-PerCounter Compound Anthem (lane 32 piece 1/N)";

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
 * Register a chosen-counter self-scaling anthem whose
 * compound AND-source is a per-counter arm
 * (`andPer.perCounter`). The anthem grants:
 * "Other creatures you control get +1/+1 for each
 *  other creature you control AND for each [chosen
 *  counter kind] on this creature." When the source
 * has 3 "marker" counters and 2 other creatures on
 * the battlefield, the affected buddy gets
 * +1/+1 * (2 + 3) = +5/+5.
 */
function registerAndPerPerCounterAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
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
            perCounter: { counter: "chosen" },
          },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 27 lane 32 piece 1/N — andPer.perCounter compound arm", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerAndPerPerCounterAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling accepts the andPer.perCounter arm", () => {
    it("parses an andPer.perCounter literal-counter arm", () => {
      // The compound arm accepts a literal
      // `perCounter: { counter: <string> }` — the
      // engine resolves the counter type from the
      // source's own counters map.
      const script = CardScriptSchema.parse({
        name: "Test AndPer-PerCounter Literal Anthem",
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
                perCounter: { counter: "marker" },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: { per: string; perCounter?: { counter: string } };
        };
      };
      expect(stat.anthemScaling?.andPer?.per).toBe("creatures");
      expect(stat.anthemScaling?.andPer?.perCounter?.counter).toBe(
        "marker",
      );
    });

    it("parses an andPer.perCounter: { counter: 'chosen' } sentinel arm", () => {
      // The `"chosen"` sentinel accepts the
      // counter-type resolution from
      // `source.chosenCreatureType` (parallel to
      // the primary `perCounter` sentinel from
      // follow-up 26 piece 1/N).
      const script = CardScriptSchema.parse({
        name: "Test AndPer-Chosen-Counter Anthem",
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
                perCounter: { counter: "chosen" },
              },
            },
          },
        ],
      });
      const stat = script.statics![0] as {
        anthemScaling?: {
          andPer?: { per: string; perCounter?: { counter: string } };
        };
      };
      expect(stat.anthemScaling?.andPer?.perCounter?.counter).toBe(
        "chosen",
      );
    });
  });

  describe("engine — refreshScriptedStatics consults andPer.perCounter", () => {
    it("adds the andPer.perCounter count to the primary count (chosen sentinel resolves via chosenCreatureType)", () => {
      // Source has 3 "marker" counters AND
      // `chosenCreatureType: "marker"` (simulating
      // the `enter_choice: { kind: "creature_type" }`
      // resolver stamping the field). The anthem
      // grants: primary `per: "other_creatures"`
      // (count=2 — the buddy + one extra creature)
      // + `andPer.perCounter: { counter: "chosen" }`
      // which resolves to "marker" from
      // chosenCreatureType (count=3 from the
      // source's own counters). Compound is
      // 2 + 3 = 5 → buddy gets +5/+5.
      // Source is placed LAST so the script lookup
      // finds the registered anthem after all the
      // other battlefield cards are in place.
      const buddyR = putOnBattlefield(
        state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-percounter-buddy" }),
      );
      const extraR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeBuddyCardDef({ id: "andPer-percounter-extra" }),
      );
      const sourceR = putOnBattlefield(
        extraR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-percounter-source" }),
        {
          counters: [{ type: "marker", count: 3 }],
          chosenCreatureType: "marker",
        },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // The compound count for the buddy's anthem
      // effect: primary `per: "other_creatures"` (count=2 —
      // the buddy + one extra creature) + andPer.perCounter
      // (count=3 from the source's own "marker" counters
      // resolved via chosenCreatureType). Compound is
      // 2 + 3 = 5. The buddy's `scriptStaticPT` is +5/+5.
      expect(buddy.scriptStaticPT?.power).toBe(5);
      expect(buddy.scriptStaticPT?.toughness).toBe(5);
    });

    it("returns primary count only when andPer.perCounter is unset (state-derived fallback preserved)", () => {
      // Regression guard: when `andPer.perCounter`
      // is NOT set, the `andPer.per` state-derived
      // count is consulted (the pre-existing
      // follow-up 25 piece 2/N semantic). The
      // andPer.perCounter arm does NOT change the
      // unset path. Use the SAME source card name
      // (SOURCE_NAME) so the script lookup finds
      // the registered anthem on the source card.
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
        makeBuddyCardDef({ id: "andPer-fallback-buddy" }),
      );
      const treasureR = putOnBattlefield(
        buddyR.state,
        aliceId,
        makeTreasureCardDef({ id: "andPer-fallback-treasure-1" }),
      );
      const sourceR = putOnBattlefield(
        treasureR.state,
        aliceId,
        makeSourceCardDef({ id: "andPer-fallback-source" }),
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const buddy = afterRefresh.cards.get(buddyR.cardId);
      expect(buddy).toBeDefined();
      if (!buddy) return;
      // 1 other_creature (the buddy) + 1 treasure = 2.
      // The anthem contributes +2/+2 to the buddy.
      expect(buddy.scriptStaticPT?.power).toBe(2);
      expect(buddy.scriptStaticPT?.toughness).toBe(2);
    });
  });
});
