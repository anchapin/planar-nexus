/**
 * Wave 4.8 follow-up 25 lane 32 piece 3/N (#2614 follow-up):
 * chosen-type `perSubtype` variant.
 *
 * The follow-up 24 lane 32 piece 2/N substrate shipped
 * `perSubtype?: string` as a FIXED TYPE STRING
 * (filter the count to permanents whose `type_line`
 * includes the literal subtype as a case-insensitive
 * substring). The follow-up 23 lane 86 chosen-type
 * anthem shipped `affects.subtype: "chosen"` as a
 * SENTINEL meaning "use the source's
 * `chosenCreatureType` instance field".
 *
 * This piece extends `perSubtype` to also accept the
 * `"chosen"` sentinel (parallel to `affects.subtype:
 * "chosen"`). The engine consults
 * `source.chosenCreatureType` when `perSubtype ===
 * "chosen"`; if the chosen type is unset (no
 * `enter_choice: { kind: "creature_type" }` resolve),
 * the count is 0 (matching the lane 86 chosen-type
 * anthem semantics in `staticAffects`).
 *
 * The sentinel + chosen-type anthem exercises both
 * the affects-side filter (`affects.subtype: "chosen"`)
 * AND the count-side filter (`perSubtype: "chosen"`)
 * in one pass — a "creatures you control of the
 * chosen type get +1/+1 for each OTHER creature you
 * control OF THE CHOSEN TYPE" anthem verifies the
 * parallel chosen-type flow.
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

const SOURCE_NAME = "Test Chosen-Type Per-Subtype Anthem (lane 32 piece 3/N)";

function makeSourceCardDef(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? SOURCE_NAME,
    type_line: overrides.type_line ?? "Creature — Shapeshifter",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{W}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
    keywords: overrides.keywords ?? [],
    power: overrides.power ?? "1",
    toughness: overrides.toughness ?? "1",
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeCreatureCardDef(
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
  opts: { chosenCreatureType?: string | null } = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  // The chosen-type source has a non-null
  // `chosenCreatureType` when the enter-choice has
  // resolved (lane 44 substrate). The test harness
  // pokes the field directly to simulate the
  // resolved state.
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
 * Register a chosen-type anthem ("creatures you
 * control of the chosen type get +1/+1 for each OTHER
 * creature you control of the chosen type"). Both
 * arms use the `"chosen"` sentinel.
 */
function registerChosenTypeAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Creatures you control of the chosen type get +1/+1 for each other creature you control of the chosen type.",
    statics: [
      {
        text:
          "Creatures you control of the chosen type get +1/+1 for each other creature you control of the chosen type.",
        // Affects-side filter uses the `"chosen"`
        // sentinel (lane 86 substrate).
        affects: { controller: "you", subtype: "chosen" },
        // Count-side filter uses the `"chosen"`
        // sentinel (lane 32 piece 3/N — this piece).
        anthemScaling: {
          per: "other_creatures",
          perPower: 1,
          perToughness: 1,
          perSubtype: "chosen",
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 25 lane 32 piece 3/N — chosen-type perSubtype variant", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerChosenTypeAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling.perSubtype accepts the chosen sentinel", () => {
    it("parses perSubtype: 'chosen' as a valid sentinel value", () => {
      const script = CardScriptSchema.parse({
        name: "Test Chosen-Type Anthem (lane 32 piece 3/N)",
        oracle:
          "Creatures you control of the chosen type get +1/+1 for each other creature you control of the chosen type.",
        statics: [
          {
            text:
              "Creatures you control of the chosen type get +1/+1 for each other creature you control of the chosen type.",
            affects: { controller: "you", subtype: "chosen" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              perSubtype: "chosen",
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { perSubtype?: string } }).anthemScaling
          ?.perSubtype,
      ).toBe("chosen");
    });

    it("parses andPer.perSubtype: 'chosen' as a valid sentinel value", () => {
      // The compound AND-source's `perSubtype`
      // also accepts the sentinel.
      const script = CardScriptSchema.parse({
        name: "Test Chosen-Type Compound Anthem",
        oracle:
          "Creatures you control of the chosen type get +1/+1 for each other creature you control and each artifact you control of the chosen type.",
        statics: [
          {
            text:
              "Creatures you control of the chosen type get +1/+1 for each other creature you control and each artifact you control of the chosen type.",
            affects: { controller: "you", subtype: "chosen" },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
              perSubtype: "chosen",
              andPer: { per: "creatures", perSubtype: "chosen" },
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { andPer?: { perSubtype?: string } } })
          .anthemScaling?.andPer?.perSubtype,
      ).toBe("chosen");
    });

    it("rejects an empty perSubtype string (typo guard)", () => {
      // Empty strings are not valid subtypes
      // (lane 32 piece 2/N guard carried forward).
      // The chosen sentinel is a valid subtype;
      // an empty string is not.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Per-Subtype Anthem",
          oracle: "Other creatures you control get +1/+1.",
          statics: [
            {
              text:
                "Other creatures you control get +1/+1 for each other creature.",
              affects: { controller: "you", other: true },
              anthemScaling: {
                per: "other_creatures",
                perPower: 1,
                perToughness: 1,
                perSubtype: "",
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — computeAnthemScalingCount consults source.chosenCreatureType", () => {
    it("counts other creatures of the chosen type when chosenCreatureType is resolved", () => {
      // Place the SOURCE anthem with
      // `chosenCreatureType: "Warrior"`. Place 3
      // OTHER Warriors + 1 non-Warrior. The count
      // filters to other Warriors only → 3.
      let s = state;
      // 3 OTHER Warriors.
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({
            id: `warrior-${i}`,
            name: `Test Warrior ${i}`,
            type_line: "Creature — Human Warrior",
          }),
        );
        s = r.state;
      }
      // 1 OTHER Bear (NOT a Warrior).
      const r = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "non-warrior",
          name: "Test Bear",
          type_line: "Creature — Bear",
        }),
      );
      s = r.state;
      // Place the SOURCE anthem with a resolved
      // `chosenCreatureType: "Warrior"`.
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-source" }),
        { chosenCreatureType: "Warrior" },
      );
      s = sourceR.state;
      // Target: another Warrior (the anthem
      // affects only the chosen type, so the
      // target must be a Warrior to receive the
      // bonus).
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "chosen-target",
          name: "Test Target Warrior",
          type_line: "Creature — Human Warrior",
        }),
      );
      s = targetR.state;
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      // The anthem contributes +4/+4 (3 OTHER
      // Warriors placed + 1 Target Warrior on
      // Alice's side; the source is excluded from
      // `other_creatures`. `perSubtype: "chosen"`
      // resolves to "Warrior" so the count
      // filters to Warriors only.).
      expect(target!.scriptStaticPT?.power).toBe(4);
      expect(target!.scriptStaticPT?.toughness).toBe(4);
    });

    it("returns 0 from the count when chosenCreatureType is null (the inert-while-unresolved semantic)", () => {
      // Place the SOURCE anthem with
      // `chosenCreatureType: null` (the enter
      // choice hasn't resolved). The anthem
      // remains inert — the count is 0 and no
      // bonus lands.
      let s = state;
      // Place 3 Warriors under Alice.
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({
            id: `null-warrior-${i}`,
            name: `Test Warrior ${i}`,
            type_line: "Creature — Human Warrior",
          }),
        );
        s = r.state;
      }
      // Place the SOURCE anthem with
      // `chosenCreatureType: null`.
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "null-source" }),
        { chosenCreatureType: null },
      );
      s = sourceR.state;
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "null-target",
          name: "Test Target Warrior",
          type_line: "Creature — Human Warrior",
        }),
      );
      s = targetR.state;
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      // The anthem is inert (chosenCreatureType
      // is null); no bonus lands. The target's
      // `scriptStaticPT` is undefined (the
      // anthem's `affects.subtype: "chosen"`
      // consult ALSO returns false when
      // `chosenCreatureType` is null — the lane
      // 86 substrate short-circuits the
      // anthem entirely).
      expect(target!.scriptStaticPT).toBeUndefined();
    });

    it("filters to the resolved chosen type (cross-type isolation)", () => {
      // Place the SOURCE anthem with
      // `chosenCreatureType: "Wizard"`. Place 2
      // Wizards + 3 Warriors. The count filters
      // to other Wizards only → 2.
      let s = state;
      for (let i = 0; i < 2; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({
            id: `wiz-${i}`,
            name: `Test Wizard ${i}`,
            type_line: "Creature — Human Wizard",
          }),
        );
        s = r.state;
      }
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({
            id: `non-wiz-${i}`,
            name: `Test Warrior ${i}`,
            type_line: "Creature — Human Warrior",
          }),
        );
        s = r.state;
      }
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "wizard-source" }),
        { chosenCreatureType: "Wizard" },
      );
      s = sourceR.state;
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "wizard-target",
          name: "Test Wizard Target",
          type_line: "Creature — Human Wizard",
        }),
      );
      s = targetR.state;
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      // 3 Wizards total on Alice's side (2 placed +
      // 1 target) + 0 Warriors (filtered by
      // `perSubtype: "chosen"` resolving to
      // "Wizard"). The `other_creatures` count
      // excludes the source. +3/+3.
      expect(target!.scriptStaticPT?.power).toBe(3);
      expect(target!.scriptStaticPT?.toughness).toBe(3);
    });
  });
});