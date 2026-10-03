/**
 * Issue #2443: the AI answers corpse, tribute and attack-return offers.
 */
import { describe, it, expect } from "@jest/globals";
import {
  createInitialGameState,
  startGame,
  createCardInstance,
  processTributeOnEtb,
  Phase,
} from "@/lib/game-state";
import type {
  GameState,
  PlayerId,
  ScryfallCard,
  WaitingChoice,
} from "@/lib/game-state";
import {
  answerAIOfferChoices,
  decideOfferChoice,
  isOfferChoice,
} from "../offer-choices";

function offer(
  type: WaitingChoice["type"],
  payPrefix: "pay" | "accept",
  payValid: boolean,
): WaitingChoice {
  return {
    type,
    playerId: "p2" as PlayerId,
    stackObjectId: null,
    prompt: "offer",
    choices: [
      { label: "Pay", value: `${payPrefix}:card-1`, isValid: payValid },
      { label: "Decline", value: "decline:card-1", isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: 0,
  };
}

describe("decideOfferChoice", () => {
  const cases: Array<[WaitingChoice["type"], "pay" | "accept"]> = [
    ["corpse_offer", "pay"],
    ["tribute_offer", "accept"],
    ["attack_return_offer", "pay"],
  ];

  it.each(cases)("%s: pays when the pay option is valid", (type, prefix) => {
    expect(decideOfferChoice(offer(type, prefix, true))).toBe(
      `${prefix}:card-1`,
    );
  });

  it.each(cases)("%s: declines when it cannot afford", (type, prefix) => {
    expect(decideOfferChoice(offer(type, prefix, false))).toBe(
      "decline:card-1",
    );
  });

  it("only treats the three offer types as offers", () => {
    expect(isOfferChoice(offer("corpse_offer", "pay", true))).toBe(true);
    expect(isOfferChoice(offer("choose_mode", "pay", true))).toBe(false);
    expect(isOfferChoice(null)).toBe(false);
  });
});

function tributeCreature(): ScryfallCard {
  return {
    id: "mock-tribute-2",
    name: "Fanatic of Rhonas",
    type_line: "Creature \u2014 Snake Druid",
    oracle_text:
      "Tribute 2 (As this creature enters the battlefield, an opponent of your choice may pay 2. If they don't, sacrifice this creature.)",
    mana_cost: "{3}{G}",
    cmc: 4,
    colors: ["G"],
    color_identity: ["G"],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "4",
    toughness: "4",
  } as unknown as ScryfallCard;
}

function tributeFixture(aiMana: number): {
  state: GameState;
  humanId: PlayerId;
  aiId: PlayerId;
} {
  let state = createInitialGameState(["Human", "AI Opponent"], 20, false);
  state = startGame(state);
  const [humanId, aiId] = Array.from(state.players.keys());
  state.status = "in_progress";
  state.turn.activePlayerId = humanId;
  state.priorityPlayerId = humanId;
  state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
  state.stack = [];

  const card = createCardInstance(tributeCreature(), humanId, humanId);
  card.hasSummoningSickness = false;
  state.cards.set(card.id, card);
  const bf = state.zones.get(`${humanId}-battlefield`)!;
  state.zones.set(`${humanId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, card.id],
  });

  const ai = state.players.get(aiId)!;
  state.players.set(aiId, {
    ...ai,
    manaPool: {
      colorless: 0,
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      generic: aiMana,
    },
  });

  const res = processTributeOnEtb(state, card.id);
  return { state: res.state, humanId, aiId };
}

describe("answerAIOfferChoices (tribute offer owned by the AI)", () => {
  it("pays the tribute when the AI can afford it and clears the choice", () => {
    const f = tributeFixture(10);
    expect(f.state.waitingChoice?.type).toBe("tribute_offer");
    expect(f.state.waitingChoice?.playerId).toBe(f.aiId);

    const { state, answered } = answerAIOfferChoices(f.state, f.aiId);
    expect(answered).toHaveLength(1);
    expect(answered[0].value.startsWith("accept:")).toBe(true);
    expect(state.waitingChoice).toBeNull();
  });

  it("declines when the AI cannot pay, and still clears the choice", () => {
    const f = tributeFixture(0);
    const { state, answered } = answerAIOfferChoices(f.state, f.aiId);
    expect(answered).toHaveLength(1);
    expect(answered[0].value.startsWith("decline:")).toBe(true);
    expect(state.waitingChoice).toBeNull();
  });

  it("leaves an offer that belongs to another player alone", () => {
    const f = tributeFixture(10);
    const { state, answered } = answerAIOfferChoices(f.state, f.humanId);
    expect(answered).toHaveLength(0);
    expect(state).toBe(f.state);
  });
});
