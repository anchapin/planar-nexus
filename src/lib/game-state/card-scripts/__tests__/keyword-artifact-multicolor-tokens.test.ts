/**
 * Card scripts — keyword artifact multicolor tokens.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted keyword, artifact and multicolor tokens (#2496)
 */
import { CardInstance, GameState, PlayerId, StackObject } from "../../types";
import { CardScriptSchema, resolveScriptedAbility } from "../index";
import { createInitialGameState, startGame } from "../../game-state";
import { hasKeyword } from "../../evergreen-keywords";
import { id, card, put, spell, battlefield } from "./helpers";

describe("scripted keyword, artifact and multicolor tokens (#2496)", () => {
  let state: GameState;
  let p1: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1] = Array.from(state.players.keys());
  });

  const etb = (cardId: string, text: string) =>
    ({
      id: "ab-1",
      type: "ability",
      sourceCardId: id(cardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: true,
      activated: false,
    }) as unknown as StackObject;

  const createdBy = (
    name: string,
    typeLine: string,
    text: string,
  ): CardInstance => {
    const s0 = put(state, p1, "src", card(name, typeLine, [1, 1]));
    const before = battlefield(s0, p1).length;
    const s = resolveScriptedAbility(s0, etb("src", text))!;
    const created = battlefield(s, p1).slice(before);
    expect(created).toHaveLength(1);
    return s.cards.get(created[0])!;
  };

  it("Nimble Thopterist makes a colorless Thopter artifact with flying", () => {
    const thopter = createdBy(
      "Nimble Thopterist",
      "Creature — Vedalken Artificer",
      "When this creature enters, create a 1/1 colorless Thopter artifact creature token with flying.",
    );
    expect(thopter.cardData.type_line).toBe(
      "Token Artifact Creature — Thopter",
    );
    expect(thopter.cardData.colors).toEqual([]);
    expect(hasKeyword(thopter, "flying")).toBe(true);
  });

  it("Eager Glyphmage makes a white and black Inkling with flying", () => {
    const inkling = createdBy(
      "Eager Glyphmage",
      "Creature — Cat Cleric",
      "When this creature enters, create a 1/1 white and black Inkling creature token with flying.",
    );
    expect(inkling.cardData.colors).toEqual(["white", "black"]);
    expect(inkling.cardData.type_line).toBe("Token Creature — Inkling");
    expect(hasKeyword(inkling, "flying")).toBe(true);
  });

  it("plain tokens still get no keywords", () => {
    const goblin = createdBy(
      "Elder Auntie",
      "Creature — Goblin Warlock",
      "When this creature enters, create a 1/1 black and red Goblin creature token.",
    );
    expect(goblin.cardData.colors).toEqual(["black", "red"]);
    expect(hasKeyword(goblin, "flying")).toBe(false);
    expect(goblin.cardData.oracle_text).toBe("");
  });

  it("requires exactly one of color or colors", () => {
    const base = {
      op: "CreateToken",
      count: 1,
      power: 1,
      toughness: 1,
      subtypes: ["Inkling"],
    };
    const parse = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "X", spell: [effect] })
        .success;
    expect(parse({ ...base, color: "white" })).toBe(true);
    expect(parse({ ...base, colors: ["white", "black"] })).toBe(true);
    expect(parse(base)).toBe(false);
    expect(parse({ ...base, color: "white", colors: ["white", "black"] })).toBe(
      false,
    );
    expect(parse({ ...base, colors: ["white"] })).toBe(false);
    expect(parse({ ...base, color: "white", keywords: ["shroud"] })).toBe(
      false,
    );
  });
});
