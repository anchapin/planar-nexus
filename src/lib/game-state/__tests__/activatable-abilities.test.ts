/**
 * Which activated abilities the game screen offers (CR 602; issue #2300).
 */
import { getActivatableAbilities } from "../abilities/activated";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import type { GameState, PlayerId, CardInstanceId, ScryfallCard } from "../types";

function permanent(name: string, oracle: string, typeLine = "Creature — Wizard") {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "1",
    toughness: "1",
  } as unknown as ScryfallCard;
}

const id = (s: string) => s as CardInstanceId;

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  sick = false,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  cards.set(id(cardId), {
    ...createCardInstance(data, playerId, playerId, { id: id(cardId), currentZoneKey: key }),
    hasSummoningSickness: sick,
  });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

describe("getActivatableAbilities", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(createInitialGameState(["Player1", "Player2"], 20, false));
    [p1, p2] = Array.from(s.players.keys());
    state = { ...s, priorityPlayerId: p1 };
  });

  it("lists a non-mana ability with its oracle line", () => {
    state = put(state, p1, "pinger", permanent("Pinger", "{T}: This creature deals 1 damage to any target."));
    const options = getActivatableAbilities(state, p1, id("pinger"));
    expect(options).toHaveLength(1);
    expect(options[0].abilityIndex).toBe(0);
    expect(options[0].label).toContain("{T}");
  });

  it("leaves out mana abilities", () => {
    state = put(state, p1, "elf", permanent("Elf", "{T}: Add {G}."));
    expect(getActivatableAbilities(state, p1, id("elf"))).toEqual([]);
  });

  it("leaves out tap abilities of a summoning-sick creature", () => {
    state = put(state, p1, "pinger", permanent("Pinger", "{T}: This creature deals 1 damage to any target."), true);
    expect(getActivatableAbilities(state, p1, id("pinger"))).toEqual([]);
  });

  it("lets a hasty creature use its tap ability right away", () => {
    const data = permanent("Hasty Pinger", "Haste\n{T}: This creature deals 1 damage to any target.");
    state = put(state, p1, "hasty", { ...data, keywords: ["Haste"] } as ScryfallCard, true);
    expect(getActivatableAbilities(state, p1, id("hasty"))).toHaveLength(1);
  });

  it("offers nothing without priority or for an opponent's permanent", () => {
    state = put(state, p2, "theirs", permanent("Theirs", "{T}: You gain 2 life."));
    expect(getActivatableAbilities(state, p1, id("theirs"))).toEqual([]);
    state = put(state, p1, "mine", permanent("Mine", "{T}: You gain 2 life."));
    expect(getActivatableAbilities({ ...state, priorityPlayerId: p2 }, p1, id("mine"))).toEqual([]);
  });
});
