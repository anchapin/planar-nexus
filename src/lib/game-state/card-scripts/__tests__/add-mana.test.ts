/**
 * Card scripts — add mana.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted AddMana (#2565)
 *   - scripted AddMana (#2565)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  isTargetedEffect,
  listScriptedCardNames,
  resolveScriptedSpell,
  resolveScriptedAbility,
} from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { activateAbility } from "../../abilities/activated";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put, spell } from "./helpers";
import { parseManaFromEffect } from "../../abilities/mana";

describe("scripted AddMana (#2565)", () => {
  const fresh = () => {
    const state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    return { state, p1: Array.from(state.players.keys())[0] };
  };

  const ok = (effect: object, where: "spell" | "activated" = "spell") =>
    CardScriptSchema.safeParse(
      where === "spell"
        ? { name: "X", oracle: "x", spell: [effect] }
        : {
            name: "X",
            oracle: "x",
            activated: [
              {
                text: "Add {G}.",
                cost: { tap: true, sacrifice: false, exileSelf: false },
                effects: [effect],
              },
            ],
          },
    ).success;

  it("validates AddMana", () => {
    expect(ok({ op: "AddMana", amount: 1, colors: ["G"] }, "activated")).toBe(
      true,
    );
    expect(ok({ op: "AddMana", colors: "any" }, "activated")).toBe(true);
    expect(ok({ op: "AddMana", amount: 1, colors: ["R", "G"] })).toBe(true);
    expect(ok({ op: "AddMana", amount: 0, colors: ["G"] })).toBe(false);
    expect(ok({ op: "AddMana", amount: 1, colors: [] })).toBe(false);
    expect(ok({ op: "AddMana", amount: 1, colors: ["X"] })).toBe(false);
    // Spending restrictions aren't enforced yet, so they can't be scripted.
    expect(
      ok({ op: "AddMana", amount: 1, colors: "any", restrict: "creatures" }),
    ).toBe(false);
  });

  it("is not a targeted effect", () => {
    expect(isTargetedEffect({ op: "AddMana", amount: 1, colors: ["G"] })).toBe(
      false,
    );
  });

  it("adds a fixed color to the controller's pool when it resolves", () => {
    const { p1, state: s0 } = fresh();
    const s = resolveScriptedSpell(
      s0,
      {
        name: "X",
        oracle: "x",
        spell: [{ op: "AddMana", amount: 2, colors: ["R"] }],
      } as CardScript,
      spell(p1),
    );
    expect(s.players.get(p1)!.manaPool.red).toBe(2);
    expect(s.players.get(p1)!.manaPool.green).toBe(0);
  });

  it("Llanowar Elves taps for {G} as a mana ability, without the stack", () => {
    expect(getCardScript("Llanowar Elves")).toBeDefined();
    const { p1, state: s0 } = fresh();
    let s = put(
      s0,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    const cards = new Map(s.cards);
    cards.set(id("elves"), {
      ...cards.get(id("elves"))!,
      hasSummoningSickness: false,
    });
    s = { ...s, cards };
    const stackBefore = s.zones.get("stack")?.cardIds.length ?? 0;

    const r = activateAbility(s, p1, id("elves"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
    expect(r.state.cards.get(id("elves"))!.isTapped).toBe(true);
    expect(r.state.zones.get("stack")?.cardIds.length ?? 0).toBe(stackBefore);
  });

  it("summoning-sick Llanowar Elves can't tap for mana (CR 302.6)", () => {
    const { p1, state: s0 } = fresh();
    const s = put(
      s0,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    const r = activateAbility(s, p1, id("elves"), 0);
    expect(r.success).toBe(false);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
  });

  it("every AddMana script's ability text agrees with its op", () => {
    const symbolKey = {
      W: "white",
      U: "blue",
      B: "black",
      R: "red",
      G: "green",
      C: "colorless",
    } as const;
    for (const name of listScriptedCardNames()) {
      for (const a of getCardScript(name)!.activated ?? []) {
        for (const e of a.effects ?? []) {
          if (e.op !== "AddMana") continue;
          // #2594 follow-up, Wave 4.7 lane 41: the "chosen" sentinel
          // (Heraldic Banner) resolves at activation time against
          // the source's `chosenColor`. The text is "Add one mana of
          // the chosen color." which the textual parser sees as
          // empty — that's correct, the substitution happens in
          // `substituteChosenColorInEffect` at activation time.
          if (Array.isArray(e.colors) && e.colors[0] === "chosen") {
            expect([name, parseManaFromEffect(a.text)]).toEqual([name, {}]);
            expect([name, /the chosen color/i.test(a.text)]).toEqual([
              name,
              true,
            ]);
            continue;
          }
          if (e.colors === "any" || e.colors.length > 1) {
            expect([name, /any (?:one )?color| or \{/i.test(a.text)]).toEqual([
              name,
              true,
            ]);
          } else {
            // After the chosen / any / length>1 branches the
            // remaining colors are a single concrete symbol.
            const symbol = e.colors[0] as keyof typeof symbolKey;
            expect([name, parseManaFromEffect(a.text)]).toEqual([
              name,
              { [symbolKey[symbol]]: e.amount },
            ]);
          }
        }
      }
    }
  });
});

describe("scripted AddMana (#2565)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  /** Bypass CR 302.6 summoning sickness on a test creature (Llanowar Elves). */
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };

  const ability = (
    sourceCardId: string,
    text: string,
    kind: "triggered" | "activated",
  ) =>
    ({
      id: "ab-mana",
      type: "ability",
      sourceCardId: id(sourceCardId),
      controllerId: p1,
      text,
      targets: [],
      triggered: kind === "triggered",
      activated: kind === "activated",
    }) as unknown as StackObject;

  it("validates AddMana with the simple and any-color shapes", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    // The mana dork shape.
    expect(ok({ op: "AddMana", amount: 1, colors: ["G"] })).toBe(true);
    // The Hedron Archive shape.
    expect(ok({ op: "AddMana", amount: 1, colors: ["C"] })).toBe(true);
    // The Gilded Lotus shape — any color, multi-amount.
    expect(ok({ op: "AddMana", amount: 3, colors: "any" })).toBe(true);
  });

  it("rejects unknown color codes and mixed any/array colors", () => {
    const bad = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    // 'Y' is not a CR 106 mana color.
    expect(bad({ op: "AddMana", amount: 1, colors: ["Y"] })).toBe(false);
    // Mixing the array and 'any' literal is not allowed.
    expect(bad({ op: "AddMana", amount: 1, colors: ["R", "any"] })).toBe(false);
    // Empty array is not allowed.
    expect(bad({ op: "AddMana", amount: 1, colors: [] })).toBe(false);
    // Extra fields are rejected by the strict() check.
    expect(bad({ op: "AddMana", amount: 1, colors: ["G"], extra: 1 })).toBe(
      false,
    );
  });

  it("Llanowar Elves' tap ability adds one green mana", () => {
    let s0 = put(
      state,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    s0 = ready(s0, "elves");
    const s = resolveScriptedAbility(
      s0,
      ability("elves", "Add {G}.", "activated"),
    )!;
    expect(s.players.get(p1)!.manaPool.green).toBe(1);
    expect(s.players.get(p2)!.manaPool.green).toBe(0);
  });

  it("Llanowar Elves' activation through the engine adds one green mana", () => {
    let s0 = put(
      state,
      p1,
      "elves",
      card("Llanowar Elves", "Creature — Elf Druid", [1, 1]),
    );
    s0 = ready(s0, "elves");
    const r = activateAbility(s0, p1, id("elves"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
    expect(r.state.cards.get(id("elves"))!.isTapped).toBe(true);
  });

  it("Hedron Archive's tap ability adds one colorless mana", () => {
    const s0 = put(
      state,
      p1,
      "archive",
      card("Hedron Archive", "Artifact", [0, 0]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability("archive", "Add {C}.", "activated"),
    )!;
    expect(s.players.get(p1)!.manaPool.colorless).toBe(1);
  });

  it("Hedron Archive's sacrifice ability draws two cards", () => {
    const s0 = put(
      state,
      p1,
      "archive",
      card("Hedron Archive", "Artifact", [0, 0]),
    );
    const before = s0.zones.get(`${p1}-hand`)!.cardIds.length;
    const s = resolveScriptedAbility(
      s0,
      ability("archive", "Draw two cards.", "activated"),
    )!;
    expect(s.zones.get(`${p1}-hand`)!.cardIds.length).toBe(before + 2);
  });

  it("Gilded Lotus' tap ability leaves the color choice for the mana-ability path", () => {
    // The scripted interpreter returns state unchanged for "any" colors
    // (CR 605.3a: the color choice is the player's via the mana-ability
    // path, not the scripted path). The engine's `activateAbility` is
    // what surfaces the choice — see the test below.
    const s0 = put(
      state,
      p1,
      "lotus",
      card("Gilded Lotus", "Artifact", [0, 0]),
    );
    const s = resolveScriptedAbility(
      s0,
      ability("lotus", "Add three mana of any one color.", "activated"),
    );
    expect(s).toBeDefined();
    expect(s!.players.get(p1)!.manaPool).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    });
  });

  it("Gilded Lotus' activation refuses the 'any one color' choice and asks the player to pick", () => {
    const s0 = put(
      state,
      p1,
      "lotus",
      card("Gilded Lotus", "Artifact", [0, 0]),
    );
    const r = activateAbility(s0, p1, id("lotus"), 0);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/choose a color/i);
    expect(r.state.cards.get(id("lotus"))!.isTapped).toBe(false);
  });
});
