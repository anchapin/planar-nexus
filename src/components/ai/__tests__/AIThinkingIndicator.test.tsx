import React from "react";
import { render, screen } from "@testing-library/react";
import { AIThinkingIndicator } from "../AIThinkingIndicator";

describe("AIThinkingIndicator", () => {
  it("renders correctly with default props", () => {
    render(<AIThinkingIndicator />);
    expect(screen.getByTestId("ai-thinking-indicator")).toBeDefined();
    expect(screen.getByText("AI Thinking...")).toBeDefined();
  });

  it("renders with custom label", () => {
    render(<AIThinkingIndicator label="Processing..." />);
    expect(screen.getByText("Processing...")).toBeDefined();
  });

  it("renders without label when label is empty", () => {
    render(<AIThinkingIndicator label="" />);
    const indicator = screen.getByTestId("ai-thinking-indicator");
    expect(indicator.textContent).toBe("");
  });

  it("applies custom className", () => {
    const { container } = render(
      <AIThinkingIndicator className="custom-class" />,
    );
    // @ts-expect-error className access on React element
    expect(container.firstChild?.className).toContain("custom-class");
  });
});
