/**
 * Dies, attack and upkeep triggers fire in real games (issue #2498).
 *
 * Before #2498 the game loop only raised enters-the-battlefield, landfall
 * and combat-damage-to-a-player events, so "When this creature dies",
 * "Whenever this creature attacks" and "At the beginning of your upkeep"
 * were parsed but never reached the stack outside unit tests.
 */
import { declareAttackers } from "../combat/declaration";
import { destroyCard } from "../keyword-actions/removal";
import { checkStateBasedActions } from "../state-based-actions";
import { createInitialGameState, startGame, passPriority } from "../game-state";
import { createCardInstance } from "../card-instance";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

const id = (s: string) => s as CardInstanceId;

function creature(name: string, oracle = "", power = "2", toughness = "2") {
  return {
    id: `mock-${name}`,
    name,
    type_line: "Creature \u2014 Bear",
    oracle_text: oracle,
    mana_cost: "{1}{G}",
    cmc: 2,
    colors: ["G"],
    color_identity: ["G"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power,
    toughness,
  } as unknown as ScryfallCard;
}

function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
): GameState {
  const key = `${playerId}-battlefield`;
  const cards = new Map(state.cards);
  const card = createCardInstance(data, playerId, playerId, {
    id: id(cardId),
    currentZoneKey: key,
  });
  cards.set(id(cardId), { ...card, hasSummoningSickness: false });
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

function atPhase(state: GameState, phase: Phase, active: PlayerId): GameState {
  return {
    ...state,
    stack: [],
    priorityPlayerId: active,
    turn: { ...state.turn, activePlayerId: active, currentPhase: phase },
  };
}

/** Both players pass once: resolves the top of the stack or advances a step. */
function bothPass(state: GameState, a: PlayerId, b: PlayerId): GameState {
  return passPriority(passPriority(state, a), b);
}

const sources = (state: GameState) => state.stack.map((o) => o.sourceCardId);
const life = (state: GameState, p: PlayerId) => state.players.get(p)!.life;

describe("dies, attack and upkeep triggers in real games (#2498)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    const s = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [p1, p2] = Array.from(s.players.keys());
    state = s;
  });

  describe("dies (CR 603.10a look-back)", () => {
    const SELF = "When this creature dies, you gain 2 life.";
    const ANOTHER = "Whenever another creature you control dies, you gain 1 life.";

    it("a destroyed creature's own dies trigger goes on the stack and resolves", () => {
      state = atPhase(put(state, p1, "bear", creature("Doomed", SELF)), Phase.PRECOMBAT_MAIN, p1);
      const destroyed = destroyCard(state, id("bear"));
      expect(destroyed.success).toBe(true);
      expect(destroyed.state.zones.get(`${p1}-graveyard`)!.cardIds).toContain(id("bear"));
      expect(sources(destroyed.state)).toEqual([id("bear")]);

      const resolved = bothPass(destroyed.state, p1, p2);
      expect(resolved.stack).toHaveLength(0);
      expect(life(resolved, p1)).toBe(22);
    });

    it("lethal damage kills through state-based actions and fires the trigger", () => {
      state = put(state, p1, "bear", creature("Doomed", SELF));
      const cards = new Map(state.cards);
      cards.set(id("bear"), { ...cards.get(id("bear"))!, damage: 2 });
      const after = checkStateBasedActions({ ...state, cards }).state;
      expect(after.zones.get(`${p1}-graveyard`)!.cardIds).toContain(id("bear"));
      expect(sources(after)).toEqual([id("bear")]);
    });

    it("'another creature you control' fires for the other, not for itself or an opponent's", () => {
      state = put(put(state, p1, "watcher", creature("Watcher", ANOTHER)), p1, "bear", creature("Bear"));
      state = put(state, p2, "foe", creature("Foe"));
      expect(sources(destroyCard(state, id("bear")).state)).toEqual([id("watcher")]);
      expect(sources(destroyCard(state, id("foe")).state)).toEqual([]);
      expect(sources(destroyCard(state, id("watcher")).state)).toEqual([]);
    });

    it("leaving for exile or hand is not dying", () => {
      state = put(state, p1, "bear", creature("Doomed", SELF));
      const { moveCardToZone } = jest.requireActual("../keyword-actions/removal");
      expect(moveCardToZone(state, id("bear"), "exile").state.stack).toHaveLength(0);
      expect(moveCardToZone(state, id("bear"), "hand").state.stack).toHaveLength(0);
    });
  });

  describe("attacks (CR 508.1m)", () => {
    const SELF = "Whenever this creature attacks, you gain 1 life.";
    const ANY = "Whenever a creature you control attacks, you gain 1 life.";
    const YOU = "Whenever you attack, you gain 1 life.";

    function declare(s: GameState, ids: string[]) {
      return declareAttackers(
        atPhase(s, Phase.DECLARE_ATTACKERS, p1),
        ids.map((c) => ({ cardId: id(c), defenderId: p2 })),
      );
    }

    it("'this creature attacks' fires only for that attacker", () => {
      state = put(put(state, p1, "raider", creature("Raider", SELF)), p1, "bear", creature("Bear"));
      expect(sources(declare(state, ["bear"]).state)).toEqual([]);
      expect(sources(declare(state, ["raider", "bear"]).state)).toEqual([id("raider")]);
    });

    it("'a creature you control attacks' fires once per attacker; 'you attack' once per combat", () => {
      state = put(put(state, p1, "a", creature("A")), p1, "b", creature("B"));
      state = put(put(state, p1, "captain", creature("Captain", ANY, "1", "1")), p1, "drummer", creature("Drummer", YOU, "1", "1"));
      const s = declare(state, ["a", "b"]).state;
      expect(sources(s).filter((x) => x === id("captain"))).toHaveLength(2);
      expect(sources(s).filter((x) => x === id("drummer"))).toHaveLength(1);
    });

    it("an opponent's attack trigger does not fire for your attackers", () => {
      state = put(put(state, p1, "bear", creature("Bear")), p2, "captain", creature("Captain", ANY));
      expect(sources(declare(state, ["bear"]).state)).toEqual([]);
    });

    it("the attack trigger resolves before blockers", () => {
      state = put(state, p1, "raider", creature("Raider", SELF));
      const declared = declare(state, ["raider"]).state;
      const resolved = bothPass(declared, p1, p2);
      expect(resolved.stack).toHaveLength(0);
      expect(life(resolved, p1)).toBe(21);
    });
  });

  describe("upkeep (CR 503.1a)", () => {
    const YOURS = "At the beginning of your upkeep, you gain 1 life.";
    const EACH = "At the beginning of each upkeep, you gain 1 life.";
    const OPP = "At the beginning of each opponent's upkeep, you gain 1 life.";

    it("fires 'your upkeep' for the active player only when the step begins", () => {
      state = put(put(state, p1, "mine", creature("Mine", YOURS)), p2, "theirs", creature("Theirs", YOURS));
      const upkeep = bothPass(atPhase(state, Phase.UNTAP, p1), p1, p2);
      expect(upkeep.turn.currentPhase).toBe(Phase.UPKEEP);
      expect(sources(upkeep)).toEqual([id("mine")]);

      const resolved = bothPass(upkeep, p1, p2);
      expect(resolved.stack).toHaveLength(0);
      expect(life(resolved, p1)).toBe(21);
      expect(resolved.turn.currentPhase).toBe(Phase.UPKEEP);
    });

    it("fires 'each upkeep' and 'each opponent's upkeep' on the right turns", () => {
      state = put(put(state, p2, "each", creature("Each", EACH)), p2, "opp", creature("Opp", OPP));
      const p1Upkeep = bothPass(atPhase(state, Phase.UNTAP, p1), p1, p2);
      expect(sources(p1Upkeep).sort()).toEqual([id("each"), id("opp")].sort());
      const p2Upkeep = bothPass(atPhase(state, Phase.UNTAP, p2), p2, p1);
      expect(sources(p2Upkeep)).toEqual([id("each")]);
    });
  });
});
