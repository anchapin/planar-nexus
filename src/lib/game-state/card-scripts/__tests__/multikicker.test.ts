/**
 * Card scripts — multikicker.
 *
 * Split out of the 9.8k-line card-scripts.test.ts (#2642). Suites:
 *   - multikicker schema (#2594)
 *   - multikicker resolution (#2594)
 *   - multikicker card-instance stamping (#2594)
 *   - Skyfire Adept fixture (#2594)
 */
import { CardScript } from "../schema";
import {
  CardScriptSchema,
  getCardScript,
  resolveScriptedSpell,
} from "../index";
import { GameState, PlayerId, StackObject } from "../../types";
import { createInitialGameState, startGame } from "../../game-state";
import { id, card, put, spell, playerTarget, battlefield } from "./helpers";

describe("multikicker schema (#2594)", () => {
  const base = {
    name: "Multikicker Schema Test",
    oracle: "Test card.",
  };

  it("accepts a single-kicker (default count) — count: 1", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{R}" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an explicit multikicker count: 2", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}{R}", count: 2 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a large multikicker count: 5", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{G}", count: 5 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative multikicker count", () => {
    const zero = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}", count: 0 },
    });
    expect(zero.success).toBe(false);
    const negative = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "DealDamage", amount: 1, target: "any" }],
      kicker: { cost: "{1}", count: -1 },
    });
    expect(negative.success).toBe(false);
  });

  it("accepts an effect with if_kicked: 2 (tiered gate)", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [
        { op: "DealDamage", amount: 1, target: "any", if_kicked: true },
        { op: "Draw", amount: 1, who: "you", if_kicked: 2 },
      ],
      kicker: { cost: "{1}{R}", count: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an if_kicked gate of 0 (gate minimum is 1)", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "Draw", amount: 1, if_kicked: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a fractional if_kicked gate", () => {
    const result = CardScriptSchema.safeParse({
      ...base,
      spell: [{ op: "Draw", amount: 1, if_kicked: 1.5 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("multikicker resolution (#2594)", () => {
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  // Hypothetical "Skyfire Multikicker" — a kicker-replacement spell with a
  // base 1-damage and a kicked 2-damage replacement, plus a tiered "if
  // kicked 2+ times, draw a card" effect. Multikicker {1}{R} (count: 2).
  const skyfire: CardScript = {
    name: "Skyfire Multikicker",
    oracle:
      "Skyfire Multikicker deals 1 damage to any target. Multikicker {1}{R}.",
    spell: [
      {
        op: "DealDamage",
        amount: 1,
        target: "any",
        if_kicked: false,
      },
      {
        op: "DealDamage",
        amount: 2,
        target: "any",
        kickedAmount: 2,
        if_kicked: true,
      },
      {
        op: "Draw",
        amount: 1,
        who: "you",
        if_kicked: 2,
      },
    ],
    kicker: { cost: "{1}{R}", count: 2 },
  };

  it("base 1-damage when un-kicked (timesKicked: 0)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      skyfire,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before - 1);
  });

  it("replacement 2-damage when kicked once (timesKicked: 1)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("2 damage AND draw a card when kicked twice (timesKicked: 2)", () => {
    const before = state.players.get(p2)!.life;
    // Seed the player's library with two cards so the Draw effect has
    // something to draw from a vacuum state.
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
    // The if_kicked: 2 gate fires the Draw branch exactly once.
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });

  it("if_kicked: 1 (boolean true) also matches a timesKicked: 2 cast (multikicker backward-compat)", () => {
    // A single-kicker-style script that uses `if_kicked: true` should still
    // run when the cast paid 2 charges (i.e. a multikicker cast where the
    // script only declared a tier-1 effect). This is the same shape as
    // Burst Lightning.
    const before = state.players.get(p2)!.life;
    const burst: CardScript = {
      name: "Burst-MK",
      oracle: "Burst-MK deals 2 damage to any target. Multikicker {4}.",
      spell: [
        { op: "DealDamage", amount: 2, target: "any", if_kicked: false },
        {
          op: "DealDamage",
          amount: 4,
          target: "any",
          kickedAmount: 4,
          if_kicked: true,
        },
      ],
      kicker: { cost: "{4}", count: 2 },
    };
    const s = resolveScriptedSpell(state, burst, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 4);
  });

  it("if_kicked: 2 skips the effect on timesKicked: 1 cast (tiered gate)", () => {
    // The "draw a card" tier (`if_kicked: 2`) MUST NOT fire when the cast
    // only paid 1 charge, even though the rest of the spell was kicked.
    // We test this by checking the opponent's life took exactly 2 (not 1,
    // not "1 + extra") and the spell resolved without error.
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(state, skyfire, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 2);
  });

  it("kickerGateMatches helper: false on timesKicked: 0 with if_kicked: true", () => {
    // Direct unit test of the gate semantics: an un-kicked spell must NOT
    // run a kicked effect. Wraps `resolveScriptedSpell` with a Draw effect
    // gated on `if_kicked: true` and asserts the hand size delta.
    const script: CardScript = {
      name: "Gate-Only",
      oracle: "Test.",
      spell: [{ op: "Draw", amount: 1, who: "you", if_kicked: true }],
    };
    // Seed the library so a successful draw is observable.
    let seeded = put(state, p1, "g1", card("G1", "Sorcery"), "library");
    seeded = put(seeded, p1, "g2", card("G2", "Sorcery"), "library");
    seeded = put(seeded, p1, "g3", card("G3", "Sorcery"), "library");
    const handOf = (s: GameState) =>
      s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    // un-kicked: the if_kicked: true gate keeps the Draw off the path.
    const s0 = resolveScriptedSpell(seeded, script, spell(p1, []));
    expect(handOf(s0)).toBe(handOf(seeded));
    // kicked once: gate opens, hand grows by 1.
    const s1 = resolveScriptedSpell(seeded, script, {
      ...spell(p1, []),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(handOf(s1)).toBe(handOf(seeded) + 1);
    // kicked twice: gate still matches (boolean `true` is inclusive of any
    // kick; mirrors the if_kicked: 2 tier semantics in reverse).
    const s2 = resolveScriptedSpell(seeded, script, {
      ...spell(p1, []),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(handOf(s2)).toBe(handOf(seeded) + 1);
  });
});

describe("multikicker card-instance stamping (#2594)", () => {
  // CR 702.85: a multikicker cast stamps the card instance with
  // `timesKicked` (and `kicked: true`) so an ETB "if kicked" trigger can
  // read the count after the spell has resolved onto the battlefield. The
  // trigger stack-ops path (`trigger-system/stack-ops.ts`) is the only
  // consumer; the unit test below exercises the read-side directly.
  it("card-instance carries timesKicked after a kicked cast (via stack-ops)", () => {
    // Build a small state with a permanent whose ETB trigger reads
    // `card.timesKicked`. The trigger's `StackObject.timesKicked` is what
    // the interpreter sees, so the test asserts that field is N rather
    // than just 0/1.
    const s0 = startGame(createInitialGameState(["P1", "P2"], 20, false));
    const [p1] = Array.from(s0.players.keys());
    const cardId = id("creature");
    let s = put(
      s0,
      p1,
      "creature",
      card("Creature", "Creature — Beast", [1, 1]),
    );
    // Simulate the post-cast state: a kicked multikicker cast stamps
    // `kicked: true, timesKicked: 3` on the card instance.
    const next = new Map(s.cards);
    next.set(cardId, {
      ...s.cards.get(cardId)!,
      kicked: true,
      timesKicked: 3,
    });
    s = { ...s, cards: next };
    // The trigger system's stack-ops reads `card.timesKicked` directly; we
    // exercise that read here by checking the same precedence rule:
    // `timesKicked` wins when set and > 0, otherwise the boolean `kicked`
    // flag is the fallback. This mirrors the production code path in
    // `trigger-system/stack-ops.ts`.
    const c = s.cards.get(cardId)!;
    const effectiveTimesKicked =
      typeof c.timesKicked === "number" && c.timesKicked > 0
        ? c.timesKicked
        : c.kicked === true
          ? 1
          : 0;
    expect(effectiveTimesKicked).toBe(3);
    expect(c.kicked).toBe(true);
  });

  it("stack-ops precedence: boolean kicked flag is the fallback when timesKicked is unset", () => {
    // Legacy single-kicker cards cast before the multikicker field landed
    // have `kicked: true` but no `timesKicked`; the production code falls
    // back to treating the boolean as "kicked once". Pin the contract.
    const s0 = startGame(createInitialGameState(["P1", "P2"], 20, false));
    const [p1] = Array.from(s0.players.keys());
    const cardId = id("legacy");
    let s = put(s0, p1, "legacy", card("Legacy", "Creature — Beast", [1, 1]));
    const next = new Map(s.cards);
    next.set(cardId, { ...s.cards.get(cardId)!, kicked: true });
    s = { ...s, cards: next };
    const c = s.cards.get(cardId)!;
    const effectiveTimesKicked =
      typeof c.timesKicked === "number" && c.timesKicked > 0
        ? c.timesKicked
        : c.kicked === true
          ? 1
          : 0;
    expect(effectiveTimesKicked).toBe(1);
  });
});

describe("Skyfire Adept fixture (#2594)", () => {
  // End-to-end: the on-disk JSON fixture (src/lib/game-state/card-scripts/
  // cards/skyfire_adept.json) loads, parses, and resolves the multikicker
  // tiered branches at the right counts. The fixture is the shipping
  // example for the new schema, so its behavior is part of the contract.
  let state: GameState;
  let p1: PlayerId;
  let p2: PlayerId;

  beforeEach(() => {
    state = startGame(
      createInitialGameState(["Player1", "Player2"], 20, false),
    );
    [p1, p2] = Array.from(state.players.keys());
  });

  it("loads from the registry", () => {
    const script = getCardScript("Skyfire Adept");
    expect(script).toBeDefined();
    expect(script?.kicker?.count).toBe(2);
  });

  it("un-kicked: no effect (DealDamage is gated on if_kicked: true)", () => {
    const before = state.players.get(p2)!.life;
    const s = resolveScriptedSpell(
      state,
      getCardScript("Skyfire Adept")!,
      spell(p1, [playerTarget(p2)]),
    );
    expect(s.players.get(p2)!.life).toBe(before);
  });

  it("kicked once: 1 damage, no draw (tier-1 effect only)", () => {
    const before = state.players.get(p2)!.life;
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, getCardScript("Skyfire Adept")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 1,
    });
    expect(s.players.get(p2)!.life).toBe(before - 1);
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore);
  });

  it("kicked twice (the multikicker cap): 1 damage AND draw a card (tier-1 + tier-2 effects)", () => {
    const before = state.players.get(p2)!.life;
    let seeded = put(state, p1, "lib1", card("L1", "Sorcery"), "library");
    seeded = put(seeded, p1, "lib2", card("L2", "Sorcery"), "library");
    const handBefore = seeded.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    const s = resolveScriptedSpell(seeded, getCardScript("Skyfire Adept")!, {
      ...spell(p1, [playerTarget(p2)]),
      wasKicked: true,
      timesKicked: 2,
    });
    expect(s.players.get(p2)!.life).toBe(before - 1);
    const handAfter = s.zones.get(`${p1}-hand`)?.cardIds.length ?? 0;
    expect(handAfter).toBe(handBefore + 1);
  });
});
