import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { GameFooter } from "../GameFooter";

/**
 * Counts how often the `Badge` leaf below the memoized footer is rendered.
 * A memoized parent that bails out does not re-render its children, so the
 * counter stays flat when the footer props are unchanged — that is the
 * render-isolation assertion of issue #2418 (slice 2).
 */
const mockBadgeRenderCount = { current: 0 };

jest.mock("@/components/ui/badge", () => {
  const actual = jest.requireActual<typeof import("@/components/ui/badge")>(
    "@/components/ui/badge",
  );
  const reactActual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    Badge: (props: React.ComponentProps<typeof actual.Badge>) => {
      mockBadgeRenderCount.current += 1;
      return reactActual.createElement(actual.Badge, props);
    },
  };
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    playerName: "Alex",
    playerLifeTotal: 18,
    opponentName: "AI (Medium)",
    opponentLifeTotal: 15,
    manaPool: undefined,
    currentPhase: "main_phase",
    turnNumber: 4,
    status: "in_progress",
    mode: "ai" as const,
    isPlayerTurn: true,
    isGameEnded: false,
    autoSaveEnabled: true,
    isMobile: false,
    onPassPriority: jest.fn(),
    onEndTurn: jest.fn(),
    onAdvancePhase: jest.fn(),
    onConcede: jest.fn(),
    onToggleAutoSave: jest.fn(),
    ...overrides,
  };
}

describe("GameFooter", () => {
  it("renders the life totals of both players", () => {
    render(<GameFooter {...makeProps()} />);
    expect(screen.getByText(/Alex:/)).toBeDefined();
    expect(screen.getByText(/18/)).toBeDefined();
    expect(screen.getByText(/AI \(Medium\):/)).toBeDefined();
    expect(screen.getByText(/15/)).toBeDefined();
  });

  it("omits the opponent block when there is no opponent", () => {
    render(
      <GameFooter
        {...makeProps({
          opponentName: undefined,
          opponentLifeTotal: undefined,
        })}
      />,
    );
    expect(screen.getByText(/Alex:/)).toBeDefined();
    expect(screen.queryByText(/AI \(Medium\):/)).toBeNull();
  });

  it("renders the phase badge and the action buttons", () => {
    render(<GameFooter {...makeProps()} />);
    expect(screen.getByText("main phase")).toBeDefined();
    expect(screen.getByText("Next Phase")).toBeDefined();
    expect(screen.getByText("End Turn")).toBeDefined();
    expect(screen.getByText("Concede")).toBeDefined();
  });

  it("shows the self-play controls and label in self-play mode", () => {
    render(<GameFooter {...makeProps({ mode: "self-play" })} />);
    expect(screen.getByText("Pass Priority")).toBeDefined();
    expect(screen.getByText("Advance Phase")).toBeDefined();
  });

  it("renders the mana pool badges when the player has mana", () => {
    render(
      <GameFooter
        {...makeProps({
          manaPool: {
            white: 2,
            blue: 1,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
            generic: 3,
          },
        })}
      />,
    );
    expect(screen.getByText("2W")).toBeDefined();
    expect(screen.getByText("1U")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("does not render mana badges for an empty pool", () => {
    render(
      <GameFooter
        {...makeProps({
          manaPool: {
            white: 0,
            blue: 0,
            black: 0,
            red: 0,
            green: 0,
            colorless: 0,
            generic: 0,
          },
        })}
      />,
    );
    expect(screen.queryByText("0W")).toBeNull();
  });

  it("shows the game status label and hides it on mobile", () => {
    const { unmount } = render(<GameFooter {...makeProps()} />);
    expect(screen.getByText("Game in Progress")).toBeDefined();
    unmount();

    render(<GameFooter {...makeProps({ isMobile: true })} />);
    expect(screen.queryByText("Game in Progress")).toBeNull();
  });

  it("shows the ended label once the game is completed", () => {
    render(
      <GameFooter {...makeProps({ status: "completed", isGameEnded: true })} />,
    );
    expect(screen.getByText("Game Ended")).toBeDefined();
    expect((screen.getByText("End Turn") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("invokes the action callbacks", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<GameFooter {...props} />);

    await user.click(screen.getByText("Next Phase"));
    await user.click(screen.getByText("End Turn"));
    await user.click(screen.getByText("Concede"));

    expect(props.onPassPriority).toHaveBeenCalled();
    expect(props.onEndTurn).toHaveBeenCalled();
    expect(props.onConcede).toHaveBeenCalled();
  });

  it("does not re-render when the props are unchanged (render isolation)", () => {
    const props = makeProps();
    const { rerender } = render(<GameFooter {...props} />);
    const rendersAfterMount = mockBadgeRenderCount.current;
    expect(rendersAfterMount).toBeGreaterThan(0);

    // Same prop values (and same callback identities) -> memo bailout.
    rerender(<GameFooter {...props} />);
    expect(mockBadgeRenderCount.current).toBe(rendersAfterMount);

    // A changed prop re-renders the footer (and its children).
    rerender(<GameFooter {...props} turnNumber={props.turnNumber + 1} />);
    expect(mockBadgeRenderCount.current).toBeGreaterThan(rendersAfterMount);
  });
});
