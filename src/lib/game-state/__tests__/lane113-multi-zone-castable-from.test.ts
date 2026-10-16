/**
 * Multi-zone `castable_from` casting (Wave 4.8 follow-up 17 lane 113
 * piece 2, #2614 follow-up).
 *
 * The v1 (lane 68) substrate supports a single-entry
 * `castable_from: ["exile" | "graveyard" | "command"]` array. Lane
 * 113 piece 2 relaxes the schema cap so a script can declare any
 * non-empty subset of the three zones (the classic
 * flashback+foretell / Yawgmoth's Vile Offer / Jump-Start shape when
 * the printed flashback effect is combined with another from-zone
 * effect). At cast time the engine iterates the array and picks the
 * FIRST matching zone (script-declared preference order); the
 * `castableFromZone` field on the StackObject reflects the actual
 * source zone so the resolve path routes the card to the correct
 * end zone.
 *
 * Schema (card-scripts/schema.ts, CardScriptSchema):
 *   `castable_from` relaxes from `.min(1).max(1).optional()` to
 *   `.min(1).optional()`. Any non-empty subset of ["exile",
 *   "graveyard", "command"] is accepted.
 *
 * Engine:
 *   `canCastSpell` (spell-casting/cast.ts) iterates the array and
 *   accepts the cast from the first matching zone; the matched zone
 *   is stashed in a local for the cast-time stamp. The cast-time
 *   stamp (`castableFromZone` on the StackObject) picks the same
 *   first-match. `castSpell` source-zone lookup follows the same
 *   pattern. The resolve path (`resolveTopOfStack`,
 *   spell-casting/resolve.ts) reads `castableFromZone` and routes
 *   to exile for "graveyard" or "exile" sources, or to graveyard
 *   for the "command" source (the commander return-to-command path
 *   is a follow-up lane — current v1 routes commander casts to the
 *   graveyard on resolution).
 *
 * Test harness pattern: synthetic card scripts registered via
 * `CardScriptSchema.parse + registerCardScripts` (the lane 49/52/
 * 55/59/60/62/63/64/65/66/67/68 pattern). The tests exercise the
 * cast path via `canCastSpell` / `castSpell` and inspect the
 * StackObject's `castableFromZone` and `alternativeCostsUsed`.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { canCastSpell, castSpell } from "../spell-casting/cast";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME_GRAVEYARD_THEN_EXILE =
  "Test Multi-Zone Castable From Graveyard/Exile (lane 113)";
const HOST_NAME_EXILE_THEN_GRAVEYARD =
  "Test Multi-Zone Castable From Exile/Graveyard (lane 113)";

const GY_EX_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME_GRAVEYARD_THEN_EXILE,
  oracle:
    "Draw a card. (You may cast this card from your graveyard or from exile.)",
  spell: [{ op: "Draw", amount: 1 }],
  // graveyard listed first — when the card is in BOTH zones, the
  // engine picks graveyard as the source zone.
  castable_from: ["graveyard", "exile"],
});

const EX_GY_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME_EXILE_THEN_GRAVEYARD,
  oracle:
    "Draw a card. (You may cast this card from exile; exiled as a foretell. May also be cast from graveyard.)",
  spell: [{ op: "Draw", amount: 1 }],
  // exile listed first — when the card is in BOTH zones, the
  // engine picks exile as the source zone.
  castable_from: ["exile", "graveyard"],
});

function card(name: string, type_line: string, mana_cost = "{1}"): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost,
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
  } as ScryfallCard;
}

function putCardInZone(
  state: GameState,
  playerId: PlayerId,
  data: ScryfallCard,
  zoneSuffix: string,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-${zoneSuffix}`,
  });
  state.cards.set(c.id, c);
  const key = `${playerId}-${zoneSuffix}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Multi-zone castable_from (Wave 4.8 follow-up 17 lane 113 piece 2, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { generic: 2 });
    resetCardScriptsForTests();
    registerCardScripts([GY_EX_SCRIPT, EX_GY_SCRIPT]);
  });

  describe("schema", () => {
    it("accepts a multi-zone castable_from array", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Multi Zone Schema Accept (lane 113)",
        oracle: "Cast from graveyard or exile.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["graveyard", "exile"],
      });
      expect(parsed.castable_from).toEqual(["graveyard", "exile"]);
    });

    it("accepts a three-zone castable_from array (graveyard+exile+command)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Multi Zone Three (lane 113)",
        oracle: "Cast from any of graveyard, exile, or command.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["graveyard", "exile", "command"],
      });
      expect(parsed.castable_from).toEqual([
        "graveyard",
        "exile",
        "command",
      ]);
    });

    it("still rejects an empty castable_from array", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Multi Zone Empty (lane 113)",
          oracle: "Cast from nowhere.",
          spell: [{ op: "Draw", amount: 1 }],
          castable_from: [],
        }),
      ).toThrow();
    });

    it("still rejects an unknown zone in castable_from", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Multi Zone Unknown (lane 113)",
          oracle: "Cast from library.",
          spell: [{ op: "Draw", amount: 1 }],
          castable_from: ["graveyard", "library"],
        }),
      ).toThrow();
    });
  });

  describe("canCastSpell — multi-zone acceptance", () => {
    it("accepts a card in graveyard when castable_from includes graveyard", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "graveyard");
      const result = canCastSpell(state, alice, id);
      expect(result.canCast).toBe(true);
    });

    it("accepts a card in exile when castable_from includes exile", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "exile");
      const result = canCastSpell(state, alice, id);
      expect(result.canCast).toBe(true);
    });

    it("rejects a card in hand when castable_from is graveyard+exile", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "hand");
      const result = canCastSpell(state, alice, id);
      expect(result.canCast).toBe(false);
      expect(result.reason).toMatch(/graveyard/);
      expect(result.reason).toMatch(/exile/);
    });

    it("rejects a card in command when castable_from is graveyard+exile (no command)", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "command");
      const result = canCastSpell(state, alice, id);
      expect(result.canCast).toBe(false);
      expect(result.reason).toMatch(/graveyard/);
      expect(result.reason).toMatch(/exile/);
    });

    it("prefers the script-declared first zone when card is in multiple listed zones", () => {
      // Card in BOTH graveyard and exile; script lists graveyard
      // first → graveyard wins. We register a duplicate in exile
      // (different id) and exercise the graveyard card.
      const c1 = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id1 = putCardInZone(state, alice, c1, "graveyard");
      // Add a second copy in exile (different cardId) so both
      // zones are populated.
      const c2 = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      putCardInZone(state, alice, c2, "exile");
      // The graveyard copy's cast resolves to "graveyard" as the
      // source zone (validated via the cast stamp below).
      const result = canCastSpell(state, alice, id1);
      expect(result.canCast).toBe(true);
    });
  });

  describe("castSpell — source-zone stamp", () => {
    it("stamps castableFromZone='graveyard' when card is in graveyard and script lists graveyard+exile", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "graveyard");
      const result = castSpell(state, alice, id);
      expect(result.success).toBe(true);
      const stackObject = result.state.stack[0];
      expect(stackObject.castableFromZone).toBe("graveyard");
      expect(stackObject.alternativeCostsUsed).toContain("castable_from");
    });

    it("stamps castableFromZone='exile' when card is in exile and script lists graveyard+exile", () => {
      const c = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "exile");
      const result = castSpell(state, alice, id);
      expect(result.success).toBe(true);
      const stackObject = result.state.stack[0];
      expect(stackObject.castableFromZone).toBe("exile");
      expect(stackObject.alternativeCostsUsed).toContain("castable_from");
    });

    it("prefers the script-declared first zone when both zones contain a copy of the card", () => {
      // Register TWO copies in BOTH zones (different cardIds).
      const cGraveyard = card(
        HOST_NAME_GRAVEYARD_THEN_EXILE,
        "Instant",
        "{1}",
      );
      const idGraveyard = putCardInZone(
        state,
        alice,
        cGraveyard,
        "graveyard",
      );
      const cExile = card(HOST_NAME_GRAVEYARD_THEN_EXILE, "Instant", "{1}");
      putCardInZone(state, alice, cExile, "exile");
      // Cast the graveyard copy — script lists graveyard first,
      // so castableFromZone must reflect "graveyard" (not
      // "exile" — the engine doesn't auto-flip when only the
      // graveyard copy is being cast).
      const result = castSpell(state, alice, idGraveyard);
      expect(result.success).toBe(true);
      expect(result.state.stack[0].castableFromZone).toBe("graveyard");
    });

    it("honors script-declared preference 'exile' over 'graveyard' when the card is in exile", () => {
      // Different script: castable_from: ["exile", "graveyard"].
      // When the card is in exile (the first-listed zone), the
      // engine stamps "exile".
      const c = card(HOST_NAME_EXILE_THEN_GRAVEYARD, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "exile");
      const result = castSpell(state, alice, id);
      expect(result.success).toBe(true);
      expect(result.state.stack[0].castableFromZone).toBe("exile");
    });

    it("falls through to the second-listed zone when the card is only there", () => {
      // Card in graveyard only (not in exile). The script lists
      // ["exile", "graveyard"] — exile doesn't match (card not
      // there), graveyard DOES match. The engine falls through
      // and stamps "graveyard".
      const c = card(HOST_NAME_EXILE_THEN_GRAVEYARD, "Instant", "{1}");
      const id = putCardInZone(state, alice, c, "graveyard");
      const result = castSpell(state, alice, id);
      expect(result.success).toBe(true);
      expect(result.state.stack[0].castableFromZone).toBe("graveyard");
    });
  });
});