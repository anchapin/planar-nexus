import { describe, it, expect } from "@jest/globals";
import type { ScryfallCard } from "@/app/actions";
import { createCardInstance } from "../card-instance";
import { createInitialGameState, startGame } from "../game-state";
import { addMana } from "../mana";
import { parseSpellEffects } from "../effect-resolution";
import { ventureIntoDungeon } from "../keyword-actions";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { computeStateHash } from "../state-hash";
import {
  detectDungeonRoomCompletionTriggers,
  hasVentureIntoDungeonText,
} from "../trigger-system";
import { Phase } from "../types";
import type { GameState, PlayerId, StackObject } from "../types";

function makeCard(
  overrides: Partial<ScryfallCard> & { id: string },
): ScryfallCard {
  return {
    name: "Test Card",
    type_line: "Instant",
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "normal",
    ...overrides,
  } as ScryfallCard;
}

function makeFixture(): {
  state: GameState;
  aliceId: PlayerId;
  bobId: PlayerId;
} {
  let state = createInitialGameState(["Alice", "Bob"], 20, false);
  state = startGame(state);
  const [aliceId, bobId] = Array.from(state.players.keys());
  return {
    state: {
      ...state,
      turn: { ...state.turn, currentPhase: Phase.PRECOMBAT_MAIN },
      priorityPlayerId: aliceId,
      status: "in_progress",
    },
    aliceId,
    bobId,
  };
}

function putCardInHand(
  state: GameState,
  playerId: PlayerId,
  cardData: ScryfallCard,
): { state: GameState; cardId: string } {
  const handKey = `${playerId}-hand`;
  const hand = state.zones.get(handKey);
  if (!hand) throw new Error("Hand zone missing");

  const card = createCardInstance(cardData, playerId, playerId, {
    id: `${cardData.id}-instance`,
  });
  const cards = new Map(state.cards);
  cards.set(card.id, { ...card, currentZoneKey: handKey });
  const zones = new Map(state.zones);
  zones.set(handKey, { ...hand, cardIds: [...hand.cardIds, card.id] });
  return { state: { ...state, cards, zones }, cardId: card.id };
}

function barTheGate(): ScryfallCard {
  return makeCard({
    id: "bar-the-gate",
    name: "Bar the Gate",
    type_line: "Instant",
    oracle_text:
      "Counter target creature or planeswalker spell. Venture into the dungeon.",
    mana_cost: "{2}{U}",
    cmc: 3,
    colors: ["U"],
    color_identity: ["U"],
  });
}

describe("Venture into the Dungeon", () => {
  it("starts Lost Mine of Phandelver on the first venture", () => {
    const { state, aliceId } = makeFixture();
    const result = ventureIntoDungeon(state, aliceId);
    const player = result.state.players.get(aliceId);

    expect(result.success).toBe(true);
    expect(player?.dungeonProgress?.dungeonId).toBe("lost-mine-of-phandelver");
    expect(player?.dungeonProgress?.roomIndex).toBe(0);
    expect(player?.dungeonProgress?.roomId).toBe("cave-entrance");
    expect(result.roomCompletion?.roomName).toBe("Cave Entrance");
    expect(result.roomCompletion?.effect).toBe("Scry 1.");
  });

  it("advances rooms and records the final room completion effect", () => {
    const { state, aliceId } = makeFixture();
    const first = ventureIntoDungeon(state, aliceId);
    const second = ventureIntoDungeon(first.state, aliceId);
    const third = ventureIntoDungeon(second.state, aliceId);
    const fourth = ventureIntoDungeon(third.state, aliceId);
    const player = fourth.state.players.get(aliceId);

    expect(second.state.players.get(aliceId)?.dungeonProgress?.roomIndex).toBe(
      1,
    );
    expect(third.state.players.get(aliceId)?.dungeonProgress?.roomIndex).toBe(
      2,
    );
    expect(player?.dungeonProgress?.roomIndex).toBe(3);
    expect(player?.dungeonProgress?.roomId).toBe("temple-of-dumathoin");
    expect(fourth.roomCompletion?.isFinalRoom).toBe(true);
    expect(fourth.roomCompletion?.effect).toBe("Draw a card.");
    expect(player?.completedDungeonIds).toContain("lost-mine-of-phandelver");
  });

  it("creates room completion triggers for entered rooms", () => {
    const { state, aliceId } = makeFixture();
    const result = ventureIntoDungeon(state, aliceId);
    const triggers = detectDungeonRoomCompletionTriggers(
      result.roomCompletion,
      aliceId,
    );

    expect(hasVentureIntoDungeonText("Venture into the dungeon.")).toBe(true);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].roomId).toBe("cave-entrance");
    expect(triggers[0].effect).toBe("Scry 1.");
  });

  it("parses venture as a stack effect", () => {
    const effects = parseSpellEffects(barTheGate().oracle_text ?? "");
    expect(
      effects.some((effect) => effect.effectType === "venture_dungeon"),
    ).toBe(true);
  });

  it("resolves Bar the Gate by countering the target spell and venturing", () => {
    const fixture = makeFixture();
    const withCard = putCardInHand(
      fixture.state,
      fixture.aliceId,
      barTheGate(),
    );
    let state = addMana(withCard.state, fixture.aliceId, {
      blue: 1,
      generic: 2,
    });
    const targetSpell: StackObject = {
      id: "target-creature-spell",
      type: "spell",
      sourceCardId: null,
      controllerId: fixture.bobId,
      name: "Target Creature Spell",
      text: "",
      manaCost: "{1}",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: 1,
    };
    state = {
      ...state,
      stack: [targetSpell],
      priorityPlayerId: fixture.aliceId,
    };

    const cast = castSpell(state, fixture.aliceId, withCard.cardId, [
      { type: "stack", targetId: targetSpell.id, isValid: true },
    ]);
    expect(cast.success).toBe(true);

    const resolved = resolveTopOfStack(cast.state);
    const alice = resolved.players.get(fixture.aliceId);

    expect(
      resolved.stack.find((item) => item.id === targetSpell.id)?.isCountered,
    ).toBe(true);
    expect(alice?.dungeonProgress?.dungeonId).toBe("lost-mine-of-phandelver");
    expect(alice?.dungeonProgress?.roomIndex).toBe(0);
  });

  it("keeps state hashes deterministic across matching venture sequences", () => {
    const { state, aliceId } = makeFixture();
    const firstA = ventureIntoDungeon(state, aliceId).state;
    const firstB = ventureIntoDungeon(state, aliceId).state;
    const secondA = ventureIntoDungeon(firstA, aliceId).state;
    const secondB = ventureIntoDungeon(firstB, aliceId).state;

    expect(computeStateHash(firstA)).toBe(computeStateHash(firstB));
    expect(computeStateHash(secondA)).toBe(computeStateHash(secondB));
    expect(computeStateHash(secondA)).not.toBe(computeStateHash(firstA));
  });
});
