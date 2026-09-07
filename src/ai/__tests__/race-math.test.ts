/**
 * @fileoverview Unit tests for the lightweight race-math module (issue #1542).
 *
 * These tests pin down the pure-math helpers (`untappedPower`,
 * `turnsToLethalSelf`, `turnsToLethalOpponent`, `raceVerdict`) independent
 * of the combat decision tree. The acceptance-criteria tests for
 * `determineCombatStrategy` itself live next to it in
 * `combat-decision-tree.test.ts` so the two test files cover the two layers:
 * math here, integration there.
 */

import { describe, it, expect } from "@jest/globals";
import type { AIPlayerState, AIPermanent } from "@/lib/game-state";
import {
  untappedPower,
  turnsToLethalSelf,
  turnsToLethalOpponent,
  raceVerdict,
} from "../decision-making/race-math";

/**
 * Build a minimal {@link AIPlayerState} with the given untapped creatures.
 * Only the fields the race-math helpers actually read matter, but the
 * interface requires the full shape.
 */
function makePlayer(
  id: string,
  life: number,
  creatures: AIPermanent[] = [],
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life,
    poisonCounters: 0,
    hand: [],
    battlefield: creatures,
    graveyard: [],
    exile: [],
    library: 40,
    manaPool: {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

function creature(
  id: string,
  power: number,
  opts: { tapped?: boolean; sick?: boolean } = {},
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name: `Creature ${id}`,
    type: "creature",
    controller: "player1",
    tapped: opts.tapped ?? false,
    power,
    toughness: Math.max(1, power),
    manaValue: 1,
    summoningSickness: opts.sick ?? false,
  };
}

describe("race-math: untappedPower", () => {
  it("returns 0 for an empty board", () => {
    const p = makePlayer("p1", 20);
    expect(untappedPower(p)).toBe(0);
  });

  it("sums the power of all untapped, non-sick creatures", () => {
    const p = makePlayer("p1", 20, [
      creature("c1", 2),
      creature("c2", 3),
      creature("c3", 5),
    ]);
    expect(untappedPower(p)).toBe(10);
  });

  it("skips tapped creatures (they cannot attack)", () => {
    const p = makePlayer("p1", 20, [
      creature("c1", 2),
      creature("c2", 4, { tapped: true }),
      creature("c3", 3),
    ]);
    expect(untappedPower(p)).toBe(5);
  });

  it("skips creatures with summoning sickness", () => {
    const p = makePlayer("p1", 20, [
      creature("c1", 2),
      creature("c2", 7, { sick: true }),
    ]);
    expect(untappedPower(p)).toBe(2);
  });

  it("treats 0-power creatures as 0 (e.g. defensive Walls)", () => {
    const p = makePlayer("p1", 20, [creature("wall", 0), creature("c1", 4)]);
    expect(untappedPower(p)).toBe(4);
  });

  it("ignores non-creature permanents", () => {
    const p = makePlayer("p1", 20, [
      { ...creature("c1", 3), type: "land" },
      { ...creature("c2", 4), type: "enchantment" },
      creature("c3", 5),
    ]);
    expect(untappedPower(p)).toBe(5);
  });
});

describe("race-math: turnsToLethalSelf", () => {
  it("returns Infinity when the AI has no untapped attackers", () => {
    const ai = makePlayer("ai", 20);
    const opp = makePlayer("opp", 20, [creature("c", 2)]);
    expect(turnsToLethalSelf(ai, [opp])).toBe(Infinity);
  });

  it("returns Infinity when the opponent list is empty", () => {
    const ai = makePlayer("ai", 20, [creature("c1", 4)]);
    expect(turnsToLethalSelf(ai, [])).toBe(Infinity);
  });

  it("returns 0 if any opponent is already at 0 life (lethal on board)", () => {
    const ai = makePlayer("ai", 20, [creature("c1", 4)]);
    const opp = makePlayer("opp", 0);
    expect(turnsToLethalSelf(ai, [opp])).toBe(0);
  });

  it("computes ceil(oppLife / aiPower) on a full board", () => {
    // 20 life, AI has 3 power: ceil(20/3) = 7 turns.
    const ai = makePlayer("ai", 20, [creature("c1", 3)]);
    const opp = makePlayer("opp", 20);
    expect(turnsToLethalSelf(ai, [opp])).toBe(7);
  });

  it("returns 1 when AI has more power than opponent's life (lethal next turn)", () => {
    // AC1: AI power 10 into opponent at 5 life → 1 turn to lethal.
    const ai = makePlayer("ai", 5, [creature("c1", 4), creature("c2", 6)]);
    const opp = makePlayer("opp", 5);
    expect(turnsToLethalSelf(ai, [opp])).toBe(1);
  });

  it("uses the lowest opponent life when there are multiple opponents", () => {
    // Lopsided: one opponent already at 2 life, the other at 20. AI has 3
    // power → the lower-life opponent is the binding constraint at 1 turn.
    const ai = makePlayer("ai", 20, [creature("c1", 3)]);
    const opp1 = makePlayer("opp1", 20);
    const opp2 = makePlayer("opp2", 2);
    expect(turnsToLethalSelf(ai, [opp1, opp2])).toBe(1);
  });
});

describe("race-math: turnsToLethalOpponent", () => {
  it("returns Infinity when no opponent has untapped creatures", () => {
    const ai = makePlayer("ai", 20);
    const opp = makePlayer("opp", 20);
    expect(turnsToLethalOpponent(ai.life, [opp])).toBe(Infinity);
  });

  it("returns 0 if the AI is already at 0 life (already lethal)", () => {
    const ai = makePlayer("ai", 0);
    const opp = makePlayer("opp", 20, [creature("c", 2)]);
    expect(turnsToLethalOpponent(ai.life, [opp])).toBe(0);
  });

  it("computes ceil(aiLife / oppPower) on a full board", () => {
    // AI at 6 life, opponent power 12 → ceil(6/12) = 1 turn.
    const ai = makePlayer("ai", 6);
    const opp = makePlayer("opp", 20, [creature("c1", 6), creature("c2", 6)]);
    expect(turnsToLethalOpponent(ai.life, [opp])).toBe(1);
  });

  it("sums across multiple opponents", () => {
    // AI at 20 life, two opponents each with 5 power → 10 incoming →
    // ceil(20/10) = 2 turns until the AI is dead on board.
    const ai = makePlayer("ai", 20);
    const opp1 = makePlayer("opp1", 20, [creature("c", 5)]);
    const opp2 = makePlayer("opp2", 20, [creature("c", 5)]);
    expect(turnsToLethalOpponent(ai.life, [opp1, opp2])).toBe(2);
  });
});

describe("race-math: raceVerdict (issue #1542 acceptance criteria)", () => {
  it("AC1: AI winning the race is labelled `ai_winning` even at low life", () => {
    // AI has 10 power, opponent at 5 life with no blockers. Race is
    // mathematically over — AI should commit, not stall.
    const ai = makePlayer("ai", 5, [creature("c1", 4), creature("c2", 6)]);
    const opp = makePlayer("opp", 5);
    expect(raceVerdict(ai, [opp])).toBe("ai_winning");
  });

  it("AC2: AI losing the race by a wide margin is labelled `ai_losing`", () => {
    // Opponent power 12 into AI's 6 life; AI power 2 into opponent's 20.
    // AI is losing the race and must hold blockers.
    const ai = makePlayer("ai", 6, [creature("c1", 2)]);
    const opp = makePlayer("opp", 20, [creature("c1", 6), creature("c2", 6)]);
    expect(raceVerdict(ai, [opp])).toBe("ai_losing");
  });

  it("AC3: symmetric boards (equal power, equal life) fall through to `even`", () => {
    // Equal 2-power creatures, both at 20 life. The 1:1 power ratio is
    // exactly the threshold, so race math stays silent and the existing
    // aggression-config branch decides the strategy.
    const ai = makePlayer("ai", 20, [creature("c1", 2)]);
    const opp = makePlayer("opp", 20, [creature("c2", 2)]);
    expect(raceVerdict(ai, [opp])).toBe("even");
  });

  it("empty board on both sides is `even` (race math has nothing to say)", () => {
    const ai = makePlayer("ai", 20);
    const opp = makePlayer("opp", 20);
    expect(raceVerdict(ai, [opp])).toBe("even");
  });

  it("AI has board, opponent does not → `ai_winning`", () => {
    const ai = makePlayer("ai", 5, [creature("c1", 2)]);
    const opp = makePlayer("opp", 20);
    expect(raceVerdict(ai, [opp])).toBe("ai_winning");
  });

  it("AI has no board, opponent has → `ai_losing`", () => {
    const ai = makePlayer("ai", 20);
    const opp = makePlayer("opp", 20, [creature("c1", 2)]);
    expect(raceVerdict(ai, [opp])).toBe("ai_losing");
  });

  it("power ratio at the 1.5x threshold → `ai_winning`", () => {
    // 6 power vs 4 power = 1.5x exactly. ≥ 1.5 is decisive.
    const ai = makePlayer("ai", 20, [creature("c1", 6)]);
    const opp = makePlayer("opp", 20, [creature("c2", 4)]);
    expect(raceVerdict(ai, [opp])).toBe("ai_winning");
  });

  it("power ratio just below the threshold → `even` (do not flip on small deltas)", () => {
    // 3 power vs 2 power = 1.5x in raw number, but the existing
    // board-count heuristic uses "+1 board creature" as its delta, so we
    // mirror that as the decisive threshold. The tests below pin down
    // the exact behavior at and below it.
    const ai = makePlayer("ai", 20, [creature("c1", 5)]);
    const opp = makePlayer("opp", 20, [creature("c2", 4)]);
    // 5/4 = 1.25 — comfortably below 1.5x, so "even" (defer to legacy).
    expect(raceVerdict(ai, [opp])).toBe("even");
  });

  it("multiple opponents sum their power for the ratio", () => {
    // AI has 12 power; two opponents each with 3 power (6 total). Ratio
    // 12/6 = 2.0 — decisive → `ai_winning`.
    const ai = makePlayer("ai", 20, [creature("c1", 6), creature("c2", 6)]);
    const opp1 = makePlayer("opp1", 20, [creature("c", 3)]);
    const opp2 = makePlayer("opp2", 20, [creature("c", 3)]);
    expect(raceVerdict(ai, [opp1, opp2])).toBe("ai_winning");
  });

  it("tapped creatures do not count toward the opponent's race clock", () => {
    // Opponent's only creature is tapped, so they cannot race the AI even
    // though their power is high. AI should be labelled `ai_winning`.
    const ai = makePlayer("ai", 5, [creature("c1", 2)]);
    const opp = makePlayer("opp", 20, [creature("c1", 8, { tapped: true })]);
    expect(raceVerdict(ai, [opp])).toBe("ai_winning");
  });
});
