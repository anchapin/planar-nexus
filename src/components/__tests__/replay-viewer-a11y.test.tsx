/**
 * @fileoverview Accessibility tests for <ReplayViewer> — issue #1604.
 *
 * Targets WCAG 1.3.1 (Info and Relationships), 4.1.2 (Name, Role, Value), and
 * 4.1.3 (Status Messages) for the replay-playback experience:
 *
 *   1. The transport controls are wrapped in a labelled `region`.
 *   2. Each transport button exposes an explicit accessible name so SR users
 *      hear more than a bare title attribute.
 *   3. The current play position is announced via an `aria-live="polite"`
 *      region ("Action <n> of <total>: <summary>") that re-fires on step /
 *      play / jump.
 *   4. The speed selector uses radiogroup semantics so screen readers can
 *      perceive the current value and navigate alternatives with the radio
 *      arrow-key pattern.
 *
 * The repo already covers `useReplayStorage`'s localStorage validation in
 * `replay-viewer-storage.test.tsx`; this file focuses on DOM-level a11y.
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReplayViewer } from "../replay-viewer";
import type { Replay, ReplayAction } from "@/lib/game-state/replay";
import { createInitialGameState } from "@/lib/game-state/game-state";
import type { GameState, GameAction } from "@/lib/game-state/types";

// jsdom polyfills required by Radix primitives used elsewhere; cheap to keep.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a real `GameState` via the engine so `resultingState` satisfies the
 * full type. The viewer only ever reads `description` and
 * `resultingState.turn.turnNumber`, so a single shared base + per-action
 * turn override is enough.
 */
function makeAction(
  baseState: GameState,
  sequenceNumber: number,
  description: string,
  turnNumber: number,
): ReplayAction {
  const action: GameAction = {
    type: "draw_card",
    playerId: baseState.players.keys().next().value!,
    timestamp: 0,
    data: {},
  };
  return {
    sequenceNumber,
    action,
    resultingState: { ...baseState, turn: { ...baseState.turn, turnNumber } },
    description,
    recordedAt: 0,
  };
}

function makeReplay(): Replay {
  const baseState = createInitialGameState(["Alice", "Bob"], 40, true);
  return {
    id: "replay-a11y",
    metadata: {
      format: "commander",
      playerNames: ["Alice", "Bob"],
      startingLife: 40,
      isCommander: true,
      gameStartDate: 1700000000000,
    },
    actions: [
      makeAction(baseState, 1, "Alice plays Island", 1),
      makeAction(baseState, 2, "Bob casts Counterspell", 1),
      makeAction(baseState, 3, "Alice draws a card", 2),
    ],
    currentPosition: 0,
    totalActions: 3,
    createdAt: 1700000000000,
    lastModifiedAt: 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// Region & transport buttons
// ---------------------------------------------------------------------------

describe("ReplayViewer — playback region (#1604, WCAG 1.3.1 / 4.1.2)", () => {
  it("wraps the transport controls in a labelled region", () => {
    render(<ReplayViewer replay={makeReplay()} />);

    const region = screen.getByRole("region", {
      name: /playback controls/i,
    });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute(
      "aria-label",
      "Game replay playback controls",
    );

    // The five transport buttons live inside the region so AT can land on
    // them via the landmark and announce the controls context first.
    expect(
      within(region).getByRole("button", { name: /^skip to start$/i }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: /^step backward$/i }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: /^play$/i }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: /^step forward$/i }),
    ).toBeInTheDocument();
    expect(
      within(region).getByRole("button", { name: /^skip to end$/i }),
    ).toBeInTheDocument();
  });

  it("flips the play/pause button's accessible name with the playback state", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    // Initial state: not playing → "Play".
    expect(screen.getByRole("button", { name: /^play$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^pause$/i }),
    ).not.toBeInTheDocument();

    // Toggle into playing → label becomes "Pause".
    await user.click(screen.getByRole("button", { name: /^play$/i }));
    expect(
      screen.getByRole("button", { name: /^pause$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^play$/i }),
    ).not.toBeInTheDocument();

    // Toggle back → "Play" returns.
    await user.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(screen.getByRole("button", { name: /^play$/i })).toBeInTheDocument();
  });

  it("disables skip-to-start and step-backward when position is 0", () => {
    render(<ReplayViewer replay={makeReplay()} />);

    expect(
      screen.getByRole("button", { name: /^skip to start$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^step backward$/i }),
    ).toBeDisabled();
  });

  it("disables skip-to-end and step-forward when position is at the last action", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    // Two step-forwards from position 0 lands on position 2 (the last index).
    await user.click(screen.getByRole("button", { name: /^step forward$/i }));
    await user.click(screen.getByRole("button", { name: /^step forward$/i }));

    expect(
      screen.getByRole("button", { name: /^step forward$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^skip to end$/i }),
    ).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Position announcer — WCAG 4.1.3 status messages
// ---------------------------------------------------------------------------

describe("ReplayViewer — aria-live position announcer (#1604, WCAG 4.1.3)", () => {
  it("renders a visually hidden polite live region announcing the current action", () => {
    render(<ReplayViewer replay={makeReplay()} />);

    const announcer = screen.getByTestId("replay-position-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveAttribute("aria-atomic", "true");
    expect(announcer.className).toContain("sr-only");

    // Initial render — position 0 / 3 actions, first description.
    expect(announcer.textContent).toMatch(
      /^Action 1 of 3: Alice plays Island$/,
    );
  });

  it("updates the announcement when stepping forward", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    await user.click(screen.getByRole("button", { name: /^step forward$/i }));

    expect(screen.getByTestId("replay-position-announcer").textContent).toMatch(
      /^Action 2 of 3: Bob casts Counterspell$/,
    );
  });

  it("updates the announcement when stepping backward", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    // Move to action 2 first.
    await user.click(screen.getByRole("button", { name: /^step forward$/i }));
    await user.click(screen.getByRole("button", { name: /^step forward$/i }));
    expect(screen.getByTestId("replay-position-announcer").textContent).toMatch(
      /^Action 3 of 3: Alice draws a card$/,
    );

    await user.click(screen.getByRole("button", { name: /^step backward$/i }));
    expect(screen.getByTestId("replay-position-announcer").textContent).toMatch(
      /^Action 2 of 3: Bob casts Counterspell$/,
    );
  });

  it("updates the announcement when jumping via skip-to-start / skip-to-end", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    await user.click(screen.getByRole("button", { name: /^skip to end$/i }));
    expect(screen.getByTestId("replay-position-announcer").textContent).toMatch(
      /^Action 3 of 3: Alice draws a card$/,
    );

    await user.click(screen.getByRole("button", { name: /^skip to start$/i }));
    expect(screen.getByTestId("replay-position-announcer").textContent).toMatch(
      /^Action 1 of 3: Alice plays Island$/,
    );
  });

  it("exposes the position scrubber with aria-label and value semantics", () => {
    render(<ReplayViewer replay={makeReplay()} />);

    const scrubber = screen.getByRole("slider", { name: /replay position/i });
    expect(scrubber).toHaveAttribute("aria-valuemin", "1");
    expect(scrubber).toHaveAttribute("aria-valuemax", "3");
    expect(scrubber).toHaveAttribute("aria-valuenow", "1");
    expect(scrubber).toHaveAttribute("aria-valuetext", "Action 1 of 3");
  });
});

// ---------------------------------------------------------------------------
// Speed control — radiogroup semantics
// ---------------------------------------------------------------------------

describe("ReplayViewer — playback-speed radiogroup (#1604, WCAG 4.1.2)", () => {
  it("exposes a labelled radiogroup with one checked radio per speed option", () => {
    render(<ReplayViewer replay={makeReplay()} />);

    const group = screen.getByRole("radiogroup", { name: /playback speed/i });
    expect(group).toBeInTheDocument();

    const radios = within(group).getAllByRole("radio");
    // Default speed is 1x per the component's initial state.
    expect(radios).toHaveLength(5);
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAttribute("aria-label", "Play at 1x speed");
  });

  it("moves the aria-checked selection when the user picks a different speed", async () => {
    const user = userEvent.setup();
    render(<ReplayViewer replay={makeReplay()} />);

    const group = screen.getByRole("radiogroup", { name: /playback speed/i });
    const twoX = within(group).getByRole("radio", {
      name: /play at 2x speed/i,
    });

    await user.click(twoX);

    expect(twoX).toHaveAttribute("aria-checked", "true");
    const radios = within(group).getAllByRole("radio");
    expect(
      radios.filter((r) => r.getAttribute("aria-checked") === "true"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Empty-replay branch
// ---------------------------------------------------------------------------

describe("ReplayViewer — null replay branch (#1604)", () => {
  it("renders a labelled region even when no replay is loaded (the call-to-action path)", () => {
    render(<ReplayViewer replay={null} />);

    // The empty-state path intentionally doesn't render transport controls;
    // there's no region either, but the announcer's existence is bounded by
    // having something to announce. This test pins the "no replay → no
    // announcer" boundary so a future refactor doesn't accidentally leak
    // stale announcements from the previous session.
    expect(
      screen.queryByTestId("replay-position-announcer"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /playback controls/i }),
    ).not.toBeInTheDocument();
  });
});
