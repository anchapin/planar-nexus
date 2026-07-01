/**
 * Tests for <GameAnnouncer> (issue #1267).
 *
 * Covers the screen-reader live region: its DOM shape, the throttle window,
 * and the announcement strings emitted for turn swaps, phase changes,
 * priority flips, and life-total changes. We rely on `jest.useFakeTimers()`
 * so we can advance `THROTTLE_MS` deterministically — a real wall-clock wait
 * is unacceptable in unit tests.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { GameAnnouncer, useGameAnnouncer, __testing } from "../game-announcer";
import { Phase } from "@/lib/game-state/types";
import type { GameState, PlayerId } from "@/lib/game-state/types";
import { createInitialGameState } from "@/lib/game-state/game-state";
import { advancePhase, startNextTurn } from "@/lib/game-state/turn-phases";

const { THROTTLE_MS } = __testing;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Harness {
  engineState: GameState;
  youId: PlayerId;
  oppId: PlayerId;
}

function makeHarness(): Harness {
  // Mirror the production setup in game-board/page.tsx: ["Opponent", "You"].
  // The Map preserves insertion order so the second player inserted is "You".
  const state = createInitialGameState(["Opponent", "You"], 20, false);
  const ids = Array.from(state.players.keys());
  return {
    engineState: state,
    youId: ids[1]!,
    oppId: ids[0]!,
  };
}

/**
 * Convenience: clone a Turn/Player Map deeply enough that mutations don't
 * bleed between tests. `GameState` carries several Maps and nested objects;
 * rather than deep-clone every one we just spread the top-level fields and
 * re-construct the maps we care about.
 */
function cloneState(
  state: GameState,
  mutate?: (draft: GameState) => void,
): GameState {
  const next: GameState = {
    ...state,
    players: new Map(state.players),
    turn: { ...state.turn },
  };
  if (mutate) mutate(next);
  return next;
}

/** Wrapper component that captures the imperative announce for testing. */
function ManualAnchoredProbe({
  onReady,
}: {
  onReady: (a: (m: string) => void) => void;
}) {
  const { announce } = useGameAnnouncer();
  // Expose `announce` to the parent test on first render via a ref-less
  // callback so the test can drive manual announcements.
  React.useEffect(() => {
    onReady(announce);
  }, [announce, onReady]);
  return null;
}

// ---------------------------------------------------------------------------
// DOM shape
// ---------------------------------------------------------------------------

describe("GameAnnouncer — DOM shape", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders a visually hidden polite live region with status role", () => {
    const { engineState } = makeHarness();
    render(<GameAnnouncer engineState={engineState} />);

    const region = screen.getByTestId("game-announcer");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region.className).toContain("sr-only");
  });

  it("publishes nothing on first render — there is no previous state to diff against", () => {
    const { engineState } = makeHarness();
    render(<GameAnnouncer engineState={engineState} />);

    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS * 3);
    });

    expect(screen.getByTestId("game-announcer")).toHaveTextContent("");
  });

  it("does not render any visible content (sr-only)", () => {
    const { engineState } = makeHarness();
    const { container } = render(<GameAnnouncer engineState={engineState} />);
    // No element with intrinsic visible text or a non-sr-only class.
    const regions = container.querySelectorAll(
      '[data-testid="game-announcer"]',
    );
    expect(regions.length).toBe(1);
    expect((regions[0] as HTMLElement).className).toContain("sr-only");
  });
});

// ---------------------------------------------------------------------------
// Pure announcer helper — the heart of the unit suite.
// Tests for `deriveGameStateAnnouncements` run WITHOUT timers because the
// function is pure.
// ---------------------------------------------------------------------------

describe("deriveGameStateAnnouncements — turn / phase / priority / life", () => {
  const { deriveGameStateAnnouncements } = __testing;

  function mutate(
    prev: GameState,
    mutator: (state: GameState) => void,
  ): GameState {
    const next = cloneState(prev);
    mutator(next);
    return next;
  }

  it("announces the local player's turn swap", () => {
    const harness = makeHarness();
    // Pre-seed priority on the LOCAL player so the upcoming turn swap
    // produces ONLY a turn-change announcement (priority is unchanged).
    const seeded = mutate(harness.engineState, (s) => {
      s.priorityPlayerId = harness.youId;
    });
    const next = mutate(seeded, (s) => {
      const turn = startNextTurn(s.turn, harness.youId, false);
      s.turn = turn;
      // Priority stays with the local (now-active) player.
      s.priorityPlayerId = harness.youId;
    });

    const out = deriveGameStateAnnouncements(seeded, next, harness.youId);

    expect(out).toEqual(["Your turn — Untap step"]);
  });

  it("announces the opponent's turn swap by name", () => {
    const harness = makeHarness();
    // Start from a state where YOU'RE active (so the swap to opponent is
    // a real active-player change) and pre-seed priority on YOU.
    const seeded = mutate(harness.engineState, (s) => {
      s.turn = startNextTurn(s.turn, harness.youId, false);
      s.priorityPlayerId = harness.youId;
    });
    const next = mutate(seeded, (s) => {
      // Real turn swap: active player flips from YOU to OPPONENT, and
      // turn number advances. Priority follows the new active player so
      // the priority diff ALONGSIDE the turn swap is meaningful and
      // visible in the same announcement bundle.
      const turn = startNextTurn(s.turn, harness.oppId, false);
      s.turn = turn;
      s.priorityPlayerId = harness.oppId;
    });

    const out = deriveGameStateAnnouncements(seeded, next, harness.youId);

    // Both the turn swap AND the priority flip land in the announcement
    // bundle — this is exactly what a screen-reader user should hear
    // when the AI ends its turn and the active player switches.
    expect(out).toEqual([
      "Opponent's turn — Untap step",
      "Opponent has priority",
    ]);
  });

  it("announces a phase change without a turn swap", () => {
    const harness = makeHarness();
    const next = mutate(harness.engineState, (s) => {
      s.turn = advancePhase(s.turn);
    });

    const out = deriveGameStateAnnouncements(
      harness.engineState,
      next,
      harness.youId,
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/now in /i);
  });

  it("maps each engine phase to the right user-facing phrase", () => {
    const { describePhase } = __testing;
    expect(describePhase(Phase.UNTAP)).toBe("Untap step");
    expect(describePhase(Phase.UPKEEP)).toBe("Upkeep step");
    expect(describePhase(Phase.DRAW)).toBe("Draw step");
    expect(describePhase(Phase.PRECOMBAT_MAIN)).toBe("Main phase 1");
    expect(describePhase(Phase.BEGIN_COMBAT)).toBe("Beginning of combat");
    expect(describePhase(Phase.DECLARE_ATTACKERS)).toBe("Declare attackers");
    expect(describePhase(Phase.DECLARE_BLOCKERS)).toBe("Declare blockers");
    expect(describePhase(Phase.COMBAT_DAMAGE)).toBe("Combat damage");
    expect(describePhase(Phase.COMBAT_DAMAGE_FIRST_STRIKE)).toBe(
      "First strike combat damage",
    );
    expect(describePhase(Phase.END_COMBAT)).toBe("End of combat");
    expect(describePhase(Phase.POSTCOMBAT_MAIN)).toBe("Main phase 2");
    expect(describePhase(Phase.END)).toBe("Ending phase");
    expect(describePhase(Phase.CLEANUP)).toBe("Cleanup step");
  });

  it("announces a priority flip with 'You have priority' for the local player", () => {
    const harness = makeHarness();
    const prev = cloneState(harness.engineState, (s) => {
      s.priorityPlayerId = harness.oppId;
    });
    const next = cloneState(prev, (s) => {
      s.priorityPlayerId = harness.youId;
    });

    const out = deriveGameStateAnnouncements(prev, next, harness.youId);

    expect(out).toContain("You have priority");
  });

  it("announces a priority flip with the opponent's name when they take priority", () => {
    const harness = makeHarness();
    const prev = cloneState(harness.engineState, (s) => {
      s.priorityPlayerId = harness.youId;
    });
    const next = cloneState(prev, (s) => {
      s.priorityPlayerId = harness.oppId;
    });

    const out = deriveGameStateAnnouncements(prev, next, harness.youId);

    expect(out).toEqual(["Opponent has priority"]);
  });

  it("announces large life-total gains and losses", () => {
    const harness = makeHarness();
    const prev = cloneState(harness.engineState);
    const next = mutate(prev, (s) => {
      const local = s.players.get(harness.youId)!;
      const opp = s.players.get(harness.oppId)!;
      s.players.set(harness.youId, { ...local, life: local.life - 5 });
      s.players.set(harness.oppId, { ...opp, life: opp.life + 3 });
    });

    const out = deriveGameStateAnnouncements(prev, next, harness.youId);

    // Order matches the engine's player Map insertion order (Opponent
    // first, then You) so the assertion below mirrors what callers see
    // when the announcer iterates `next.players`.
    expect(out).toEqual([
      "Opponent gains 3 life (now 23)",
      "You loses 5 life (now 15)",
    ]);
  });

  it("suppresses noise-level life changes (below LIFE_DELTA_THRESHOLD)", () => {
    const harness = makeHarness();
    const prev = cloneState(harness.engineState);
    const next = mutate(prev, (s) => {
      const local = s.players.get(harness.youId)!;
      s.players.set(harness.youId, { ...local, life: local.life }); // 0 delta
    });

    const out = deriveGameStateAnnouncements(prev, next, harness.youId);

    expect(out).toEqual([]);
  });

  it("returns no announcements when prev is null (first render)", () => {
    const harness = makeHarness();
    expect(
      __testing.deriveGameStateAnnouncements(null, harness.engineState, null),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Throttled delivery — DOM-level tests.
// ---------------------------------------------------------------------------

describe("GameAnnouncer — throttled delivery", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes the first announcement immediately and queues subsequent ones", () => {
    const harness = makeHarness();
    const { rerender } = render(
      <GameAnnouncer
        engineState={harness.engineState}
        localPlayerId={harness.youId}
      />,
    );

    // Bump the turn — single transition.
    const next = cloneState(harness.engineState, (s) => {
      s.turn = advancePhase(s.turn);
    });
    rerender(
      <GameAnnouncer engineState={next} localPlayerId={harness.youId} />,
    );

    // First announcement should already be in the DOM (flushes synchronously
    // via the 0-ms setTimeout in flush()).
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(screen.getByTestId("game-announcer").textContent).not.toBe("");
  });

  it("throttles burst announcements to one per THROTTLE_MS", () => {
    const harness = makeHarness();
    let announceRef: ((m: string) => void) | null = null;
    render(
      <GameAnnouncer
        engineState={harness.engineState}
        localPlayerId={harness.youId}
      >
        <ManualAnchoredProbe
          onReady={(a) => {
            announceRef = a;
          }}
        />
      </GameAnnouncer>,
    );

    // Three back-to-back manual announcements.
    act(() => {
      announceRef?.("First message");
      announceRef?.("Second message");
      announceRef?.("Third message");
    });

    // Only the first has surfaced.
    expect(screen.getByTestId("game-announcer").textContent).toBe(
      "First message",
    );

    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    expect(screen.getByTestId("game-announcer").textContent).toBe(
      "Second message",
    );

    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    expect(screen.getByTestId("game-announcer").textContent).toBe(
      "Third message",
    );
  });

  it("suppresses identical repeat announcements", () => {
    const harness = makeHarness();
    let announceRef: ((m: string) => void) | null = null;
    render(
      <GameAnnouncer
        engineState={harness.engineState}
        localPlayerId={harness.youId}
      >
        <ManualAnchoredProbe
          onReady={(a) => {
            announceRef = a;
          }}
        />
      </GameAnnouncer>,
    );

    act(() => {
      announceRef?.("Repeat");
      announceRef?.("Repeat");
      announceRef?.("Repeat");
    });
    expect(screen.getByTestId("game-announcer").textContent).toBe("Repeat");

    // Even after a full throttle window, dedup keeps the second "Repeat"
    // from being announced.
    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    // The queue continues running but should find nothing left to speak.
    expect(screen.getByTestId("game-announcer").textContent).toBe("Repeat");
  });

  it("publishes a phase-change announcement within one throttle window (acceptance #4: <1s)", () => {
    const harness = makeHarness();
    const { rerender } = render(
      <GameAnnouncer
        engineState={harness.engineState}
        localPlayerId={harness.youId}
      />,
    );

    // Simulate a `advancePhase()` call — same active player, next phase.
    const next = cloneState(harness.engineState, (s) => {
      s.turn = advancePhase(s.turn);
    });
    rerender(
      <GameAnnouncer engineState={next} localPlayerId={harness.youId} />,
    );

    // Within the throttle window the first message must already be visible.
    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });

    const region = screen.getByTestId("game-announcer");
    expect(region.textContent).toMatch(/now in/i);
  });
});

// ---------------------------------------------------------------------------
// End-to-end coverage of the four transitions in one suite so a reviewer can
// see a single trace of the live-region's spoken output across a turn.
// ---------------------------------------------------------------------------

describe("GameAnnouncer — simulated turn (acceptance #4)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("walks a full advancePhase -> passPriority -> life loss trace", () => {
    const harness = makeHarness();
    // Initial state has the Opponent holding priority (priorityPlayerId =
    // firstPlayerId by createInitialGameState). Move it to the local player
    // so the script below generates a real priority FIP in the order the
    // test asserts.
    const seeded = cloneState(harness.engineState, (s) => {
      s.priorityPlayerId = harness.youId;
    });
    const { rerender } = render(
      <GameAnnouncer engineState={seeded} localPlayerId={harness.youId} />,
    );

    // 1. advancePhase (only phase changes, not turn).
    const afterPhase = cloneState(seeded, (s) => {
      s.turn = advancePhase(s.turn);
    });
    rerender(
      <GameAnnouncer engineState={afterPhase} localPlayerId={harness.youId} />,
    );
    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    expect(screen.getByTestId("game-announcer").textContent).toMatch(/now in/i);

    // 2. passPriority flips priority to the opponent.
    const afterPass = cloneState(afterPhase, (s) => {
      s.priorityPlayerId = harness.oppId;
    });
    rerender(
      <GameAnnouncer engineState={afterPass} localPlayerId={harness.youId} />,
    );
    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    expect(screen.getByTestId("game-announcer").textContent).toBe(
      "Opponent has priority",
    );

    // 3. life loss on the local player.
    const afterLife = cloneState(afterPass, (s) => {
      const local = s.players.get(harness.youId)!;
      s.players.set(harness.youId, { ...local, life: local.life - 4 });
    });
    rerender(
      <GameAnnouncer engineState={afterLife} localPlayerId={harness.youId} />,
    );
    act(() => {
      jest.advanceTimersByTime(THROTTLE_MS);
    });
    expect(screen.getByTestId("game-announcer").textContent).toBe(
      "You loses 4 life (now 16)",
    );
  });
});

// ---------------------------------------------------------------------------
// useGameAnnouncer — error case so wiring mistakes are loud.
// ---------------------------------------------------------------------------

describe("useGameAnnouncer — guard", () => {
  it("throws when used outside of <GameAnnouncer>", () => {
    // Silence React error logs so the test output stays readable; the
    // throw is expected.
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    function Thief() {
      useGameAnnouncer();
      return null;
    }
    expect(() => render(<Thief />)).toThrow(
      /useGameAnnouncer must be used inside <GameAnnouncer>/i,
    );
    consoleErrorSpy.mockRestore();
  });
});
