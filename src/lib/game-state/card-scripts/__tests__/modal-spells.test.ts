/**
 * Card scripts — modal spells.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted modal spells (#2523)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
  scriptedModeChoiceError,
  scriptedSpellEffects,
} from "../index";
import { GameState, PlayerId, StackObject, Target } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, spell } from "./helpers";
import { join } from "node:path";
import { parseModes } from "../../oracle-text-parser/modes";
import { readdirSync, readFileSync } from "node:fs";
import { scriptedSpellTargetSpec } from "../../trigger-system/trigger-targets";

describe("scripted modal spells (#2523)", () => {
  const COUNTER = "Counter target spell.";
  const DRAW = "Surveil 2, then draw two cards.";
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  const victim = (controllerId: PlayerId) =>
    ({
      id: "stack-victim",
      type: "spell",
      sourceCardId: null,
      controllerId,
      name: "Victim",
      text: "",
      manaCost: "",
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCopy: false,
      timestamp: 0,
    }) as unknown as StackObject;
  const stackTarget: Target = {
    type: "stack",
    targetId: "stack-victim",
    isValid: true,
  };

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("every modal script matches its card's printed modes", () => {
    // The bundled index drops oracle text, so read the source JSON.
    const dir = join(__dirname, "..", "cards");
    const modal = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as CardScript)
      .filter((s) => s.modes);
    expect(modal.length).toBeGreaterThanOrEqual(2);
    for (const s of modal) {
      const printed = parseModes(s.oracle);
      expect(printed).not.toBeNull();
      expect(s.modes!.choose).toBe(printed!.modeCount);
      const key = (t: string) =>
        t
          .replace(/\([^)]*\)/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      expect(s.modes!.options.map((o) => key(o.text))).toEqual(
        printed!.modes.map(key),
      );
    }
  });

  it("Spellgyre's counter mode counters the target spell", () => {
    const s = resolveScriptedSpell(
      { ...state, stack: [victim(p2)] },
      getCardScript("Spellgyre")!,
      { ...spell(p1, [stackTarget]), chosenModes: [COUNTER] },
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(false);
  });

  it("resolves only the chosen mode, matched without reminder text", () => {
    const script = getCardScript("Spellgyre")!;
    const withReminder = `${DRAW} (To surveil 2, look at the top two cards.)`;
    expect(
      scriptedSpellEffects(script, [withReminder]).map((e) => e.op),
    ).toEqual(["Surveil", "Draw"]);
    expect(scriptedSpellEffects(script, [COUNTER]).map((e) => e.op)).toEqual([
      "Counter",
    ]);
    // School Daze's draw mode leaves a spell on the stack alone.
    const s = resolveScriptedSpell(
      { ...state, stack: [victim(p2)] },
      getCardScript("School Daze")!,
      {
        ...spell(p1, [stackTarget]),
        chosenModes: ["Do Homework — Draw three cards."],
      },
    );
    expect(s.stack.some((o) => o.id === "stack-victim")).toBe(true);
  });

  it("does nothing with no mode chosen", () => {
    const s0 = { ...state, stack: [victim(p2)] };
    const s = resolveScriptedSpell(s0, getCardScript("Spellgyre")!, {
      ...spell(p1, [stackTarget]),
      chosenModes: [],
    });
    expect(s).toBe(s0);
  });

  it("targets follow the chosen mode", () => {
    expect(scriptedSpellTargetSpec("Spellgyre", [DRAW])).toBeNull();
    expect(scriptedSpellTargetSpec("Spellgyre", [COUNTER])).toBeNull();
  });

  it("accepts only exactly `choose` distinct modes of its own", () => {
    const script = getCardScript("Spellgyre")!;
    expect(scriptedModeChoiceError(script, [COUNTER])).toBeNull();
    expect(scriptedModeChoiceError(script, [])).toMatch(/choose exactly 1/);
    expect(scriptedModeChoiceError(script, [COUNTER, DRAW])).not.toBeNull();
    expect(
      scriptedModeChoiceError(script, ["Destroy target creature."]),
    ).not.toBeNull();
    expect(scriptedModeChoiceError(getCardScript("Cancel")!, [])).toBeNull();
  });

  it("validates modes", () => {
    const base = { name: "X", oracle: "x" };
    const opt = (text: string) => ({
      text,
      effects: [{ op: "Draw", amount: 1 }],
    });
    const ok = { choose: 1, options: [opt("a"), opt("b")] };
    expect(CardScriptSchema.safeParse({ ...base, modes: ok }).success).toBe(
      true,
    );
    for (const bad of [
      { ...base, modes: { ...ok, choose: 2 } },
      { ...base, modes: { choose: 1, options: [opt("a"), opt("A")] } },
      { ...base, modes: ok, spell: [{ op: "Draw", amount: 1 }] },
      {
        ...base,
        modes: ok,
        statics: [
          { text: "s", affects: { controller: "you" }, power: 1, toughness: 1 },
        ],
      },
    ]) {
      expect(CardScriptSchema.safeParse(bad).success).toBe(false);
    }
  });
});
