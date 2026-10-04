/**
 * Cast triggers fire in real games, and scripts can declare them (#2496).
 *
 * Before this, "Whenever you cast ..." abilities parsed but `castSpell` only
 * ran storm and prowess, so nothing else ever reached the stack on cast.
 */
import { describe, it, expect, beforeEach } from "@jest/globals";
import { castSpell, resolveTopOfStack } from "../spell-casting";
import { createInitialGameState, startGame } from "../game-state";
import { createCardInstance } from "../card-instance";
import { addMana } from "../mana";
import { fireUpkeepTriggers } from "../keyword-actions/upkeep";
import { parseCastTrigger } from "../oracle-text-parser/abilities";
import { Phase } from "../types";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
} from "../types";

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: `mock-${overrides.name}`,
    name: "Test",
    type_line: "Creature \u2014 Bear",
    oracle_text: "",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: "2",
    toughness: "2",
    ...overrides,
  } as ScryfallCard;
}

const instant = card({
  name: "Test Bolt",
  type_line: "Instant",
  oracle_text: "You gain 1 life.",
});
const bear = card({ name: "Test Bear" });

function put(
  state: GameState,
  playerId: PlayerId,
  zone: "hand" | "battlefield",
  data: ScryfallCard,
): CardInstanceId {
  const c = createCardInstance(data, playerId, playerId);
  state.cards.set(c.id, { ...c, hasSummoningSickness: false });
  const key = `${playerId}-${zone}`;
  const z = state.zones.get(key)!;
  state.zones.set(key, { ...z, cardIds: [...z.cardIds, c.id] });
  return c.id;
}

const life = (s: GameState, p: PlayerId) => s.players.get(p)!.life;
const handSize = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-hand`)!.cardIds.length;

describe("cast triggers in real games (#2496)", () => {
  let state: GameState;
  let alice: PlayerId;
  let bob: PlayerId;

  beforeEach(() => {
    state = startGame(createInitialGameState(["Alice", "Bob"], 20, false));
    [alice, bob] = Array.from(state.players.keys());
    state.status = "in_progress";
    state.turn.activePlayerId = alice;
    state.turn.currentPhase = Phase.PRECOMBAT_MAIN;
    state.priorityPlayerId = alice;
    state.stack = [];
    state = addMana(state, alice, { red: 4, generic: 4 });
    state = addMana(state, bob, { red: 4, generic: 4 });
  });

  function cast(s: GameState, p: PlayerId, data: ScryfallCard): GameState {
    const id = put(s, p, "hand", data);
    const r = castSpell({ ...s, priorityPlayerId: p }, p, id);
    expect(r.success).toBe(true);
    return r.state;
  }

  it("scripted Firebrand Archer triggers above a noncreature spell and pings each opponent", () => {
    const archer = put(
      state,
      alice,
      "battlefield",
      card({
        name: "Firebrand Archer",
        oracle_text:
          "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent.",
      }),
    );
    let s = cast(state, alice, instant);
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1].sourceCardId).toBe(archer);
    s = resolveTopOfStack(s);
    expect(life(s, bob)).toBe(19);
  });

  it("noncreature triggers ignore creature spells and opponents' spells", () => {
    put(
      state,
      alice,
      "battlefield",
      card({
        name: "Firebrand Archer",
        oracle_text:
          "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent.",
      }),
    );
    expect(cast(state, alice, bear).stack).toHaveLength(1);
    expect(cast(state, bob, instant).stack).toHaveLength(1);
  });

  it("scripted Guttersnipe fires on instants, not creatures", () => {
    put(
      state,
      alice,
      "battlefield",
      card({
        name: "Guttersnipe",
        oracle_text:
          "Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.",
      }),
    );
    expect(cast(state, alice, bear).stack).toHaveLength(1);
    const s = resolveTopOfStack(cast(state, alice, instant));
    expect(life(s, bob)).toBe(18);
  });

  it("an unscripted opponent-casts trigger fires from parsed oracle text", () => {
    const watcher = put(
      state,
      bob,
      "battlefield",
      card({
        name: "Test Watcher",
        oracle_text:
          "Whenever an opponent casts a creature spell, you gain 1 life.",
      }),
    );
    const s = cast(state, alice, bear);
    expect(s.stack).toHaveLength(2);
    expect(s.stack[1].sourceCardId).toBe(watcher);
    expect(life(resolveTopOfStack(s), bob)).toBe(21);
  });

  it("qualifiers the parser doesn't model never fire", () => {
    put(
      state,
      alice,
      "battlefield",
      card({
        name: "Test Flurry",
        oracle_text:
          "Whenever you cast your second spell each turn, you gain 1 life.",
      }),
    );
    put(
      state,
      alice,
      "battlefield",
      card({
        name: "Test Big",
        oracle_text:
          "Whenever you cast a spell with mana value 5 or greater, you gain 1 life.",
      }),
    );
    expect(cast(state, alice, instant).stack).toHaveLength(1);
  });

  it("parses who casts and what kind of spell", () => {
    expect(
      parseCastTrigger("whenever you cast a noncreature spell")?.castFilter,
    ).toEqual({ caster: "you", excludeTypes: ["creature"] });
    expect(
      parseCastTrigger("whenever you cast or copy an instant or sorcery spell")
        ?.castFilter,
    ).toEqual({ caster: "you", types: ["instant", "sorcery"] });
    expect(
      parseCastTrigger("whenever a player casts a multicolored spell")
        ?.castFilter,
    ).toEqual({ caster: "any", multicolored: true });
    expect(parseCastTrigger("when you cast this spell")?.castFilter?.self).toBe(
      true,
    );
    expect(
      parseCastTrigger("whenever you cast a spell with mana value 4 or greater")
        ?.castFilter?.unsupported,
    ).toBe(true);
  });

  it("scripted Phyrexian Arena draws and drains its controller on upkeep", () => {
    put(
      state,
      alice,
      "battlefield",
      card({
        name: "Phyrexian Arena",
        type_line: "Enchantment",
        oracle_text:
          "At the beginning of your upkeep, you draw a card and lose 1 life.",
        power: undefined,
        toughness: undefined,
      }),
    );
    const hand = handSize(state, alice);
    let s = fireUpkeepTriggers(
      { ...state, turn: { ...state.turn, currentPhase: Phase.UPKEEP } },
      alice,
    );
    expect(s.stack).toHaveLength(1);
    s = resolveTopOfStack(s);
    expect(life(s, alice)).toBe(19);
    expect(handSize(s, alice)).toBe(hand + 1);
    expect(fireUpkeepTriggers(state, bob).stack).toHaveLength(0);
  });
});
