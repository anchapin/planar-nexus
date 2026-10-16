/**
 * Wave 4.8 follow-up 25 lane 32 piece 2/N (#2614 follow-up):
 * compound count sources for the scaling-anthem substrate.
 *
 * The follow-up 23 + 24 lane 32 substrate shipped a
 * single-source `anthemScaling: { per, perPower,
 * perToughness, perSubtype? }` arm — the count comes
 * from ONE state-derived source (creatures /
 * treasures / lands / other_creatures). v1 minimum
 * covers the "+1/+1 per creature" / "+1/+1 per
 * Treasure" / "Warrior Knights" family.
 *
 * This piece adds the COMPOUND AND-source: a card
 * granting "+1/+1 for each creature AND each artifact
 * you control" reads as `count(per) + count(andPer.per)`.
 * CR 613.4c-style multi-source scaling. The
 * `andPer: { per, perSubtype? }` arm is OPTIONAL — a
 * card without it falls through to the single-source
 * v1 default. The compound arm shares the `per`
 * enum + `perSubtype` filter with the primary source.
 *
 * Test pattern mirrors the lane 32 substrate piece:
 * synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts`,
 * refresh path exercised via `refreshScriptedStatics`,
 * effect consulted via the engine's P/T layer.
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

const SOURCE_NAME = "Test Compound Scaling Anthem (lane 32 piece 2/N)";

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
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
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

/**
 * Register a "+1/+1 for each creature AND each artifact
 * you control" anthem. The compound count consults the
 * primary `per` (creatures) + the `andPer.per` (treasures
 * via the "Artifact — Treasure" type-line substring).
 */
function registerCompoundAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Creatures you control get +1/+1 for each creature and each artifact you control.",
    statics: [
      {
        text:
          "Creatures you control get +1/+1 for each creature and each artifact you control.",
        affects: { controller: "you" },
        // Lane 32 piece 2/N: the compound AND-source
        // — primary `per: "creatures"` + secondary
        // `andPer: { per: "treasures" }`. The
        // count is `creatures_count + treasures_count`.
        anthemScaling: {
          per: "creatures",
          perPower: 1,
          perToughness: 1,
          andPer: { per: "treasures" },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 25 lane 32 piece 2/N — compound count source", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerCompoundAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling accepts the andPer arm", () => {
    it("parses an anthemScaling arm with andPer.per: 'treasures' (the compound AND-source)", () => {
      const script = CardScriptSchema.parse({
        name: "Test Compound Anthem (lane 32 piece 2/N)",
        oracle:
          "Creatures you control get +1/+1 for each creature and each artifact you control.",
        statics: [
          {
            text:
              "Creatures you control get +1/+1 for each creature and each artifact you control.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              andPer: { per: "treasures" },
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { andPer?: { per: string } } })
          .anthemScaling?.andPer?.per,
      ).toBe("treasures");
    });

    it("parses an anthemScaling arm with andPer.perSubtype filter", () => {
      // The compound AND-source accepts the same
      // `perSubtype` filter as the primary source. A
      // "Warrior AND Equipment" anthem filters the
      // secondary count to equipment-flagged
      // cards.
      const script = CardScriptSchema.parse({
        name: "Test Subtyped Compound Anthem",
        oracle:
          "Warriors you control get +1/+1 for each Warrior and each Equipment you control.",
        statics: [
          {
            text:
              "Warriors you control get +1/+1 for each Warrior and each Equipment you control.",
            affects: { controller: "you", subtype: "Warrior" },
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perSubtype: "Warrior",
              andPer: { per: "creatures", perSubtype: "Equipment" },
            },
          },
        ],
      });
      const stat = script.statics![0];
      const as = stat as {
        anthemScaling?: {
          per: string;
          perSubtype?: string;
          andPer?: { per: string; perSubtype?: string };
        };
      };
      expect(as.anthemScaling?.per).toBe("creatures");
      expect(as.anthemScaling?.perSubtype).toBe("Warrior");
      expect(as.anthemScaling?.andPer?.per).toBe("creatures");
      expect(as.anthemScaling?.andPer?.perSubtype).toBe("Equipment");
    });

    it("rejects an unknown andPer.per enum value (typo guard)", () => {
      // The strict Zod envelope catches malformed
      // values — a typo like "other_creature" (singular)
      // throws so a card script with the wrong string
      // doesn't silently broaden the substrate.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Compound Anthem Typo",
          oracle:
            "Creatures you control get +1/+1 for each creature and each artifact you control.",
          statics: [
            {
              text:
                "Creatures you control get +1/+1 for each creature and each artifact you control.",
              affects: { controller: "you" },
              anthemScaling: {
                per: "creatures",
                perPower: 1,
                perToughness: 1,
                andPer: { per: "other_creature" },
              },
            },
          ],
        }),
      ).toThrow();
    });

    it("parses an anthemScaling arm WITHOUT andPer (the v1 single-source fallback)", () => {
      // Regression guard: a card without the new
      // `andPer` arm must still parse (the v1 single-
      // source path). Backwards-compatible.
      const script = CardScriptSchema.parse({
        name: "Test Legacy Anthem (no compound)",
        oracle:
          "Creatures you control get +1/+1 for each other creature you control.",
        statics: [
          {
            text:
              "Creatures you control get +1/+1 for each other creature you control.",
            affects: { controller: "you", other: true },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { andPer?: unknown } }).anthemScaling
          ?.andPer,
      ).toBeUndefined();
    });
  });

  describe("engine — computeAnthemScalingCount sums primary + AND-source", () => {
    it("sums creatures + treasures counts on a populated battlefield", () => {
      // Place the SOURCE anthem on the battlefield
      // (the script lookup is by name; the source
      // card must be on the field for the refresh
      // pass to find its `statics`). Then 3 OTHER
      // creatures + 2 Treasures. The compound
      // count: 4 creatures (source + 3 others +
      // the target) + 2 treasures = 6 → +6/+6
      // to the target.
      let s = state;
      // 3 OTHER creatures under Alice.
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({ id: `creature-${i}` }),
        );
        s = r.state;
      }
      // 2 Treasures under Alice.
      for (let i = 0; i < 2; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeTreasureCardDef({ id: `treasure-${i}` }),
        );
        s = r.state;
      }
      // Place the SOURCE anthem on Alice's
      // battlefield (the script lookup reads the
      // card's `cardData.name` against the
      // registered script's `name` — the source
      // must be on the field for `getCardScript` to
      // find its `statics`).
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "compound-source" }),
      );
      s = sourceR.state;
      // Add a target creature to verify the bonus lands.
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "target-creature",
          name: "Anthem Target",
        }),
      );
      s = targetR.state;
      const targetCardId = targetR.cardId;
      // Refresh the static, then consult the
      // target's `scriptStaticPT`.
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetCardId);
      expect(target).toBeDefined();
      // The anthem contributes +7/+7 (5 creatures
      // on Alice's side — 3 placed + 1 source + 1
      // target — plus 2 treasures). The primary
      // per: "creatures" (NOT "other_creatures")
      // counts ALL of Alice's creatures, including
      // the source and the target.
      expect(target!.scriptStaticPT?.power).toBe(7);
      expect(target!.scriptStaticPT?.toughness).toBe(7);
    });

    it("counts only the primary `per` when andPer is unset (v1 default)", () => {
      // The single-source path still works — the
      // `andPer` arm is OPTIONAL. A card without
      // it falls through to the per-creature count
      // alone.
      //
      // Register a legacy single-source anthem
      // and verify the bonus.
      const legacyScript: CardScript = CardScriptSchema.parse({
        name: "Legacy Single Source Anthem (lane 32 piece 2/N)",
        oracle:
          "Other creatures you control get +1/+1 for each other creature you control.",
        statics: [
          {
            text:
              "Other creatures you control get +1/+1 for each other creature you control.",
            affects: { controller: "you", other: true },
            anthemScaling: {
              per: "other_creatures",
              perPower: 1,
              perToughness: 1,
            },
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([legacyScript]);
      let s = state;
      // Place the legacy anthem on the field.
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({
          id: "legacy-source",
          name: "Legacy Single Source Anthem (lane 32 piece 2/N)",
        }),
      );
      s = sourceR.state;
      // 3 OTHER creatures under Alice.
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({ id: `legacy-creature-${i}` }),
        );
        s = r.state;
      }
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "legacy-target",
          name: "Legacy Target",
        }),
      );
      s = targetR.state;
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      // The legacy anthem's per-other-creature count
      // is 4 (3 OTHER creatures placed + 1 target,
      // excluding the source itself — the
      // `other_creatures` count excludes the source
      // but counts the target since the target is
      // also an "other creature"). The bonus is
      // +4/+4.
      expect(target!.scriptStaticPT?.power).toBe(4);
      expect(target!.scriptStaticPT?.toughness).toBe(4);
    });

    it("returns 0 from the AND-source when the battlefield has no matching permanents", () => {
      // Place ONLY creatures (no treasures). The
      // compound count is 5 creatures (source + 3
      // placed + 1 target) + 0 treasures = 5 →
      // +5/+5 (the treasures branch contributes
      // 0).
      let s = state;
      for (let i = 0; i < 3; i++) {
        const r = putOnBattlefield(
          s,
          aliceId,
          makeCreatureCardDef({ id: `notho-${i}` }),
        );
        s = r.state;
      }
      // Place the SOURCE anthem.
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "notho-source" }),
      );
      s = sourceR.state;
      const targetR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({
          id: "notho-target",
          name: "No-Treasure Target",
        }),
      );
      s = targetR.state;
      // Re-register the compound anthem (the
      // `beforeEach` registers it; this confirms
      // the registration is correct).
      registerCompoundAnthem();
      s = refreshScriptedStatics(s);
      const target = s.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      // 5 creatures on Alice's side (3 placed + 1
      // source + 1 target) + 0 treasures = 5 →
      // +5/+5.
      expect(target!.scriptStaticPT?.power).toBe(5);
      expect(target!.scriptStaticPT?.toughness).toBe(5);
    });
  });
});