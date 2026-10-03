/**
 * Issue #2452: created tokens are named by their creature subtypes (CR 111.4),
 * not "Token". Found by the landfall-rampaging-baloths differential scenario.
 */
import { describe, it, expect } from "@jest/globals";
import {
  parseSpellEffects,
  parseTokenSubtypes,
  resolveStackObjectEffects,
} from "../effect-resolution";
import { createInitialGameState, startGame } from "../game-state";

describe("token names from oracle text (#2452)", () => {
  it.each([
    ["4/4 green beast creature", ["Beast"]],
    ["1/1 red goblin creature", ["Goblin"]],
    ["1/1 white and black human cleric creature", ["Human", "Cleric"]],
    ["2/2 colorless artifact creature", []],
    ["1/1 white soldier", ["Soldier"]],
  ])("parses %p as %p", (desc, expected) => {
    expect(parseTokenSubtypes(desc)).toEqual(expected);
  });

  it("parses the Beast subtype from Rampaging Baloths' landfall text", () => {
    const effects = parseSpellEffects(
      "Whenever a land you control enters, you may create a 4/4 green Beast creature token.",
    );
    const token = effects.find((e) => e.effectType === "token_creation");
    expect(token).toMatchObject({
      power: 4,
      toughness: 4,
      color: "green",
      subtypes: ["Beast"],
    });
  });

  it("creates a token named Beast with a Beast type line", () => {
    const state = startGame(createInitialGameState(["Alice", "Bob"], 20));
    const alice = Array.from(state.players.keys())[0];
    const effects = parseSpellEffects(
      "Create a 4/4 green Beast creature token.",
    ).map((e) =>
      e.effectType === "token_creation" ? { ...e, controllerId: alice } : e,
    );
    const after = resolveStackObjectEffects(state, effects);
    const token = Array.from(after.cards.values()).find(
      (c) => !state.cards.has(c.id),
    );
    expect(token?.cardData.name).toBe("Beast");
    expect(token?.cardData.type_line).toBe("Token Creature — Beast");
  });

  it("keeps the generic name when the text names no subtype", () => {
    const effects = parseSpellEffects(
      "Create a 2/2 colorless artifact creature token.",
    );
    const token = effects.find((e) => e.effectType === "token_creation");
    expect(token && "subtypes" in token ? token.subtypes : undefined).toBe(
      undefined,
    );
  });
});
