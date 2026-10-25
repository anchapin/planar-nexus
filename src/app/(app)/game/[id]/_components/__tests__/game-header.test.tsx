import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "@jest/globals";
import { GameHeader } from "../GameHeader";

describe("GameHeader", () => {
  it("renders the phase bar contents", () => {
    render(
      <GameHeader
        gameId="abcdef123456"
        turnNumber={7}
        currentPlayerName="Alex"
        isAIThinking={false}
        mode="ai"
        difficulty="medium"
        onBack={() => {}}
      />,
    );
    expect(screen.getByText("Single Player")).toBeDefined();
    expect(screen.getByText("Game abcdef12")).toBeDefined();
    expect(screen.getByText("Turn 7")).toBeDefined();
    expect(screen.getByText("Alex")).toBeDefined();
    expect(screen.getByText("vs AI (medium)")).toBeDefined();
    expect(
      screen.getByLabelText("Back to single player menu"),
    ).toBeDefined();
  });

  it("shows the AI thinking badge and self play mode", () => {
    render(
      <GameHeader
        gameId="x"
        turnNumber={1}
        currentPlayerName="Bob"
        isAIThinking
        mode="self-play"
        difficulty="hard"
        onBack={() => {}}
      />,
    );
    expect(screen.getByText("AI Thinking...")).toBeDefined();
    expect(screen.getByText("Self Play")).toBeDefined();
  });
});
