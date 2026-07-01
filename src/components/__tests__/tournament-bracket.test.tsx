/**
 * TournamentBracket keyboard-accessibility tests
 *
 * Issue #1272 — keyboard-accessible alternatives to pointer-only interactions
 * (https://github.com/anchapin/planar-nexus/issues/1272)
 *
 * Covers:
 *  - MatchCard exposes a descriptive aria-label (round + matchup)
 *  - Icon-only winner-selection buttons expose accessible names
 *  - Winner-selection buttons activate on Enter (native <button>)
 *  - Bracket implements a roving tabindex across matches
 *  - Arrow keys navigate between matches; current match is announced in
 *    a polite live region
 *  - axe-core accessibility scan reports no violations
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axe = require("axe-core");
import {
  TournamentBracket,
  type Tournament,
  type TournamentMatch,
  type TournamentPlayer,
} from "../tournament-bracket";

// jsdom polyfills required by Radix primitives used by Card.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

function buildPlayer(id: string, name: string, seed: number): TournamentPlayer {
  return { id, name, seed, wins: 0, losses: 0 };
}

function buildTournament(): Tournament {
  // 4 players → 2 matches in round 1, 1 final in round 2.
  const players = [
    buildPlayer("p1", "Alex", 1),
    buildPlayer("p2", "Sam", 2),
    buildPlayer("p3", "Robin", 3),
    buildPlayer("p4", "Jordan", 4),
  ];
  const matches: TournamentMatch[] = [
    {
      id: "match-r1-m1",
      round: 1,
      player1: players[0],
      player2: players[1],
      status: "pending",
    },
    {
      id: "match-r1-m2",
      round: 1,
      player1: players[2],
      player2: players[3],
      status: "pending",
    },
    {
      id: "match-r2-m1",
      round: 2,
      status: "pending",
    },
  ];
  return {
    id: "t1",
    name: "Spring Open",
    status: "in-progress",
    players,
    rounds: [
      { roundNumber: 1, matches: [matches[0], matches[1]] },
      { roundNumber: 2, matches: [matches[2]] },
    ],
    currentRound: 1,
    createdAt: Date.now(),
  };
}

async function runAxe(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map(
        (v: { id: string; impact: string; nodes: { target: string[] }[] }) =>
          `${v.id} (${v.impact}) — ${v.nodes
            .map((n) => n.target.join(","))
            .join(" | ")}`,
      )
      .join("\n");
    throw new Error(`axe violations:\n${summary}`);
  }
}

describe("TournamentBracket — keyboard accessibility (#1272)", () => {
  it("exposes a region landmark with an accessible name", () => {
    render(<TournamentBracket tournament={buildTournament()} />);
    const region = screen.getByRole("region", { name: /spring open/i });
    expect(region).toBeInTheDocument();
  });

  it("labels every match with round and player names", () => {
    render(<TournamentBracket tournament={buildTournament()} />);
    // 4 players → 2 rounds. roundLabel() names round 1 "Semifinals"
    // (totalRounds - 1) and round 2 "Final" (totalRounds).
    expect(
      screen.getByRole("group", {
        name: /Match 1: Alex vs Sam, Semifinals/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /Match 2: Robin vs Jordan, Semifinals/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: /Match 3: TBD vs TBD, Final/i,
      }),
    ).toBeInTheDocument();
  });

  it("icon-only winner buttons expose accessible names (#1272)", () => {
    render(<TournamentBracket tournament={buildTournament()} />);
    expect(
      screen.getByRole("button", {
        name: /select Alex as the winner of match 1/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /select Sam as the winner of match 1/i,
      }),
    ).toBeInTheDocument();
  });

  it("winner buttons advertise their keyboard shortcut", () => {
    render(<TournamentBracket tournament={buildTournament()} />);
    const btn = screen.getByRole("button", {
      name: /select Alex as the winner of match 1/i,
    });
    expect(btn.getAttribute("aria-keyshortcuts")).toMatch(/Enter/);
  });

  it("Enter on a winner button fires onMatchComplete", async () => {
    const onMatchComplete = jest.fn();
    const user = userEvent.setup();
    render(
      <TournamentBracket
        tournament={buildTournament()}
        onMatchComplete={onMatchComplete}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /select Alex as the winner of match 1/i,
    });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onMatchComplete).toHaveBeenCalledWith("match-r1-m1", "p1");
  });

  it("Space on a winner button fires onMatchComplete", async () => {
    const onMatchComplete = jest.fn();
    const user = userEvent.setup();
    render(
      <TournamentBracket
        tournament={buildTournament()}
        onMatchComplete={onMatchComplete}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /select Sam as the winner of match 1/i,
    });
    btn.focus();
    await user.keyboard(" ");
    expect(onMatchComplete).toHaveBeenCalledWith("match-r1-m1", "p2");
  });

  it("mouse click on a winner button fires onMatchComplete", async () => {
    const onMatchComplete = jest.fn();
    const user = userEvent.setup();
    render(
      <TournamentBracket
        tournament={buildTournament()}
        onMatchComplete={onMatchComplete}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: /select Robin as the winner of match 2/i,
      }),
    );
    expect(onMatchComplete).toHaveBeenCalledWith("match-r1-m2", "p3");
  });

  it("implements a roving tabindex across matches (only the active match has tabIndex 0)", () => {
    render(<TournamentBracket tournament={buildTournament()} />);
    const match1 = screen.getByRole("group", {
      name: /Match 1: Alex vs Sam/i,
    });
    const match2 = screen.getByRole("group", {
      name: /Match 2: Robin vs Jordan/i,
    });
    const match3 = screen.getByRole("group", {
      name: /Match 3: TBD vs TBD, Final/i,
    });
    expect(match1).toHaveAttribute("tabindex", "0");
    expect(match2).toHaveAttribute("tabindex", "-1");
    expect(match3).toHaveAttribute("tabindex", "-1");
  });

  it("ArrowLeft moves focus to the previous match", async () => {
    const user = userEvent.setup();
    render(<TournamentBracket tournament={buildTournament()} />);
    // Focus the second match first so we have somewhere to move LEFT from.
    const match2 = screen.getByRole("group", {
      name: /Match 2: Robin vs Jordan/i,
    });
    match2.focus();
    await user.keyboard("{ArrowLeft}");
    const match1 = screen.getByRole("group", {
      name: /Match 1: Alex vs Sam/i,
    });
    expect(match1).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(match1);
  });

  it("End jumps to the last match and announces it in the live region", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TournamentBracket tournament={buildTournament()} />,
    );
    const liveRegion = container.querySelector('[role="status"]');
    expect(liveRegion).toBeTruthy();
    const initialText = liveRegion?.textContent ?? "";
    expect(initialText).toBe("");

    // Focus the first match so the bracket region receives the keydown.
    const match1 = screen.getByRole("group", {
      name: /Match 1: Alex vs Sam/i,
    });
    match1.focus();
    await user.keyboard("{End}");
    const finalMatch = screen.getByRole("group", {
      name: /Match 3: TBD vs TBD, Final/i,
    });
    expect(finalMatch).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(finalMatch);
    expect(liveRegion?.textContent).toMatch(/Match 3: TBD vs TBD, Final/);
  });

  it("Home jumps to the first match", async () => {
    const user = userEvent.setup();
    render(<TournamentBracket tournament={buildTournament()} />);
    const match1 = screen.getByRole("group", {
      name: /Match 1: Alex vs Sam/i,
    });
    match1.focus();
    await user.keyboard("{End}");
    await user.keyboard("{Home}");
    expect(match1).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(match1);
  });

  it("ArrowRight moves focus to the next match", async () => {
    const user = userEvent.setup();
    render(<TournamentBracket tournament={buildTournament()} />);
    const match1 = screen.getByRole("group", {
      name: /Match 1: Alex vs Sam/i,
    });
    match1.focus();
    await user.keyboard("{ArrowRight}");
    const match2 = screen.getByRole("group", {
      name: /Match 2: Robin vs Jordan/i,
    });
    expect(match2).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(match2);
  });

  it("clicking a match focuses it and announces the match label", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TournamentBracket tournament={buildTournament()} />,
    );
    const match3 = screen.getByRole("group", {
      name: /Match 3: TBD vs TBD, Final/i,
    });
    await user.click(match3);
    expect(match3).toHaveAttribute("tabindex", "0");
    const liveRegion = container.querySelector('[role="status"]');
    expect(liveRegion?.textContent).toMatch(/Match 3: TBD vs TBD, Final/);
  });

  it("live region exists with role=status and aria-live=polite", () => {
    const { container } = render(
      <TournamentBracket tournament={buildTournament()} />,
    );
    const liveRegion = container.querySelector('[role="status"]');
    expect(liveRegion).toBeTruthy();
    expect(liveRegion?.getAttribute("aria-live")).toBe("polite");
    expect(liveRegion?.getAttribute("aria-atomic")).toBe("true");
  });

  it("axe-core: no violations on a populated bracket", async () => {
    const { container } = render(
      <TournamentBracket
        tournament={buildTournament()}
        onMatchComplete={jest.fn()}
      />,
    );
    await runAxe(container);
  });

  it("axe-core: no violations when there is no onMatchComplete callback", async () => {
    const { container } = render(
      <TournamentBracket tournament={buildTournament()} />,
    );
    await runAxe(container);
  });

  it("Leaderboard rows have list semantics for screen-reader navigation", () => {
    // Ensure the leaderboard is not regressed by the change set.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Leaderboard } = require("../tournament-bracket");
    render(<Leaderboard players={[buildPlayer("p1", "Alex", 1)]} />);
    const list = screen.getByRole("list", { name: /standings/i });
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBe(1);
  });
});
