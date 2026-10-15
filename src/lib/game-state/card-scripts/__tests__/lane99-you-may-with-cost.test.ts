/**
 * Wave 4.8 follow-up 20 lane 99 (#2614 follow-up,
 * follow-up 20 piece 2): the "you may + cost.pay_life
 * (or cost.pay_mana)" combined arm — the bridge
 * between the lane 60 `you_may` yes/no gate and
 * the lane 106 / 117 trigger-cost substrate.
 *
 * Per the follow-up 20 handoff's lane 99 note, the
 * engine consult "already orchestrates the yes/no
 * flow" (lane 60 surfaces the `you_may_prompt`; on
 * yes, the cost arms run). This test pins the
 * actual orchestration — the schema accepts the
 * combination (no exclusion), the engine surfaces
 * the lane 60 `you_may_prompt` on the first resolve
 * pass, and on yes the lane 106 / 117 substrate
 * runs its own prompt (`pay_life_prompt` /
 * `pay_mana_prompt`) before applying the cost and
 * the effects.
 *
 * The card is the synthetic `You May Cost Pay
 * Life` — a parallel to the lane 93 Skyship
 * Buccaneer but using `cost.pay_life` ALONGSIDE
 * `you_may: true` rather than the
 * `you_may_cost.pay_life` compact form (the
 * "combined arm" shape the handoff flagged). The
 * behavior under the bridge is: the controller
 * gets TWO prompts (lane 60 first, then lane 106),
 * each independently yes/no — the yes on the lane
 * 60 prompt authorizes the trigger to proceed,
 * and the yes on the lane 106 prompt authorizes
 * the life loss.
 *
 * Out of scope for lane 99 (each a follow-up lane):
 * - the "you may pay N OR pay M; if you do, ..."
 *   multi-cost combinator (lane 99 follow-up
 *   extension).
 * - the lane 117 `cost.pay_mana` parallel — same
 *   consult shape as `cost.pay_life`; only
 *   `pay_life` is exercised here.
 */
import { getCardScript } from "../index";
import { CardScriptSchema } from "../schema";
import { resolveScriptedAbility } from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { resolveWaitingChoice } from "../../spell-casting/choices";
import { createCardInstance } from "../../card-instance";
import {
  createInitialGameState,
  startGame,
} from "../../game-state";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../../types";

const id = (s: string) => s as CardInstanceId;

function card(name: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Enchantment",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const canonicalKey = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: canonicalKey,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(canonicalKey);
  if (!z) return state;
  zones.set(canonicalKey, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  return startGame(base);
}

describe("Lane 99 (follow-up 20 piece 2): 'you may' + 'cost.pay_life' combined arm", () => {
  it("registry exposes You May Cost Pay Life with you_may: true + cost.pay_life", () => {
    const c = getCardScript("You May Cost Pay Life");
    expect(c).toBeDefined();
    const t = c!.triggers![0];
    expect(t.you_may).toBe(true);
    expect(t.cost?.pay_life).toEqual({ amount: 2 });
    // The trigger has no `you_may_cost` arm — the
    // bridge is the side-by-side `you_may: true` +
    // `cost.pay_life` (per the handoff's lane 99
    // note).
    expect(t.you_may_cost).toBeUndefined();
  });

  it("schema accepts you_may: true + cost.pay_life on the same trigger (no exclusion)", () => {
    // The schema's refine rules reject
    // `you_may_cost + cost.sacrifice_self` (a
    // different overlap), but
    // `you_may + cost.pay_life` is NOT in any
    // exclusion list — the combination is valid
    // by design (the lane 60 yes/no gate and
    // the lane 106 cost arm are orthogonal
    // shapes, even when both ride on the same
    // trigger).
    const r = CardScriptSchema.safeParse({
      name: "Test Bridge Card",
      oracle: "test",
      triggers: [
        {
          text: "test",
          event: "upkeep",
          subject: "self",
          you_may: true,
          cost: { pay_life: { amount: 2 } },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("first resolve pass surfaces the lane 60 you_may_prompt (yes/no on the trigger)", () => {
    // Set up: enchantment on the battlefield
    // owned by p1 (the controller). At upkeep
    // the trigger fires; the engine consult
    // surfaces a `you_may_prompt` first (the
    // lane 60 gate), suspending resolution
    // until the controller answers yes/no.
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "src", card("You May Cost Pay Life"));

    const detected = detectTriggeredAbilities(state, "upkeep");
    const triggers = detected.filter((t) => t.sourceCardId === id("src"));
    expect(triggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, triggers);
    const obj = stacked.stack[0];

    const prompted = resolveScriptedAbility(stacked, obj)!;
    expect(prompted.waitingChoice).toBeDefined();
    expect(prompted.waitingChoice!.type).toBe("you_may_prompt");
  });

  it("end-to-end: yes on you_may → second pass surfaces pay_life_prompt → yes on pay_life → life loss + draw applied", () => {
    // The full consult path for the combined
    // arm:
    //   1. Lane 60: `you_may_prompt` (yes/no on
    //      the trigger). On yes → continue.
    //   2. Lane 106: `pay_life_prompt` (yes/no
    //      on paying the life cost). On yes →
    //      `loseLife` runs, then effects.
    // The two prompts are surfaced in sequence;
    // each is yes/no independently. This is the
    // engine consult's existing orchestration.
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "src", card("You May Cost Pay Life"));

    const lifeBefore = state.players.get(p1)!.life;
    const libraryBefore = state.zones.get(`${p1}-library`)!.cardIds.length;

    const detected = detectTriggeredAbilities(state, "upkeep");
    const triggers = detected.filter((t) => t.sourceCardId === id("src"));
    const { state: stacked } = putTriggersOnStack(state, triggers);
    const obj = stacked.stack[0];

    // First resolve pass: lane 60 you_may_prompt.
    const r1 = resolveScriptedAbility(stacked, obj)!;
    expect(r1.waitingChoice!.type).toBe("you_may_prompt");
    // Controller answers yes on the lane 60 prompt.
    const r1yes = resolveWaitingChoice(r1, p1, true);
    expect(r1yes.success).toBe(true);
    const stamped1 = r1yes.state.stack.find((s) => s.id === obj.id)!;
    expect(stamped1.you_may_resolved).toBe(true);

    // Second resolve pass: lane 106 pay_life_prompt.
    const r2 = resolveScriptedAbility(r1yes.state, stamped1)!;
    expect(r2.waitingChoice).toBeDefined();
    expect(r2.waitingChoice!.type).toBe("pay_life_prompt");
    // Controller answers yes on the lane 106 prompt.
    const r2yes = resolveWaitingChoice(r2, p1, true);
    expect(r2yes.success).toBe(true);
    const stamped2 = r2yes.state.stack.find((s) => s.id === obj.id)!;

    // Third resolve pass: cost_paid === true →
    // `loseLife` runs (pay 2) + the effects
    // loop applies the Draw op.
    const r3 = resolveScriptedAbility(r2yes.state, stamped2)!;
    expect(r3.players.get(p1)!.life).toBe(lifeBefore - 2);
    expect(r3.zones.get(`${p1}-library`)!.cardIds.length).toBe(libraryBefore - 1);
  });

  it("end-to-end: yes on you_may, NO on pay_life → no life loss, no draw", () => {
    // The lane 60 yes authorizes the trigger
    // to proceed; the lane 106 NO fizzes the
    // cost (CR 602.2b). The trigger's effects
    // do NOT apply on cost-decline (the cost
    // is part of the trigger's resolution).
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "src", card("You May Cost Pay Life"));

    const lifeBefore = state.players.get(p1)!.life;
    const libraryBefore = state.zones.get(`${p1}-library`)!.cardIds.length;

    const detected = detectTriggeredAbilities(state, "upkeep");
    const triggers = detected.filter((t) => t.sourceCardId === id("src"));
    const { state: stacked } = putTriggersOnStack(state, triggers);
    const obj = stacked.stack[0];

    const r1 = resolveScriptedAbility(stacked, obj)!;
    const r1yes = resolveWaitingChoice(r1, p1, true);
    const stamped1 = r1yes.state.stack.find((s) => s.id === obj.id)!;

    const r2 = resolveScriptedAbility(r1yes.state, stamped1)!;
    expect(r2.waitingChoice!.type).toBe("pay_life_prompt");
    // Decline the cost.
    const r2no = resolveWaitingChoice(r2, p1, false);
    expect(r2no.success).toBe(true);
    const stamped2 = r2no.state.stack.find((s) => s.id === obj.id)!;

    // Third pass: cost_paid === false → trigger
    // fizzles (no life loss, no draw).
    const r3 = resolveScriptedAbility(r2no.state, stamped2)!;
    expect(r3.players.get(p1)!.life).toBe(lifeBefore);
    expect(r3.zones.get(`${p1}-library`)!.cardIds.length).toBe(libraryBefore);
  });
});
