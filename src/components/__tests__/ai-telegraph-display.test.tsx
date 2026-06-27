/**
 * @fileoverview Tests for the AI telegraph display surface (#993).
 *
 * Verifies the UI acceptance: the surface is non-intrusive (renders nothing
 * when empty), dismissible per-entry and clear-all, and accessible
 * (role=status + aria-live=polite for screen readers).
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AiTelegraphDisplay,
  type TelegraphEntry,
} from "../ai/ai-telegraph-display";

const sampleEntries: TelegraphEntry[] = [
  { id: "1", text: "AI attacks with Goblin Guide.", turn: 3 },
  { id: "2", text: "AI keeps Wall of Omens in reserve as a blocker.", turn: 3 },
];

describe("AiTelegraphDisplay", () => {
  it("renders nothing when there are no entries (non-intrusive)", () => {
    const { container } = render(<AiTelegraphDisplay entries={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("ai-telegraph-display")).toBeNull();
  });

  it("renders each coach entry", () => {
    render(<AiTelegraphDisplay entries={sampleEntries} />);
    expect(screen.getByTestId("ai-telegraph-display")).toBeInTheDocument();
    const items = screen.getAllByTestId("ai-telegraph-entry");
    expect(items).toHaveLength(2);
    expect(
      screen.getByText("AI attacks with Goblin Guide."),
    ).toBeInTheDocument();
  });

  it("is an accessible live region for screen readers", () => {
    render(<AiTelegraphDisplay entries={sampleEntries} />);
    const region = screen.getByTestId("ai-telegraph-display");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-label", "AI coach tips");
  });

  it("dismisses a single entry via its accessible dismiss button", () => {
    const onDismiss = jest.fn();
    render(
      <AiTelegraphDisplay entries={sampleEntries} onDismiss={onDismiss} />,
    );
    const dismissButtons = screen.getAllByLabelText(/Dismiss tip:/);
    expect(dismissButtons).toHaveLength(2);
    fireEvent.click(dismissButtons[0]);
    expect(onDismiss).toHaveBeenCalledWith("1");
  });

  it("clears all entries via the Clear all control", () => {
    const onClear = jest.fn();
    render(<AiTelegraphDisplay entries={sampleEntries} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss all/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("omits dismiss/clear controls when no handlers are provided", () => {
    render(<AiTelegraphDisplay entries={sampleEntries} />);
    expect(screen.queryAllByLabelText(/Dismiss tip:/)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /dismiss all/i })).toBeNull();
  });
});
