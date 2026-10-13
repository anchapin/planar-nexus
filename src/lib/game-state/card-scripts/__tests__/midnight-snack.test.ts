/**
 * Midnight Snack (FDN 65): raid + end-of-turn CreatePredefinedToken Food.
 *
 * Lane 82 of the Wave 4.8 follow-up 11 loop. Midnight Snack's oracle:
 * "Raid — At the beginning of your end step, if you attacked this turn,
 * create a Food token." The trigger template is the same as Skyship
 * Buccaneer's raid + phaseEnds + intervening_if pattern (#2594 lane 29),
 * with `CreatePredefinedToken: "food"` in place of `PutCounters`. No
 * schema or engine change — both substrates are shipped.
 */
import {
  getCardScript,
  resolveScriptedAbility,
} from "../index";
import { detectTriggeredAbilities } from "../../abilities/triggered";
import { putTriggersOnStack } from "../../trigger-system/stack-ops";
import { getScriptedTriggeredAbilities } from "../../abilities/parse";
import { evaluateInterveningIfClause } from "../../abilities/evaluate";
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

function card(name: string, typeLine: string, pt?: [number, number]) {
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
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
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

describe("Midnight Snack (FDN 65): raid + end-of-turn Food token (#2614 lane 82)", () => {
  it("registry exposes Midnight Snack with the raid phaseEnds trigger", () => {
    const snack = getCardScript("Midnight Snack");
    expect(snack).toBeDefined();
    const trig = snack!.triggers![0];
    expect(trig.event).toBe("phaseEnds");
    expect(trig.intervening_if).toBe("you attacked this turn");
    expect(trig.effects).toEqual([
      { op: "CreatePredefinedToken", token: "food", count: 1 },
    ]);
  });

  it("forwards the raid intervening_if to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Midnight Snack",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("you attacked this turn");
  });

  it("evaluator returns false when the controller has not attacked", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();
    expect(
      evaluateInterveningIfClause("you attacked this turn", state, p1),
    ).toBe(false);
  });

  it("evaluator returns true after markAttackedThisTurn flips the flag", () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    const attacked = markAttackedThisTurn(state, [p1]);
    expect(attacked.players.get(p1)?.attackedThisTurn).toBe(true);
    expect(
      evaluateInterveningIfClause("you attacked this turn", attacked, p1),
    ).toBe(true);
  });

  it("end-of-turn trigger is suppressed when the controller has not attacked", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "snack",
      card("Midnight Snack", "Enchantment"),
    );
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    expect(snackTriggers).toHaveLength(0);
  });

  it("end-of-turn trigger fires after the controller attacks, and resolves into a Food token", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(
      state,
      p1,
      "snack",
      card("Midnight Snack", "Enchantment"),
    );
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "endOfTurn");
    const snackTriggers = triggers.filter(
      (t) => t.sourceCardId === id("snack"),
    );
    expect(snackTriggers).toHaveLength(1);

    const { state: stacked, triggeredAbilities } = putTriggersOnStack(
      state,
      snackTriggers,
    );
    expect(triggeredAbilities).toHaveLength(1);
    expect(stacked.stack).toHaveLength(1);

    const stackObject = stacked.stack[0];
    const beforeFoods = countFoodTokens(stacked, p1);
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterFoods = countFoodTokens(resolved, p1);
    expect(afterFoods).toBe(beforeFoods + 1);
  });
});

/**
 * Count Food tokens (defined as artifacts named "Food") on the given
 * player's side of the battlefield. The CreatePredefinedToken substrate
 * creates the token under `state.cards` keyed by player; we look up by
 * `cardData.name` across the whole battlefields and filter by controller.
 */
function countFoodTokens(
  state: ReturnType<typeof startGame>,
  playerId: string,
): number {
  let n = 0;
  for (const [, cardInstance] of state.cards) {
    if (cardInstance.controllerId !== playerId) continue;
    if (cardInstance.cardData?.name !== "Food") continue;
    n += 1;
  }
  return n;
}