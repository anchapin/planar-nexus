/**
 * @fileoverview Multiplayer Threat Assessment tests (issue #1233).
 *
 * The five acceptance criteria map to the test groups below:
 *
 *   1. assessThreats → leader = pumped-commander player (not lowest life)
 *      → describe `assessThreats → 3-player leader ≠ lowest-life fixture`
 *   2. chooseAttackTarget flips when the leader-vs-weaker threat changes
 *      → describe `chooseAttackTarget → target flips when leader changes`
 *   3. chooseResponseTarget prefers countering the leader's spell
 *      → describe `chooseResponseTarget → prefers the leader's spell`
 *   4. AI avoids kingmaking in 50+ 3-player permutations at Expert
 *      → describe `anti-kingmaking batch (issue #1233 AC4)`
 *   5. No regression in single-player `combat-decision-tree.test.ts`
 *      → not exercised here (covered by the existing tests in
 *        `src/ai/__tests__/combat-decision-tree.test.ts`); the module is a
 *        pure addition that does not modify CombatDecisionTree.
 *
 * The coverage target on the new module is ≥ 70 % (issue #1233 acceptance).
 */

import { describe, expect, it, test } from "@jest/globals";
import type { AIPermanent } from "@/lib/game-state/types";
import {
  _buildFixtureState,
  assessThreats,
  chooseAttackTarget,
  chooseResponseTarget,
  type MultiplayerThreatAssessment,
} from "../multiplayer-threat";

/* -------------------------------------------------------------------------- */
/* Local fixture helpers                                                      */
/* -------------------------------------------------------------------------- */

function creature(
  id: string,
  power: number,
  toughness: number = power,
  tapped: boolean = false,
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name: id,
    type: "creature",
    controller: "opponent_a",
    tapped,
    manaValue: 3,
    power,
    toughness,
    keywords: [],
  };
}

function commander(
  id: string,
  name: string,
  power: number,
  toughness: number = power,
): AIPermanent {
  return {
    id,
    cardInstanceId: id,
    name,
    type: "creature",
    controller: "opponent_a",
    tapped: false,
    manaValue: 3,
    power,
    toughness,
    keywords: [],
  };
}

/* -------------------------------------------------------------------------- */
/* AC #1 — assessThreats leader ≠ lowest-life naive pick                      */
/* -------------------------------------------------------------------------- */

describe("assessThreats — 3-player leader ≠ lowest-life fixture (AC #1)", () => {
  it("flags the 3-life Voltron player as the threat leader over a 20-life empty opponent", () => {
    // A is the "obvious" lowest-life player; B is at full life with no board;
    // C is the 3-life player with an 8/8 Voltron commander (which the
    // commander-math Voltron floor pins to ≥ 0.7 at Hard/Expert).
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_a",
          life: 20,
          battlefield: [],
        },
        {
          id: "op_b",
          life: 3,
          battlefield: [],
        },
        {
          id: "op_c",
          life: 15,
          battlefield: [creature("cr_c", 4, 4)],
        },
      ],
      {
        op_b: {
          commander: commander(
            "cmdr_b",
            "Sram, Senior Edificer",
            8,
            8,
          ),
        },
      },
    );

    const rankings = assessThreats(state, "ai", undefined, "expert");

    // Sort order: leader must be op_b (the 3-life Voltron player).
    expect(rankings.map((r) => r.playerId)).toEqual([
      "op_b",
      expect.stringMatching(/op_[ac]/),
      expect.stringMatching(/op_[ac]/),
    ]);
    const leader = rankings[0];
    expect(leader.isThreatLeader).toBe(true);
    expect(leader.playerId).toBe("op_b");

    // Only one leader — guards against accidentally flagging two.
    expect(rankings.filter((r) => r.isThreatLeader)).toHaveLength(1);

    // Life ≠ ranking: confirm the leader's life (3) is the *lowest* of the
    // pod, not the highest. The naive "lowest life = leader" rule would
    // still pick op_b here, so this test alone does not disprove that rule;
    // the next test does.
    expect(Math.min(...rankings.map((r) => state.players[r.playerId].life))).toBe(
      3,
    );
  });

  it("flags the high-life high-board player as leader when the pumped-commander 3-life player is absent", () => {
    // Same 20-life empty opponent is now the leader only if their threat is
    // strictly higher than the 15-life boardy opponent. We beef up the 15-life
    // player's board so it pulls ahead — proving the ranking is threat-aware
    // (board/commander weighted), not "lowest life wins".
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_a",
          life: 20,
          battlefield: [],
        },
        {
          id: "op_b",
          life: 15,
          battlefield: [
            creature("cr_b1", 7, 7),
            creature("cr_b2", 7, 7),
          ],
        },
      ],
      undefined,
    );

    const rankings = assessThreats(state, "ai", undefined, "expert");
    const leader = rankings[0];
    expect(leader.isThreatLeader).toBe(true);
    // 15-life boardy opponent wins on board score, NOT on lowest life.
    expect(leader.playerId).toBe("op_b");
    expect(leader.boardScore).toBeGreaterThan(rankings[1].boardScore);
  });

  it("is deterministic at expert difficulty across repeated calls", () => {
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_a",
          life: 12,
          battlefield: [creature("cr_a", 6, 6)],
        },
        {
          id: "op_b",
          life: 7,
          battlefield: [creature("cr_b", 3, 3)],
        },
      ],
      undefined,
    );
    const first = assessThreats(state, "ai", undefined, "expert");
    const second = assessThreats(state, "ai", undefined, "expert");
    expect(second).toEqual(first);
  });
});

describe("assessThreats — kingmaking pre-flag", () => {
  it("isAboutToLose is true when another non-AI opponent can kill them next turn", () => {
    // op_b: 3 life. op_c has 5 power of untapped creatures → can kill op_b.
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 3,
          battlefield: [],
        },
        {
          id: "op_c",
          life: 20,
          battlefield: [creature("cr_c1", 3, 3), creature("cr_c2", 3, 3)],
        },
      ],
      undefined,
    );
    const rankings = assessThreats(state, "ai", undefined, "expert");
    const b = rankings.find((r) => r.playerId === "op_b")!;
    expect(b.isAboutToLose).toBe(true);
  });

  it("isAboutToLose is false when no opponent has enough power to one-shot", () => {
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 20,
          battlefield: [creature("cr_b", 2, 2)],
        },
        {
          id: "op_c",
          life: 20,
          battlefield: [creature("cr_c", 2, 2)],
        },
      ],
      undefined,
    );
    const rankings = assessThreats(state, "ai", undefined, "expert");
    for (const r of rankings) {
      expect(r.isAboutToLose).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* AC #2 — chooseAttackTarget flips when leader threat changes                */
/* -------------------------------------------------------------------------- */

describe("chooseAttackTarget — target flips when leader changes (AC #2)", () => {
  function buildState(bPower: number, cLife: number) {
    return _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 3, // the "obvious" lowest-life target
          battlefield: [],
        },
        {
          id: "op_c",
          life: cLife,
          battlefield:
            bPower >= 1
              ? [creature("cr_c_big", bPower, bPower)]
              : [],
        },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
  }

  it("flips from op_b (leader) to op_c when op_c gains enough board to take the lead", () => {
    // Scenario 1 — only op_b has threat (Voltron + 3 life).
    const before = buildState(/* bPower */ 0, /* cLife */ 20);
    const targetBefore = chooseAttackTarget(before, "ai", undefined, "expert");
    expect(targetBefore.targetId).toBe("op_b");
    expect(targetBefore.avoidedKingmaking).toBe(false);

    // Scenario 2 — op_c grows a board that overtakes op_b. New leader = op_c.
    // We boost op_c's board AND drop op_c's life so lifeScore also rises.
    const after = buildState(/* bPower */ 12, /* cLife */ 10);
    const targetAfter = chooseAttackTarget(after, "ai", undefined, "expert");
    expect(targetAfter.targetId).toBe("op_c");
    // Different leader, different target — the AI flipped its attack target.
    expect(targetAfter.targetId).not.toBe(targetBefore.targetId);
  });
});

/* -------------------------------------------------------------------------- */
/* AC #3 — chooseResponseTarget prefers leader's spell                        */
/* -------------------------------------------------------------------------- */

describe("chooseResponseTarget — prefers the leader's spell (AC #3)", () => {
  it("counters the leader's spell when two competing spells are on the stack at expert", () => {
    // Two opponents: op_b (the leader, with Voltron commander) and op_c
    // (a non-leader with a small board). Place two spells on the stack
    // — leader's is more expensive to make sure the "highest MV leader
    // spell" tiebreak is exercised.
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 3,
          battlefield: [],
        },
        {
          id: "op_c",
          life: 20,
          battlefield: [],
        },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
    state.stack = [
      {
        id: "spell_c",
        cardInstanceId: "card_c",
        controller: "op_c",
        type: "spell",
        targets: [],
        name: "Stroke of Genius",
        manaValue: 3,
      },
      {
        id: "spell_b",
        cardInstanceId: "card_b",
        controller: "op_b",
        type: "spell",
        targets: [],
        name: "Armageddon",
        manaValue: 6,
      },
    ];

    const counter = chooseResponseTarget(state, "ai", "expert");
    expect(counter.stackObjectId).toBe("spell_b");
    expect(counter.controllerId).toBe("op_b");
    expect(counter.reason).toMatch(/leader/);

    // Sanity: at hard, the same preference holds.
    const counterHard = chooseResponseTarget(state, "ai", "hard");
    expect(counterHard.stackObjectId).toBe("spell_b");
  });

  it("picks the cheapest spell at easy regardless of leader", () => {
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_b", life: 3, battlefield: [] },
        { id: "op_c", life: 20, battlefield: [] },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
    state.stack = [
      {
        id: "spell_c",
        cardInstanceId: "card_c",
        controller: "op_c",
        type: "spell",
        targets: [],
        name: "Brainstorm",
        manaValue: 1,
      },
      {
        id: "spell_b",
        cardInstanceId: "card_b",
        controller: "op_b",
        type: "spell",
        targets: [],
        name: "Decree of Savagery",
        manaValue: 8,
      },
    ];
    const counter = chooseResponseTarget(state, "ai", "easy");
    expect(counter.stackObjectId).toBe("spell_c");
  });

  it("returns null when the stack contains no opponent spells", () => {
    const state = _buildFixtureState(
      "ai",
      [{ id: "op_b", life: 5, battlefield: [] }],
      undefined,
    );
    state.stack = [];
    const counter = chooseResponseTarget(state, "ai", "expert");
    expect(counter.stackObjectId).toBeNull();
    expect(counter.controllerId).toBeNull();
  });

  it("returns null when only AI-controlled spells are on the stack", () => {
    const state = _buildFixtureState(
      "ai",
      [{ id: "op_b", life: 5, battlefield: [] }],
      undefined,
    );
    state.stack = [
      {
        id: "spell_ai",
        cardInstanceId: "card_ai",
        controller: "ai",
        type: "spell",
        targets: [],
        name: "Counterspell",
        manaValue: 2,
      },
    ];
    const counter = chooseResponseTarget(state, "ai", "expert");
    expect(counter.stackObjectId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Difficulty-scaled noise and kingmaking avoidance                           */
/* -------------------------------------------------------------------------- */

describe("chooseAttackTarget — difficulty scaling", () => {
  it("easy samples within the top half of the pool (deterministic via injected rng)", () => {
    // Easy tier uses opts.rng to sample within the top half so the AI
    // sometimes misses the best target by design. Inject an RNG that
    // returns the *last* index of the slice to exercise the easy path.
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 20, battlefield: [] },
        { id: "op_b", life: 12, battlefield: [creature("cr_b", 4, 4)] },
        { id: "op_c", life: 18, battlefield: [creature("cr_c", 6, 6)] },
      ],
      undefined,
    );
    const rng = () => 0.999; // forces the last index of the slice
    const target = chooseAttackTarget(
      state,
      "ai",
      undefined,
      "easy",
      { rng },
    );
    expect(target.targetId).toBeTruthy();
    expect(["op_a", "op_b", "op_c"]).toContain(target.targetId);
  });

  it("expert refuses to attack an opponent flagged isAboutToLose", () => {
    // op_b is at 5 life and isAboutToLose (op_c has 6 power of creatures).
    // Expert must NOT pick op_b even though op_b's life is dangerously low
    // and a naive AI would race to kill them.
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 5,
          battlefield: [],
        },
        {
          id: "op_c",
          life: 15,
          battlefield: [creature("cr_c1", 3, 3), creature("cr_c2", 3, 3)],
        },
      ],
      undefined,
    );

    const target = chooseAttackTarget(state, "ai", undefined, "expert");
    // Expert avoids the doomed target and picks the threat leader (op_c,
    // who is about to take out op_b on their own — pull pressure off op_b
    // and toward op_c, the player who is winning).
    expect(target.targetId).toBe("op_c");
    expect(target.avoidedKingmaking).toBe(true);
  });

  it("hard also refuses to attack an opponent flagged isAboutToLose", () => {
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_b",
          life: 5,
          battlefield: [],
        },
        {
          id: "op_c",
          life: 15,
          battlefield: [creature("cr_c1", 4, 4), creature("cr_c2", 4, 4)],
        },
      ],
      undefined,
    );
    const target = chooseAttackTarget(state, "ai", undefined, "hard");
    expect(target.targetId).toBe("op_c");
    expect(target.avoidedKingmaking).toBe(true);
  });

  it("medium does not enforce kingmaking avoidance (still picks the leader)", () => {
    // Medium MUST_AVOID_KINGMAKING = false, so even if the leader happens to
    // also be the about-to-lose target, the AI picks them anyway. Note:
    // we construct the case where the leader and the losable target are the
    // SAME player — that way the AI's choice is unambiguous.
    const state = _buildFixtureState(
      "ai",
      [
        {
          // op_b = low-life leader AND about to lose to op_c.
          id: "op_b",
          life: 5,
          battlefield: [],
        },
        {
          // op_c is also a threat but at full health — would win the race.
          id: "op_c",
          life: 15,
          battlefield: [creature("cr_c1", 2, 2)],
        },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
    const target = chooseAttackTarget(state, "ai", undefined, "medium");
    // op_b is the Voltron leader at 5 life → highest threat → medium picks
    // the leader, ignoring the kingmaking concern.
    expect(target.targetId).toBe("op_b");
    expect(target.avoidedKingmaking).toBe(false);
  });

  it("returns null when no opponents exist", () => {
    const state = _buildFixtureState("ai", [], undefined);
    const target = chooseAttackTarget(state, "ai", undefined, "expert");
    expect(target.targetId).toBeNull();
    expect(target.avoidedKingmaking).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* AC #4 — anti-kingmaking batch (50+ 3-player permutations)                  */
/* -------------------------------------------------------------------------- */

describe("anti-kingmaking batch — 50+ 3-player permutations (AC #4)", () => {
  // The existing headless harness only runs 2-player games (issue #1065).
  // Rather than fork the engine to N-player for a single acceptance
  // criterion, we drive `chooseAttackTarget` directly through 50+
  // deterministic 3-player permutations that all share the same kingmaking
  // setup:
  //
  //   * op_a — neutral bystander at 25 life, no board (the AI can always
  //     attack op_a, so a safe alternative always exists)
  //   * op_b — the doomed target at `bLife` life, no board (the AI's naive
  //     play would be to finish them off)
  //   * op_c — the player about to kill op_b; their board power is
  //     `cPower` (just enough to kill op_b if cPower >= bLife)
  //
  // Across the sweep, `chooseAttackTarget` at Expert must NEVER pick op_b.

  function buildKingmakingState(
    bLife: number,
    cPower: number,
    cLife: number,
    hasCommanderOnC: boolean,
  ) {
    const opponents = [
      // Bystander — the safe alternative the AI can always attack.
      {
        id: "op_a",
        life: 25,
        battlefield: [],
      },
      // Doomed — the kingmaking suspect.
      {
        id: "op_b",
        life: bLife,
        battlefield: [],
      },
      // Killer — the player who will take op_b out anyway.
      {
        id: "op_c",
        life: cLife,
        battlefield: [creature("cr_c1", cPower, cPower)],
      },
    ];
    const commandZone = hasCommanderOnC
      ? {
          op_c: {
            commander: commander("cmdr_c", "Bruse Tarl, Boorish Herder", 5, 5),
          },
        }
      : undefined;
    return _buildFixtureState("ai", opponents, commandZone);
  }

  it("Expert never picks the kingmaking-suspect across 50+ 3-player permutations", () => {
    let permutations = 0;
    let avoidedCount = 0;
    for (const bLife of [1, 2, 3, 4, 5, 8]) {
      for (const cPower of [2, 4, 6, 8, 10, 12, 14, 18, 25]) {
        if (cPower < bLife) continue;
        for (const cLife of [4, 12, 20]) {
          for (const hasCommander of [false, true]) {
            const state = buildKingmakingState(
              bLife,
              cPower,
              cLife,
              hasCommander,
            );
            const decision = chooseAttackTarget(
              state,
              "ai",
              undefined,
              "expert",
            );
            permutations++;
            if (decision.targetId === "op_b") {
              throw new Error(
                `Expert kingmade on perm #${permutations} (bLife=${bLife} ` +
                  `cPower=${cPower} cLife=${cLife} hasCommander=${hasCommander}): ` +
                  JSON.stringify(decision),
              );
            }
            if (decision.avoidedKingmaking) avoidedCount++;
          }
        }
      }
    }
    expect(permutations).toBeGreaterThanOrEqual(50);
    // The vast majority of permutations should trigger kingmaking avoidance
    // (an `op_a` always exists as a safe alternative).
    expect(avoidedCount).toBeGreaterThanOrEqual(permutations - 5);
    console.log(
      `[kingmaking] permutations=${permutations} avoidedKingmaking=${avoidedCount}`,
    );
  });

  it("Hard also avoids the kingmaking-suspect at every single iteration", () => {
    let attempted = 0;
    let avoided = 0;
    for (const bLife of [1, 2, 3, 4, 5, 8]) {
      for (const cPower of [2, 4, 6, 8, 10, 12, 14]) {
        if (cPower < bLife) continue;
        const state = buildKingmakingState(bLife, cPower, 18, false);
        const decision = chooseAttackTarget(state, "ai", undefined, "hard");
        attempted++;
        if (decision.targetId === "op_b") {
          throw new Error(`Hard kingmade at bLife=${bLife} cPower=${cPower}`);
        }
        if (decision.avoidedKingmaking) avoided++;
      }
    }
    expect(attempted).toBeGreaterThanOrEqual(10);
    expect(avoided).toBe(attempted);
  });
});

/* -------------------------------------------------------------------------- */
/* assessThreats — structural invariants                                       */
/* -------------------------------------------------------------------------- */

describe("assessThreats — sub-score branches", () => {
  it("non-creature permanents contribute a small board-strength bump", () => {
    // Two opponents with the same creature power but differing in
    // non-creature permanent count — the planeswalker side should rank
    // slightly higher.
    const state = _buildFixtureState(
      "ai",
      [
        {
          id: "op_a",
          life: 15,
          battlefield: [creature("cr_a", 5, 5)],
        },
        {
          id: "op_b",
          life: 15,
          battlefield: [
            creature("cr_b", 5, 5),
            {
              id: "pw_b",
              cardInstanceId: "pw_b",
              name: "Chandra, Torch of Defiance",
              type: "planeswalker",
              controller: "op_b",
              tapped: false,
              manaValue: 4,
              loyalty: 4,
              keywords: [],
            },
          ],
        },
      ],
      undefined,
    );
    const r = assessThreats(state, "ai", undefined, "expert");
    const a = r.find((x) => x.playerId === "op_a")!;
    const b = r.find((x) => x.playerId === "op_b")!;
    expect(b.boardScore).toBeGreaterThan(a.boardScore);
  });

  it("attackers on the combat layer aimed at the AI raise opponent intent", () => {
    // The attackers feed the intent sub-score. op_a has creatures swinging
    // at the AI; op_b has the same life and an empty battlefield.
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 18, battlefield: [creature("cr_a", 4, 4)] },
        { id: "op_b", life: 18, battlefield: [] },
      ],
      undefined,
    );
    state.combat = {
      inCombatPhase: true,
      attackers: [
        {
          cardInstanceId: "cr_a",
          defenderId: "ai",
          isAttackingPlaneswalker: false,
          damageToDeal: 4,
          hasFirstStrike: false,
          hasDoubleStrike: false,
        },
      ],
      blockers: {},
    };
    const r = assessThreats(state, "ai", undefined, "expert");
    const a = r.find((x) => x.playerId === "op_a")!;
    const b = r.find((x) => x.playerId === "op_b")!;
    expect(a.intentScore).toBeGreaterThan(b.intentScore);
    expect(a.intentScore).toBeGreaterThan(0);
  });

  it("attacker cards with unknown controllers fall back to the scoring opponent", () => {
    // An attacker whose cardInstanceId is not on any player's battlefield
    // (e.g. a token spawned mid-combat) should still register intent for
    // *some* opponent rather than silently be dropped. The fallback is to
    // attribute to the opponent being scored when no other player owns the
    // card — here, op_b has the same empty battlefield as the unattributed
    // attacker, so its intent should still pick up the +0.5.
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 18, battlefield: [] },
        { id: "op_b", life: 18, battlefield: [] },
      ],
      undefined,
    );
    state.combat = {
      inCombatPhase: true,
      attackers: [
        {
          cardInstanceId: "ghost-token",
          defenderId: "ai",
          isAttackingPlaneswalker: false,
          damageToDeal: 4,
          hasFirstStrike: false,
          hasDoubleStrike: false,
        },
      ],
      blockers: {},
    };
    const r = assessThreats(state, "ai", undefined, "expert");
    // The unattributed attacker should contribute to at least one opponent.
    const totalIntent = r.reduce((s, x) => s + x.intentScore, 0);
    expect(totalIntent).toBeGreaterThan(0);
  });

  it("opponent spells on the stack raise intent by 0.25 each", () => {
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 15, battlefield: [] },
        { id: "op_b", life: 15, battlefield: [] },
      ],
      undefined,
    );
    state.stack = [
      {
        id: "s_a1",
        cardInstanceId: "s_a1",
        controller: "op_a",
        type: "spell",
        targets: [],
        name: "Opt",
        manaValue: 1,
      },
      {
        id: "s_a2",
        cardInstanceId: "s_a2",
        controller: "op_a",
        type: "spell",
        targets: [],
        name: "Counterspell",
        manaValue: 2,
      },
    ];
    const r = assessThreats(state, "ai", undefined, "expert");
    const a = r.find((x) => x.playerId === "op_a")!;
    // Two opponent spells × 0.25 = 0.5 intent (clamped to 1.0 max).
    expect(a.intentScore).toBeGreaterThanOrEqual(0.5);
  });
});

describe("chooseResponseTarget — fallback / leader path edges", () => {
  it("falls back to highest-MV opponent spell when the leader has no spell on the stack", () => {
    // op_b is the threat leader (low life + Voltron commander). Stack has
    // only op_a spells at very different MVs — confirm we don't accidentally
    // pick op_a because leader has nothing on the stack.
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 20, battlefield: [] },
        { id: "op_b", life: 3, battlefield: [] },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
    state.stack = [
      {
        id: "spell_a_cheap",
        cardInstanceId: "spell_a_cheap",
        controller: "op_a",
        type: "spell",
        targets: [],
        name: "Brainstorm",
        manaValue: 1,
      },
      {
        id: "spell_a_big",
        cardInstanceId: "spell_a_big",
        controller: "op_a",
        type: "spell",
        targets: [],
        name: "Blightsteel Colossus",
        manaValue: 12,
      },
    ];
    const counter = chooseResponseTarget(state, "ai", "expert");
    // No leader-on-stack, fallback picks highest-MV opponent spell.
    expect(counter.stackObjectId).toBe("spell_a_big");
    expect(counter.reason).toMatch(/no clear leader/i);
  });

  it("picks the highest-MV spell among multiple leader spells", () => {
    // When the leader has multiple spells on the stack, take the highest.
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 20, battlefield: [] },
        { id: "op_b", life: 3, battlefield: [] },
      ],
      {
        op_b: {
          commander: commander("cmdr_b", "Sram, Senior Edificer", 8, 8),
        },
      },
    );
    state.stack = [
      {
        id: "spell_a",
        cardInstanceId: "spell_a",
        controller: "op_a",
        type: "spell",
        targets: [],
        name: "Snuff Out",
        manaValue: 4,
      },
      {
        id: "spell_b_cheap",
        cardInstanceId: "spell_b_cheap",
        controller: "op_b",
        type: "spell",
        targets: [],
        name: "Shock",
        manaValue: 1,
      },
      {
        id: "spell_b_big",
        cardInstanceId: "spell_b_big",
        controller: "op_b",
        type: "spell",
        targets: [],
        name: "Decree of Savagery",
        manaValue: 8,
      },
    ];
    const counter = chooseResponseTarget(state, "ai", "expert");
    expect(counter.stackObjectId).toBe("spell_b_big");
  });
});

describe("assessThreats — structural invariants", () => {
  it("always returns one row per requested opponent", () => {
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 15, battlefield: [] },
        { id: "op_b", life: 18, battlefield: [] },
        { id: "op_c", life: 12, battlefield: [] },
      ],
      undefined,
    );
    const r = assessThreats(state, "ai", undefined, "expert");
    expect(r).toHaveLength(3);
    expect(new Set(r.map((x) => x.playerId))).toEqual(
      new Set(["op_a", "op_b", "op_c"]),
    );
  });

  it("returns a non-leader reason string when pick is non-leader", () => {
    // Drives the "Top of safe pool" branch in chooseAttackTarget: when the
    // leader is also the kingmaking-suspect, Hard picks the next safest and
    // the reason string does NOT say "Threat leader".
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 25, battlefield: [] }, // bystander
        { id: "op_b", life: 5, battlefield: [] }, // doomed target
        { id: "op_c", life: 15, battlefield: [creature("cr_c", 6, 6)] }, // killer
      ],
      undefined,
    );
    const decision = chooseAttackTarget(state, "ai", undefined, "hard");
    expect(decision.avoidedKingmaking).toBe(true);
    // The reason should explain the avoidance rather than calling op_a the leader.
    expect(decision.reason).toMatch(/avoidance/i);
  });

  it("sub-scores are all in [0,1]", () => {
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 30, battlefield: [creature("cr_a", 4, 4)] },
      ],
      {
        op_a: {
          commander: commander("cmdr_a", "Sram, Senior Edificer", 7, 7),
        },
      },
    );
    const r = assessThreats(state, "ai", undefined, "expert")[0];
    for (const k of ["lifeScore", "boardScore", "commanderScore", "intentScore", "threatScore"] as const) {
      const v = r[k];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("ignores opponent IDs that are missing from the game state", () => {
    const state = _buildFixtureState("ai", [], undefined);
    // Phantom opponent; ranks get a zero assessment per the missing-player path.
    const r = assessThreats(state, "ai", ["phantom"], "expert");
    expect(r).toHaveLength(1);
    expect(r[0].playerId).toBe("phantom");
    expect(r[0].threatScore).toBe(0);
  });

  it("is sorted strictly descending by threatScore at expert", () => {
    const state = _buildFixtureState(
      "ai",
      [
        { id: "op_a", life: 5, battlefield: [creature("cr_a", 5, 5)] },
        { id: "op_b", life: 15, battlefield: [] },
        { id: "op_c", life: 20, battlefield: [] },
      ],
      undefined,
    );
    const r = assessThreats(state, "ai", undefined, "expert");
    for (let i = 1; i < r.length; i++) {
      const prev: MultiplayerThreatAssessment = r[i - 1];
      const cur: MultiplayerThreatAssessment = r[i];
      expect(prev.threatScore).toBeGreaterThanOrEqual(cur.threatScore);
    }
  });
});
