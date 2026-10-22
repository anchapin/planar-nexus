/**
 * Card scripts — return to hand.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted ReturnToHand (#2546)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  isTargetedEffect,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId, Target } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put, spell, cardTarget, battlefield } from "./helpers";

describe("scripted ReturnToHand (#2546)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
    state = put(state, p2, "forest", card("Forest", "Basic Land — Forest"));
    state = put(state, p1, "mine", card("Elk", "Creature — Elk", [3, 3]));
  });

  const zoneOf = (s: GameState, c: string) =>
    Array.from(s.zones.entries()).find(([, z]) =>
      z.cardIds.includes(id(c)),
    )?.[0];

  it("validates ReturnToHand with the removal targets", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "ReturnToHand", target: "creature" })).toBe(true);
    expect(
      ok({ op: "ReturnToHand", target: "creature", controller: "opponent" }),
    ).toBe(true);
    expect(ok({ op: "ReturnToHand", target: "nonland_permanent" })).toBe(true);
    expect(ok({ op: "ReturnToHand", target: "spell" })).toBe(false);
    expect(isTargetedEffect({ op: "ReturnToHand", target: "creature" })).toBe(
      true,
    );
  });

  it("Unsummon returns a target creature to its owner's hand", () => {
    const s = resolveScriptedSpell(
      state,
      getCardScript("Unsummon")!,
      spell(p1, [cardTarget("bear")]),
    );
    expect(zoneOf(s, "bear")).toBe(`${p2}-hand`);
  });

  it("returns a stolen creature to its owner's hand, not its controller's", () => {
    // p1 controls a creature p2 owns: it sits on p1's battlefield.
    let s = put(state, p1, "stolen", card("Wolf", "Creature — Wolf", [2, 2]));
    const cards = new Map(s.cards);
    cards.set(id("stolen"), { ...cards.get(id("stolen"))!, ownerId: p2 });
    s = resolveScriptedSpell(
      { ...s, cards },
      getCardScript("Unsummon")!,
      spell(p2, [cardTarget("stolen")]),
    );
    expect(zoneOf(s, "stolen")).toBe(`${p2}-hand`);
  });

  it("a returned token ceases to exist", () => {
    let s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [
          {
            op: "CreateToken",
            count: 1,
            power: 1,
            toughness: 1,
            color: "white",
            subtypes: ["Soldier"],
          },
        ],
      }),
      spell(p1),
    );
    const token = s.zones
      .get(`${p1}-battlefield`)!
      .cardIds.find((cid) => s.cards.get(cid)!.isToken)!;
    const handBefore = s.zones.get(`${p1}-hand`)!.cardIds.length;
    s = resolveScriptedSpell(s, getCardScript("Unsummon")!, {
      controllerId: p1,
      sourceCardId: null as never,
      targets: [{ type: "card", targetId: token } as Target],
    });
    expect(s.cards.has(token)).toBe(false);
    expect(s.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore);
    expect(s.zones.get(`${p1}-battlefield`)!.cardIds).not.toContain(token);
  });

  it("does nothing to a target that no longer matches", () => {
    // Unauthorized Exit needs a nonland permanent: a land is illegal.
    const s = resolveScriptedSpell(
      state,
      CardScriptSchema.parse({
        name: "X",
        oracle: "x",
        spell: [{ op: "ReturnToHand", target: "nonland_permanent" }],
      }),
      spell(p1, [cardTarget("forest")]),
    );
    expect(zoneOf(s, "forest")).toBe(`${p2}-battlefield`);
  });

  it("Exclusion Mage only returns a creature an opponent controls", () => {
    const effects = getCardScript("Exclusion Mage")!.triggers![0].effects!;
    const run = (target: string) =>
      resolveScriptedSpell(
        state,
        { name: "X", oracle: "x", spell: effects } as CardScript,
        spell(p1, [cardTarget(target)]),
      );
    expect(zoneOf(run("bear"), "bear")).toBe(`${p2}-hand`);
    expect(zoneOf(run("mine"), "mine")).toBe(`${p1}-battlefield`);
  });

  it("Unauthorized Exit returns a nonland permanent", () => {
    const script = getCardScript("Unauthorized Exit")!;
    expect(script.spell!.map((e) => e.op)).toEqual(["ReturnToHand", "Surveil"]);
    const s = resolveScriptedSpell(
      state,
      { ...script, spell: [script.spell![0]] } as CardScript,
      spell(p1, [cardTarget("rock")]),
    );
    expect(zoneOf(s, "rock")).toBe(`${p2}-hand`);
  });
});
