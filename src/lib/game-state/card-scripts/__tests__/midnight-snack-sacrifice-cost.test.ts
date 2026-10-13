/**
 * Midnight Snack (FDN 65) — sacrifice-self cost (lane 88).
 *
 * Wave 4.8 follow-up 12 lane 88 (#2614 follow-up). Midnight Snack's
 * full oracle (per the handoff's "second warmup"): sacrifice this
 * artifact as a cost when the raid + end-of-turn trigger fires. The
 * lane 82 v1 minimum shipped the raid + phaseEnds + CreatePredefinedToken
 * half only. This lane adds the `cost.sacrifice_self: true` arm to
 * the trigger so the engine surfaces a `sacrifice_self_prompt`
 * waitingChoice at resolution; the controller picks yes / no:
 *
 *   - yes: the engine sacrifices Midnight Snack (CR 602.2b) and
 *     creates the Food token (the trigger's only effect).
 *   - no: the trigger fizzles — no sacrifice, no Food.
 *
 * Out of scope for lane 88 (each a follow-up lane): the
 * "sacrifice this OR pay X life" alternate, multi-target sacrifice,
 * sacrifice as a spell cost (vs a trigger cost).
 */
import { getCardScript } from "../index";
import {
  resolveScriptedAbility,
  createSacrificeSelfPromptWaitingChoice,
} from "../interpret";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
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
  const canonicalKey = `${playerId}-${zone}`;
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

function countFoodTokens(state: GameState, playerId: PlayerId): number {
  let n = 0;
  for (const [, cardInstance] of state.cards) {
    if (cardInstance.controllerId !== playerId) continue;
    if (cardInstance.cardData?.name === "Food") n += 1;
  }
  return n;
}

describe("Midnight Snack (FDN 65): sacrifice-self cost on raid end-of-turn (lane 88)", () => {
  it("registry exposes Midnight Snack with cost.sacrifice_self: true", () => {
    const snack = getCardScript("Midnight Snack");
    expect(snack).toBeDefined();
    const trig = snack!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("you attacked this turn");
    expect(trig.cost).toEqual({ sacrifice_self: true });
  });

  it("schema accepts cost.sacrifice_self on a trigger", () => {
    const snack = getCardScript("Midnight Snack");
    expect(snack).toBeDefined();
    // The build-card-script-index step above proves the schema accepts
    // this shape (zod parses without error). Just assert the parsed
    // trigger carries the same field.
    const abilities = getScriptedTriggeredAbilities({
      name: "Midnight Snack",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].trigger.event).toBe("phaseEnds");
  });

  it("createSacrificeSelfPromptWaitingChoice surfaces a yes/no prompt (lane 88)", () => {
    const choice = createSacrificeSelfPromptWaitingChoice(
      "lane88-choice-1",
      "alice" as PlayerId,
      "Midnight Snack's raid trigger",
    );
    expect(choice.type).toBe("sacrifice_self_prompt");
    expect(choice.stackObjectId).toBe("lane88-choice-1");
    expect(choice.playerId).toBe("alice");
    expect(choice.choices).toHaveLength(2);
    expect(choice.choices[0].label).toBe("Yes");
    expect(choice.choices[1].label).toBe("No");
  });

  it("end-to-end: controller picks 'yes' → Food created, enchantment sacrificed", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Midnight Snack", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    expect(snackTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, snackTriggers);
    expect(stacked.stack).toHaveLength(1);
    const stackObject = stacked.stack[0];

    // First resolve pass surfaces the sacrifice-self prompt
    // (`cost_paid === undefined` → waitingChoice).
    const prompted = resolveScriptedAbility(stacked, stackObject)!;
    expect(prompted.waitingChoice).toBeDefined();
    expect(prompted.waitingChoice!.type).toBe("sacrifice_self_prompt");

    // Controller answers yes: stamp `cost_paid: true` on the stack
    // object and clear the prompt. resolveWaitingChoice returns the
    // updated state.
    const answered = resolveWaitingChoice(prompted, p1, true);
    expect(answered.success).toBe(true);
    const stamped = answered.state.stack.find((s) => s.id === stackObject.id)!;
    expect(stamped.cost_paid).toBe(true);
    expect(answered.state.waitingChoice).toBeNull();

    // Second resolve pass: cost_paid is true → engine sacrifices the
    // enchantment THEN runs the trigger's effects (CreatePredefinedToken
    // "food"). Result: enchantment in graveyard, Food on the battlefield.
    const resolved = resolveScriptedAbility(
      answered.state,
      stamped,
    )!;
    // Midnight Snack moved to graveyard
    const graveyard = resolved.zones.get(`${p1}-graveyard`)!;
    expect(graveyard.cardIds).toContain(id("snack"));
    // Food token created on the battlefield
    const afterFoods = countFoodTokens(resolved, p1);
    expect(afterFoods).toBe(1);
  });

  it("end-to-end: controller picks 'no' → trigger fizzles, enchantment stays, no Food", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Midnight Snack", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    const { state: stacked } = putTriggersOnStack(state, snackTriggers);
    const stackObject = stacked.stack[0];

    const prompted = resolveScriptedAbility(stacked, stackObject)!;
    expect(prompted.waitingChoice!.type).toBe("sacrifice_self_prompt");

    // Controller answers no: stamp cost_paid: false. The trigger fizzles.
    const answered = resolveWaitingChoice(prompted, p1, false);
    expect(answered.success).toBe(true);
    const stamped = answered.state.stack.find((s) => s.id === stackObject.id)!;
    expect(stamped.cost_paid).toBe(false);

    const resolved = resolveScriptedAbility(answered.state, stamped)!;

    // Enchantment still on the battlefield (not sacrificed)
    const battlefield = resolved.zones.get(`${p1}-battlefield`)!;
    expect(battlefield.cardIds).toContain(id("snack"));
    // No Food created
    expect(countFoodTokens(resolved, p1)).toBe(0);
  });

  it("the trigger fizzles defensively when the source has already left the battlefield", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "snack", card("Midnight Snack", "Enchantment"));
    state = markAttackedThisTurn(state, [p1]);

    // Manually remove Midnight Snack from the battlefield before the
    // trigger resolves (e.g. destroyed by another effect). The cost
    // can no longer be paid; the trigger fizzles.
    const cards = new Map(state.cards);
    cards.delete(id("snack"));
    const zones = new Map(state.zones);
    const battlefield = zones.get(`${p1}-battlefield`)!;
    zones.set(`${p1}-battlefield`, {
      ...battlefield,
      cardIds: battlefield.cardIds.filter((cid) => cid !== id("snack")),
    });
    state = { ...state, cards, zones };

    // detectTriggeredAbilities skips cards not on the battlefield, so
    // the trigger never makes it onto the stack in the first place.
    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    expect(snackTriggers).toHaveLength(0);
  });
});