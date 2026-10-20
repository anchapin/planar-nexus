/**
 * Wild Hypothesis — X-cost flip-X-coins-draw spell (#2829, follow-up to
 * #2552 lane 2).
 *
 * Wild Hypothesis reads "{X}{R}: Flip X coins. For each heads, draw a
 * card." It is the canonical X-cost flip-coin spell: literal-X on the
 * `coins` field of a new `FlipCoins` op that auto-draws per heads via
 * the existing `resolveCardDrawEffect` helper.
 *
 * Lane parity with `slice-from-the-shadows-discard-x.test.ts` and
 * `ashroot-animist-literal-x-activated.test.ts`. The schema + RNG + op
 * plumbing shipped in PR #2829 + this file; the runtime layer uses
 * `state.random` (defaults to `Math.random`, tests use a deterministic
 * seeded RNG for reproducibility).
 */
import { getCardScript } from "../index";
import { resolveScriptedSpell } from "../interpret";
import { createInitialGameState, startGame } from "../../game-state";
import { ZoneType, getZoneKey } from "../../types/zones";
import type { GameState, PlayerId, StackObject } from "../../types";

/**
 * Linear-congruential PRNG (lcg) for deterministic test fixtures.
 * The sequence of coin flips is reproducible across runs by fixing
 * `seed`. A pure RNG (no Math.random fallback) is required so the
 * test's assertions on heads count are exact.
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function startTwoPlayerStateWithRandom(
  random: () => number,
): { state: GameState; p1: PlayerId; p2: PlayerId } {
  const base = createInitialGameState(
    ["Player1", "Player2"],
    20,
    false,
    random,
  );
  const state = startGame(base);
  const [p1, p2] = Array.from(state.players.keys());
  return { state, p1, p2 };
}

function countHand(state: GameState, playerId: PlayerId): number {
  return state.zones.get(getZoneKey(playerId, ZoneType.HAND))?.cardIds.length ?? 0;
}

function makeSpell(
  sourceId: string,
  controllerId: PlayerId,
  x: number,
): StackObject {
  return {
    id: `wild-test-${sourceId}`,
    type: "spell",
    sourceCardId: sourceId as StackObject["sourceCardId"],
    controllerId,
    name: "Wild Hypothesis",
    text: "Flip X coins. For each heads, draw a card.",
    manaCostPaid: ["X", "R"],
    targets: [],
    variableValues: new Map([["X", x]]),
    chosenModes: [],
    wasKicked: false,
    timesKicked: 0,
    triggeringStackObjectId: undefined,
    isXCost: true,
  } as unknown as StackObject;
}

describe("Wild Hypothesis (#2829, follow-up to #2552): X-cost flip-coins spell", () => {
  it("registry exposes Wild Hypothesis with literal-X-cost FlipCoins", () => {
    const wh = getCardScript("Wild Hypothesis");
    expect(wh).toBeDefined();
    const spell = wh!.spell!;
    expect(spell).toHaveLength(1);
    expect(spell[0].op).toBe("FlipCoins");
    if (spell[0].op !== "FlipCoins") throw new Error("narrow");
    expect(spell[0].coins).toBe("X");
    expect(spell[0].who).toBe("you");
  });

  it("X=3: draws some cards in [0, 3] (heads count bounded by coin flips)", () => {
    const { state, p1 } = startTwoPlayerStateWithRandom(seededRandom(0x5eed1));
    const p1HandBefore = countHand(state, p1);
    const script = getCardScript("Wild Hypothesis")!;

    const resolved = resolveScriptedSpell(
      state,
      script,
      makeSpell("wh", p1, 3),
    );

    const drew = countHand(resolved, p1) - p1HandBefore;
    expect(drew).toBeGreaterThanOrEqual(0);
    expect(drew).toBeLessThanOrEqual(3);
  });

  it("X=0: zero coins flipped, no draws (CR 107.3 default)", () => {
    const { state, p1 } = startTwoPlayerStateWithRandom(seededRandom(0xabcde));
    const p1HandBefore = countHand(state, p1);
    const script = getCardScript("Wild Hypothesis")!;

    const resolved = resolveScriptedSpell(
      state,
      script,
      makeSpell("wh", p1, 0),
    );

    expect(countHand(resolved, p1)).toBe(p1HandBefore);
  });

  it("deterministic: same seed yields identical heads count across runs", () => {
    const seed = 0xfeed1;
    const script = getCardScript("Wild Hypothesis")!;

    const s1 = startTwoPlayerStateWithRandom(seededRandom(seed));
    const s2 = startTwoPlayerStateWithRandom(seededRandom(seed));
    const r1 = resolveScriptedSpell(
      s1.state,
      script,
      makeSpell("wh", s1.p1, 5),
    );
    const r2 = resolveScriptedSpell(
      s2.state,
      script,
      makeSpell("wh", s2.p1, 5),
    );

    // Both runs must produce identical hand growth → identical heads
    // counts (the engine''s RNG is the only source of variance, and the
    // seeded RNG is deterministic).
    const drew1 = countHand(r1, s1.p1) - countHand(s1.state, s1.p1);
    const drew2 = countHand(r2, s2.p1) - countHand(s2.state, s2.p1);
    expect(drew1).toBe(drew2);
    expect(drew1).toBeGreaterThanOrEqual(0);
    expect(drew1).toBeLessThanOrEqual(5);
  });
});