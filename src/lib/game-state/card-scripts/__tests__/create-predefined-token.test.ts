/**
 * Card scripts — create predefined token.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted CreatePredefinedToken (#2544)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId, ScryfallCard } from "../../types";
import { PREDEFINED_TOKENS } from "../predefined-tokens";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { activateAbility } from "../../abilities/activated";
import {
  activateManaAbility,
  hasSacrificeManaAbility,
  parseManaAbility,
} from "../../mana";
import { createInitialGameState, startGame } from "../../game-state";
import { getActivatedAbilities } from "../../abilities/parse";
import { id, card, put, spell, cardTarget, battlefield } from "./helpers";

describe("scripted CreatePredefinedToken (#2544)", () => {
  const tokensNamed = (state: GameState, playerId: PlayerId, name: string) =>
    state.zones
      .get(`${playerId}-battlefield`)!
      .cardIds.map((cid) => state.cards.get(cid)!)
      .filter((c) => c.cardData.name === name);

  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    return { state, p1: Array.from(state.players.keys())[0] };
  };

  it("validates CreatePredefinedToken", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(
      ok({ op: "CreatePredefinedToken", token: "treasure", count: 2 }),
    ).toBe(true);
    expect(ok({ op: "CreatePredefinedToken", token: "clue", count: 0 })).toBe(
      false,
    );
    expect(ok({ op: "CreatePredefinedToken", token: "map", count: 1 })).toBe(
      false,
    );
    expect(
      ok({
        op: "CreatePredefinedToken",
        token: "treasure",
        count: 1,
        who: "opponent",
        tapped: true,
      }),
    ).toBe(true);
    expect(
      ok({
        op: "CreatePredefinedToken",
        token: "food",
        count: 1,
        who: "each_player",
      }),
    ).toBe(false);
  });

  it("resolves Deduce: draw a card, then investigate", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    const handBefore = state.zones.get(`${p1}-hand`)!.cardIds.length;
    state = resolveScriptedSpell(state, getCardScript("Deduce")!, spell(p1));
    expect(state.zones.get(`${p1}-hand`)!.cardIds).toHaveLength(handBefore + 1);
    const clues = tokensNamed(state, p1, "Clue");
    expect(clues).toHaveLength(1);
    expect(clues[0].cardData.type_line).toBe("Token Artifact — Clue");
    expect(clues[0].cardData.oracle_text).toBe(
      PREDEFINED_TOKENS.clue.oracle_text,
    );
    expect(clues[0].cardData.colors).toEqual([]);
  });

  it("creates two Treasures for Rapacious Dragon's count", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    const effects = getCardScript("Rapacious Dragon")!.triggers![0].effects!;
    state = resolveScriptedSpell(
      state,
      { name: "X", oracle: "x", spell: effects } as CardScript,
      spell(p1),
    );
    expect(tokensNamed(state, p1, "Treasure")).toHaveLength(2);
  });

  it("a Treasure sacrifices itself for one mana of the chosen color", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    state = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    state = resolveScriptedSpell(
      state,
      getCardScript("Reckless Ransacking")!,
      spell(p1, [cardTarget("bear")]),
    );
    const [treasure] = tokensNamed(state, p1, "Treasure");
    expect(treasure).toBeDefined();

    const ask = activateManaAbility(state, p1, treasure.id, 0);
    expect(ask.success).toBe(true);
    expect(ask.options?.map((o) => o.description)).toEqual([
      "White",
      "Blue",
      "Black",
      "Red",
      "Green",
    ]);
    const red = ask.options!.find((o) => o.description === "Red")!;
    const paid = activateManaAbility(state, p1, treasure.id, 0, red);
    expect(paid.success).toBe(true);
    expect(paid.state.players.get(p1)!.manaPool.red).toBe(1);
    expect(tokensNamed(paid.state, p1, "Treasure")).toHaveLength(0);
  });

  it("won't sacrifice a Treasure through the colorless activation path", () => {
    const { p1, state: s0 } = fresh();
    let state = s0;
    state = resolveScriptedSpell(
      state,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "CreatePredefinedToken", token: "treasure", count: 1 }],
      } as CardScript,
      spell(p1),
    );
    const [treasure] = tokensNamed(state, p1, "Treasure");
    const r = activateAbility(state, p1, treasure.id, 0);
    expect(r.success).toBe(false);
    expect(tokensNamed(r.state, p1, "Treasure")).toHaveLength(1);
  });

  it("parses sacrifice mana abilities", () => {
    const opts = parseManaAbility(PREDEFINED_TOKENS.treasure.oracle_text);
    expect(opts).toHaveLength(5);
    expect(opts.every((o) => o.sacrificeSelf)).toBe(true);
    expect(
      hasSacrificeManaAbility(PREDEFINED_TOKENS.treasure.oracle_text),
    ).toBe(true);
    expect(hasSacrificeManaAbility("{T}: Add {G}.")).toBe(false);
    expect(hasSacrificeManaAbility(PREDEFINED_TOKENS.food.oracle_text)).toBe(
      false,
    );
    expect(parseManaAbility("{T}: Add {G}.")[0].sacrificeSelf).toBeUndefined();
  });

  it("gives Food and Clue their activated abilities", () => {
    const food = getActivatedAbilities({
      ...card("Food", "Token Artifact — Food"),
      oracle_text: PREDEFINED_TOKENS.food.oracle_text,
      layout: "token",
    } as unknown as ScryfallCard);
    expect(food).toHaveLength(1);
    expect(food[0].costs.tap).toBe(true);
    expect(food[0].costs.sacrifice).toBe(true);
    expect(food[0].costs.mana?.generic).toBe(2);
    const clue = getActivatedAbilities({
      ...card("Clue", "Token Artifact — Clue"),
      oracle_text: PREDEFINED_TOKENS.clue.oracle_text,
      layout: "token",
    } as unknown as ScryfallCard);
    expect(clue[0].costs.tap).toBe(false);
    expect(clue[0].costs.sacrifice).toBe(true);
    expect(clue[0].costs.mana?.generic).toBe(2);
  });

  it("scripts the Treasure, Food and Clue cards", () => {
    const byName = new Map(
      (RAW_CARD_SCRIPTS as unknown as CardScript[]).map((s) => [s.name, s]),
    );
    const tokens = (name: string) => {
      const sc = byName.get(name)!;
      return [
        ...(sc.spell ?? []),
        ...(sc.triggers ?? []).flatMap((t) => t.effects ?? []),
        ...(sc.activated ?? []).flatMap((a) => a.effects ?? []),
      ]
        .filter((e) => e.op === "CreatePredefinedToken")
        .map((e) => (e as { token: string }).token);
    };
    expect(tokens("Bake into a Pie")).toEqual(["food"]);
    expect(tokens("Deduce")).toEqual(["clue"]);
    expect(tokens("Savor")).toEqual(["food"]);
    expect(tokens("Auspicious Arrival")).toEqual(["clue"]);
    expect(tokens("Plundering Pirate")).toEqual(["treasure"]);
    expect(tokens("Gleaming Barrier")).toEqual(["treasure"]);
    expect(tokens("Noggle Robber")).toEqual(["treasure", "treasure"]);
    expect(byName.get("Noggle Robber")!.triggers!.map((t) => t.event)).toEqual([
      "etb",
      "dies",
    ]);
    expect(tokens("Novice Inspector")).toEqual(["clue"]);
    expect(tokens("Cold Case Cracker")).toEqual(["clue"]);
    expect(tokens("Vinereap Mentor")).toEqual(["food", "food"]);
    expect(tokens("Greedy Freebooter")).toEqual(["treasure"]);
    expect(tokens("Stark Industries Executive")).toEqual(["treasure"]);
  });
});
