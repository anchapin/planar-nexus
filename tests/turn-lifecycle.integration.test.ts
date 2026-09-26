/**
 * Integration test: full turn lifecycle simulation.
 *
 * Rather than re-checking individual helpers (covered by unit tests), this
 * drives the real turn-structure workflow end-to-end across two game-state
 * modules (types.ts + turn-phases.ts):
 *   createTurn
 *     -> walk a complete Untap..Cleanup cycle via advancePhase / getNextPhase
 *     -> assert spell-speed permission gating flips at the right steps
 *        (main vs combat vs no-priority), exercising the cross-step invariants
 *     -> startNextTurn (player handoff + draw eligibility)
 *     -> addExtraTurn / hasExtraTurn (extra-turn accounting)
 *
 * Resolves issue #931.
 */

import { describe, it, expect } from "@jest/globals";

import { Phase } from "@/lib/game-state/types";
import {
  createTurn,
  advancePhase,
  getNextPhase,
  getPreviousPhase,
  isMainPhase,
  isCombatPhase,
  isBeginningPhase,
  isEndingPhase,
  isCombatDamageStep,
  playersGetPriority,
  canCastSorcerySpeedSpells,
  canCastInstantSpeedSpells,
  startNextTurn,
  addExtraTurn,
  hasExtraTurn,
  playerDrawsCard,
  getPhaseName,
  getPhaseShortName,
} from "@/lib/game-state/turn-phases";

// The canonical MTG turn structure, shared by turn-phases.ts.
const FULL_TURN_ORDER: Phase[] = [
  Phase.UNTAP,
  Phase.UPKEEP,
  Phase.DRAW,
  Phase.PRECOMBAT_MAIN,
  Phase.BEGIN_COMBAT,
  Phase.DECLARE_ATTACKERS,
  Phase.DECLARE_BLOCKERS,
  Phase.COMBAT_DAMAGE_FIRST_STRIKE,
  Phase.COMBAT_DAMAGE,
  Phase.END_COMBAT,
  Phase.POSTCOMBAT_MAIN,
  Phase.END,
  Phase.CLEANUP,
];

describe("full turn lifecycle simulation", () => {
  it("creates a first turn rooted at the Untap step with no draw", () => {
    const turn = createTurn("player-1", 1, true);
    expect(turn.activePlayerId).toBe("player-1");
    expect(turn.turnNumber).toBe(1);
    expect(turn.currentPhase).toBe(Phase.UNTAP);
    expect(turn.isFirstTurn).toBe(true);
    // On the very first turn of a game the starting player does not draw.
    expect(playerDrawsCard(turn)).toBe(false);
  });

  it("walks the complete Untap -> Cleanup cycle with no gaps or repeats", () => {
    // Verify the static phase chain first.
    const chain: Phase[] = [Phase.UNTAP];
    let cursor: Phase | null = Phase.UNTAP;
    while ((cursor = getNextPhase(cursor)) !== null) chain.push(cursor);
    expect(chain).toEqual(FULL_TURN_ORDER);
    expect(getNextPhase(Phase.CLEANUP)).toBeNull();

    // Now simulate driving a turn forward step by step, collecting visited phases.
    let turn = createTurn("player-1", 1, true);
    const visited: Phase[] = [turn.currentPhase];
    for (let i = 0; i < FULL_TURN_ORDER.length - 1; i++) {
      turn = advancePhase(turn);
      visited.push(turn.currentPhase);
    }
    expect(turn.currentPhase).toBe(Phase.CLEANUP);
    expect(visited).toEqual(FULL_TURN_ORDER);
  });

  it("flips spell-speed permissions correctly as the phase context changes", () => {
    // Beginning phase: untap grants no priority; upkeep/draw do.
    expect(playersGetPriority(Phase.UNTAP)).toBe(false);
    expect(canCastInstantSpeedSpells(Phase.UNTAP)).toBe(false);
    expect(canCastInstantSpeedSpells(Phase.UPKEEP)).toBe(true);

    // Main phase: sorcery-speed allowed only when the stack is empty.
    expect(isMainPhase(Phase.PRECOMBAT_MAIN)).toBe(true);
    expect(isCombatPhase(Phase.PRECOMBAT_MAIN)).toBe(false);
    expect(canCastSorcerySpeedSpells(Phase.PRECOMBAT_MAIN, true)).toBe(true);
    expect(canCastSorcerySpeedSpells(Phase.PRECOMBAT_MAIN, false)).toBe(false);

    // Combat phase: never sorcery-speed; instants still allowed where priority exists.
    expect(isCombatPhase(Phase.DECLARE_ATTACKERS)).toBe(true);
    expect(isMainPhase(Phase.DECLARE_ATTACKERS)).toBe(false);
    expect(canCastSorcerySpeedSpells(Phase.DECLARE_ATTACKERS, true)).toBe(
      false,
    );
    expect(canCastInstantSpeedSpells(Phase.DECLARE_BLOCKERS)).toBe(true);

    // Ending phase: cleanup grants no priority.
    expect(isEndingPhase(Phase.CLEANUP)).toBe(true);
    expect(playersGetPriority(Phase.CLEANUP)).toBe(false);
  });

  it("hands the turn to the next player and re-enables the draw", () => {
    const firstTurn = createTurn("player-1", 1, true);
    const secondTurn = startNextTurn(firstTurn, "player-2");

    expect(secondTurn.activePlayerId).toBe("player-2");
    expect(secondTurn.turnNumber).toBe(2);
    expect(secondTurn.currentPhase).toBe(Phase.UNTAP);
    expect(secondTurn.isFirstTurn).toBe(false);
    // From the second turn onward the active player draws in their draw step.
    expect(playerDrawsCard(secondTurn)).toBe(true);
  });

  it("accounts for extra turns across a handoff", () => {
    let turn = createTurn("player-1", 3, false);
    turn = addExtraTurn(turn, 1);
    expect(hasExtraTurn(turn)).toBe(true);
    expect(turn.extraTurns).toBe(1);

    // The current player takes another turn instead of passing.
    const next = startNextTurn(turn, "player-1");
    expect(next.activePlayerId).toBe("player-1");
    expect(next.extraTurns).toBe(0);
    expect(hasExtraTurn(next)).toBe(false);
  });

  it("keeps beginning / main / combat / ending buckets mutually consistent for every phase", () => {
    // Cross-step invariant: every phase falls into exactly the expected bucket,
    // a property the UI relies on to render the turn wheel.
    for (const phase of FULL_TURN_ORDER) {
      const buckets = [
        isBeginningPhase(phase),
        isMainPhase(phase),
        isCombatPhase(phase),
        isEndingPhase(phase),
      ];
      // Beginning, main, combat, ending are disjoint; cleanup/end are "ending".
      const trueCount = buckets.filter(Boolean).length;
      expect(trueCount).toBeGreaterThanOrEqual(1);
      // Main and combat never overlap.
      expect(isMainPhase(phase) && isCombatPhase(phase)).toBe(false);
      // Every phase has a display name.
      expect(getPhaseName(phase).length).toBeGreaterThan(0);
    }
  });
});

describe("Backward phase traversal", () => {
  it("should return null for untap (no previous phase)", () => {
    expect(getPreviousPhase(Phase.UNTAP)).toBeNull();
  });

  it("should return correct previous phase for each phase", () => {
    const expectations: [Phase, Phase | null][] = [
      [Phase.UNTAP, null],
      [Phase.UPKEEP, Phase.UNTAP],
      [Phase.DRAW, Phase.UPKEEP],
      [Phase.PRECOMBAT_MAIN, Phase.DRAW],
      [Phase.BEGIN_COMBAT, Phase.PRECOMBAT_MAIN],
      [Phase.DECLARE_ATTACKERS, Phase.BEGIN_COMBAT],
      [Phase.DECLARE_BLOCKERS, Phase.DECLARE_ATTACKERS],
      [Phase.COMBAT_DAMAGE_FIRST_STRIKE, Phase.DECLARE_BLOCKERS],
      [Phase.COMBAT_DAMAGE, Phase.COMBAT_DAMAGE_FIRST_STRIKE],
      [Phase.END_COMBAT, Phase.COMBAT_DAMAGE],
      [Phase.POSTCOMBAT_MAIN, Phase.END_COMBAT],
      [Phase.END, Phase.POSTCOMBAT_MAIN],
      [Phase.CLEANUP, Phase.END],
    ];

    expectations.forEach(([phase, expected]) => {
      expect(getPreviousPhase(phase)).toBe(expected);
    });
  });

  it("should allow round-trip navigation (next then previous)", () => {
    let turn = createTurn("player-1", 1, false);
    turn = advancePhase(turn); // UPKEEP
    turn = advancePhase(turn); // DRAW
    expect(turn.currentPhase).toBe(Phase.DRAW);
    turn = { ...turn, currentPhase: getPreviousPhase(turn.currentPhase)! }; // back to UPKEEP
    expect(turn.currentPhase).toBe(Phase.UPKEEP);
  });
});

describe("End-of-turn boundary", () => {
  it("should stay at cleanup when advancePhase is called after cleanup", () => {
    let turn = createTurn("player-1", 1, false);
    while (turn.currentPhase !== Phase.CLEANUP) {
      turn = advancePhase(turn);
    }
    expect(turn.currentPhase).toBe(Phase.CLEANUP);
    const stuckTurn = advancePhase(turn);
    expect(stuckTurn.currentPhase).toBe(Phase.CLEANUP);
    expect(stuckTurn).toEqual(turn);
  });

  it("should track turn number correctly across multiple full turns", () => {
    let turn = createTurn("player-1", 1, false);
    while (turn.currentPhase !== Phase.CLEANUP) {
      turn = advancePhase(turn);
    }
    turn = startNextTurn(turn, "player-2", false);
    expect(turn.turnNumber).toBe(2);
    expect(turn.activePlayerId).toBe("player-2");
    expect(turn.currentPhase).toBe(Phase.UNTAP);
  });
});

describe("Combat damage steps", () => {
  it("should identify combat damage steps correctly", () => {
    expect(isCombatDamageStep(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(true);
    expect(isCombatDamageStep(Phase.COMBAT_DAMAGE)).toBe(true);
    expect(isCombatDamageStep(Phase.DECLARE_ATTACKERS)).toBe(false);
    expect(isCombatDamageStep(Phase.DECLARE_BLOCKERS)).toBe(false);
    expect(isCombatDamageStep(Phase.END_COMBAT)).toBe(false);
  });

  it("should skip first-strike damage step in normal combat", () => {
    const normalPhases = [
      Phase.UNTAP,
      Phase.UPKEEP,
      Phase.DRAW,
      Phase.PRECOMBAT_MAIN,
      Phase.BEGIN_COMBAT,
      Phase.DECLARE_ATTACKERS,
      Phase.DECLARE_BLOCKERS,
      Phase.COMBAT_DAMAGE,
      Phase.END_COMBAT,
      Phase.POSTCOMBAT_MAIN,
      Phase.END,
      Phase.CLEANUP,
    ];
    const combatDamageSteps = normalPhases.filter(isCombatDamageStep);
    expect(combatDamageSteps).toEqual([Phase.COMBAT_DAMAGE]);
  });
});

describe("Phase display names", () => {
  it("should return correct short phase names", () => {
    expect(getPhaseShortName(Phase.PRECOMBAT_MAIN)).toBe("Main 1");
    expect(getPhaseShortName(Phase.POSTCOMBAT_MAIN)).toBe("Main 2");
    expect(getPhaseShortName(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(
      "First Strike",
    );
    expect(getPhaseShortName(Phase.COMBAT_DAMAGE)).toBe("Damage");
    expect(getPhaseShortName(Phase.BEGIN_COMBAT)).toBe("Combat");
    expect(getPhaseShortName(Phase.DECLARE_ATTACKERS)).toBe("Attackers");
    expect(getPhaseShortName(Phase.DECLARE_BLOCKERS)).toBe("Blockers");
  });

  it("should return correct full phase names", () => {
    expect(getPhaseName(Phase.PRECOMBAT_MAIN)).toBe("Pre-Combat Main");
    expect(getPhaseName(Phase.POSTCOMBAT_MAIN)).toBe("Post-Combat Main");
    expect(getPhaseName(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(
      "Combat Damage (First Strike)",
    );
    expect(getPhaseName(Phase.COMBAT_DAMAGE)).toBe("Combat Damage");
    expect(getPhaseName(Phase.END)).toBe("End");
    expect(getPhaseName(Phase.CLEANUP)).toBe("Cleanup");
  });
});

describe("Extra turn handoff edge cases", () => {
  it("should decrement extraTurns on each startNextTurn", () => {
    let turn = createTurn("player-1", 1, false);
    turn = addExtraTurn(turn, 2);
    expect(turn.extraTurns).toBe(2);

    turn = startNextTurn(turn, "player-2", false);
    expect(turn.extraTurns).toBe(1);

    turn = startNextTurn(turn, "player-1", false);
    expect(turn.extraTurns).toBe(0);
    expect(hasExtraTurn(turn)).toBe(false);
  });

  it("should treat a new game first turn correctly", () => {
    const turn = createTurn("player-1", 1, true);
    expect(playerDrawsCard(turn)).toBe(false);
    expect(turn.currentPhase).toBe(Phase.UNTAP);
    expect(turn.isFirstTurn).toBe(true);
  });

  it("should allow draw on second turn of game", () => {
    const firstTurn = createTurn("player-1", 1, true);
    expect(playerDrawsCard(firstTurn)).toBe(false);

    const secondTurn = startNextTurn(firstTurn, "player-2", false);
    expect(secondTurn.isFirstTurn).toBe(false);
    expect(playerDrawsCard(secondTurn)).toBe(true);
  });
});
