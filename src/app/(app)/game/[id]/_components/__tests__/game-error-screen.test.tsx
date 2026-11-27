import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";
import { GameErrorScreen } from "../GameErrorScreen";

/**
 * Issue #2418 (SLICE 12) — the memoized error / "game not found" leaf.
 *
 * The screen used to be inlined in the `error || !gameState` early return of
 * `GameBoardContent`. The tests below pin the behaviour of the extracted
 * leaf: it renders the error message, falls back to "Game not found" when no
 * message is given, and both navigation buttons fire the `onBack` callback.
 */

describe("GameErrorScreen", () => {
  it("renders the error message", () => {
    render(
      <GameErrorScreen message="Failed to load game." onBack={() => {}} />,
    );

    expect(screen.getByText("Failed to load game.")).toBeDefined();
    expect(screen.getByText("Back")).toBeDefined();
    expect(screen.getByText("Return to Menu")).toBeDefined();
  });

  it("falls back to 'Game not found' when the message is null", () => {
    render(<GameErrorScreen message={null} onBack={() => {}} />);

    expect(screen.getByText("Game not found")).toBeDefined();
  });

  it("falls back to 'Game not found' when no message is given", () => {
    render(<GameErrorScreen onBack={() => {}} />);

    expect(screen.getByText("Game not found")).toBeDefined();
  });

  it("fires onBack from the back button", () => {
    const onBack = jest.fn();
    render(<GameErrorScreen message="Boom" onBack={onBack} />);

    fireEvent.click(screen.getByText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onBack from the return to menu button", () => {
    const onBack = jest.fn();
    render(<GameErrorScreen message="Boom" onBack={onBack} />);

    fireEvent.click(screen.getByText("Return to Menu"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
