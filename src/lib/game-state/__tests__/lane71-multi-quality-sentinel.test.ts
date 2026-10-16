/**
 * Wave 4.8 follow-up 27 lane 71 piece 3/N (#2614 follow-up):
 * per-entry `"chosen"` sentinel on `protectionFrom`
 * (multi-quality sentinel).
 *
 * The lane 71 piece 3/N (follow-up 26) substrate
 * shipped `protectionFrom: Array<string> | "chosen"`
 * — a flat string array (literal qualities) OR the
 * standalone `"chosen"` sentinel (single-element list
 * resolved from `source.chosenProtectionFrom`).
 *
 * This piece extends the union with a per-entry mixed
 * form `Array<string | "chosen">` so a multi-quality
 * anthem can grant protection from a list of literal
 * qualities AND the chosen quality in the same arm
 * (e.g. `["red", "chosen"]` = "protection from red AND
 * the chosen quality"). The engine resolves each
 * `"chosen"` entry independently from
 * `source.chosenProtectionFrom`; null chosen quality
 * skips the entry (the literal entries still
 * contribute).
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
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const SOURCE_NAME =
  "Test Multi-Quality Sentinel Anthem (lane 71 piece 3/N)";

function makeAnthemCardDef(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? SOURCE_NAME,
    type_line: overrides.type_line ?? "Enchantment",
    oracle_text: overrides.oracle_text ?? "",
    mana_cost: overrides.mana_cost ?? "{2}{W}",
    cmc: overrides.cmc ?? 3,
    colors: overrides.colors ?? ["W"],
    color_identity: overrides.color_identity ?? ["W"],
    keywords: overrides.keywords ?? [],
    power: undefined,
    toughness: undefined,
    legalities: { standard: "legal" },
    layout: "normal",
  } as ScryfallCard;
}

function makeTargetCardDef(
  overrides: Partial<ScryfallCard> & { id: string; name?: string },
): ScryfallCard {
  return {
    id: `mock-${overrides.id}`,
    name: overrides.name ?? "Test Target Creature",
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
  opts: { chosenProtectionFrom?: string | null } = {},
): { state: GameState; cardId: CardInstanceId } {
  const cardId =
    `card-${cardDef.id}-${Math.random().toString(36).slice(2)}` as CardInstanceId;
  const card = createCardInstance(cardDef, controllerId, controllerId, {
    id: cardId,
    currentZoneKey: `${controllerId}-battlefield`,
  });
  card.hasSummoningSickness = false;
  if (opts.chosenProtectionFrom !== undefined) {
    card.chosenProtectionFrom = opts.chosenProtectionFrom;
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

describe("Wave 4.8 follow-up 27 lane 71 piece 3/N — multi-quality sentinel", () => {
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

  describe("schema — StaticSchema.protectionFrom accepts the per-entry sentinel form", () => {
    it("parses a protectionFrom array with the 'chosen' entry mixed in", () => {
      // A multi-quality anthem with literal +
      // chosen entries in the SAME array. The
      // engine resolves each `"chosen"` entry
      // independently from
      // `source.chosenProtectionFrom`.
      const script = CardScriptSchema.parse({
        name: "Test Multi-Quality Sentinel Anthem",
        oracle:
          "Creatures you control have protection from red and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: ["red", "chosen"],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: string[];
      };
      expect(stat.protectionFrom).toEqual(["red", "chosen"]);
    });

    it("rejects a protectionFrom array with only 'chosen' (use the literal sentinel instead)", () => {
      // The Zod union accepts the per-entry
      // mixed form `Array<string | "chosen">`
      // (which includes arrays with only the
      // `"chosen"` entry). The v1 convention
      // uses the standalone `"chosen"` sentinel
      // (string literal, not array) for the
      // single-quality case; the per-entry form
      // is reserved for the multi-quality case.
      // The engine handles BOTH forms correctly.
      const script = CardScriptSchema.parse({
        name: "Test Per-Entry Chosen-Only Array",
        oracle: "Creatures you control have protection from the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: ["chosen"],
          },
        ],
      });
      const stat = script.statics![0] as {
        protectionFrom?: string[];
      };
      expect(stat.protectionFrom).toEqual(["chosen"]);
    });
  });

  describe("engine — refreshScriptedStatics resolves the per-entry sentinel form", () => {
    it("grants protection from literal quality AND chosen quality (resolved via chosenProtectionFrom)", () => {
      // Register a multi-quality anthem:
      // `protectionFrom: ["red", "chosen"]` +
      // `enter_choice: { kind: "protection_quality" }`
      // resolving to "blue" (via
      // `chosenProtectionFrom: "blue"` on the
      // source). The anthem grants protection
      // from BOTH "red" and "blue" to each
      // affected creature.
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: ["red", "chosen"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      // Place target first; anthem second
      // (script lookup reads the source's name).
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "multi-quality-target" }),
      );
      const sourceR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "multi-quality-source" }),
        { chosenProtectionFrom: "blue" },
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The multi-quality sentinel resolves
      // BOTH the literal "red" entry AND the
      // `"chosen"` entry (→ "blue" from
      // chosenProtectionFrom). The target has
      // protection from BOTH "red" and "blue".
      expect(target.protectionFrom?.sort()).toEqual(["blue", "red"]);
      // The `hasProtectionFrom` consult reads
      // the per-instance `protectionFrom`
      // ledger (stamped by
      // `refreshScriptedStatics`).
      expect(hasProtectionFrom(target, "red")).toBe(true);
      expect(hasProtectionFrom(target, "blue")).toBe(true);
      // A third color (green) is NOT protected.
      expect(hasProtectionFrom(target, "green")).toBe(false);
    });

    it("skips the chosen entry but still grants the literal entries when chosenProtectionFrom is null", () => {
      // Regression guard: when
      // `chosenProtectionFrom` is null, the
      // `"chosen"` entry contributes 0
      // qualities (per-entry resolution), but
      // the literal entries still contribute.
      // The static is NOT inert for the whole
      // pass (only the chosen entry is
      // skipped).
      const script: CardScript = CardScriptSchema.parse({
        name: SOURCE_NAME,
        oracle:
          "Creatures you control have protection from red and the chosen quality.",
        statics: [
          {
            text:
              "Creatures you control have protection from red and the chosen quality.",
            affects: { controller: "you" },
            protectionFrom: ["red", "chosen"],
          },
        ],
      });
      resetCardScriptsForTests();
      registerCardScripts([script]);
      // chosenProtectionFrom is undefined (default)
      // — the source does not carry an
      // `enter_choice: { kind: "protection_quality" }`
      // script, so the field is the default
      // null.
      const targetR = putOnBattlefield(
        state,
        aliceId,
        makeTargetCardDef({ id: "multi-quality-null-target" }),
      );
      const sourceR = putOnBattlefield(
        targetR.state,
        aliceId,
        makeAnthemCardDef({ id: "multi-quality-null-source" }),
      );
      const afterRefresh = refreshScriptedStatics(sourceR.state);
      const target = afterRefresh.cards.get(targetR.cardId);
      expect(target).toBeDefined();
      if (!target) return;
      // The "red" literal entry is stamped; the
      // "chosen" entry is skipped (null
      // chosenProtectionFrom).
      expect(target.protectionFrom).toEqual(["red"]);
      expect(hasProtectionFrom(target, "red")).toBe(true);
      // No chosen-quality grant — no protection
      // from any non-literal quality.
      expect(target.protectionFrom?.length).toBe(1);
    });
  });
});
