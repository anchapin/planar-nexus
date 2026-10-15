/**
 * Cast from exile / graveyard / command (Wave 4.8 follow-up 4 lane 68,
 * #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards that
 * cast from a non-hand zone: Evoke, Flashback, Jump-Start,
 * Undergrowth, Escape, As Foretold, Yawgmoth's Vile Offer,
 * commander cast, etc. The v0 substrate is the per-keyword
 * `flashback` and `harmonize` fields (which already work for
 * flashback-style instants/sorceries); lane 68 unifies the
 * castable-from zone as a script-level
 * `castable_from: ["exile" | "graveyard" | "command"]` array.
 *
 * Schema (card-scripts/schema.ts, CardScriptSchema):
 *   `castable_from: ["exile" | "graveyard" | "command"]` — a
 *   single-element array (multi-zone casting is a follow-up
 *   lane). The engine reads the field at cast time
 *   (`canCastSpell` extends to accept the card from any named
 *   zone) and at resolve time (the post-resolution end zone is
 *   inferred from the source: `castable_from: ["graveyard"]`
 *   → exile, `castable_from: ["exile"]` → exile, `castable_from:
 *   ["command"]` → command; the commander return-to-command
 *   for permanents is a follow-up lane).
 *
 * Engine:
 *   `canCastSpell` (spell-casting/cast.ts) reads the
 *   `castable_from` field and accepts the cast when the card
 *   is in one of the named zones (instead of requiring the
 *   hand). The cast path pushes `"castable_from"` to
 *   `alternativeCostsUsed` and stamps `castableFromZone` on
 *   the StackObject. The resolve path
 *   (`resolveTopOfStack`, in spell-casting/resolve.ts) reads
 *   the StackObject's `castableFromZone` and routes the card
 *   to the right end zone (exile for `castable_from:
 *   ["graveyard"]` / `castable_from: ["exile"]`
 *   instants/sorceries; commander return-to-command is a
 *   follow-up lane).
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (the lane 49
 * /52/55/59/60/62/63/64/65/66/67 pattern). The test exercises
 * the cast path via the engine's `canCastSpell` and
 * `castSpell` functions (the same call sites the engine uses
 * for a real cast).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { canCastSpell, castSpell } from "../spell-casting/cast";
import { resolveTopOfStack } from "../spell-casting/resolve";
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

const HOST_NAME_GRAVEYARD = "Test Castable From Graveyard (lane 68)";
const HOST_NAME_EXILE = "Test Castable From Exile (lane 68)";
const HOST_NAME_COMMAND = "Test Castable From Command (lane 68)";

const GRAVEYARD_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME_GRAVEYARD,
  oracle:
    "Draw a card. (You may cast this card from your graveyard for its mana cost. Then exile it.)",
  spell: [{ op: "Draw", amount: 1 }],
  castable_from: ["graveyard"],
});

const EXILE_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME_EXILE,
  oracle:
    "Draw a card. (You may cast this card from exile for its mana cost. Then exile it.)",
  spell: [{ op: "Draw", amount: 1 }],
  castable_from: ["exile"],
});

const COMMAND_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME_COMMAND,
  oracle:
    "Draw a card. (You may cast this card from the command zone for its mana cost.)",
  spell: [{ op: "Draw", amount: 1 }],
  castable_from: ["command"],
});

function card(
  name: string,
  type_line: string,
  mana_cost = "{1}",
): ScryfallCard {
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

describe("Cast from exile / graveyard / command (Wave 4.8 follow-up 4 lane 68, #2614 follow-up)", () => {
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
    registerCardScripts([GRAVEYARD_SCRIPT, EXILE_SCRIPT, COMMAND_SCRIPT]);
  });

  describe("schema", () => {
    it("accepts a castable_from arm with graveyard", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Graveyard (lane 68)",
        oracle: "You may cast this card from your graveyard.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["graveyard"],
      });
      expect(parsed.castable_from).toEqual(["graveyard"]);
    });

    it("accepts a castable_from arm with exile", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Exile (lane 68)",
        oracle: "You may cast this card from exile.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["exile"],
      });
      expect(parsed.castable_from).toEqual(["exile"]);
    });

    it("accepts a castable_from arm with command", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Command (lane 68)",
        oracle: "You may cast this card from the command zone.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["command"],
      });
      expect(parsed.castable_from).toEqual(["command"]);
    });

    it("rejects an unknown zone in castable_from", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Zone (lane 68)",
          oracle: "Cast from library.",
          spell: [{ op: "Draw", amount: 1 }],
          castable_from: ["library"],
        }),
      ).toThrow();
    });

    it("rejects an empty castable_from array", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Empty Array (lane 68)",
          oracle: "Cast from nowhere.",
          spell: [{ op: "Draw", amount: 1 }],
          castable_from: [],
        }),
      ).toThrow();
    });

    it("accepts a multi-zone castable_from array (Wave 4.8 follow-up 17 lane 113 piece 2)", () => {
      // Wave 4.8 follow-up 17 lane 113 piece 2 (#2614 follow-up):
      // the v1 single-entry cap is relaxed; multi-zone arrays
      // are accepted by the schema. The engine iterates the
      // array and picks the first matching zone at cast time.
      const parsed = CardScriptSchema.parse({
        name: "Test Multi Zone (lane 113)",
        oracle: "Cast from graveyard or exile.",
        spell: [{ op: "Draw", amount: 1 }],
        castable_from: ["graveyard", "exile"],
      });
      expect(parsed.castable_from).toEqual(["graveyard", "exile"]);
    });

    it("keeps the existing CardScriptSchema shape byte-compatible (no castable_from)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test No Castable From (lane 68)",
        oracle: "A vanilla sorcery.",
        spell: [{ op: "Draw", amount: 1 }],
      });
      expect(parsed.castable_from).toBeUndefined();
    });
  });

  describe("engine cast-time", () => {
    it("accepts a card in the graveyard when castable_from includes graveyard", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_GRAVEYARD, "Instant"),
        "graveyard",
      );
      const r = canCastSpell(state, alice, cardId);
      expect(r.canCast).toBe(true);
    });

    it("rejects a card in the hand when castable_from is graveyard", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_GRAVEYARD, "Instant"),
        "hand",
      );
      const r = canCastSpell(state, alice, cardId);
      expect(r.canCast).toBe(false);
    });

    it("rejects a card in exile when castable_from is graveyard", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_GRAVEYARD, "Instant"),
        "exile",
      );
      const r = canCastSpell(state, alice, cardId);
      expect(r.canCast).toBe(false);
    });

    it("accepts a card in exile when castable_from includes exile", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_EXILE, "Instant"),
        "exile",
      );
      const r = canCastSpell(state, alice, cardId);
      expect(r.canCast).toBe(true);
    });

    it("accepts a card in the command zone when castable_from includes command", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_COMMAND, "Instant"),
        "command",
      );
      const r = canCastSpell(state, alice, cardId);
      expect(r.canCast).toBe(true);
    });

    it("rejects a card not in the named zone (default hand-only path still works)", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card("Vanilla", "Instant"),
        "hand",
      );
      const r = canCastSpell(state, alice, cardId);
      // The vanilla card has no castable_from; the default
      // hand check accepts it. This is the byte-compat path.
      expect(r.canCast).toBe(true);
    });
  });

  describe("engine cast-time + resolve-time integration", () => {
    it("a graveyard-cast instant routes to exile on resolution", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_GRAVEYARD, "Instant"),
        "graveyard",
      );
      // Cast the card. castSpell moves the card from the
      // graveyard to the stack, pushes the cast onto the stack,
      // and consumes mana.
      const castResult = castSpell(state, alice, cardId, [], []);
      if (!castResult.success) {
        // Surface the error to help debug.
        throw new Error(`castSpell failed: ${JSON.stringify(castResult)}`);
      }
      expect(castResult.success).toBe(true);
      // The stack should have the spell.
      expect(castResult.state.stack).toHaveLength(1);
      const stackObject = castResult.state.stack[0];
      expect(stackObject.alternativeCostsUsed).toContain("castable_from");
      expect(stackObject.castableFromZone).toBe("graveyard");
      // Resolve the spell.
      const resolved = resolveTopOfStack(castResult.state);
      // The card should now be in exile (the v1 routing for
      // `castable_from: ["graveyard"]` instants/sorceries).
      const finalInst = resolved.cards.get(cardId);
      expect(finalInst?.currentZoneKey).toBe(`${alice}-exile`);
    });

    it("an exile-cast instant routes to exile on resolution", () => {
      const cardId = putCardInZone(
        state,
        alice,
        card(HOST_NAME_EXILE, "Instant"),
        "exile",
      );
      const castResult = castSpell(state, alice, cardId, [], []);
      if (!castResult.success) {
        throw new Error(`castSpell failed: ${JSON.stringify(castResult)}`);
      }
      expect(castResult.success).toBe(true);
      const stackObject = castResult.state.stack[0];
      expect(stackObject.alternativeCostsUsed).toContain("castable_from");
      expect(stackObject.castableFromZone).toBe("exile");
      const resolved = resolveTopOfStack(castResult.state);
      const finalInst = resolved.cards.get(cardId);
      expect(finalInst?.currentZoneKey).toBe(`${alice}-exile`);
    });
  });
});
