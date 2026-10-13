/**
 * Gorehorn Raider (FDN 89) + Storm Fleet Spy (FDN 515): raid + ETB.
 *
 * Lane 84 of the Wave 4.8 follow-up 11 loop. Both cards share the
 * raid + ETB + intervening_if trigger template; the effects exercise
 * DealDamage (Gorehorn Raider) and Draw (Storm Fleet Spy). All
 * substrates shipped — the test exercises the same end-to-end
 * resolution path as Midnight Snack / Skyship Buccaneer.
 *
 * Note: Storm Fleet Spy's FDN printing is ETB, not attack-triggered
 * (the handoff's prose misread the card). The plumbing for ETB +
 * raid is the same as the existing lane 29 / lane 82 work.
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
  Target,
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

describe("Gorehorn Raider (FDN 89): raid + ETB DealDamage any target", () => {
  it("registry exposes Gorehorn Raider with the raid ETB trigger", () => {
    const raider = getCardScript("Gorehorn Raider");
    expect(raider).toBeDefined();
    const trig = raider!.triggers![0];
    expect(trig.event).toBe("etb");
    expect(trig.intervening_if).toBe("you attacked this turn");
    expect(trig.effects).toEqual([
      { op: "DealDamage", amount: 2, target: "any" },
    ]);
  });

  it("forwards the raid intervening_if to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Gorehorn Raider",
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

  it("ETB trigger fires when the controller has attacked and resolves 2 damage to the target", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "raider", card("Gorehorn Raider", "Creature — Minotaur Pirate", [3, 3]));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const raiderTriggers = triggers.filter(
      (t) => t.sourceCardId === id("raider"),
    );
    expect(raiderTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, raiderTriggers);
    const stackObject = stacked.stack[0];
    // Stamp a player-target so DealDamage resolves to p2.
    const [p2id, p2name] = [p2, "Player2"];
    const targeted = {
      ...stacked,
      stack: [
        {
          ...stackObject,
          targets: [
            {
              type: "player",
              targetId: p2id,
              isValid: true,
            } as Target,
          ],
        },
      ],
    };
    const beforeLife = targeted.players.get(p2id)!.life;
    const resolved = resolveScriptedAbility(
      targeted,
      targeted.stack[0],
    )!;
    const afterLife = resolved.players.get(p2id)!.life;
    expect(afterLife).toBe(beforeLife - 2);
    // Sanity: p2 didn't change identity.
    expect(p2name).toBe("Player2");
  });
});

describe("Storm Fleet Spy (FDN 515): raid + ETB Draw", () => {
  it("registry exposes Storm Fleet Spy with the raid ETB trigger", () => {
    const spy = getCardScript("Storm Fleet Spy");
    expect(spy).toBeDefined();
    const trig = spy!.triggers![0];
    expect(trig.event).toBe("etb");
    expect(trig.intervening_if).toBe("you attacked this turn");
    expect(trig.effects).toEqual([
      { op: "Draw", amount: 1, who: "you" },
    ]);
  });

  it("forwards the raid intervening_if to the parsed ability", () => {
    const abilities = getScriptedTriggeredAbilities({
      name: "Storm Fleet Spy",
    } as unknown as Parameters<typeof getScriptedTriggeredAbilities>[0]);
    expect(abilities).toBeDefined();
    expect(abilities![0].interveningIf).toBe("you attacked this turn");
  });

  it("ETB trigger is suppressed when the controller has not attacked", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "spy", card("Storm Fleet Spy", "Creature — Human Pirate", [2, 2]));
    expect(state.players.get(p1)?.attackedThisTurn).toBeFalsy();

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const spyTriggers = triggers.filter((t) => t.sourceCardId === id("spy"));
    expect(spyTriggers).toHaveLength(0);
  });

  it("ETB trigger fires when the controller has attacked and resolves into 1 drawn card", () => {
    let state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    const [p1] = Array.from(state.players.keys());
    state = put(state, p1, "spy", card("Storm Fleet Spy", "Creature — Human Pirate", [2, 2]));
    state = markAttackedThisTurn(state, [p1]);

    const triggers = detectTriggeredAbilities(state, "entersBattlefield");
    const spyTriggers = triggers.filter((t) => t.sourceCardId === id("spy"));
    expect(spyTriggers).toHaveLength(1);

    const { state: stacked } = putTriggersOnStack(state, spyTriggers);
    const stackObject = stacked.stack[0];
    const beforeHand = stacked.zones.get(`${p1}-hand`)!.cardIds.length;
    const resolved = resolveScriptedAbility(stacked, stackObject)!;
    const afterHand = resolved.zones.get(`${p1}-hand`)!.cardIds.length;
    expect(afterHand).toBe(beforeHand + 1);
  });
});