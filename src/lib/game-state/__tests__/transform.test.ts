/**
 * Transform keyword action (issue #2300, Standard remainder slice).
 */
import {
  canTransform,
  isSelfTransformText,
  moveCardToZone,
  transformPermanent,
} from "../keyword-actions";
import { resolveEffect } from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  ScryfallCard,
} from "../types";

const DELVER = {
  id: "mock-delver",
  name: "Delver of Secrets // Insectile Aberration",
  type_line: "Creature — Human Wizard // Creature — Human Insect",
  keywords: ["Transform", "Flying"],
  mana_cost: "{U}",
  cmc: 1,
  colors: ["U"],
  color_identity: ["U"],
  legalities: { standard: "legal" },
  layout: "transform",
  card_faces: [
    {
      name: "Delver of Secrets",
      mana_cost: "{U}",
      type_line: "Creature — Human Wizard",
      oracle_text:
        "At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.",
      power: "1",
      toughness: "1",
    },
    {
      name: "Insectile Aberration",
      mana_cost: "",
      type_line: "Creature — Human Insect",
      oracle_text: "Flying",
      power: "3",
      toughness: "2",
    },
  ],
} as unknown as ScryfallCard;

const MDFC = {
  ...DELVER,
  id: "mock-mdfc",
  name: "Front // Back",
  layout: "modal_dfc",
} as unknown as ScryfallCard;

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone = "battlefield",
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

describe("transform", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    const s = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(s.players.keys());
    state = put(s, p1, "delver", DELVER);
  });

  it("recognises self-transform instructions only", () => {
    const name = "Delver of Secrets // Insectile Aberration";
    expect(isSelfTransformText("Transform Delver of Secrets.", name)).toBe(
      true,
    );
    expect(isSelfTransformText("transform it.", name)).toBe(true);
    expect(isSelfTransformText("Transform this creature.", name)).toBe(true);
    expect(
      isSelfTransformText("Return it to the battlefield transformed.", name),
    ).toBe(false);
    expect(
      isSelfTransformText(
        "When this creature transforms into X, draw a card.",
        name,
      ),
    ).toBe(false);
  });

  it("turns a permanent to its back face and keeps its state", () => {
    const cards = new Map(state.cards);
    cards.set(id("delver"), {
      ...cards.get(id("delver"))!,
      isTapped: true,
      damage: 1,
    });
    const result = transformPermanent({ ...state, cards }, id("delver"));
    expect(result.success).toBe(true);
    const after = result.state.cards.get(id("delver"))!;
    expect(after.currentFaceIndex).toBe(1);
    expect(after.cardData.name).toBe("Insectile Aberration");
    expect(after.cardData.type_line).toBe("Creature — Human Insect");
    expect(after.cardData.power).toBe("3");
    expect(after.cardData.cmc).toBe(1);
    expect(after.isTapped).toBe(true);
    expect(after.damage).toBe(1);
  });

  it("transforms back to the original card data", () => {
    const once = transformPermanent(state, id("delver")).state;
    const twice = transformPermanent(once, id("delver")).state;
    const after = twice.cards.get(id("delver"))!;
    expect(after.currentFaceIndex).toBe(0);
    expect(after.cardData).toBe(DELVER);
    expect(after.transformOriginalCardData).toBeUndefined();
  });

  it("does nothing to a modal double-faced card", () => {
    const st = put(state, p1, "mdfc", MDFC);
    expect(canTransform(st, id("mdfc")).canTransform).toBe(false);
    expect(transformPermanent(st, id("mdfc")).success).toBe(false);
  });

  it("does nothing to a card that isn't on the battlefield", () => {
    const st = put(state, p1, "handDelver", DELVER, "hand");
    expect(transformPermanent(st, id("handDelver")).success).toBe(false);
  });

  it("returns to its front face when it leaves the battlefield", () => {
    const flipped = transformPermanent(state, id("delver")).state;
    const moved = moveCardToZone(flipped, id("delver"), "graveyard");
    expect(moved.success).toBe(true);
    const after = moved.state.cards.get(id("delver"))!;
    expect(after.currentFaceIndex).toBe(0);
    expect(after.cardData.name).toBe(DELVER.name);
  });

  it("resolves a structured transform effect against its source", () => {
    const result = resolveEffect(
      state,
      { effectType: "transform" },
      id("delver"),
    );
    expect(result.success).toBe(true);
    expect(result.state.cards.get(id("delver"))!.currentFaceIndex).toBe(1);
  });
});
