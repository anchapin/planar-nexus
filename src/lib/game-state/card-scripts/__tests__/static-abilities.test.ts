/**
 * Card scripts — static abilities.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted static abilities (#2496)
 */
import { CardScriptSchema } from "../index";
import { GameState, PlayerId } from "../../types";
import { checkStateBasedActions } from "../../state-based-actions";
import { createInitialGameState, startGame } from "../../game-state";
import { destroyCard } from "../../keyword-actions/removal";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { id, card, put, battlefield } from "./helpers";
import { refreshScriptedStatics } from "../../keyword-actions/scripted-statics";
import { refreshTribalAnthems } from "../../keyword-actions/tribal-anthem";

describe("scripted static abilities (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  const pt = (s: GameState, cardId: string) => {
    const c = s.cards.get(id(cardId))!;
    return [getEffectivePower(c), getEffectiveToughness(c)];
  };

  it("Anthem of Champions pumps your creatures, not the opponent's", () => {
    let s = put(
      state,
      p1,
      "anthem",
      card("Anthem of Champions", "Enchantment"),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = put(s, p2, "foe", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = refreshScriptedStatics(s);
    expect(pt(s, "bear")).toEqual([3, 3]);
    expect(pt(s, "foe")).toEqual([2, 2]);
  });

  it("Regal Imperiosaur pumps other Dinosaurs once, not itself", () => {
    let s = put(
      state,
      p1,
      "rex",
      card("Regal Imperiosaur", "Creature — Dinosaur", [2, 2]),
    );
    s = put(s, p1, "dino", card("Raptor", "Creature — Dinosaur", [2, 1]));
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    // The oracle-text lord path must not also apply it.
    s = refreshScriptedStatics(refreshTribalAnthems(s));
    expect(pt(s, "dino")).toEqual([3, 2]);
    expect(pt(s, "rex")).toEqual([2, 2]);
    expect(pt(s, "bear")).toEqual([2, 2]);
  });

  it("Samut gives creatures you control haste, itself included", () => {
    let s = put(
      state,
      p1,
      "samut",
      card(
        "Samut, Hazoret's Champion",
        "Legendary Creature — Human Warrior Cleric",
        [2, 2],
      ),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = put(s, p2, "foe", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    // The grant line alone is not Samut's own haste.
    expect(hasKeyword(s.cards.get(id("samut"))!, "haste")).toBe(false);
    s = refreshScriptedStatics(s);
    expect(hasKeyword(s.cards.get(id("samut"))!, "haste")).toBe(true);
    expect(hasKeyword(s.cards.get(id("bear"))!, "haste")).toBe(true);
    expect(hasKeyword(s.cards.get(id("foe"))!, "haste")).toBe(false);
  });

  it("the bonus ends when the source leaves the battlefield", () => {
    let s = put(
      state,
      p1,
      "anthem",
      card("Anthem of Champions", "Enchantment"),
    );
    s = put(s, p1, "bear", card("Grizzly Bears", "Creature — Bear", [2, 2]));
    s = checkStateBasedActions(s).state;
    expect(pt(s, "bear")).toEqual([3, 3]);
    s = checkStateBasedActions(destroyCard(s, id("anthem")).state).state;
    expect(pt(s, "bear")).toEqual([2, 2]);
  });

  it("validates statics", () => {
    const parse = (stat: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "X", statics: [stat] })
        .success;
    const affects = { controller: "you" };
    expect(parse({ text: "t", affects, power: 1, toughness: 1 })).toBe(true);
    expect(parse({ text: "t", affects, keywords: ["haste"] })).toBe(true);
    expect(parse({ text: "t", affects })).toBe(false);
    expect(parse({ text: "t", affects, power: 1 })).toBe(false);
    expect(
      parse({ text: "t", affects: { controller: "all" }, keywords: ["haste"] }),
    ).toBe(false);
  });
});
