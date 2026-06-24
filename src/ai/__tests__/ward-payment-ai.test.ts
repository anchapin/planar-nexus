/**
 * AI Ward Payment Decision Tests — CR 702.21
 *
 * Issue #920: the AI must decide whether to pay a ward cost to keep its
 * targeted spell/ability from being countered.
 */

import { decideWardPayments } from "../stack-interaction-ai";
import { createInitialGameState, startGame } from "@/lib/game-state/game-state";
import { createCardInstance } from "@/lib/game-state/card-instance";
import { addMana } from "@/lib/game-state/mana";
import type {
  CardInstanceId,
  PlayerId,
  ScryfallCard,
  StackEffect,
  StackObject,
  Target,
} from "@/lib/game-state/types";

function wardedCreature(
  name: string,
  wardText: string,
  opts: { power?: number; toughness?: number; cmc?: number } = {},
): ScryfallCard {
  return {
    id: `mock-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    type_line: "Creature — Test",
    power: String(opts.power ?? 4),
    toughness: String(opts.toughness ?? 4),
    keywords: ["Ward"],
    oracle_text: wardText,
    mana_cost: "{2}{U}",
    cmc: opts.cmc ?? 4,
    colors: ["U"],
    color_identity: ["U"],
    card_faces: undefined,
    layout: "normal",
  } as ScryfallCard;
}

interface Scenario {
  state: ReturnType<typeof startGame>;
  aliceId: PlayerId;
  bobId: PlayerId;
  wardedId: CardInstanceId;
  stackObjectId: string;
}

function setup(
  wardText: string,
  creatureOpts?: { power?: number; toughness?: number; cmc?: number },
): Scenario {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const [aliceId, bobId] = Array.from(state.players.keys()) as PlayerId[];

  const creature = createCardInstance(
    wardedCreature("Warded", wardText, creatureOpts),
    bobId,
    bobId,
  );
  state.cards.set(creature.id, creature);
  const bf = state.zones.get(`${bobId}-battlefield`)!;
  state.zones.set(`${bobId}-battlefield`, {
    ...bf,
    cardIds: [...bf.cardIds, creature.id],
  });

  state = addMana(state, aliceId, { blue: 4, generic: 4 });

  const stackObject: StackObject = {
    id: "ai-spell-1",
    type: "ability",
    sourceCardId: null,
    controllerId: aliceId,
    name: "AI Targeting Ability",
    text: "",
    manaCost: null,
    targets: [{ type: "card", targetId: creature.id, isValid: true } as Target],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
    effects: [] as StackEffect[],
  };
  state.stack = [stackObject];

  return {
    state,
    aliceId,
    bobId,
    wardedId: creature.id,
    stackObjectId: stackObject.id,
  };
}

describe("evaluateWardPayment (AI heuristic)", () => {
  it("pays a mana ward when affordable and the target is valuable", () => {
    const { state, stackObjectId } = setup("Ward {2}", { cmc: 4, power: 4 });
    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].canAfford).toBe(true);
    expect(evaluations[0].shouldPay).toBe(true);
  });

  it("declines a mana ward when the target is low-value", () => {
    const { state, stackObjectId } = setup("Ward {2}", { cmc: 1, power: 1 });
    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations[0].shouldPay).toBe(false);
    expect(evaluations[0].reasoning).toMatch(/not worth/i);
  });

  it("declines when it cannot afford the ward cost", () => {
    const { state, stackObjectId, aliceId } = setup("Ward {50}", {
      cmc: 5,
      power: 5,
    });
    const player = state.players.get(aliceId)!;
    state.players.set(aliceId, {
      ...player,
      manaPool: { ...player.manaPool, blue: 0, generic: 0, colorless: 0 },
    });
    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations[0].canAfford).toBe(false);
    expect(evaluations[0].shouldPay).toBe(false);
  });

  it("declines a life ward that would drop the AI to the safety floor", () => {
    // Alice at 6 life, ward costs 3 life -> 6 - 3 = 3 <= floor(5) -> decline.
    const { state, stackObjectId, aliceId } = setup("Ward—Pay 3 life.", {
      cmc: 5,
      power: 5,
    });
    const player = state.players.get(aliceId)!;
    state.players.set(aliceId, { ...player, life: 6 });
    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations[0].shouldPay).toBe(false);
    expect(evaluations[0].reasoning).toMatch(/life/i);
  });

  it("pays a life ward when safe and the target is valuable", () => {
    const { state, stackObjectId, aliceId } = setup("Ward—Pay 3 life.", {
      cmc: 5,
      power: 5,
    });
    const player = state.players.get(aliceId)!;
    state.players.set(aliceId, { ...player, life: 20 });
    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations[0].shouldPay).toBe(true);
  });
});

describe("decideWardPayments (applies decisions)", () => {
  it("records payment and spends resources when the AI decides to pay", () => {
    const { state, stackObjectId, wardedId, aliceId } = setup("Ward {2}", {
      cmc: 4,
      power: 4,
    });
    const manaBefore = state.players.get(aliceId)!.manaPool;
    const { state: after } = decideWardPayments(state, stackObjectId);

    const paid = after.stack.find((s) => s.id === stackObjectId)!;
    expect(paid.wardPaidTargetIds).toContain(wardedId);
    const manaAfter = after.players.get(aliceId)!.manaPool;
    expect(manaAfter.generic + manaAfter.blue).toBeLessThan(
      manaBefore.generic + manaBefore.blue,
    );
  });

  it("leaves the spell unpaid when the AI declines, so it will be countered", () => {
    const { state, stackObjectId, wardedId } = setup("Ward {2}", {
      cmc: 1,
      power: 1,
    });
    const { state: after } = decideWardPayments(state, stackObjectId);
    const paid = after.stack.find((s) => s.id === stackObjectId)!;
    expect(paid.wardPaidTargetIds ?? []).not.toContain(wardedId);
  });

  it("is a no-op for a spell with no ward triggers", () => {
    const { state, stackObjectId, bobId, wardedId } = setup("Ward {2}");
    // Remove the warded creature from the battlefield so there's no trigger.
    const bf = state.zones.get(`${bobId}-battlefield`)!;
    state.zones.set(`${bobId}-battlefield`, {
      ...bf,
      cardIds: bf.cardIds.filter((id) => id !== wardedId),
    });

    const { evaluations } = decideWardPayments(state, stackObjectId);
    expect(evaluations).toHaveLength(0);
  });
});
