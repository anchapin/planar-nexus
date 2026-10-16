/**
 * Wave 4.8 follow-up 21 lane 99 follow-up extension
 * piece 1/N (#2614 follow-up): the multi-cost OR
 * combinator on `TriggerSchema.cost` ("you may pay
 * [A] OR pay [B]; if you do, [effects]" — Skeletonize
 * / Oracle-shaped choices on the cost).
 *
 * The follow-up 20 piece 2 verified the single-cost
 * `you_may + cost.pay_life` bridge. This piece extends
 * the substrate with the `cost.or: [...]` arm — a
 * non-empty array of single-arm cost shapes
 * (`sacrifice_self` / `discard` / `pay_life` / `pay_mana`).
 * The engine surfaces a `cost_combinator_or_prompt`
 * waitingChoice at the first resolve pass; on the
 * second pass the picked arm runs through the existing
 * lane 88 / 98 / 106 / 117 dispatch path.
 *
 * Schema (`card-scripts/schema.ts`, `TriggerSchema.cost`):
 *   `cost.or: [{ ... }, { ... }]` — a 2-arm minimum
 *   union of the existing single-arm shapes. Mutually
 *   exclusive with the standalone `cost.<arm>`
 *   siblings (refine rule rejects dual shape) and
 *   requires `you_may: true` (refine rule rejects
 *   the OR combinator without the yes/no gate).
 *
 * Engine (`card-scripts/interpret.ts`,
 * `resolveScriptedAbility`): the cost dispatch now
 * checks `cost.or` BEFORE the standalone cost arms.
 * On the first resolve pass (`chosen_or_cost_index
 * === undefined`), the engine surfaces a
 * `cost_combinator_or_prompt` waitingChoice with one
 * `ChoiceOption` per arm (label describing the arm's
 * cost shape, value = the 0-based index). The
 * resolver stamps `stackObject.chosen_or_cost_index`
 * and returns; on the second pass the picked arm's
 * standalone dispatch path runs (the
 * `hasSacrificeCost` / `discardCost` / `payLifeCost`
 * / `payManaCost` blocks below the OR check — the
 * picked arm is rewritten into the `ability.cost`
 * object so the existing dispatch picks it up).
 *
 * Out of scope (each a follow-up lane):
 *   - 3+ arm combinators (`min(2)` v1 minimum).
 *   - OR combinators mixing in the
 *     `additionalCosts` family (spell-cast only).
 *   - Colored-mana payment within the combinator
 *     (parallel to the lane 117 colored follow-up).
 *
 * Test harness pattern: synthetic card script
 * registered via `CardScriptSchema.parse +
 * registerCardScripts`. Tests exercise the schema
 * directly (validation / refine-rule rejections)
 * and the trigger path via `detectTriggeredAbilities`
 * + `putTriggersOnStack` + `resolveScriptedAbility`
 * + `resolveWaitingChoice`. Mirrors the lane 99
 * follow-up 20 piece 2 / lane 117 precedent.
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

const HOST_NAME = "Test Cost Or Combinator (lane 99 follow-up)";

const COST_OR_SCRIPT: CardScript = CardScriptSchema.parse({
  name: HOST_NAME,
  oracle:
    "Whenever this creature attacks, you may pay {2} or pay 3 life. If you do, this creature gets +1/+0 until end of turn.",
  triggers: [
    {
      text: "Whenever this creature attacks, you may pay {2} or pay 3 life. If you do, this creature gets +1/+0 until end of turn.",
      event: "attacks",
      subject: "self",
      you_may: true,
      cost: {
        or: [
          { pay_mana: { amount: 2 } },
          { pay_life: { amount: 3 } },
        ],
      },
      effects: [
        { op: "Pump", power: 1, toughness: 0, target: "self" },
      ],
    },
  ],
});

function card(name: string, type_line = "Creature — Wizard"): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line,
    oracle_text: "",
    mana_cost: "",
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

describe("cost.or multi-cost OR combinator (Wave 4.8 follow-up 21 lane 99 follow-up extension piece 1/N, #2614 follow-up)", () => {
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
    registerCardScripts([COST_OR_SCRIPT]);
    sourceId = putOnBattlefield(state, alice, card(HOST_NAME));
  });

  describe("schema — accepts the combinator", () => {
    it("accepts cost.or with two arms of different shape (mana vs life)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Or Combinator Heterogeneous (lane 99 follow-up)",
        oracle:
          "Whenever this creature attacks, you may pay {2} or pay 3 life.",
        triggers: [
          {
            text: "Whenever this creature attacks, you may pay {2} or pay 3 life.",
            event: "attacks",
            subject: "self",
            you_may: true,
            cost: {
              or: [
                { pay_mana: { amount: 2 } },
                { pay_life: { amount: 3 } },
              ],
            },
            effects: [
              { op: "Pump", power: 1, toughness: 0, target: "self" },
            ],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.or).toHaveLength(2);
      expect(parsed.triggers![0].cost?.or?.[0]).toEqual({
        pay_mana: { amount: 2 },
      });
      expect(parsed.triggers![0].cost?.or?.[1]).toEqual({
        pay_life: { amount: 3 },
      });
    });

    it("accepts cost.or with three arms of different shape (multi-arm)", () => {
      const parsed = CardScriptSchema.parse({
        name: "Test Or Combinator Three Arms (lane 99 follow-up)",
        oracle: "you may pay {2}, pay 3 life, or sacrifice this.",
        triggers: [
          {
            text: "you may pay {2}, pay 3 life, or sacrifice this.",
            event: "attacks",
            subject: "self",
            you_may: true,
            cost: {
              or: [
                { pay_mana: { amount: 2 } },
                { pay_life: { amount: 3 } },
                { sacrifice_self: true },
              ],
            },
            effects: [
              { op: "Pump", power: 1, toughness: 0, target: "self" },
            ],
          },
        ],
      });
      expect(parsed.triggers![0].cost?.or).toHaveLength(3);
    });
  });

  describe("schema — rejects the combinator", () => {
    it("rejects cost.or alongside standalone cost.pay_life (mutual exclusion)", () => {
      // The combinator is mutually exclusive with
      // the standalone `cost.<arm>` siblings —
      // either the OR shape OR a single arm, not
      // both (the engine rewrites the picked arm
      // into the standalone shape on the second
      // pass, so the dual shape is unambiguous at
      // runtime).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Or Combinator Dual (lane 99 follow-up)",
          oracle: "you may pay {2} or pay 3 life.",
          triggers: [
            {
              text: "you may pay {2} or pay 3 life.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: {
                or: [
                  { pay_mana: { amount: 2 } },
                  { pay_life: { amount: 3 } },
                ],
                pay_life: { amount: 5 },
              },
              effects: [
                { op: "Pump", power: 1, toughness: 0, target: "self" },
              ],
            },
          ],
        }),
      ).toThrow(
        /cost.or is mutually exclusive with the standalone cost arms/,
      );
    });

    it("rejects cost.or without you_may: true (yes/no gate is the precondition)", () => {
      // The combinator requires `you_may: true` —
      // the controller must consent to the trigger
      // before picking which arm to pay. A
      // combinator without the yes/no gate is a
      // degenerate shape (the controller is forced
      // to pick one of N arms without a
      // trigger-level consent step).
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Or Combinator No You May (lane 99 follow-up)",
          oracle: "you may pay {2} or pay 3 life.",
          triggers: [
            {
              text: "you may pay {2} or pay 3 life.",
              event: "attacks",
              subject: "self",
              // (no you_may)
              cost: {
                or: [
                  { pay_mana: { amount: 2 } },
                  { pay_life: { amount: 3 } },
                ],
              },
              effects: [
                { op: "Pump", power: 1, toughness: 0, target: "self" },
              ],
            },
          ],
        }),
      ).toThrow(/cost.or requires you_may: true/);
    });

    it("rejects cost.or with only one arm (the v1 minimum is 2)", () => {
      // A single-arm OR combinator is the same
      // shape as the standalone arm — the schema
      // requires `min(2)` so the drafter uses the
      // standalone `cost.<arm>` shape instead. The
      // refine rule rejects the degenerate
      // 1-arm combinator.
      expect(() =>
        CardScriptSchema.parse({
          name: "Test Or Combinator Single Arm (lane 99 follow-up)",
          oracle: "you may pay {2}.",
          triggers: [
            {
              text: "you may pay {2}.",
              event: "attacks",
              subject: "self",
              you_may: true,
              cost: {
                or: [{ pay_mana: { amount: 2 } }],
              },
              effects: [
                { op: "Pump", power: 1, toughness: 0, target: "self" },
              ],
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe("engine — OR combinator dispatch", () => {
    it("first resolve pass surfaces cost_combinator_or_prompt with one ChoiceOption per arm", () => {
      // The engine consult's first pass walks:
      //   1. The lane 60 `you_may: true` gate
      //      surfaces `you_may_prompt`.
      //   2. After the controller answers yes, the
      //      next pass walks into the OR combinator
      //      branch (the dispatch checks
      //      `cost.or` BEFORE the standalone
      //      cost arms). The OR combinator's
      //      `chosen_or_cost_index === undefined`
      //      path surfaces
      //      `cost_combinator_or_prompt` with one
      //      `ChoiceOption` per arm.
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      expect(triggers).toHaveLength(1);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0] as StackObject & {
        chosen_or_cost_index?: number;
      };
      expect(stackObject.chosen_or_cost_index).toBeUndefined();

      // First pass: lane 60 you_may_prompt.
      const r1 = resolveScriptedAbility(stacked, stackObject)!;
      expect(r1.waitingChoice!.type).toBe("you_may_prompt");
      const accepted = resolveWaitingChoice(r1, alice, true);
      const stampedYouMay = accepted.state.stack.find(
        (s) => s.id === stackObject.id,
      )!;

      // Second pass: OR combinator's
      // cost_combinator_or_prompt.
      const r2 = resolveScriptedAbility(accepted.state, stampedYouMay)!;
      expect(r2.waitingChoice).not.toBeNull();
      expect(r2.waitingChoice!.type).toBe("cost_combinator_or_prompt");
      expect(r2.waitingChoice!.choices).toHaveLength(2);
      expect(r2.waitingChoice!.choices[0].value).toBe(0);
      expect(r2.waitingChoice!.choices[1].value).toBe(1);
      // Labels describe the arm's cost shape.
      expect(r2.waitingChoice!.choices[0].label).toMatch(/mana/);
      expect(r2.waitingChoice!.choices[1].label).toMatch(/life/);
    });

    it("picking the first arm (mana): stamps chosen_or_cost_index=0; second pass runs pay_mana_prompt", () => {
      // Pick the mana arm (index 0). The resolver
      // stamps `chosen_or_cost_index = 0` and the
      // engine rewrites the picked arm into the
      // standalone `cost.pay_mana` shape so the
      // existing lane 117 dispatch picks it up on
      // the next pass.
      state = addMana(state, alice, { generic: 5 });
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0];

      // Walk: you_may_prompt (yes) → cost_combinator_or_prompt (pick 0).
      const r1 = resolveScriptedAbility(stacked, stackObject)!;
      const r1yes = resolveWaitingChoice(r1, alice, true);
      const stamped1 = r1yes.state.stack.find((s) => s.id === stackObject.id)!;
      const r2 = resolveScriptedAbility(r1yes.state, stamped1)!;
      expect(r2.waitingChoice!.type).toBe("cost_combinator_or_prompt");
      const r2pick = resolveWaitingChoice(r2, alice, 0);
      const stamped2 = r2pick.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { chosen_or_cost_index?: number };
      expect(stamped2.chosen_or_cost_index).toBe(0);

      // Third pass: the OR combinator rewrote
      // `ability.cost` to `{ pay_mana: { amount: 2
      // } }` so the lane 117 dispatch surfaces
      // `pay_mana_prompt`.
      const r3 = resolveScriptedAbility(r2pick.state, stamped2)!;
      expect(r3.waitingChoice).not.toBeNull();
      expect(r3.waitingChoice!.type).toBe("pay_mana_prompt");

      // Yes on pay_mana → cost_paid: true → mana
      // deduction + effects.
      const r3yes = resolveWaitingChoice(r3, alice, true);
      const stamped3 = r3yes.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { cost_paid?: boolean };
      expect(stamped3.cost_paid).toBe(true);
      const r4 = resolveScriptedAbility(r3yes.state, stamped3)!;
      // Mana pool: 5 generic → 3 generic after the
      // spend (pay 2).
      expect(r4.players.get(alice)!.manaPool.generic).toBe(3);
    });

    it("picking the second arm (life): stamps chosen_or_cost_index=1; second pass runs pay_life_prompt", () => {
      // Pick the life arm (index 1). The resolver
      // stamps `chosen_or_cost_index = 1` and the
      // engine rewrites the picked arm into the
      // standalone `cost.pay_life` shape so the
      // existing lane 106 dispatch picks it up on
      // the next pass.
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0];

      const lifeBefore = state.players.get(alice)!.life;

      const r1 = resolveScriptedAbility(stacked, stackObject)!;
      const r1yes = resolveWaitingChoice(r1, alice, true);
      const stamped1 = r1yes.state.stack.find((s) => s.id === stackObject.id)!;
      const r2 = resolveScriptedAbility(r1yes.state, stamped1)!;
      expect(r2.waitingChoice!.type).toBe("cost_combinator_or_prompt");
      // Pick index 1 (life arm).
      const r2pick = resolveWaitingChoice(r2, alice, 1);
      const stamped2 = r2pick.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { chosen_or_cost_index?: number };
      expect(stamped2.chosen_or_cost_index).toBe(1);

      // Third pass: the OR combinator rewrote
      // `ability.cost` to `{ pay_life: { amount: 3
      // } }` so the lane 106 dispatch surfaces
      // `pay_life_prompt`.
      const r3 = resolveScriptedAbility(r2pick.state, stamped2)!;
      expect(r3.waitingChoice).not.toBeNull();
      expect(r3.waitingChoice!.type).toBe("pay_life_prompt");

      // Yes on pay_life → cost_paid: true → life
      // loss + effects.
      const r3yes = resolveWaitingChoice(r3, alice, true);
      const stamped3 = r3yes.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { cost_paid?: boolean };
      expect(stamped3.cost_paid).toBe(true);
      const r4 = resolveScriptedAbility(r3yes.state, stamped3)!;
      // Life loss: 20 → 17 (pay 3).
      expect(r4.players.get(alice)!.life).toBe(lifeBefore - 3);
    });

    it("chosen_or_cost_index is undefined on the first pass (before the choice resolves)", () => {
      // On the first resolve pass through the OR
      // combinator branch, the stack object's
      // `chosen_or_cost_index` field is undefined
      // — the resolver stamps it only when the
      // controller answers the
      // `cost_combinator_or_prompt`.
      const detected = detectTriggeredAbilities(state, "attacked");
      const triggers = detected.filter((t) => t.sourceCardId === sourceId);
      const { state: stacked } = putTriggersOnStack(state, triggers);
      const stackObject = stacked.stack[0] as StackObject & {
        chosen_or_cost_index?: number;
      };
      expect(stackObject.chosen_or_cost_index).toBeUndefined();

      // Walk through the lane 60 you_may_prompt
      // and into the OR combinator. The first
      // pass through the OR branch (with
      // `chosen_or_cost_index === undefined`)
      // surfaces the `cost_combinator_or_prompt`.
      const r1 = resolveScriptedAbility(stacked, stackObject)!;
      const r1yes = resolveWaitingChoice(r1, alice, true);
      const stamped1 = r1yes.state.stack.find(
        (s) => s.id === stackObject.id,
      )! as StackObject & { chosen_or_cost_index?: number };
      // Still undefined — the lane 60 prompt
      // didn't stamp the OR index.
      expect(stamped1.chosen_or_cost_index).toBeUndefined();

      const r2 = resolveScriptedAbility(r1yes.state, stamped1)!;
      expect(r2.waitingChoice!.type).toBe("cost_combinator_or_prompt");
    });
  });
});