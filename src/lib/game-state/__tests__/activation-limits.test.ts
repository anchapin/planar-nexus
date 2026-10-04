/**
 * Activation restrictions (CR 602.5b, 602.5d; issue #2496):
 * "Activate only once each turn" and "Activate only as a sorcery", from
 * card scripts and from oracle text.
 */
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { activateAbility, canActivateAbility } from "../abilities/activated";
import { getActivatedAbilities } from "../abilities/parse";
import { addMana } from "../mana/mana-pool";
import { isActivateOnlyOnce } from "../keyword-actions/threshold";
import { parseActivatedAbilities } from "../oracle-text-parser/abilities";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
} from "../types";

const id = (s: string) => s as CardInstanceId;

function data(name: string, oracle: string): ScryfallCard {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature — Cat",
    oracle_text: oracle,
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
  } as unknown as ScryfallCard;
}

const CATS =
  "{2}{G}: This creature gets +2/+2 until end of turn. Activate only once each turn.";
const TENDERFOOT =
  "{3}: Put a +1/+1 counter on this creature. Activate only as a sorcery.";

describe("activation limits (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const put = (s: GameState, cardId: string, card: ScryfallCard): GameState => {
    const key = `${p1}-battlefield`;
    const cards = new Map(s.cards);
    const inst = createCardInstance(card, p1, p1, {
      id: id(cardId),
      currentZoneKey: key,
    });
    cards.set(id(cardId), { ...inst, hasSummoningSickness: false });
    const zones = new Map(s.zones);
    const z = zones.get(key)!;
    zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
    return { ...s, cards, zones };
  };
  const at = (
    s: GameState,
    phase: Phase,
    active = p1,
    turnNumber = s.turn.turnNumber,
  ): GameState => ({
    ...s,
    stack: [],
    priorityPlayerId: p1,
    turn: {
      ...s.turn,
      activePlayerId: active,
      currentPhase: phase,
      turnNumber,
    },
  });
  const mana = (s: GameState) => addMana(s, p1, { green: 6 });

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("scripted Kraven's Cats activates once each turn, then again next turn", () => {
    let s = mana(
      at(put(state, "cats", data("Kraven's Cats", CATS)), Phase.PRECOMBAT_MAIN),
    );
    expect(
      getActivatedAbilities(s.cards.get(id("cats"))!.cardData)[0]
        .activationLimit,
    ).toBe("oncePerTurn");
    const first = activateAbility(s, p1, id("cats"), 0);
    expect(first.success).toBe(true);
    s = { ...first.state, stack: [], priorityPlayerId: p1 };
    expect(canActivateAbility(s, p1, id("cats"), 0)).toEqual({
      canActivate: false,
      reason: "This ability can be activated only once each turn",
    });
    expect(activateAbility(s, p1, id("cats"), 0).success).toBe(false);
    const nextTurn = at(s, Phase.PRECOMBAT_MAIN, p1, s.turn.turnNumber + 1);
    expect(canActivateAbility(nextTurn, p1, id("cats"), 0).canActivate).toBe(
      true,
    );
  });

  it("scripted Intrepid Tenderfoot activates only at sorcery speed", () => {
    const s = mana(put(state, "tf", data("Intrepid Tenderfoot", TENDERFOOT)));
    expect(
      getActivatedAbilities(s.cards.get(id("tf"))!.cardData)[0].sorceryOnly,
    ).toBe(true);
    expect(
      canActivateAbility(at(s, Phase.PRECOMBAT_MAIN), p1, id("tf"), 0)
        .canActivate,
    ).toBe(true);
    expect(
      canActivateAbility(at(s, Phase.BEGIN_COMBAT), p1, id("tf"), 0).reason,
    ).toBe("Activate only as a sorcery");
    expect(
      canActivateAbility(at(s, Phase.PRECOMBAT_MAIN, p2), p1, id("tf"), 0)
        .canActivate,
    ).toBe(false);
    const withStack = {
      ...at(s, Phase.PRECOMBAT_MAIN),
      stack: [{ id: "x" } as unknown as StackObject],
    };
    expect(canActivateAbility(withStack, p1, id("tf"), 0).canActivate).toBe(
      false,
    );
    // Unlimited at sorcery speed: a second activation is fine.
    const once = activateAbility(at(s, Phase.PRECOMBAT_MAIN), p1, id("tf"), 0);
    expect(once.success).toBe(true);
  });

  it("parses restrictions from oracle text for unscripted cards", () => {
    const [gunner] = parseActivatedAbilities(
      "Reach\n{2}: Draw a card. Activate only as a sorcery and only once each turn.",
      "Creature",
    );
    expect(gunner.activationLimit).toBe("oncePerTurn");
    expect(gunner.sorceryOnly).toBe(true);
    const [plain] = parseActivatedAbilities(
      "{R}: This creature gets +1/+0 until end of turn.",
      "Creature",
    );
    expect(plain.activationLimit).toBeUndefined();
    expect(plain.sorceryOnly).toBeUndefined();
  });

  it("doesn't treat once each turn as the once-ever restriction", () => {
    const cats = createCardInstance(data("Some Cat", CATS), p1, p1);
    expect(
      isActivateOnlyOnce(cats, "This creature gets +2/+2 until end of turn"),
    ).toBe(false);
  });
});
