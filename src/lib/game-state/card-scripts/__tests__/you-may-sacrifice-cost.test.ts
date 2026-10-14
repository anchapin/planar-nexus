/**
 * "You may" + sacrifice-cost combination (lane 99).
 *
 * Wave 4.8 follow-up 13 lane 99 (#2614 follow-up). The
 * Skyship-Buccaneer-style "you may sacrifice self; if
 * you do, [effects]" pattern — combining the lane 60
 * `you_may` yes/no gate with the lane 88
 * `cost.sacrifice_self` arm. The trigger carries BOTH
 * `you_may: true` AND `cost.sacrifice_self: true`:
 *
 *   - yes → sacrifice the source → run the effects
 *   - no → trigger fizzles (no sacrifice, no effects)
 *
 * The engine already supports both arms in isolation
 * (lanes 60 and 88 shipped them). Lane 99 wires them
 * together: the lane 60 gate runs FIRST (the
 * `you_may_resolved === undefined` path surfaces the
 * yes/no prompt), the lane 88 cost chain runs AFTER
 * (the `cost_paid === undefined` path surfaces the
 * sacrifice-self prompt only when `you_may_resolved
 * === true`). The two gates don't fight — they're
 * resolved sequentially by the
 * `resolveScriptedAbility` re-entry pattern (one
 * resolve pass per gate).
 *
 * The sample card (`snack_with_you_may.json`) is a
 * synthetic "you may sacrifice this artifact; if you
 * do, create a Food token" trigger (Midnight Snack's
 * raid+phaseEnds arm, extended with `you_may: true`).
 *
 * Out of scope for lane 99 (each a follow-up lane):
 * - the `you_may_cost.discard` arm (lane 98 covers
 *   `cost.discard` directly; the
 *   `you_may_cost.discard` variant rides a follow-up)
 * - the "if you do, [alt effects]" alternate (lane 99
 *   is just the yes/no gate; effects only run on yes)
 * - "you may pay X mana; if you do, ..." alternates
 */
import { getCardScript } from "../index";
import {
  resolveScriptedAbility,
  createSacrificeSelfPromptWaitingChoice,
  createYouMayPromptWaitingChoice,
} from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { resolveWaitingChoice } from "../../spell-casting/choices";
import { markAttackedThisTurn } from "../../keyword-actions/raid";
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

function card(name: string, typeLine: string) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
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
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function startTwoPlayerState(): GameState {
  const base = createInitialGameState(["Player1", "Player2"], 20, false);
  return startGame(base);
}

describe("Snack with You May (lane 99): you_may + sacrifice_self chained gates", () => {
  it("schema accepts the you_may: true + cost.sacrifice_self: true combination (lane 99)", () => {
    // The schema doesn't currently reject this combination
    // — the mutual-exclusion refine only forbids
    // `you_may_cost` + `cost.sacrifice_self` (lane 93's
    // substrate) and `cost.sacrifice_self` + `modes`
    // (lane 88). The `you_may: true` + `cost.sacrifice_self:
    // true` shape is the lane 99 v1 substrate.
    const snack = getCardScript("Snack with You May");
    expect(snack).toBeDefined();
    const trig = snack!.triggers![0];
    expect(trig.you_may).toBe(true);
    expect(trig.cost).toEqual({ sacrifice_self: true });
    expect(trig.you_may_cost).toBeUndefined(); // lane 93 substrate, NOT used here
  });

  it("end-to-end: controller picks 'yes' to you_may, then 'yes' to sacrifice → trigger fires, food token created", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Snack with You May", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    expect(snackTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, snackTriggers);
    const stackObject = stacked.stack[0];

    // First resolve pass: lane 60 `you_may` gate
    // surfaces the you_may_prompt (you_may_resolved is
    // still undefined).
    const prompted1 = resolveScriptedAbility(stacked, stackObject)!;
    expect(prompted1.waitingChoice).toBeDefined();
    expect(prompted1.waitingChoice!.type).toBe("you_may_prompt");

    // Controller picks yes.
    const answered1 = resolveWaitingChoice(prompted1, p1, true);
    expect(answered1.success).toBe(true);
    const stamped1 = answered1.state.stack.find(
      (s) => s.id === stackObject.id,
    )!;
    expect(stamped1.you_may_resolved).toBe(true);

    // Second resolve pass: lane 60 gate falls
    // through (you_may_resolved is true). Lane 88
    // cost block runs (cost_paid is undefined) —
    // surfaces the sacrifice_self_prompt.
    const prompted2 = resolveScriptedAbility(answered1.state, stamped1)!;
    expect(prompted2.waitingChoice).toBeDefined();
    expect(prompted2.waitingChoice!.type).toBe("sacrifice_self_prompt");

    // Controller picks yes.
    const answered2 = resolveWaitingChoice(prompted2, p1, true);
    expect(answered2.success).toBe(true);
    const stamped2 = answered2.state.stack.find(
      (s) => s.id === stackObject.id,
    )!;
    expect(stamped2.cost_paid).toBe(true);

    // Third resolve pass: both gates have resolved.
    // The lane 88 cost block runs (sacrifices the
    // source) and the effects loop applies (creates
    // the Food token).
    const resolved = resolveScriptedAbility(answered2.state, stamped2)!;
    // Source is in graveyard (sacrificed).
    expect(resolved.zones.get(`${p1}-graveyard`)!.cardIds).toContain(id("snack"));
    // Food token created on p1's battlefield.
    let foodCount = 0;
    for (const [, ci] of resolved.cards) {
      if (ci.controllerId !== p1) continue;
      if (ci.cardData?.name === "Food") foodCount += 1;
    }
    expect(foodCount).toBe(1);
  });

  it("end-to-end: controller declines you_may → trigger fizzles (no sacrifice, no food)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Snack with You May", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    const { state: stacked } = putTriggersOnStack(state, snackTriggers);
    const stackObject = stacked.stack[0];

    const prompted = resolveScriptedAbility(stacked, stackObject)!;
    expect(prompted.waitingChoice!.type).toBe("you_may_prompt");

    // Controller declines.
    const answered = resolveWaitingChoice(prompted, p1, false);
    expect(answered.success).toBe(true);
    const stamped = answered.state.stack.find(
      (s) => s.id === stackObject.id,
    )!;
    expect(stamped.you_may_resolved).toBe(false);

    // Second resolve pass: lane 60 gate short-
    // circuits (you_may_resolved === false → trigger
    // does nothing). Lane 88 block doesn't run.
    const resolved = resolveScriptedAbility(answered.state, stamped)!;
    // Source stays on the battlefield (NOT sacrificed).
    expect(resolved.zones.get(`${p1}-battlefield`)!.cardIds).toContain(id("snack"));
    // No Food token created.
    let foodCount = 0;
    for (const [, ci] of resolved.cards) {
      if (ci.controllerId !== p1) continue;
      if (ci.cardData?.name === "Food") foodCount += 1;
    }
    expect(foodCount).toBe(0);
  });

  it("end-to-end: controller says yes to you_may, then no to sacrifice → trigger fizzles (sacrifice path declined)", () => {
    let state = startTwoPlayerState();
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Snack with You May", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    const { state: stacked } = putTriggersOnStack(state, snackTriggers);
    const stackObject = stacked.stack[0];

    // First pass: you_may_prompt.
    const prompted1 = resolveScriptedAbility(stacked, stackObject)!;
    expect(prompted1.waitingChoice!.type).toBe("you_may_prompt");
    // Yes to you_may.
    const answered1 = resolveWaitingChoice(prompted1, p1, true);
    const stamped1 = answered1.state.stack.find(
      (s) => s.id === stackObject.id,
    )!;
    expect(stamped1.you_may_resolved).toBe(true);

    // Second pass: sacrifice_self_prompt.
    const prompted2 = resolveScriptedAbility(answered1.state, stamped1)!;
    expect(prompted2.waitingChoice!.type).toBe("sacrifice_self_prompt");
    // No to sacrifice.
    const answered2 = resolveWaitingChoice(prompted2, p1, false);
    expect(answered2.success).toBe(true);
    const stamped2 = answered2.state.stack.find(
      (s) => s.id === stackObject.id,
    )!;
    expect(stamped2.cost_paid).toBe(false);

    // Third resolve pass: lane 88 block short-
    // circuits (cost_paid === false → trigger does
    // nothing). Source NOT sacrificed, no food
    // created.
    const resolved = resolveScriptedAbility(answered2.state, stamped2)!;
    expect(resolved.zones.get(`${p1}-battlefield`)!.cardIds).toContain(id("snack"));
    let foodCount = 0;
    for (const [, ci] of resolved.cards) {
      if (ci.controllerId !== p1) continue;
      if (ci.cardData?.name === "Food") foodCount += 1;
    }
    expect(foodCount).toBe(0);
  });

  it("createYouMayPromptWaitingChoice and createSacrificeSelfPromptWaitingChoice coexist (lane 99 dual-prompt)", () => {
    // The two prompt factories return distinct
    // WaitingChoice types. `resolveWaitingChoice`
    // dispatches on the type field — lane 99's
    // sequential-prompt pattern exercises the type
    // discrimination.
    const youMay = createYouMayPromptWaitingChoice(
      "lane99-1",
      "alice" as PlayerId,
      "Snack with You May's end-of-turn trigger",
    );
    expect(youMay.type).toBe("you_may_prompt");
    const sacrifice = createSacrificeSelfPromptWaitingChoice(
      "lane99-2",
      "alice" as PlayerId,
      "Snack with You May's end-of-turn trigger",
    );
    expect(sacrifice.type).toBe("sacrifice_self_prompt");
  });
});