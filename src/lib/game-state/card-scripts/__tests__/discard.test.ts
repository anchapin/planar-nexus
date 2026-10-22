/**
 * Card scripts — discard.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted Discard (#2536)
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
import { passPriority } from "../../game-state";
import { resolveWaitingChoice } from "../../spell-casting/choices";

describe("scripted Discard (#2536)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const hand = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-hand`)!.cardIds;
  const yard = (st: GameState, p: PlayerId) =>
    st.zones.get(`${p}-graveyard`)!.cardIds;
  const discardScript = (effects: object[]): CardScript =>
    CardScriptSchema.parse({
      name: "Discard Test",
      oracle: "x",
      spell: effects,
    });

  /** Empty every hand and library, then give each player `n` known cards. */
  const setup = (names: string[], n: number) => {
    let st = startGame(createInitialGameState(names, 20, false));
    const players = Array.from(st.players.keys());
    const zones = new Map(st.zones);
    for (const p of players) {
      for (const z of ["hand", "library"]) {
        const key = `${p}-${z}`;
        zones.set(key, { ...zones.get(key)!, cardIds: [] });
      }
    }
    st = { ...st, zones };
    for (const p of players) {
      for (let i = 1; i <= n; i++) {
        st = put(st, p, `${p}-h${i}`, card(`Hand ${i}`, "Sorcery"), "hand");
        st = put(st, p, `${p}-l${i}`, card(`Lib ${i}`, "Sorcery"), "library");
      }
    }
    return { st, players };
  };

  beforeEach(() => {
    const { st, players } = setup(["Player1", "Player2"], 3);
    state = st;
    [p1, p2] = players;
  });

  it("validates Discard and keeps it after every other effect", () => {
    const ok = (effects: object[]) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: effects })
        .success;
    expect(ok([{ op: "Discard", amount: 1 }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 2, who: "target_player" }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 1, who: "each_opponent" }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 1, who: "each_player" }])).toBe(true);
    expect(ok([{ op: "Discard", amount: 0 }])).toBe(false);
    expect(
      ok([
        { op: "Draw", amount: 2 },
        { op: "Discard", amount: 1 },
      ]),
    ).toBe(true);
    expect(
      ok([
        { op: "Discard", amount: 1 },
        { op: "Draw", amount: 2 },
      ]),
    ).toBe(false);
  });

  it("asks the discarding player to choose, then discards the pick", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(p1),
    );
    const choice = s.waitingChoice!;
    expect(choice.type).toBe("discard_cards");
    expect(choice.playerId).toBe(p2);
    expect(choice.minChoices).toBe(1);
    expect(choice.choices.map((c) => c.value)).toEqual(hand(s, p2));
    expect(yard(s, p2)).toEqual([]);

    const picked = `${p2}-h2`;
    const r = resolveWaitingChoice(s, p2, [picked]);
    expect(r.success).toBe(true);
    expect(r.state.waitingChoice).toBeNull();
    expect(yard(r.state, p2)).toEqual([picked]);
    expect(hand(r.state, p2)).not.toContain(picked);
    expect(r.state.cards.get(id(picked))!.currentZoneKey).toBe(
      `${p2}-graveyard`,
    );
    expect(hand(r.state, p1)).toHaveLength(3);
  });

  it("rejects a pick of the wrong size or from outside the hand", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 2, who: "target_player" }]),
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.waitingChoice!.playerId).toBe(p2);
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`]).success).toBe(false);
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p2}-h1`]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p1}-h1`]).success).toBe(
      false,
    );
    expect(resolveWaitingChoice(s, p1, [`${p1}-h1`]).success).toBe(false);
    const r = resolveWaitingChoice(s, p2, [`${p2}-h1`, `${p2}-h3`]);
    expect(r.success).toBe(true);
    expect(hand(r.state, p2)).toEqual([`${p2}-h2`]);
  });

  it("discards the whole hand without asking when it is short", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 3 }]),
      spell(p1),
    );
    expect(s.waitingChoice).toBeNull();
    expect(hand(s, p1)).toEqual([]);
    expect(yard(s, p1)).toHaveLength(3);
  });

  it("loots: draws first, so the drawn cards can be discarded", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([
        { op: "Draw", amount: 3 },
        { op: "Discard", amount: 1 },
      ]),
      spell(p1),
    );
    expect(hand(s, p1)).toHaveLength(6);
    expect(s.waitingChoice!.playerId).toBe(p1);
    const drawn = hand(s, p1).find((c) => c.includes("-l"))!;
    const r = resolveWaitingChoice(s, p1, [drawn]);
    expect(r.success).toBe(true);
    expect(yard(r.state, p1)).toEqual([drawn]);
    expect(hand(r.state, p1)).toHaveLength(5);
  });

  it("holds priority until the discard is answered", () => {
    const s = resolveScriptedSpell(
      state,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(p1),
    );
    expect(passPriority(s, s.priorityPlayerId!)).toBe(s);
  });

  it("asks each opponent in turn in a multiplayer game", () => {
    const { st, players } = setup(["Player1", "Player2", "Player3"], 2);
    const [a, b, c] = players;
    const s = resolveScriptedSpell(
      st,
      discardScript([{ op: "Discard", amount: 1, who: "each_opponent" }]),
      spell(a),
    );
    expect(s.waitingChoice!.playerId).toBe(b);
    expect(s.waitingChoice!.pendingDiscards).toEqual([
      { playerId: c, amount: 1 },
    ]);
    const first = resolveWaitingChoice(s, b, [`${b}-h1`]);
    expect(first.success).toBe(true);
    expect(first.state.waitingChoice!.playerId).toBe(c);
    expect(first.state.waitingChoice!.pendingDiscards).toBeUndefined();
    const second = resolveWaitingChoice(first.state, c, [`${c}-h2`]);
    expect(second.state.waitingChoice).toBeNull();
    expect(yard(second.state, b)).toEqual([`${b}-h1`]);
    expect(yard(second.state, c)).toEqual([`${c}-h2`]);
    expect(hand(second.state, a)).toHaveLength(2);
  });

  it("Burglar Rat's ETB makes each opponent discard a card", () => {
    state = put(
      state,
      p1,
      "rat",
      card("Burglar Rat", "Creature — Rat", [1, 1]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-1",
      type: "ability",
      sourceCardId: id("rat"),
      controllerId: p1,
      text: "When this creature enters, each opponent discards a card.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(s.waitingChoice!.type).toBe("discard_cards");
    expect(s.waitingChoice!.playerId).toBe(p2);
  });

  it("Icewind Elemental's ETB draws a card, then asks for a discard", () => {
    state = put(
      state,
      p1,
      "icewind",
      card("Icewind Elemental", "Creature — Elemental", [3, 4]),
    );
    const s = resolveScriptedAbility(state, {
      id: "ab-2",
      type: "ability",
      sourceCardId: id("icewind"),
      controllerId: p1,
      text: "When this creature enters, draw a card, then discard a card.",
      targets: [],
      triggered: true,
      activated: false,
    } as unknown as StackObject)!;
    expect(hand(s, p1)).toHaveLength(4);
    expect(s.waitingChoice!.playerId).toBe(p1);
    expect(s.waitingChoice!.minChoices).toBe(1);
  });
});
