/**
 * @fileoverview Tests for the attribute-scaled threat evaluation introduced
 * in issue #1540. The previous implementation assigned every planeswalker a
 * flat threatLevel of 0.7, every enchantment 0.5, and every artifact 0.4
 * regardless of manaValue / loyalty / keywords. These tests pin the new
 * behavior:
 *
 *   - planeswalker threat scales with loyalty + manaValue, with a dedicated
 *     "ultimate-ready" boost at loyalty >= 5 (proxied since AIPermanent does
 *     not carry oracle text);
 *   - enchantment threat scales with manaValue, gets a Hard/Expert engine
 *     bonus when the permanent is high-CMC and carries any keyword;
 *   - artifact threat scales with manaValue and keywords so a 4-CMC value
 *     engine strictly outscores a 1-CMC rock;
 *   - the creature branch is unchanged (regression guard on power/10).
 */

import { describe, it, expect } from "@jest/globals";
import { GameStateEvaluator, evaluateGameState } from "../game-state-evaluator";
import type { AIGameState, AIPlayerState, AIPermanent } from "@/lib/game-state";

function createPlayer(
  id: string,
  battlefield: AIPermanent[] = [],
): AIPlayerState {
  return {
    id,
    name: `Player ${id}`,
    life: 20,
    poisonCounters: 0,
    hand: [],
    battlefield,
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
      generic: 0,
    },
    commanderDamage: {},
    landsPlayedThisTurn: 0,
    hasPassedPriority: false,
  };
}

function makePermanent(
  id: string,
  type: AIPermanent["type"],
  overrides: Partial<AIPermanent> = {},
): AIPermanent {
  return {
    cardInstanceId: id,
    id,
    name: id,
    type,
    controller: "player2",
    tapped: false,
    keywords: [],
    ...overrides,
  };
}

function makeGameState(
  battlefield: AIPermanent[],
  difficulty: AIPlayerState extends never
    ? never
    : "easy" | "medium" | "hard" | "expert" = "medium",
): AIGameState {
  return {
    players: {
      player1: createPlayer("player1"),
      player2: createPlayer("player2", battlefield),
    },
    turnInfo: {
      currentTurn: 1,
      currentPlayer: "player1",
      priority: "player1",
      phase: "precombat_main",
      step: "main",
    },
    stack: [],
    combat: { inCombatPhase: false, attackers: [], blockers: {} },
  };
}

function evaluate(
  battlefield: AIPermanent[],
  difficulty: "easy" | "medium" | "hard" | "expert" = "medium",
) {
  const state = makeGameState(battlefield, difficulty);
  return evaluateGameState(state, "player1", difficulty);
}

function findThreat(
  evaluation: ReturnType<typeof evaluate>,
  permanentId: string,
) {
  const t = evaluation.threats.find((th) => th.permanentId === permanentId);
  if (!t) {
    throw new Error(
      `Expected threat for permanent ${permanentId} but got: ${JSON.stringify(
        evaluation.threats,
      )}`,
    );
  }
  return t;
}

describe("assessThreats (issue #1540) — attribute-scaled threat evaluation", () => {
  describe("planeswalker branch", () => {
    it("rates a 1-loyalty planeswalker below 0.5 (down from flat 0.7)", () => {
      const evaluation = evaluate([
        makePermanent("pw-tickdown", "planeswalker", {
          manaValue: 3,
          loyalty: 1,
        }),
      ]);
      const pw = findThreat(evaluation, "pw-tickdown");
      expect(pw.threatLevel).toBeLessThan(0.5);
      expect(pw.urgency).toBe("eventual");
      expect(pw.reason).toMatch(/Planeswalker/);
    });

    it("rates an ultimate-ready planeswalker (loyalty >= 5) at >= 0.85 and urgency 'immediate'", () => {
      const evaluation = evaluate([
        makePermanent("pw-ult", "planeswalker", {
          manaValue: 4,
          loyalty: 5,
        }),
      ]);
      const pw = findThreat(evaluation, "pw-ult");
      expect(pw.threatLevel).toBeGreaterThanOrEqual(0.85);
      expect(pw.urgency).toBe("immediate");
    });

    it("scores high-loyalty strictly above low-loyalty at the same manaValue", () => {
      const low = evaluate([
        makePermanent("pw-low", "planeswalker", { manaValue: 4, loyalty: 1 }),
      ]);
      const high = evaluate([
        makePermanent("pw-high", "planeswalker", { manaValue: 4, loyalty: 7 }),
      ]);
      expect(findThreat(high, "pw-high").threatLevel).toBeGreaterThan(
        findThreat(low, "pw-low").threatLevel,
      );
    });

    it("scores high-CMC strictly above low-CMC at the same loyalty", () => {
      const cheap = evaluate([
        makePermanent("pw-cheap", "planeswalker", {
          manaValue: 2,
          loyalty: 4,
        }),
      ]);
      const pricey = evaluate([
        makePermanent("pw-pricey", "planeswalker", {
          manaValue: 6,
          loyalty: 4,
        }),
      ]);
      expect(findThreat(pricey, "pw-pricey").threatLevel).toBeGreaterThan(
        findThreat(cheap, "pw-cheap").threatLevel,
      );
    });

    it("clamps threatLevel into [0, 1] for a maximally-stacked planeswalker", () => {
      const evaluation = evaluate([
        makePermanent("pw-max", "planeswalker", {
          manaValue: 8,
          loyalty: 12,
        }),
      ]);
      const pw = findThreat(evaluation, "pw-max");
      expect(pw.threatLevel).toBeLessThanOrEqual(1);
      expect(pw.threatLevel).toBeGreaterThanOrEqual(0);
      expect(pw.urgency).toBe("immediate");
    });
  });

  describe("artifact branch", () => {
    it("scores a 4+ CMC artifact strictly above a 1-CMC artifact", () => {
      const low = evaluate([
        makePermanent("a-rock", "artifact", { manaValue: 1 }),
      ]);
      const high = evaluate([
        makePermanent("a-engine", "artifact", { manaValue: 4 }),
      ]);
      expect(findThreat(high, "a-engine").threatLevel).toBeGreaterThan(
        findThreat(low, "a-rock").threatLevel,
      );
    });

    it("boosts an artifact when it carries keywords (e.g. a value engine)", () => {
      const vanilla = evaluate([
        makePermanent("a-vanilla", "artifact", { manaValue: 3 }),
      ]);
      const keyed = evaluate([
        makePermanent("a-keyed", "artifact", {
          manaValue: 3,
          keywords: ["flash", "ward"],
        }),
      ]);
      expect(findThreat(keyed, "a-keyed").threatLevel).toBeGreaterThan(
        findThreat(vanilla, "a-vanilla").threatLevel,
      );
    });

    it("scoring is monotonic in manaValue for fixed keyword counts", () => {
      const scores = [1, 2, 3, 4, 5, 6].map((cmc) => {
        const ev = evaluate([
          makePermanent(`a-${cmc}`, "artifact", {
            manaValue: cmc,
            keywords: ["flash"],
          }),
        ]);
        return findThreat(ev, `a-${cmc}`).threatLevel;
      });
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    });

    it("clamps to [0, 1] for a maximally-stacked artifact", () => {
      const evaluation = evaluate([
        makePermanent("a-max", "artifact", {
          manaValue: 8,
          keywords: [
            "flash",
            "ward",
            "trample",
            "haste",
            "deathtouch",
            "lifelink",
          ],
        }),
      ]);
      const a = findThreat(evaluation, "a-max");
      expect(a.threatLevel).toBeLessThanOrEqual(1);
    });
  });

  describe("enchantment branch", () => {
    it("rates a high-CMC enchantment with keywords at Hard/Expert at >= 0.7", () => {
      const evaluation = evaluate(
        [
          makePermanent("e-engine", "enchantment", {
            manaValue: 4,
            keywords: ["flash"],
          }),
        ],
        "hard",
      );
      const e = findThreat(evaluation, "e-engine");
      expect(e.threatLevel).toBeGreaterThanOrEqual(0.7);
      expect(e.urgency).toBe("soon");
    });

    it("does NOT apply the engine bonus on Easy (engine patterns need Hard+)", () => {
      const evaluation = evaluate(
        [
          makePermanent("e-easy", "enchantment", {
            manaValue: 4,
            keywords: ["flash"],
          }),
        ],
        "easy",
      );
      const e = findThreat(evaluation, "e-easy");
      expect(e.threatLevel).toBeLessThan(0.7);
      expect(e.urgency).toBe("eventual");
    });

    it("scores a high-CMC enchantment strictly above a 1-CMC enchantment", () => {
      const low = evaluate([
        makePermanent("e-low", "enchantment", { manaValue: 1 }),
      ]);
      const high = evaluate(
        [
          makePermanent("e-high", "enchantment", {
            manaValue: 5,
            keywords: ["flash"],
          }),
        ],
        "hard",
      );
      expect(findThreat(high, "e-high").threatLevel).toBeGreaterThan(
        findThreat(low, "e-low").threatLevel,
      );
    });

    it("Hard/Expert scores strictly above Easy for the same enchantment", () => {
      const easy = evaluate(
        [
          makePermanent("e", "enchantment", {
            manaValue: 4,
            keywords: ["flash"],
          }),
        ],
        "easy",
      );
      const hard = evaluate(
        [
          makePermanent("e", "enchantment", {
            manaValue: 4,
            keywords: ["flash"],
          }),
        ],
        "hard",
      );
      expect(findThreat(hard, "e").threatLevel).toBeGreaterThan(
        findThreat(easy, "e").threatLevel,
      );
    });
  });

  describe("creature branch — regression guard (issue #1540 AC #5)", () => {
    it("a 5-power vanilla creature scores exactly power/10 = 0.5", () => {
      const evaluation = evaluate([
        makePermanent("c-5", "creature", {
          power: 5,
          toughness: 5,
          manaValue: 3,
        }),
      ]);
      const c = findThreat(evaluation, "c-5");
      expect(c.threatLevel).toBeCloseTo(0.5, 6);
      expect(c.urgency).toBe("immediate");
    });

    it("a 0-power tapped creature does not surface as a threat", () => {
      const evaluation = evaluate([
        makePermanent("c-tapped", "creature", {
          power: 5,
          toughness: 5,
          tapped: true,
          manaValue: 3,
        }),
      ]);
      expect(
        evaluation.threats.find((t) => t.permanentId === "c-tapped"),
      ).toBeUndefined();
    });
  });

  describe("regression vs the prior flat scores (issue #1540 step 4)", () => {
    it("a 5-CMC high-loyalty planeswalker now beats the prior flat 0.7", () => {
      const evaluation = evaluate([
        makePermanent("pw-better", "planeswalker", {
          manaValue: 5,
          loyalty: 6,
        }),
      ]);
      const pw = findThreat(evaluation, "pw-better");
      // Old code: 0.7. New code: >= 0.85 (AC) and grows with cost+loyalty.
      expect(pw.threatLevel).toBeGreaterThan(0.7);
    });

    it("a 1-CMC vanilla rock now scores below the prior flat 0.4", () => {
      const evaluation = evaluate([
        makePermanent("a-cheap", "artifact", { manaValue: 1 }),
      ]);
      const a = findThreat(evaluation, "a-cheap");
      // Old code: 0.4. New code: 0.25 (base 0.20 + cmc 0.05).
      // We assert it drops so the AI no longer wastes interaction on rocks.
      expect(a.threatLevel).toBeLessThan(0.4);
    });

    it("a 1-loyalty planeswalker now scores below the prior flat 0.7", () => {
      const evaluation = evaluate([
        makePermanent("pw-dead", "planeswalker", {
          manaValue: 3,
          loyalty: 1,
        }),
      ]);
      const pw = findThreat(evaluation, "pw-dead");
      expect(pw.threatLevel).toBeLessThan(0.7);
    });
  });

  describe("ordering invariants across the new attribute-scaled branches", () => {
    it("ultimate-ready planeswalker ranks higher than a high-CMC enchantment engine", () => {
      const evaluation = evaluate(
        [
          makePermanent("pw-ult", "planeswalker", {
            manaValue: 4,
            loyalty: 5,
          }),
          makePermanent("e-engine", "enchantment", {
            manaValue: 5,
            keywords: ["flash", "prowess"],
          }),
        ],
        "hard",
      );
      const pw = findThreat(evaluation, "pw-ult");
      const en = findThreat(evaluation, "e-engine");
      expect(pw.threatLevel).toBeGreaterThan(en.threatLevel);
    });

    it("a 4-CMC value artifact ranks higher than a 1-CMC rock", () => {
      const evaluation = evaluate([
        makePermanent("a-rock", "artifact", { manaValue: 1 }),
        makePermanent("a-engine", "artifact", {
          manaValue: 4,
          keywords: ["flash"],
        }),
      ]);
      const rock = findThreat(evaluation, "a-rock");
      const engine = findThreat(evaluation, "a-engine");
      expect(engine.threatLevel).toBeGreaterThan(rock.threatLevel);
      // And the engine should outrank a 1-power creature too:
      const weak = evaluate([
        makePermanent("a-engine", "artifact", {
          manaValue: 4,
          keywords: ["flash"],
        }),
        makePermanent("c-weak", "creature", {
          power: 1,
          toughness: 1,
          manaValue: 1,
        }),
      ]);
      expect(findThreat(weak, "a-engine").threatLevel).toBeGreaterThan(
        findThreat(weak, "c-weak").threatLevel,
      );
    });
  });

  describe("integration through GameStateEvaluator", () => {
    it("evaluator returns the new threats on the public evaluation object", () => {
      const state = makeGameState(
        [
          makePermanent("pw-x", "planeswalker", {
            manaValue: 5,
            loyalty: 6,
          }),
        ],
        "medium",
      );
      const evaluator = new GameStateEvaluator(state, "player1", "medium");
      const result = evaluator.evaluate();
      const pw = result.threats.find((t) => t.permanentId === "pw-x");
      expect(pw).toBeDefined();
      expect(pw?.urgency).toBe("immediate");
      expect(pw?.threatLevel).toBeGreaterThanOrEqual(0.85);
    });
  });
});
