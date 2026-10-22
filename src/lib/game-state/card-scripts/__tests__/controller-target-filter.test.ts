/**
 * Card scripts — controller target filter.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - controller filter on targets (#2532)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId } from "../../types";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { createInitialGameState, startGame } from "../../game-state";
import { getEffectivePower } from "../../evergreen-keywords";
import { getLegalSpellTargets } from "../../trigger-system/trigger-targets";
import { id, card, put, spell, cardTarget } from "./helpers";
import { matchesController } from "../target-filters";
import { registerCardScripts } from "../registry";

describe("controller filter on targets (#2532)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p1, "mine", card("Elf", "Creature — Elf", [1, 1]));
    state = put(state, p2, "theirs", card("Bear", "Creature — Bear", [2, 2]));
    state = put(state, p2, "rock", card("Mind Stone", "Artifact"));
  });

  const ok = (effect: object) =>
    CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
      .success;

  it("matches the permanent's controller relative to the caster", () => {
    const mine = state.cards.get(id("mine"))!;
    const theirs = state.cards.get(id("theirs"))!;
    expect(matchesController(mine, "you", p1)).toBe(true);
    expect(matchesController(theirs, "you", p1)).toBe(false);
    expect(matchesController(theirs, "opponent", p1)).toBe(true);
    expect(matchesController(mine, "opponent", p1)).toBe(false);
    expect(matchesController(mine, undefined, p1)).toBe(true);
  });

  it("accepts controller only on targeted permanent effects", () => {
    expect(
      ok({
        op: "Pump",
        power: 1,
        toughness: 1,
        target: "creature",
        controller: "you",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "DealDamage",
        amount: 2,
        target: "creature",
        controller: "opponent",
      }),
    ).toBe(true);
    expect(
      ok({ op: "Exile", target: "nonland_permanent", controller: "opponent" }),
    ).toBe(true);
    expect(
      ok({
        op: "PutCounters",
        counter: "+1/+1",
        amount: 1,
        target: "creature",
        controller: "you",
      }),
    ).toBe(true);
    expect(
      ok({
        op: "Pump",
        power: 1,
        toughness: 1,
        target: "self",
        controller: "you",
      }),
    ).toBe(false);
    expect(
      ok({
        op: "DealDamage",
        amount: 2,
        target: "any",
        controller: "opponent",
      }),
    ).toBe(false);
    expect(
      ok({ op: "Destroy", target: "creature", controller: "everyone" }),
    ).toBe(false);
  });

  it("Oracle's Restoration only targets a creature you control", () => {
    state = put(
      state,
      p1,
      "resto",
      card("Oracle's Restoration", "Sorcery"),
      "library",
    );
    expect(getLegalSpellTargets(state, p1, id("resto"))).toEqual(["mine"]);
  });

  it("an opponent-only removal spell offers only their permanents", () => {
    const script: CardScript = CardScriptSchema.parse({
      name: "Test Removal",
      oracle: "Exile target nonland permanent an opponent controls.",
      spell: [
        { op: "Exile", target: "nonland_permanent", controller: "opponent" },
      ],
    });
    // Restore the shared registry afterwards: under `--randomize` a leaked
    // extra script makes "registers every script file" see one card too many.
    registerCardScripts([...RAW_CARD_SCRIPTS, script]);
    try {
      state = put(state, p1, "zap", card("Test Removal", "Instant"), "library");
      expect(getLegalSpellTargets(state, p1, id("zap")).sort()).toEqual([
        "rock",
        "theirs",
      ]);
    } finally {
      registerCardScripts(RAW_CARD_SCRIPTS);
    }
  });

  it("does nothing if the target changed controller before resolution", () => {
    const resto = getCardScript("Oracle's Restoration")!;
    const pumped = (st: GameState) =>
      getEffectivePower(st.cards.get(id("mine"))!);
    const before = pumped(state);
    expect(
      pumped(
        resolveScriptedSpell(state, resto, spell(p1, [cardTarget("mine")])),
      ),
    ).toBe(before + 1);
    // An opponent took the Elf: it's no longer "a creature you control".
    const cards = new Map(state.cards);
    cards.set(id("mine"), { ...cards.get(id("mine"))!, controllerId: p2 });
    const stolen = { ...state, cards };
    const after = resolveScriptedSpell(
      stolen,
      resto,
      spell(p1, [cardTarget("mine")]),
    );
    expect(pumped(after)).toBe(before);
    // The rest of the spell still happens: the caster gains 1 life.
    expect(after.players.get(p1)!.life).toBe(state.players.get(p1)!.life + 1);
  });
});
