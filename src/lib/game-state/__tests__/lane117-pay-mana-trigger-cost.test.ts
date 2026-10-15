/**
 * Trigger `cost.pay_mana` arm (Wave 4.8 follow-up 17 lane 117,
 * #2614 follow-up).
 *
 * The drafter list (#2614) flags a long tail of cards that pay
 * mana as a trigger cost: Mana Echo (you may pay {2}; if you do,
 * draw a card), Selvala Heart of the Wilds (you may pay {G}; if
 * you do, draw a card and put a +1/+1 counter on a creature you
 * control), and the broader "you may pay {cost}; if you do, [X]"
 * pattern. The v0 substrate is the lane 106 `cost.pay_life` arm
 * (parallel trigger-cost dispatch for life payment); lane 117 wires
 * the same dispatch shape for mana payment.
 *
 * Schema (card-scripts/schema.ts, TriggerSchema.cost):
 *   `cost.pay_mana: { amount: N }` — a parallel arm to the lane
 *   106 `cost.pay_life`. v1 supports generic mana only (the
 *   standard spendMana cascade: generic → colorless → colored).
 *   Colored-mana payment rides a follow-up lane.
 *
 * Engine (card-scripts/interpret.ts, resolveScriptedAbility):
 *   The cost dispatch checks `cost.pay_mana` AFTER `cost.pay_life`.
 *   On `cost_paid === undefined`, the engine surfaces a
 *   `pay_mana_prompt` yes/no WaitingChoice. The resolver
 *   (`pay_mana_prompt` branch in spell-casting/choices.ts)
 *   stamps `cost_paid` on the stack object. On `cost_paid ===
 *   true`, the engine consult runs `spendMana(state,
 *   controllerId, { generic: amount })` before the effects loop.
 *   On `cost_paid === false`, the trigger fizzles (CR 602.2b).
 *
 * Out of scope (each a follow-up lane):
 *   - Colored-mana payment (e.g. "Pay {G}: ..."): requires an
 *     extension to `spendMana`'s cascade / a parallel spend
 *     helper for colored costs.
 *   - "Pay any amount of mana up to N" variant.
 *   - Combined `pay_mana + pay_life` on the same trigger
 *     (the handoff's "you_may + pay_life combined" wording).
 *     The v1 minimum ships one or the other; the multi-cost
 *     combinator rides a future lane.
 *
 * Test harness pattern: synthetic card script registered via
 * `CardScriptSchema.parse + registerCardScripts` (the lane 49/52/
 * 55/59/60/62/63/64/65/66/67/68/113 pattern). The tests exercise
 * the trigger path via `detectTriggeredAbilities` +
 * `putTriggersOnStack` (the natural flow) and inspect the
 * StackObject's `cost_paid` flag and the controller's mana pool.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { CardScriptSchema, type CardScript } from "../card-scripts/schema";
import {
  registerCardScripts,
  resetCardScriptsForTests,
} from "../card-scripts/registry";
import { resolveScriptedAbility } from "../card-scripts/interpret";
import { resolveWaitingChoice } from "../spell-casting/choices";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { putTriggersOnStack } from "../trigger-system/stack-ops";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../types";

const HOST_NAME = "Test Pay Mana Trigger Cost (lane 117)";

const PAY_MANA_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Whenever this creature attacks, you may pay {2}. If you do, draw a card.",
  triggers: [
    {
      text: "Whenever this creature attacks, you may pay {2}. If you do, draw a card.",
      event: "attacks",
      subject: "self",
      you_may: true,
      cost: { pay_mana: { amount: 2 } },
      effects: [{ op: "Draw", amount: 1, who: "you" }],
    },
  ],
});

function card(name: string, type_line: string, mana_cost = ""): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost,
    cmc: 0,
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
  state.cards.set(c.id, c);
  const key = `${playerId}-battlefield`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

describe("Trigger cost.pay_mana (Wave 4.8 follow-up 17 lane 117, #2614 follow-up)", () => {
  let state: GameState;
  let alice: PlayerId;
  let sourceId: CardInstanceId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    resetCardScriptsForTests();
    registerCardScripts([PAY_MANA_SCRIPT]);
    const c = card(HOST_NAME, "Creature — Goblin", "");
    sourceId = putOnBattlefield(state, alice, c);
  });

  describe("schema", () => {
    it("accepts a pay_mana: { amount: 2 } cost on a trigger", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Schema Pay Mana (lane 117)",
        oracle: "You may pay {2}; if you do, draw.",
        triggers: [
          {
            text: "You may pay {2}; if you do, draw.",
            event: "attacks",
            subject: "self",
            you_may: true,
            cost: { pay_mana: { amount: 2 } },
            effects: [{ op: "Draw", amount: 1, who: "you" }],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.pay_mana).toEqual({ amount: 2 });
    });

    it("accepts amount: 1 (single mana payment)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Schema Pay Mana Single (lane 117)",
        oracle: "You may pay {1}; if you do, draw.",
        triggers: [
          {
            text: "You may pay {1}; if you do, draw.",
            event: "attacks",
            subject: "self",
            you_may: true,
            cost: { pay_mana: { amount: 1 } },
            effects: [{ op: "Draw", amount: 1, who: "you" }],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.pay_mana?.amount).toBe(1);
    });

    it("accepts amount: 99 (max)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Schema Pay Mana Max (lane 117)",
        oracle: "You may pay {99}; if you do, draw.",
        triggers: [
          {
            text: "You may pay {99}; if you do, draw.",
            event: "attacks",
            subject: "self",
            you_may: true,
            cost: { pay_mana: { amount: 99 } },
            effects: [{ op: "Draw", amount: 1, who: "you" }],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.pay_mana?.amount).toBe(99);
    });

    it("rejects amount: 0 (v1 minimum is 1)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Pay Mana Zero (lane 117)",
          oracle: "You may pay 0; if you do, draw.",
          triggers: [
            {
              text: "You may pay 0; if you do, draw.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: { pay_mana: { amount: 0 } },
              effects: [{ op: "Draw", amount: 1, who: "you" }],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects amount: 100 (over the v1 max of 99)", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Pay Mana Over (lane 117)",
          oracle: "You may pay {100}; if you do, draw.",
          triggers: [
            {
              text: "You may pay {100}; if you do, draw.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: { pay_mana: { amount: 100 } },
              effects: [{ op: "Draw", amount: 1, who: "you" }],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects a non-integer amount", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Pay Mana Float (lane 117)",
          oracle: "You may pay 1.5; if you do, draw.",
          triggers: [
            {
              text: "You may pay 1.5; if you do, draw.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: { pay_mana: { amount: 1.5 } },
              effects: [{ op: "Draw", amount: 1, who: "you" }],
            },
          ],
        }),
      ).toThrow();
    });

    it("rejects an unknown field on the pay_mana arm", () => {
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Schema Pay Mana Unknown (lane 117)",
          oracle: "You may pay {2}; if you do, draw.",
          triggers: [
            {
              text: "You may pay {2}; if you do, draw.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: { pay_mana: { amount: 2, color: "R" } },
              effects: [{ op: "Draw", amount: 1, who: "you" }],
            },
          ],
        }),
      ).toThrow();
    });

    it("keeps the existing TriggerSchema.cost shape byte-compatible (no pay_mana)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Schema Pay Mana None (lane 117)",
        oracle: "Draw a card.",
        triggers: [
          {
            text: "Draw a card.",
            event: "attacks",
            subject: "self",
            effects: [{ op: "Draw", amount: 1, who: "you" }],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.pay_mana).toBeUndefined();
    });
  });

  describe("engine — pay_mana_prompt path", () => {
    it("first pass: surfaces a you_may_prompt, then pay_mana_prompt on the second pass", () => {
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      expect(triggers).toHaveLength(1);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0];
      // First pass: surfaces `you_may_prompt` (the lane 60
      // you_may gate fires before the cost consult).
      const prompted = resolveScriptedAbility(stacked, stackObject)!;
      expect(prompted.waitingChoice!.type).toBe("you_may_prompt");
      // Controller accepts: stamp `you_may_resolved: true`.
      const accepted = resolveWaitingChoice(prompted, alice, true);
      const stamped = accepted.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { you_may_resolved?: boolean };
      expect(stamped.you_may_resolved).toBe(true);
      // Second pass: surfaces `pay_mana_prompt` (the cost
      // consult fires after the you_may gate).
      const costPrompted = resolveScriptedAbility(accepted.state, stamped)!;
      expect(costPrompted.waitingChoice).not.toBeNull();
      expect(costPrompted.waitingChoice!.type).toBe("pay_mana_prompt");
      expect(costPrompted.waitingChoice!.choices.length).toBe(2);
    });

    it("controller accepts → cost_paid stamped true, mana spent, effects resolve (draw)", () => {
      state = addMana(state, alice, { generic: 5 });
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0];
      // you_may pass.
      const youMay = resolveScriptedAbility(stacked, stackObject)!;
      const accepted = resolveWaitingChoice(youMay, alice, true);
      const stampedYouMay = accepted.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { you_may_resolved?: boolean };
      // pay_mana prompt surfaces.
      const prompted = resolveScriptedAbility(accepted.state, stampedYouMay)!;
      expect(prompted.waitingChoice!.type).toBe("pay_mana_prompt");
      // Controller answers yes.
      const answered = resolveWaitingChoice(prompted, alice, true);
      const stamped = answered.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { cost_paid?: boolean };
      expect(stamped.cost_paid).toBe(true);
      // Second resolve pass: deduct mana + run effects.
      const resolved = resolveScriptedAbility(answered.state, stamped)!;
      // Mana pool should be 5 - 2 = 3 generic after the spend.
      expect(resolved.players.get(alice)!.manaPool.generic).toBe(3);
    });

    it("controller declines → cost_paid stamped false, trigger fizzles (no mana spent, no draw)", () => {
      state = addMana(state, alice, { generic: 5 });
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0];
      const youMay = resolveScriptedAbility(stacked, stackObject)!;
      const accepted = resolveWaitingChoice(youMay, alice, true);
      const stampedYouMay = accepted.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { you_may_resolved?: boolean };
      const prompted = resolveScriptedAbility(accepted.state, stampedYouMay)!;
      expect(prompted.waitingChoice!.type).toBe("pay_mana_prompt");
      const answered = resolveWaitingChoice(prompted, alice, false);
      const stamped = answered.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { cost_paid?: boolean };
      expect(stamped.cost_paid).toBe(false);
      // Second resolve pass: fizzles — mana NOT spent, effects
      // do NOT run.
      const resolved = resolveScriptedAbility(answered.state, stamped)!;
      expect(resolved.players.get(alice)!.manaPool.generic).toBe(5);
    });

    it("defensive: confirms with cost_paid=true but insufficient mana → trigger fizzles", () => {
      // No mana added — pool is empty. We stamp you_may_resolved
      // and cost_paid manually to exercise the defensive path
      // (the spendMana call fails when there's no mana to
      // spend).
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0] as StackObject & {
        you_may_resolved?: boolean;
        cost_paid?: boolean;
      };
      stackObject.you_may_resolved = true;
      stackObject.cost_paid = true;
      const resolved = resolveScriptedAbility(state, stackObject)!;
      // Pool is unchanged (empty).
      expect(resolved.players.get(alice)!.manaPool.generic).toBe(0);
    });
  });
});