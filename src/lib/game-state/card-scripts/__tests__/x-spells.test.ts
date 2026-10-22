/**
 * Card scripts — x spells.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted X spells (#2552)
 */
import {
  CARDS_DIR,
  id,
  card,
  put,
  spell,
  cardTarget,
  playerTarget,
} from "./helpers";
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  effectTargetCount,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId, Target } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { hasKeyword } from "../../evergreen-keywords";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { withX as withXEffect } from "../interpret";

describe("scripted X spells (#2552)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
    state = put(state, p2, "bear", card("Bear", "Creature — Bear", [2, 2]));
  });

  const withX = (
    controllerId: PlayerId,
    x: number,
    targets: Target[] = [],
  ) => ({
    ...spell(controllerId, targets),
    variableValues: new Map([["X", x]]),
  });
  const handSize = (s: GameState, p: PlayerId) =>
    s.zones.get(`${p}-hand`)!.cardIds.length;

  it("validates X amounts", () => {
    const ok = (effect: object) =>
      CardScriptSchema.safeParse({ name: "X", oracle: "x", spell: [effect] })
        .success;
    expect(ok({ op: "Draw", amount: "X", who: "you" })).toBe(true);
    expect(ok({ op: "DealDamage", amount: "X", target: "any" })).toBe(true);
    expect(
      ok({ op: "Pump", power: "-X", toughness: "-X", target: "creature" }),
    ).toBe(true);
    expect(
      ok({ op: "PutCounters", counter: "+1/+1", amount: "X", target: "self" }),
    ).toBe(true);
    expect(ok({ op: "Draw", amount: "-X", who: "you" })).toBe(false);
    expect(ok({ op: "Draw", amount: "Y", who: "you" })).toBe(false);
  });

  it("validates X amounts on trigger and activated effects (#2559)", () => {
    // X in the `effects` of a trigger — exercises the schema work PR #2553
    // already shipped, restated here as the trigger-side half of #2559.
    const triggerOk = CardScriptSchema.safeParse({
      name: "X-Trigger",
      oracle: "Whenever this enters, draw X cards.",
      triggers: [
        {
          text: "Whenever this enters, draw X cards.",
          event: "etb",
          subject: "self",
          effects: [{ op: "Draw", amount: "X", who: "you" }],
        },
      ],
    });
    expect(triggerOk.success).toBe(true);

    // X in the `effects` of an activated ability — same coverage.
    // The {X} activation cost itself isn't in the schema yet (separate
    // work, see `X cost in activation cost [fdn]`); we use a mana cost
    // here to focus on the effect schema.
    const activatedOk = CardScriptSchema.safeParse({
      name: "X-Activated",
      oracle: "{1}: this creature gets +X/+X until end of turn.",
      activated: [
        {
          text: "{1}: this creature gets +X/+X until end of turn.",
          cost: { mana: "{1}", tap: true },
          effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
        },
      ],
    });
    expect(activatedOk.success).toBe(true);
  });

  it("only cards with X in their text use X", () => {
    for (const file of readdirSync(CARDS_DIR).filter((f) =>
      f.endsWith(".json"),
    )) {
      const text = readFileSync(join(CARDS_DIR, file), "utf8");
      // Wave 4.8 follow-up 12 lane 90 (#2614 follow-up): the
      // JSON-key `"X": "creaturesDiedThisTurn"` arm on
      // `Draw.amount.X` is NOT a CR 107.3 mana-cost X. Strip
      // JSON field-key usages of "X" before checking for CR
      // 107.3-X.
      const stripped = text.replace(/"X"\s*:\s*"[^"]*"/g, "");
      if (/"-?X"/.test(stripped)) {
        const { name, oracle } = JSON.parse(text) as CardScript;
        expect(`${name}: ${oracle}`).toMatch(/\bX\b/);
      }
    }
  });

  it("Mind Spring draws X cards", () => {
    let s = state;
    for (let i = 0; i < 5; i++)
      s = put(s, p1, `lib${i}`, card(`Lib ${i}`, "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Mind Spring")!,
      withX(p1, 3),
    );
    expect(handSize(after, p1)).toBe(before + 3);
  });

  it("an X spell cast with no X does nothing", () => {
    let s = state;
    s = put(s, p1, "lib0", card("Lib 0", "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Mind Spring")!,
      spell(p1),
    );
    expect(handSize(after, p1)).toBe(before);
  });

  it("Traumatic Critique deals X damage to a creature or a player", () => {
    const script = getCardScript("Traumatic Critique")!;
    const atBear = resolveScriptedSpell(
      state,
      script,
      withX(p1, 3, [cardTarget("bear")]),
    );
    expect(atBear.cards.get(id("bear"))!.damage).toBe(3);
    const atFace = resolveScriptedSpell(
      state,
      script,
      withX(p1, 4, [playerTarget(p2)]),
    );
    expect(atFace.players.get(p2)!.life).toBe(16);
  });

  it("withX fills in X and -X", () => {
    expect(
      withXEffect(
        { op: "Pump", power: "-X", toughness: "X", target: "creature" },
        2,
      ),
    ).toMatchObject({ power: -2, toughness: 2 });
  });

  it("Primal Might pumps +X/+X then fights", () => {
    // p1 has a Bear (2/2); p2 has a Boar (3/3). Cast Primal Might with X=2.
    // The Bear becomes 4/4 until end of turn, then fights the Boar.
    // 4 damage to Boar (dies), 3 damage to Bear (dies).
    let s = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    s = put(s, p2, "boar", card("Boar", "Creature — Boar", [3, 3]));
    const after = resolveScriptedSpell(
      s,
      getCardScript("Primal Might")!,
      withX(p1, 2, [cardTarget("bear"), cardTarget("boar")]),
    );
    expect(after.cards.get(id("bear"))!.damage).toBe(3); // 3 damage from Boar
    expect(after.cards.get(id("boar"))!.damage).toBe(4); // 4 damage from Bear (2 + X=2)
  });

  it("Pedal to the Metal gives +X/+0 and first strike to one target", () => {
    let s = put(state, p1, "bear", card("Bear", "Creature — Bear", [2, 2]));
    const script = getCardScript("Pedal to the Metal")!;
    expect(script.spell!.reduce((n, e) => n + effectTargetCount(e), 0)).toBe(1);
    s = resolveScriptedSpell(s, script, withX(p1, 3, [cardTarget("bear")]));
    const bear = s.cards.get(id("bear"))!;
    expect(getEffectivePower(bear)).toBe(5);
    expect(getEffectiveToughness(bear)).toBe(2);
    expect(hasKeyword(bear, "first strike")).toBe(true);
  });

  it("Finale of Revelation draws X cards", () => {
    let s = state;
    for (let i = 0; i < 5; i++)
      s = put(s, p1, `lib${i}`, card(`Lib ${i}`, "Instant"), "library");
    const before = handSize(s, p1);
    const after = resolveScriptedSpell(
      s,
      getCardScript("Finale of Revelation")!,
      withX(p1, 3),
    );
    expect(handSize(after, p1)).toBe(before + 3);
  });
});
