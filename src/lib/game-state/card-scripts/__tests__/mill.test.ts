/**
 * Card scripts — mill.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted Mill (#2534)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put, spell, playerTarget } from "./helpers";

describe("scripted Mill (#2534)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    // Start from known three-card libraries instead of the dealt decks.
    const zones = new Map(state.zones);
    for (const p of [p1, p2]) {
      const key = `${p}-library`;
      zones.set(key, { ...zones.get(key)!, cardIds: [] });
    }
    state = { ...state, zones };
    for (const p of [p1, p2]) {
      for (const n of [1, 2, 3]) {
        state = put(
          state,
          p,
          `${p}-lib${n}`,
          card(`Card ${n}`, "Sorcery"),
          "library",
        );
      }
    }
  });

  const yard = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-graveyard`)!.cardIds;
  const library = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-library`)!.cardIds;
  const millScript = (effect: object): CardScript =>
    CardScriptSchema.parse({ name: "Mill Test", oracle: "x", spell: [effect] });

  it("validates Mill", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Mill", amount: 2 })).toBe(true);
    expect(ok({ op: "Mill", amount: 1, who: "target_player" })).toBe(true);
    expect(ok({ op: "Mill", amount: 1, who: "each_opponent" })).toBe(true);
    expect(ok({ op: "Mill", amount: 1, who: "each_player" })).toBe(true);
    expect(ok({ op: "Mill", amount: 0 })).toBe(false);
  });

  it("validates Draw (#2594 lane 25)", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Draw", amount: 1 })).toBe(true);
    expect(ok({ op: "Draw", amount: 1, who: "you" })).toBe(true);
    expect(ok({ op: "Draw", amount: 1, who: "target_player" })).toBe(true);
    expect(ok({ op: "Draw", amount: 1, who: "each_player" })).toBe(true);
    expect(ok({ op: "Draw", amount: 1, who: "each_opponent" })).toBe(false);
  });

  it("mills the top cards of your library into your graveyard", () => {
    const before = library(state, p1);
    const s = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 2 }),
      spell(p1),
    );
    const top2 = before.slice(-2);
    expect(library(s, p1)).toEqual(before.slice(0, -2));
    expect([...yard(s, p1)].sort()).toEqual([...top2].sort());
    for (const c of top2) {
      expect(s.cards.get(c)!.currentZoneKey).toBe(`${p1}-graveyard`);
    }
    expect(yard(s, p2)).toEqual([]);
  });

  it("mills a target player or each opponent", () => {
    const targeted = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 1, who: "target_player" }),
      spell(p1, [playerTarget(p2)]),
    );
    expect(yard(targeted, p2)).toHaveLength(1);
    expect(yard(targeted, p1)).toHaveLength(0);

    const each = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 2, who: "each_opponent" }),
      spell(p1),
    );
    expect(yard(each, p2)).toHaveLength(2);
    expect(yard(each, p1)).toHaveLength(0);
  });

  it("mills only what is left when the library is short", () => {
    const s = resolveScriptedSpell(
      state,
      millScript({ op: "Mill", amount: 10 }),
      spell(p1),
    );
    expect(library(s, p1)).toEqual([]);
    expect(yard(s, p1)).toHaveLength(3);
  });

  it("Scarblade Scout's ETB mills two cards", () => {
    state = put(
      state,
      p1,
      "scout",
      card("Scarblade Scout", "Creature — Elf Scout", [2, 2]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("scout"),
      controllerId: p1,
      text: "When this creature enters, mill two cards.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(yard(s, p1)).toHaveLength(2);
    expect(library(s, p1)).toHaveLength(1);
  });
});
