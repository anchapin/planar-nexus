/**
 * Wave 4.8 follow-up 26 lane 32 piece 1/N (#2614 follow-up):
 * chosen-counter variant of the per-counter scaling arm.
 *
 * The follow-up 25 lane 32 piece 4/N substrate shipped
 * `anthemScaling: { ..., perCounter: { counter: <string> } }`
 * with a FIXED counter type string (the source's own
 * per-counter count of that single type drives the
 * anthem's power/toughness).
 *
 * This piece extends `perCounter.counter` to also accept
 * the `"chosen"` sentinel (parallel to the
 * `affects.subtype: "chosen"` + `perSubtype: "chosen"`
 * sentinels shipped in lane 86 / follow-up 25). The
 * engine consults `source.chosenCreatureType` when
 * `perCounter.counter === "chosen"`; if the chosen type
 * is unset (no `enter_choice: { kind: "creature_type" }`
 * resolve), the count is 0 (matching the lane 86
 * chosen-type anthem semantics in `staticAffects`).
 *
 * Sample: a chosen-counter anthem ("this creature gets
 * +1/+1 for each [chosen counter kind] on it" —
 * combined with an enter_choice that resolves
 * `chosenCreatureType` to a counter type like
 * "+1/+1"). Exercises both the sentinel substitution
 * AND the per-counter count in one pass.
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

const SOURCE_NAME = "Test Chosen-Counter Per-Counter Anthem (lane 32 piece 1/N)";

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
  // The chosen-counter sentinel resolves the
  // counter-type string from `chosenCreatureType`.
  // The test harness pokes the field directly to
  // simulate the resolved state. A null/undefined
  // value matches the "enter choice hasn't
  // resolved" path; a string value is the
  // resolved counter type (parallel to the lane 86
  // chosen-type anthem substrate).
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
 * Register a chosen-counter self-scaling anthem:
 * "this creature gets +1/+1 for each [chosen counter
 * kind] on it." The counter-type string is resolved
 * from `source.chosenCreatureType`.
 */
function registerChosenCounterAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for each chosen counter kind on it.",
    statics: [
      {
        text: "This creature gets +1/+1 for each chosen counter kind on it.",
        affects: { self: true, controller: "you" },
        anthemScaling: {
          per: "creatures",
          perPower: 1,
          perToughness: 1,
          perCounter: { counter: "chosen" },
        },
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 26 lane 32 piece 1/N — chosen-counter variant", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerChosenCounterAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling.perCounter.counter accepts the chosen sentinel", () => {
    it("parses an anthemScaling arm with perCounter: { counter: 'chosen' }", () => {
      const script = CardScriptSchema.parse({
        name: "Test Chosen-Counter Anthem (lane 32 piece 1/N)",
        oracle: "This creature gets +1/+1 for each chosen counter on it.",
        statics: [
          {
            text: "This creature gets +1/+1 for each chosen counter on it.",
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "chosen" },
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { perCounter?: { counter: string } } })
          .anthemScaling?.perCounter?.counter,
      ).toBe("chosen");
    });

    it("still accepts a fixed counter-type string (no regression on the v1 literal arm)", () => {
      // Regression guard: the chosen sentinel is a
      // UNION extension, not a replacement.
      const script = CardScriptSchema.parse({
        name: "Test Literal Counter Anthem",
        oracle: "This creature gets +1/+1 for each +1/+1 counter on it.",
        statics: [
          {
            text: "This creature gets +1/+1 for each +1/+1 counter on it.",
            anthemScaling: {
              per: "creatures",
              perPower: 1,
              perToughness: 1,
              perCounter: { counter: "+1/+1" },
            },
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { anthemScaling?: { perCounter?: { counter: string } } })
          .anthemScaling?.perCounter?.counter,
      ).toBe("+1/+1");
    });

    it("rejects an empty perCounter.counter string (typo guard)", () => {
      // Empty counter type strings are not valid
      // even with the chosen sentinel — the Zod
      // enum / union rejects both empty strings
      // and the literal "chosen" mismatch path.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Counter Type Anthem",
          oracle: "This creature gets +1/+1 for each counter on it.",
          statics: [
            {
              text: "This creature gets +1/+1 for each counter on it.",
              anthemScaling: {
                per: "creatures",
                perPower: 1,
                perToughness: 1,
                perCounter: { counter: "" },
              },
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — computeAnthemScalingCount consults source.chosenCreatureType for perCounter.counter: 'chosen'", () => {
    it("scales with the source's counter count for the resolved chosen type", () => {
      // Place the SOURCE anthem with 3 chosen-type
      // counters ("+1/+1" via resolved
      // `chosenCreatureType`). The anthem grants
      // +3/+3.
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-counter-source" }),
        {
          counters: [{ type: "+1/+1", count: 3 }],
          chosenCreatureType: "+1/+1",
        },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // 3 chosen-type counters → +3/+3 bonus.
      expect(source!.scriptStaticPT?.power).toBe(3);
      expect(source!.scriptStaticPT?.toughness).toBe(3);
    });

    it("returns 0 from the per-counter count when chosenCreatureType is null", () => {
      // The enter choice hasn't resolved yet — the
      // sentinel resolves to no counter type, so
      // the count is 0 (matches the lane 86
      // chosen-type anthem semantics).
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-counter-unset-source" }),
        {
          counters: [{ type: "+1/+1", count: 5 }],
          chosenCreatureType: null,
        },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // Unset chosenCreatureType → 0/0 (the
      // per-counter arm resolves to no counter
      // type, so the source's own counters are
      // not consulted).
      expect(source!.scriptStaticPT?.power ?? 0).toBe(0);
      expect(source!.scriptStaticPT?.toughness ?? 0).toBe(0);
    });

    it("ignores other counter types (the cross-counter isolation for the chosen type)", () => {
      // Place the SOURCE anthem with 2 chosen-type
      // (+1/+1) counters AND 5 -1/-1 counters. The
      // per-counter arm reads ONLY the chosen type
      // (+1/+1) → 2.
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-counter-mixed-source" }),
        {
          counters: [
            { type: "+1/+1", count: 2 },
            { type: "-1/-1", count: 5 },
          ],
          chosenCreatureType: "+1/+1",
        },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // 2 chosen-type (+1/+1) counters, 5 -1/-1
      // counters filtered by the resolved type.
      // +2/+2 bonus.
      expect(source!.scriptStaticPT?.power).toBe(2);
      expect(source!.scriptStaticPT?.toughness).toBe(2);
    });

    it("reads a non-default resolved chosen counter kind", () => {
      // The chosen sentinel resolves to whatever
      // string the enter choice settled on. Verify
      // a non-default counter kind ("+0/+1" —
      // synthetic) flows through correctly when
      // set on `chosenCreatureType`.
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-counter-weird-kind" }),
        {
          counters: [{ type: "+0/+1", count: 4 }],
          chosenCreatureType: "+0/+1",
        },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // 4 chosen-type (+0/+1) counters → +4/+4.
      expect(source!.scriptStaticPT?.power).toBe(4);
      expect(source!.scriptStaticPT?.toughness).toBe(4);
    });
  });
});
