/**
 * Counter-based trigger gate — engine arm
 * (Wave 4.8 follow-up 2 lane 62, #2614 follow-up).
 *
 * The drafter list (#2614) flags Redcap Gutter-Dweller's
 * "Goblins you control have menace when this has 3+ +1/+1
 * counters" half as a deferred-lane blocker — Wave 4.8
 * follow-up lane 57 (#2731) shipped the JSON shape; this
 * lane (62) wires the engine arm the card implicitly
 * carried.
 *
 * Schema (card-scripts/schema.ts, TriggerSchema):
 *   `counter_gate: { counter: string, op: "gte" | "eq", n: int >= 0 }`
 *   — a "while" gate parallel (CR 603.2) to the existing
 *   `whileCondition` and `losesAbilities` gates. The
 *   comparator op is set explicitly so cards can demand
 *   an exact count ("when you have EXACTLY 5 counters") or
 *   a threshold ("when you have 3+ counters").
 *
 * Engine:
 *   `triggered.ts#detectTriggeredAbilities` consults
 *   `card.instanceCounters[gate.counter]` (the per-instance
 *   counter ledger stamped by `resolveEnterChoice` for the
 *   lane 59 `enters_with_counters_per_match` arm) and a
 *   comparator (gte|eq); the gate is the third CR 603.2
 *   "while"-gate filter, sitting AFTER `whileCondition`
 *   AND `losesAbilities` (lane 58) so higher-priority
 *   disqualifications short-circuit the regex evaluator.
 *
 *   The default count is `0` when `card.instanceCounters`
 *   is undefined (matches the lane 59 v1 default; the field
 *   is `Record<string, number>`). A trigger on a permanent
 *   with no instanceCounters ledger and a gate `op: "gte",
 *   n: 3` won't fire unless an explicit instanceCounters
 *   entry bumps the count over the threshold.
 *
 * Test harness pattern: synthetic script registered via
 * `CardScriptSchema.parse + registerCardScripts`, mirroring
 * the lane 49/52/55/59/60 pattern.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { detectTriggeredAbilities } from "../abilities/triggered";
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

const HOST_NAME = "Test Host Counter Gate (lane 62)";

const HOST_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Whenever you attack, if this has 3 or more +1/+1 counters, draw a card. (For testing, the upkeephand trigger fires every combat.)",
  triggers: [
    {
      text: "Whenever you attack, if this has 3 or more +1/+1 counters, draw a card.",
      // The actual event we trigger under is "attacked" for simplicity;
      // the gate is what we're testing, not the event.
      event: "attacks",
      counter_gate: { counter: "+1/+1", op: "gte", n: 3 },
      effects: [{ op: "Draw", amount: 1 }],
    },
  ],
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

/** Stamp `instanceCounters` on a card. */
function stampCounters(
  state: GameState,
  cardId: CardInstanceId,
  counters: Record<string, number>,
): void {
  const inst = state.cards.get(cardId);
  if (!inst) return;
  const cards = new Map(state.cards);
  cards.set(cardId, { ...inst, instanceCounters: counters });
  state.cards = cards;
}

describe("Counter-based trigger gate (Wave 4.8 follow-up 2 lane 62, #2614 follow-up)", () => {
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
    registerCardScripts([HOST_SCRIPT]);
  });

  describe("schema", () => {
    it("accepts counter_gate on a trigger with effects", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test OK (lane 62)",
        oracle:
          "Whenever you attack, if this has 3 or more +1/+1 counters, draw a card.",
        triggers: [
          {
            text:
              "Whenever you attack, if this has 3 or more +1/+1 counters, draw a card.",
            event: "attacks",
            counter_gate: { counter: "+1/+1", op: "gte", n: 3 },
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      expect(parsed.triggers?.[0].counter_gate).toEqual({
        counter: "+1/+1",
        op: "gte",
        n: 3,
      });
    });

    it("rejects negative n", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad (lane 62)",
          oracle: "Whenever you attack, draw a card.",
          triggers: [
            {
              text: "Whenever you attack, draw a card.",
              event: "attacks",
              counter_gate: { counter: "+1/+1", op: "gte", n: -1 },
              effects: [{ op: "Draw", amount: 1 }],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects unknown op", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Bad Op (lane 62)",
          oracle: "Whenever you attack, draw a card.",
          triggers: [
            {
              text: "Whenever you attack, draw a card.",
              event: "attacks",
              counter_gate: { counter: "+1/+1", op: "lte", n: 3 },
              effects: [{ op: "Draw", amount: 1 }],
            },
          ],
        }),
      ).toThrow();
    });

    it("accepts eq op", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Eq Op (lane 62)",
        oracle: "Whenever you attack, draw a card.",
        triggers: [
          {
            text: "Whenever you attack, draw a card.",
            event: "attacks",
            counter_gate: { counter: "+1/+1", op: "eq", n: 5 },
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      expect(parsed.triggers?.[0].counter_gate?.op).toBe("eq");
    });
  });

  describe("engine", () => {
    it("fires the trigger when instanceCounters >= n (gte)", () => {
      const cardId = putOnBattlefield(state, alice, card(HOST_NAME, "Creature \u2014 Goblin"));
      stampCounters(state, cardId, { "+1/+1": 3 });
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(1);
    });

    it("skips the trigger when instanceCounters < n (gte)", () => {
      const cardId = putOnBattlefield(state, alice, card(HOST_NAME, "Creature \u2014 Goblin"));
      stampCounters(state, cardId, { "+1/+1": 2 });
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(0);
    });

    it("skips the trigger when instanceCounters is unset (default 0 < n)", () => {
      const cardId = putOnBattlefield(state, alice, card(HOST_NAME, "Creature \u2014 Goblin"));
      // No instanceCounters stamped.
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(0);
    });

    it("fires the trigger on eq when count matches exactly", () => {
      const eqHost = "Test Eq Host (lane 62)";
      const eqScript = CardScriptSchema.parse({
        name: eqHost,
        oracle: "Whenever you attack, draw a card.",
        triggers: [
          {
            text: "Whenever you attack, draw a card.",
            event: "attacks",
            counter_gate: { counter: "+1/+1", op: "eq", n: 5 },
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      registerCardScripts([HOST_SCRIPT, eqScript]);
      const cardId = putOnBattlefield(state, alice, card(eqHost, "Creature \u2014 Goblin"));
      stampCounters(state, cardId, { "+1/+1": 5 });
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(1);
    });

    it("skips the trigger on eq when count is off-by-one (5 != 4)", () => {
      const eqHost = "Test Eq Off-by-one (lane 62)";
      const eqScript = CardScriptSchema.parse({
        name: eqHost,
        oracle: "Whenever you attack, draw a card.",
        triggers: [
          {
            text: "Whenever you attack, draw a card.",
            event: "attacks",
            counter_gate: { counter: "+1/+1", op: "eq", n: 5 },
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      registerCardScripts([HOST_SCRIPT, eqScript]);
      const cardId = putOnBattlefield(state, alice, card(eqHost, "Creature \u2014 Goblin"));
      stampCounters(state, cardId, { "+1/+1": 4 });
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(0);
    });

    it("does not affect the firing of triggers without a counter_gate (no break to v1)", () => {
      const noGateHost = "Test No Counter Gate (lane 62)";
      const noGateScript = CardScriptSchema.parse({
        name: noGateHost,
        oracle: "Whenever you attack, draw a card.",
        triggers: [
          {
            text: "Whenever you attack, draw a card.",
            event: "attacks",
            effects: [{ op: "Draw", amount: 1 }],
          },
        ],
      });
      registerCardScripts([HOST_SCRIPT, noGateScript]);
      const cardId = putOnBattlefield(state, alice, card(noGateHost, "Creature \u2014 Bear"));
      const fired = detectTriggeredAbilities(state, "attacked", {});
      const fromHost = fired.filter((t) => t.sourceCardId === cardId);
      expect(fromHost.length).toBe(1);
    });
  });
});
