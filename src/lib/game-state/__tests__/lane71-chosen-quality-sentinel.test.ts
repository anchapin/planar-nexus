/**
 * Wave 4.8 follow-up 26 lane 71 piece 3/N (#2614 follow-up):
 * chosen-quality `protectionFrom` sentinel.
 *
 * The follow-up 5 lane 71 substrate shipped
 * `StaticSchema.protectionFrom: z.array(z.string().min(1))`
 * — each entry is a literal protection quality (color or
 * "everything") the engine grants to each affected permanent.
 * The follow-up 25 lane 71 piece 1/N added the per-source
 * ledger (`protectionFromBySource: Record<sourceId, string[]>`)
 * on top of the union semantic.
 *
 * This piece widens `protectionFrom` to also accept the
 * `"chosen"` sentinel. When the field is the sentinel, the
 * engine resolves the protected qualities from
 * `source.chosenProtectionFrom` — a single-element list
 * (parallel to the `affects.subtype: "chosen"` sentinel
 * reading `source.chosenCreatureType`). If
 * `chosenProtectionFrom` is null (the enter choice hasn't
 * resolved yet), the static is INERT for that pass (matches
 * the lane 86 chosen-type anthem semantics).
 *
 * The enter-choice substrate extends with a new
 * `kind: "protection_quality"` arm — the resolver stamps
 * `card.chosenProtectionFrom` from a curated W/U/B/R/G +
 * "everything" option list at ETB.
 *
 * Test pattern mirrors the follow-up 25 / follow-up 26
 * chosen-type sentinels: synthetic card script registered
 * via `CardScriptSchema.parse + registerCardScripts`,
 * `chosenProtectionFrom` stamped via
 * `resolveEnterChoice`, refresh path exercised via
 * `refreshScriptedStatics`, consult verified via
 * `hasProtectionFrom` (the per-instance ledger consult).
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
import { hasProtectionFrom } from "../evergreen-keywords";
import { resolveEnterChoice, createEnterChoiceWaitingChoice } from "../keyword-actions/enter-choice";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME = "Test Chosen-Quality Protection Anthem (lane 71 piece 3/N)";

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
 * Register a chosen-quality anthem ("creatures you
 * control have protection from the chosen color"). The
 * sentinel resolves `protectionFrom` from
 * `source.chosenProtectionFrom` — a single-element list
 * of the chosen quality.
 */
function registerChosenQualityAnthem(): void {
  const script: CardScript = CardScriptSchema.parse({
    name: SOURCE_NAME,
    oracle:
      "Creatures you control have protection from the chosen color.",
    statics: [
      {
        text: "Creatures you control have protection from the chosen color.",
        affects: { controller: "you" },
        // The `"chosen"` sentinel — the engine
        // resolves the protected quality from
        // `source.chosenProtectionFrom`. When unset,
        // the static is inert (no qualities stamped).
        protectionFrom: "chosen",
      },
    ],
  });
  resetCardScriptsForTests();
  registerCardScripts([script]);
}

describe("Wave 4.8 follow-up 26 lane 71 piece 3/N — chosen-quality protectionFrom sentinel", () => {
  let state: GameState;
  let aliceId: PlayerId;

  beforeEach(() => {
    registerChosenQualityAnthem();
    const setup = setupGame();
    state = setup.state;
    aliceId = setup.aliceId;
  });

  afterAll(() => {
    resetCardScriptsForTests();
  });

  describe("schema — StaticSchema.protectionFrom accepts the chosen sentinel", () => {
    it("parses a static with protectionFrom: 'chosen' (literal sentinel)", () => {
      const script = CardScriptSchema.parse({
        name: "Test Chosen-Quality Anthem (lane 71 piece 3/N)",
        oracle:
          "Creatures you control have protection from the chosen color.",
        statics: [
          {
            text: "Creatures you control have protection from the chosen color.",
            protectionFrom: "chosen",
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { protectionFrom?: unknown }).protectionFrom,
      ).toBe("chosen");
    });

    it("still accepts a fixed qualities array (no regression on the v1 literal arm)", () => {
      // Regression guard: the chosen sentinel is a
      // UNION extension, not a replacement.
      const script = CardScriptSchema.parse({
        name: "Test Literal-Quality Anthem",
        oracle: "Creatures you control have protection from red.",
        statics: [
          {
            text: "Creatures you control have protection from red.",
            protectionFrom: ["red"],
          },
        ],
      });
      const stat = script.statics![0];
      expect(
        (stat as { protectionFrom?: unknown }).protectionFrom,
      ).toEqual(["red"]);
    });

    it("rejects an array with an empty string entry (typo guard)", () => {
      // Empty entries in the literal-qualities form
      // are still rejected (the v1 typo guard is
      // preserved).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Quality Anthem",
          oracle: "Creatures you control have protection from the chosen color.",
          statics: [
            {
              text: "Creatures you control have protection from the chosen color.",
              protectionFrom: [""],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — refreshScriptedStatics resolves protectionFrom: 'chosen' from source.chosenProtectionFrom", () => {
    it("stamps a single-element protection ledger when source.chosenProtectionFrom is set", () => {
      // Place the SOURCE anthem with
      // `chosenProtectionFrom: 'red'` resolved. Place
      // one OTHER creature under Alice's control. The
      // OTHER creature's per-instance
      // `protectionFrom` ledger is stamped with
      // `['red']` (the chosen quality).
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-quality-source" }),
      );
      s = sourceR.state;
      const source = s.cards.get(sourceR.cardId);
      if (!source) throw new Error("source not placed");
      s = {
        ...s,
        cards: new Map(s.cards).set(source.id, {
          ...source,
          chosenProtectionFrom: "red",
        } as CardInstance),
      };
      const otherR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({ id: "chosen-quality-other" }),
      );
      s = otherR.state;
      s = refreshScriptedStatics(s);
      const other = s.cards.get(otherR.cardId);
      expect(other).toBeDefined();
      // The anthem's chosen-quality semantic resolves
      // to `['red']` and stamps the per-instance
      // ledger on each affected permanent.
      expect(other!.protectionFrom).toEqual(["red"]);
      // The `hasProtectionFrom` engine consult reads
      // the ledger and returns true for the chosen
      // color.
      expect(hasProtectionFrom(other!, "red")).toBe(true);
      // A non-chosen color (e.g. blue) is NOT in the
      // ledger → consult returns false.
      expect(hasProtectionFrom(other!, "blue")).toBe(false);
    });

    it("is INERT when source.chosenProtectionFrom is null (the enter choice hasn't resolved)", () => {
      // Place the SOURCE anthem WITHOUT resolving
      // `chosenProtectionFrom` (default null). Place
      // one OTHER creature under Alice's control. The
      // anthem is INERT for that pass — no qualities
      // stamped on the OTHER creature (parallel to the
      // lane 86 chosen-type anthem "null" semantics).
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-quality-unset-source" }),
      );
      s = sourceR.state;
      const otherR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({ id: "chosen-quality-unset-other" }),
      );
      s = otherR.state;
      s = refreshScriptedStatics(s);
      const other = s.cards.get(otherR.cardId);
      expect(other).toBeDefined();
      // Inert static: NO per-instance ledger stamped.
      // (The field starts as undefined; the engine
      // consult falls through to the union field,
      // which is also unset.)
      expect(other!.protectionFrom).toBeUndefined();
      // No protection granted for any color in the
      // inert state.
      expect(hasProtectionFrom(other!, "red")).toBe(false);
      expect(hasProtectionFrom(other!, "blue")).toBe(false);
    });

    it("resolves a non-default chosen quality ('everything')", () => {
      // Place the SOURCE anthem with
      // `chosenProtectionFrom: 'everything'`. The
      // anthem grants protection from EVERY source
      // (the legacy "everything" quality, equivalent
      // to shroud at the card vs. color level — see
      // lane 5 follow-up for the v1 "everything"
      // shape).
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "chosen-quality-everything" }),
      );
      s = sourceR.state;
      const source = s.cards.get(sourceR.cardId);
      if (!source) throw new Error("source not placed");
      s = {
        ...s,
        cards: new Map(s.cards).set(source.id, {
          ...source,
          chosenProtectionFrom: "everything",
        } as CardInstance),
      };
      const otherR = putOnBattlefield(
        s,
        aliceId,
        makeCreatureCardDef({ id: "chosen-quality-everything-other" }),
      );
      s = otherR.state;
      s = refreshScriptedStatics(s);
      const other = s.cards.get(otherR.cardId);
      expect(other).toBeDefined();
      // The "everything" chosen quality resolves to
      // `['everything']` and stamps the ledger.
      expect(other!.protectionFrom).toEqual(["everything"]);
    });
  });

  describe("engine — resolveEnterChoice stamps chosenProtectionFrom for kind: 'protection_quality'", () => {
    it("stamps chosenProtectionFrom from a valid W/U/B/R/G/everything value", () => {
      // Place a card with `enter_choice: { kind:
      // "protection_quality" }`. Drive the resolver
      // via `createEnterChoiceWaitingChoice` (the
      // standard UI-routing helper — same pattern
      // as the enter-choice-dual.test.ts tests).
      // The resolver stamps
      // `card.chosenProtectionFrom` from the value.
      const cardName =
        "Test Enter-Choice Quality Anthem (lane 71 piece 3/N)";
      const cardScript: CardScript = CardScriptSchema.parse({
        name: cardName,
        oracle: "Stamped with a chosen protection quality at ETB.",
        statics: [
          {
            text: "Stamped with a chosen protection quality at ETB.",
            protectionFrom: "chosen",
          },
        ],
        enter_choice: {
          kind: "protection_quality",
          text: "Choose a protection quality.",
        },
      });
      resetCardScriptsForTests();
      registerCardScripts([cardScript]);

      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "enter-choice-quality-source", name: cardName }),
      );
      s = sourceR.state;
      const cardId = sourceR.cardId;
      const initial = s.cards.get(cardId);
      expect(initial).toBeDefined();
      // The card starts with `chosenProtectionFrom: null`.
      expect(initial!.chosenProtectionFrom).toBeNull();
      // Build a proper waitingChoice via the
      // standard helper. The resolver picks the
      // option matching the chosenValue.
      const choice = createEnterChoiceWaitingChoice(s, cardId);
      expect(choice).not.toBeNull();
      s = { ...s, waitingChoice: choice };
      const res = resolveEnterChoice(s, aliceId, "U");
      expect(res.success).toBe(true);
      const stamped = res.state.cards.get(cardId);
      expect(stamped).toBeDefined();
      expect(stamped!.chosenProtectionFrom).toBe("U");
      // Re-register the standard anthem so the
      // rest of the suite's refresh path remains
      // valid.
      registerChosenQualityAnthem();
    });

    it("rejects an invalid protection-quality pick (typo guard)", () => {
      // Pick a value not in the curated set (the
      // curated set is W/U/B/R/G + "everything").
      // Construct the choice manually with
      // `purple` as a valid option so we reach the
      // inner `isProtectionQuality` guard (mirrors
      // the enter-choice-dual.test.ts "rejects a
      // malformed encoded value" path). The
      // resolver returns a failure result with a
      // description mirroring the existing
      // color / creature_type error shape.
      const cardName =
        "Test Enter-Choice Quality Anthem (invalid pick, lane 71 piece 3/N)";
      const cardScript: CardScript = CardScriptSchema.parse({
        name: cardName,
        oracle: "Stamped with a chosen protection quality at ETB.",
        statics: [
          {
            text: "Stamped with a chosen protection quality at ETB.",
            protectionFrom: "chosen",
          },
        ],
        enter_choice: {
          kind: "protection_quality",
          text: "Choose a protection quality.",
        },
      });
      resetCardScriptsForTests();
      registerCardScripts([cardScript]);
      let s = state;
      const sourceR = putOnBattlefield(
        s,
        aliceId,
        makeSourceCardDef({ id: "invalid-quality-source", name: cardName }),
      );
      s = sourceR.state;
      const cardId = sourceR.cardId;
      // Build the choice manually so `purple` is a
      // valid option (the outer `validOption.isValid`
      // guard passes) but fails the inner
      // `isProtectionQuality` validation against
      // the curated set.
      const choice = {
        type: "enter_choice" as const,
        playerId: aliceId,
        stackObjectId: null,
        prompt: "Choose a protection quality.",
        choices: [
          { label: "purple", value: "purple", isValid: true },
          { label: "W", value: "W", isValid: true },
        ],
        minChoices: 1,
        maxChoices: 1,
        presentedAt: Date.now(),
      };
      s = { ...s, waitingChoice: choice };
      const res = resolveEnterChoice(s, aliceId, "purple");
      expect(res.success).toBe(false);
      expect(res.description).toMatch(/Invalid enter choice value/);
      // Card remains untouched (resolver rejects
      // before any stamp).
      const updated = res.state.cards.get(cardId);
      expect(updated?.chosenProtectionFrom).toBeNull();
      registerChosenQualityAnthem();
    });
  });
});
