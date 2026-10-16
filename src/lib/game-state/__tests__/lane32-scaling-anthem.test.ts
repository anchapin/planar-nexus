/**
 * Wave 4.8 follow-up 23 lane 32 (#2614 follow-up):
 * the "per count" P/T scaling modifier — the Warrior
 * Knights / adaptive anthem family that grows with the
 * board. v1 minimum: a schema arm
 * (`StaticSchema.anthemScaling: { per, perPower, perToughness }`)
 * + a synthetic test card exercising the
 * "creatures you control get +1/+1 for each other
 * creature you control" family surface.
 *
 * The arm complements the lane 36 (`Smaug-style`) `X`
 * enum. Lane 36 was the integer-X scaling anthem; lane
 * 32 is the per-unit scaling modifier. The lane 32
 * `per` enum is a superset of the lane 36 `X` enum
 * (treasures / creatures / lands) with one lane-32
 * addition: `other_creatures` excludes the source
 * itself ("OTHER creatures you control" semantics).
 *
 * Test pattern mirrors the lane 36 `smaug-scaling-anthem.test.ts`
 * + lane 70 piece 1/N "substrate-only" pattern: synthetic
 * card script registered via `CardScriptSchema.parse +
 * registerCardScripts`, refresh path exercised via
 * `refreshScriptedStatics`, effect consulted via the
 * engine's P/T layer (lands on the target's
 * `scriptStaticPT`).
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

const SOURCE_NAME = "Test Scaling Anthem (lane 32)";

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
 * Register a "creatures you control get +1/+1 for each
 * other creature you control" anthem. The shape combines:
 *   affects: { controller: "you", other: true }
 *   anthemScaling: { per: "other_creatures", perPower: 1,
 *                    perToughness: 1 }
 *
 * The anthem grants the SOURCE's effect to OTHER
 * creatures Alice controls (the lane 32 anthem shape —
 * the SOURCE is the "Warrior Knights" itself, the
 * affected creatures are Alice's OTHER creatures).
 */
function registerScalingAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Other creatures you control get +1/+1 for each other creature you control.",
    statics: [
      {
        text:
          "Other creatures you control get +1/+1 for each other creature you control.",
        affects: { controller: "you", other: true },
        // Lane 32: the per-count scaling modifier. v1
        // uses `other_creatures` (excludes the source).
        anthemScaling: {
          per: "other_creatures",
          perPower: 1,
          perToughness: 1,
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 23 lane 32 — scaling P/T anthem substrate", () => {
  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling accepts per / perPower / perToughness", () => {
    it("parses an anthemScaling arm with per: 'other_creatures'", () => {
      // The lane 32 addition: `other_creatures` is the
      // "excludes source" count source. A typo in any
      // other field value must throw (the strict Zod
      // envelope catches malformed cards).
      const script = CardScriptSchema.parse({
        name: "Test Other-Creatures Anthem (lane 32)",
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
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { per: string } }).anthemScaling?.per,
      ).toBe("other_creatures");
    });

    it("parses an anthemScaling arm with per: 'treasures' (lane-36-parallel)", () => {
      // The lane 32 `per` enum is a superset of the lane
      // 36 `X` enum — `treasures` is shared. v1 reuses
      // `computeX`'s treasures-count helper for the
      // `per: "treasures"` arm.
      const script = CardScriptSchema.parse({
        name: "Test Treasures Anthem (lane 32)",
        oracle: "Creatures you control get +1/+1 for each Treasure you control.",
        statics: [
          {
            text:
              "Creatures you control get +1/+1 for each Treasure you control.",
            affects: { controller: "you" },
            anthemScaling: {
              per: "treasures",
              perPower: 1,
              perToughness: 1,
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { per: string } }).anthemScaling?.per,
      ).toBe("treasures");
    });

    it("rejects an unknown per enum value (typo guard)", () => {
      // A typo like "other_creature" (singular) or a
      // value the lane-32 enum doesn't accept must
      // throw so a card script with the wrong string
      // doesn't silently broaden the substrate.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Anthem Typo (lane 32)",
          oracle: "Other creatures you control get +1/+1 for each other creature.",
          statics: [
            {
              text:
                "Other creatures you control get +1/+1 for each other creature.",
              affects: { controller: "you", other: true },
              anthemScaling: {
                per: "other_creature",
                perPower: 1,
                perToughness: 1,
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — anthemScaling refresh write", () => {
    it("applies +1/+1 per OTHER creature you control", () => {
      // Setup: Alice has the anthem + 2 OTHER creatures
      // on her battlefield. Each OTHER creature sees
      // anthem contribution = 2 (other_creatures
      // excludes the source itself).
      const { state, aliceId } = setupGame();
      const sourceDef = makeSourceCardDef({ id: "lane32-source" });
      const { state: stateWithSource, cardId: sourceId } = putOnBattlefield(
        state,
        aliceId,
        sourceDef,
      );
      const otherA = makeCreatureCardDef({
        id: "lane32-other-a",
        name: "Test Other Creature A",
      });
      const { state: stateWithOtherA, cardId: otherAId } = putOnBattlefield(
        stateWithSource,
        aliceId,
        otherA,
      );
      const otherB = makeCreatureCardDef({
        id: "lane32-other-b",
        name: "Test Other Creature B",
      });
      const { state: stateWithBoth, cardId: otherBId } = putOnBattlefield(
        stateWithOtherA,
        aliceId,
        otherB,
      );
      registerScalingAnthem();
      const refreshed = refreshScriptedStatics(stateWithBoth);
      // Each non-source creature sees +2/+2 (two OTHER
      // creatures on Alice's battlefield; the source is
      // excluded by `affects.other: true` AND by the
      // `other_creatures` count source — both gates
      // exclude the source, matching "OTHER creatures
      // you control get +1/+1 for each OTHER creature
      // you control").
      for (const cardId of [otherAId, otherBId]) {
        const card = refreshed.cards.get(cardId)!;
        const pt = card.scriptStaticPT;
        expect(pt).toBeDefined();
        expect(pt!.power).toBe(2);
        expect(pt!.toughness).toBe(2);
      }
      // Sanity: the source itself doesn't pick up its
      // own anthem (the source affects OTHER creatures
      // — the `affects.other: true` guard excludes
      // itself from the affected set).
      const source = refreshed.cards.get(sourceId);
      expect(source?.scriptStaticPT).toBeUndefined();
    });

    it("scales with board size (the Warrior Knights family surface)", () => {
      // Setup: Alice has the anthem + N other creatures.
      // The P/T contribution on each "other" creature
      // is exactly N (N OTHER creatures on Alice's
      // battlefield; `other_creatures` excludes the
      // source).
      const { state, aliceId } = setupGame();
      const sourceDef = makeSourceCardDef({ id: "lane32-scale-source" });
      const { state: stateWithSource } = putOnBattlefield(
        state,
        aliceId,
        sourceDef,
      );
      // Place 4 OTHER creatures — the anthem
      // contribution on each is 4 (4 other creatures).
      let builtState = stateWithSource;
      const otherIds: CardInstanceId[] = [];
      for (let i = 0; i < 4; i++) {
        const def = makeCreatureCardDef({
          id: `lane32-scale-other-${i}`,
          name: `Test Scale ${i}`,
        });
        const { state: nextState, cardId: cardId } = putOnBattlefield(
          builtState,
          aliceId,
          def,
        );
        builtState = nextState;
        otherIds.push(cardId);
      }
      registerScalingAnthem();
      const refreshed = refreshScriptedStatics(builtState);
      for (const cardId of otherIds) {
        const card = refreshed.cards.get(cardId)!;
        expect(card.scriptStaticPT).toBeDefined();
        // +4/+4 from 4 OTHER creatures on the battlefield.
        expect(card.scriptStaticPT!.power).toBe(4);
        expect(card.scriptStaticPT!.toughness).toBe(4);
      }
    });
  });
});
