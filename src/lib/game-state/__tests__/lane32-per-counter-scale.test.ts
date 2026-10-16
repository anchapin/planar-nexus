/**
 * Wave 4.8 follow-up 25 lane 32 piece 4/N (#2614 follow-up):
 * per-counter scaling anthem arm.
 *
 * The follow-up 23 lane 32 substrate shipped
 * `anthemScaling: { per, perPower, perToughness }`
 * with a state-derived count source (creatures /
 * treasures / lands / other_creatures). The follow-up
 * 24 lane 32 piece 2/N added a fixed-string
 * `perSubtype?: string` filter. The follow-up 25
 * lane 32 piece 2/N added an `andPer` compound
 * AND-source. The follow-up 25 lane 32 piece 3/N
 * added a `"chosen"` sentinel on `perSubtype`.
 *
 * This piece adds the per-counter scaling arm: a
 * self-referential scaling anthem ("this creature
 * gets +1/+1 for each +1/+1 counter on it"). The
 * count is `source.counters?.find(c => c.type ===
 * counter)?.count ?? 0` — REPLACES the `per` arm's
 * state-derived count with the source's own
 * per-counter count. The implementation reads the
 * source's counter array (matching how
 * `evergreen-keywords.getEffectivePower` reads
 * `card.counters?.find(...)` for the +1/+1 counter
 * — see `evergreen-keywords.ts` line ~973).
 *
 * Test pattern mirrors the lane 32 substrate pieces:
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

const SOURCE_NAME = "Test Per-Counter Scaling Anthem (lane 32 piece 4/N)";

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
  opts: { counters?: Array<{ type: string; count: number }> } = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  // The per-counter anthem reads the source's
  // `counters` field. The test harness pokes the
  // field directly to simulate the resolved state
  // (the lane 91 `enter_choice: { kind:
  // "counter_minimum" }` and similar ops stamp
  // counters at runtime — the test bypasses those
  // for the v1 minimum).
  if (opts.counters) {
    card.counters = opts.counters;
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
 * Register a self-scaling anthem: "this creature
 * gets +1/+1 for each +1/+1 counter on it." The
 * count is the SOURCE's own per-counter count.
 */
function registerPerCounterAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "This creature gets +1/+1 for each +1/+1 counter on it.",
    statics: [
      {
        text: "This creature gets +1/+1 for each +1/+1 counter on it.",
        // The anthem applies to the source itself
        // (the lane 36 self-only substrate —
        // `affects: { self: true, controller: "you" }`
        // restricts to `source === target` AND
        // requires the `controller` field — the
        // schema validates `controller` as a
        // required enum).
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
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 25 lane 32 piece 4/N — per-counter scaling arm", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerPerCounterAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.anthemScaling accepts the perCounter arm", () => {
    it("parses an anthemScaling arm with perCounter: { counter: '+1/+1' }", () => {
      const script = CardScriptSchema.parse({
        name: "Test Per-Counter Anthem (lane 32 piece 4/N)",
        oracle:
          "This creature gets +1/+1 for each +1/+1 counter on it.",
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

    it("parses an anthemScaling arm WITHOUT perCounter (v1 default)", () => {
      // Regression guard: a card without the
      // perCounter arm still parses (the v1
      // single-source path is the default).
      const script = CardScriptSchema.parse({
        name: "Test Legacy Anthem (no per-counter)",
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
        (stat as { anthemScaling?: { perCounter?: unknown } }).anthemScaling
          ?.perCounter,
      ).toBeUndefined();
    });

    it("rejects an empty perCounter.counter string (typo guard)", () => {
      // Empty counter type strings are not valid.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Counter Type Anthem",
          oracle: "This creature gets +1/+1 for each counter on it.",
          statics: [
            {
              text:
                "This creature gets +1/+1 for each counter on it.",
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

  describe("engine — computeAnthemScalingCount consults source.counters for perCounter", () => {
    it("scales with the source's +1/+1 counter count", () => {
      // Place the SOURCE anthem with 3 +1/+1
      // counters. The anthem grants +3/+3.
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "per-counter-source" }),
        { counters: [{ type: "+1/+1", count: 3 }] },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // 3 +1/+1 counters → +3/+3 bonus.
      expect(source!.scriptStaticPT?.power).toBe(3);
      expect(source!.scriptStaticPT?.toughness).toBe(3);
    });

    it("returns 0 from the per-counter count when the source has no matching counters", () => {
      // Place the SOURCE anthem with NO counters.
      // The anthem grants 0/0 (the count is 0).
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "per-counter-source-no-counters" }),
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // No counters → 0/0 bonus (the per-counter
      // arm REPLACES the `per: "creatures"`
      // arm — the source's own per-counter count
      // is the count). When the count is 0, the
      // engine computes `0 * 1 = 0` and the diff
      // doesn't stamp `scriptStaticPT` (no P/T
      // contribution); consult via `?? 0` for the
      // regression guard.
      expect(source!.scriptStaticPT?.power ?? 0).toBe(0);
      expect(source!.scriptStaticPT?.toughness ?? 0).toBe(0);
    });

    it("ignores other counter types (the cross-counter isolation)", () => {
      // Place the SOURCE anthem with 2 +1/+1
      // counters AND 5 "-1" counters. The
      // per-counter arm reads ONLY +1/+1 → 2.
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "per-counter-source-mixed" }),
        {
          counters: [
            { type: "+1/+1", count: 2 },
            { type: "-1/-1", count: 5 },
          ],
        },
      );
      s = sourceR.state;
      s = refreshScriptedStatics(s);
      const source = s.cards.get(sourceR.cardId);
      expect(source).toBeDefined();
      // 2 +1/+1 counters (the -1/-1 counters
      // are filtered by the `counter: "+1/+1"`
      // arm). +2/+2 bonus.
      expect(source!.scriptStaticPT?.power).toBe(2);
      expect(source!.scriptStaticPT?.toughness).toBe(2);
    });
  });
});