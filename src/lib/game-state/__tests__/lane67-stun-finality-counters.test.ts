/**
 * Stun / finality counters generalized from `instanceCounters` (Wave 4.8
 * follow-up 4 lane 67, #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of recent cards that
 * need a generalized counter engine: Magmatic Hellkite's "stun
 * counter" effect, Sheoldred's Headcracker's "finality counter"
 * effect, and the standard `+1/+1` / `-1/-1` counter family. The
 * Wave 4.8 follow-up lane 59 (`enters_with_counters_per_match`)
 * shipped a per-card chosen-counter arm for Banner of Kinship; the
 * legacy `SearchLibrary.stun` substrate writes a single stun counter
 * to `card.counters` (read by `untapOrRemoveStun`). This lane
 * generalizes both substrates by exposing a script-level
 * `enters_with_counters: [{ counter, count }]` arm that stamps
 * arbitrary named counter types at ETB on the `instanceCounters`
 * ledger (the generalized lane 59 substrate) AND mirrors them to
 * `card.counters` so the existing untap-skip + P/T paths pick up
 * the counters immediately.
 *
 * Schema (card-scripts/schema.ts, CardScriptSchema):
 *   `enters_with_counters: [{ counter, count }]` — a list of named
 *   counter types and counts. v1 supports the four counter types
 *   `"+1/+1"`, `"-1/-1"`, `"stun"`, and `"finality"`. Other
 *   counter types (charge, time, lore, etc.) are follow-up lanes.
 *
 * Engine:
 *   `applyScriptEntersWithCounters` (keyword-actions/enters.ts)
 *   stamps the counters on the entering card's
 *   `instanceCounters` ledger and mirrors them to the legacy
 *   `card.counters` list. The function is called from
 *   `fireEntersTriggers` (the non-spell ETB path — tokens,
 *   `ReturnFromZone` to the battlefield, persist returns) AND
 *   from the spell-casting resolve.ts path (the spell-casting
 *   ETB). v1 doesn't wire the active decrement of stun counters
 *   during the untap step (the follow-up lane will move the
 *   untap path to read from `instanceCounters` once the legacy
 *   `SearchLibrary.stun` substrate is retired) — the v1 mirrors
 *   to `card.counters` so the existing untap-skip path picks up
 *   the new stun counter on day one.
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (lane 49/52/55/59
 * /60/62/63/64/65/66 pattern). The card is put on the battlefield
 * via `fireEntersTriggers` (the same call site the engine uses for
 * non-spell ETBs — the test exercises the schema arm end-to-end
 * through the same call site).
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import {
  fireEntersTriggers,
  applyScriptEntersWithCounters,
} from "../keyword-actions/enters";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const HOST_NAME = "Test Enters-With-Counters Host (lane 67)";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle: "This creature enters the battlefield with one stun counter on it.",
  enters_with_counters: [{ counter: "stun", count: 1 }],
});

function card(name: string, type_line: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost: "{1}",
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

function putOnBattlefield(
  state: GameState,
  playerId: PlayerId,
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId, {
    currentZoneKey: `${playerId}-battlefield`,
  });
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-battlefield`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Stun / finality counters generalized from instanceCounters (Wave 4.8 follow-up 4 lane 67, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    resetCardScriptsForTests();
    registerCardScripts([HOST_SCRIPT]);
  });

  describe("schema", () => {
    it("accepts an enters_with_counters arm with stun", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Stun (lane 67)",
        oracle: "Enters with one stun counter on it.",
        enters_with_counters: [{ counter: "stun", count: 1 }],
      });
      expect(parsed.enters_with_counters).toEqual([
        { counter: "stun", count: 1 },
      ]);
    });

    it("accepts an enters_with_counters arm with multiple entries", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK Multi (lane 67)",
        oracle: "Enters with one stun counter and one +1/+1 counter.",
        enters_with_counters: [
          { counter: "stun", count: 1 },
          { counter: "+1/+1", count: 1 },
        ],
      });
      expect(parsed.enters_with_counters).toEqual([
        { counter: "stun", count: 1 },
        { counter: "+1/+1", count: 1 },
      ]);
    });

    it("accepts the four v1 counter types", () => {
      for (const counter of ["+1/+1", "-1/-1", "stun", "finality"] as const) {
        const parsed = CardScriptSchema.parse({
          name: `Test OK ${counter} (lane 67)`,
          oracle: `Enters with a ${counter} counter.`,
          enters_with_counters: [{ counter, count: 1 }],
        });
        expect(parsed.enters_with_counters?.[0].counter).toBe(counter);
      }
    });

    it("rejects an unknown counter type", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Counter (lane 67)",
          oracle: "Enters with a charge counter.",
          enters_with_counters: [{ counter: "charge", count: 1 }],
        }),
      ).toThrow();
    });

    it("rejects a non-positive count", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Count (lane 67)",
          oracle: "Enters with a stun counter.",
          enters_with_counters: [{ counter: "stun", count: 0 }],
        }),
      ).toThrow();
    });

    it("keeps the existing CardScriptSchema shape byte-compatible (no enters_with_counters)", () => {
      // The CardScriptSchema requires at least one ability arm
      // (spell, modes, triggers, activated, statics, rules,
      // equipment, aura, cycling, enter_choice, OR
      // enters_with_counters). A vanilla creature with no
      // abilities doesn't parse. We add a minimal `cycling` arm
      // to satisfy the refinement and assert the
      // enters_with_counters field stays unset.
      const parsed = CardScriptSchema.parse({
        name: "Test No Enters With Counters (lane 67)",
        oracle: "Cycling {2}.",
        cycling: { cost: "{2}" },
      });
      expect(parsed.enters_with_counters).toBeUndefined();
    });
  });

  describe("engine", () => {
    it("applyScriptEntersWithCounters stamps stun on the instanceCounters ledger", () => {
      const cardId = putOnBattlefield(
        state,
        alice,
        card(HOST_NAME, "Creature \u2014 Goblin"),
      );
      const after = applyScriptEntersWithCounters(state, cardId);
      const inst = after.cards.get(cardId);
      expect(inst?.instanceCounters?.stun).toBe(1);
    });

    it("applyScriptEntersWithCounters mirrors stun to the legacy card.counters list", () => {
      const cardId = putOnBattlefield(
        state,
        alice,
        card(HOST_NAME, "Creature \u2014 Goblin"),
      );
      const after = applyScriptEntersWithCounters(state, cardId);
      const inst = after.cards.get(cardId);
      // The legacy `untapOrRemoveStun` reads from `card.counters`;
      // the mirror ensures the existing untap-skip path picks
      // up the new stun counter on day one.
      expect(inst?.counters).toEqual([{ type: "stun", count: 1 }]);
    });

    it("applyScriptEntersWithCounters stamps multiple entries", () => {
      const multi = "Test Multi (lane 67)";
      const multiScript = CardScriptSchema.parse({
        name: multi,
        oracle: "Enters with one stun counter and one +1/+1 counter.",
        enters_with_counters: [
          { counter: "stun", count: 1 },
          { counter: "+1/+1", count: 1 },
        ],
      });
      registerCardScripts([HOST_SCRIPT, multiScript]);
      const cardId = putOnBattlefield(
        state,
        alice,
        card(multi, "Creature \u2014 Goblin"),
      );
      const after = applyScriptEntersWithCounters(state, cardId);
      const inst = after.cards.get(cardId);
      expect(inst?.instanceCounters?.stun).toBe(1);
      expect(inst?.instanceCounters?.["+1/+1"]).toBe(1);
      expect(inst?.counters).toEqual(
        expect.arrayContaining([
          { type: "stun", count: 1 },
          { type: "+1/+1", count: 1 },
        ]),
      );
    });

    it("applyScriptEntersWithCounters is a no-op for a card without the field", () => {
      const vanilla = "Test Vanilla (lane 67)";
      // The card has cycling but no enters_with_counters; the
      // helper should be a no-op (returns the same state shape
      // with the original `counters: []` list intact).
      const vanillaScript = CardScriptSchema.parse({
        name: vanilla,
        oracle: "Cycling {2}.",
        cycling: { cost: "{2}" },
      });
      registerCardScripts([HOST_SCRIPT, vanillaScript]);
      const cardId = putOnBattlefield(
        state,
        alice,
        card(vanilla, "Creature \u2014 Goblin"),
      );
      const after = applyScriptEntersWithCounters(state, cardId);
      const inst = after.cards.get(cardId);
      expect(inst?.instanceCounters).toBeUndefined();
      // card.counters may be an empty array (the constructor sets
      // `counters: []`); the stamp didn't add anything.
      expect(inst?.counters).toEqual([]);
    });

    it("fireEntersTriggers stamps the entering card via applyScriptEntersWithCounters", () => {
      const cardId = putOnBattlefield(
        state,
        alice,
        card(HOST_NAME, "Creature \u2014 Goblin"),
      );
      // fireEntersTriggers reads the card by id; the helper
      // stamps before the ETB triggers fire. The card has the
      // stun counter after this call.
      const after = fireEntersTriggers(state, cardId);
      const inst = after.cards.get(cardId);
      expect(inst?.instanceCounters?.stun).toBe(1);
      expect(inst?.counters).toEqual([{ type: "stun", count: 1 }]);
    });
  });
});
