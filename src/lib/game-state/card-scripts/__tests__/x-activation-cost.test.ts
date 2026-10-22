/**
 * Card scripts — x activation cost.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - scripted X activation cost (#2559, #2594 #18)
 */
import { CardScript } from "../schema";
import { CardScriptSchema, resolveScriptedAbility } from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { RAW_CARD_SCRIPTS } from "../cards/index.generated";
import { activateAbility } from "../../abilities/activated";
import { createInitialGameState, startGame } from "../../game-state";
import { getActivatedAbilities } from "../../abilities/parse";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../../evergreen-keywords";
import { id, card, put, spell, battlefield } from "./helpers";
import { registerCardScripts } from "../registry";

describe("scripted X activation cost (#2559, #2594 #18)", () => {
  // CR 107.3 / 602 — an activated ability whose mana cost contains {X} pays
  // the chosen X as generic mana on top of the printed colored cost. The
  // X value flows from the source's `xValue` (set when the spell/permanent
  // was cast) into `StackObject.variableValues`; here we confirm the
  // engine's `activateAbility` honors the parsed `manaCost.X` against
  // `card.xValue` and the player's pool.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Hypothetical X-cost permanent whose "{X}{G}, {T}: this creature gets
  // +X/+X until end of turn" mirrors Heroes' Bane. We register it as a
  // fixture because `getActivatedAbilities` reads scripted abilities from
  // the registry keyed on card name. The `text` is the *effect* part
  // (after the colon) — see Burnished Hart for the canonical shape; the
  // cost string lives in `cost.mana`, never in `text`.
  const xHydraScript: CardScript = {
    name: "Test X Hydra",
    oracle:
      "{X}{G}, {T}: This creature gets +X/+X until end of turn. (X-cost activation; #2559 + #2594 #18.)",
    activated: [
      {
        text: "This creature gets +X/+X until end of turn.",
        cost: { mana: "{X}{G}", tap: true, sacrifice: false, exileSelf: false },
        effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
      },
    ],
  };

  beforeAll(() => registerCardScripts([...RAW_CARD_SCRIPTS, xHydraScript]));
  afterAll(() => registerCardScripts(RAW_CARD_SCRIPTS));

  // Tap-state helper: a permanent that was just put on the battlefield
  // has summoning sickness and can't be tapped for an ability. The
  // Llanowar Elves test uses the same pattern (#2565).
  const ready = (s: GameState, cardId: string): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), {
      ...cards.get(id(cardId))!,
      hasSummoningSickness: false,
    });
    return { ...s, cards };
  };

  // Add the chosen X + colored cost to the player's pool so the
  // activation can pay for itself.
  const fundPool = (s: GameState, x: number, green: number): GameState => {
    const player = s.players.get(p1);
    if (!player) return s;
    const updated = new Map(s.players);
    updated.set(p1, {
      ...player,
      manaPool: {
        ...player.manaPool,
        generic: x,
        green,
      },
    });
    return { ...s, players: updated };
  };

  // Stamp `xValue` on the source the way `castSpell` would when the
  // permanent was cast with X chosen.
  const stampX = (s: GameState, cardId: string, x: number): GameState => {
    const cards = new Map(s.cards);
    cards.set(id(cardId), { ...cards.get(id(cardId))!, xValue: x });
    return { ...s, cards };
  };

  it("schema accepts {X} in the activation cost regex", () => {
    // A single-symbol {X} activation.
    const single = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}: draw a card.",
          cost: { mana: "{X}" },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(single.success).toBe(true);

    // Mixed {X}{G}.
    const mixed = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}{G}: +X/+X.",
          cost: { mana: "{X}{G}" },
          effects: [{ op: "Pump", power: "X", toughness: "X", target: "self" }],
        },
      ],
    });
    expect(mixed.success).toBe(true);

    // Multi-X {X}{X}{R} (Steel Hellkite style).
    const multiX = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{X}{X}{R}: deal X.",
          cost: { mana: "{X}{X}{R}" },
          effects: [{ op: "DealDamage", amount: "X", target: "any" }],
        },
      ],
    });
    expect(multiX.success).toBe(true);
  });

  it("schema still rejects an unknown mana symbol in the cost", () => {
    const result = CardScriptSchema.safeParse({
      name: "X",
      oracle: "x",
      activated: [
        {
          text: "{Y}: draw a card.",
          cost: { mana: "{Y}" },
          effects: [{ op: "Draw", amount: 1, who: "you" }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("getActivatedAbilities parses {X} into manaCost.X (not generic)", () => {
    // {X}{G} on a scripted permanent: parseManaCost stores X=0 and
    // green=1; the X value is read at activation time from the source's
    // xValue, not from the parsed numeric field. The activation-payment
    // path is what we test here.
    const hydra = card("Test X Hydra", "Creature — Hydra", [0, 0]);
    const abilities = getActivatedAbilities(hydra);
    expect(abilities).toHaveLength(1);
    const mc = abilities[0].costs.mana;
    expect(mc).not.toBeNull();
    expect(mc!.X).toBe(0);
    expect(mc!.generic).toBe(0);
    expect(mc!.green).toBe(1);
  });

  it("activation pays (xValue + printed colored) from the pool", () => {
    // Wildwood-style X-cost permanent cast with X=3, then activated.
    // 3 generic + 1 green = 4 mana total. The pool is fully drained
    // by the activation, and the +X/+X pump is applied on resolution.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 3), "xhydra");
    s = fundPool(s, 3, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(true);
    // Pool drained.
    expect(r.state.players.get(p1)!.manaPool.generic).toBe(0);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
    // The scripted ability is on the stack with the chosen X seeded in
    // `variableValues` (the activation path mirrors the trigger path,
    // #2559). Resolving it applies the +3/+3 pump.
    const stackObj = r.state.stack[r.state.stack.length - 1];
    expect(stackObj.variableValues.get("X")).toBe(3);
    const resolved = resolveScriptedAbility(r.state, stackObj)!;
    const hydra = resolved.cards.get(id("xhydra"))!;
    expect(getEffectivePower(hydra)).toBe(3);
    expect(getEffectiveToughness(hydra)).toBe(3);
  });

  it("activation refuses the {X} cost when the pool is short of X", () => {
    // X=4 chosen, but only 3 generic in the pool. The engine must not
    // silently spend the printed green while refusing the X.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 4), "xhydra");
    s = fundPool(s, 3, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(false);
    // Mana untouched (the engine bails before spending — see
    // activated.ts `Not enough mana` branch).
    expect(r.state.players.get(p1)!.manaPool.generic).toBe(3);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(1);
  });

  it("X=0 activation costs only the printed colored mana", () => {
    // Cast with X=0 (a hypothetical "use no X" case) — the engine pays
    // 0 generic + 1 green, drains the green, and applies +0/+0 on
    // resolution.
    let s = put(
      state,
      p1,
      "xhydra",
      card("Test X Hydra", "Creature — Hydra", [0, 0]),
    );
    s = ready(stampX(s, "xhydra", 0), "xhydra");
    s = fundPool(s, 0, 1);

    const r = activateAbility(s, p1, id("xhydra"), 0);
    expect(r.success).toBe(true);
    expect(r.state.players.get(p1)!.manaPool.green).toBe(0);
    const stackObj = r.state.stack[r.state.stack.length - 1];
    expect(stackObj.variableValues.get("X")).toBe(0);
    const resolved = resolveScriptedAbility(r.state, stackObj)!;
    const hydra = resolved.cards.get(id("xhydra"))!;
    expect(getEffectivePower(hydra)).toBe(0);
    expect(getEffectiveToughness(hydra)).toBe(0);
  });
});
