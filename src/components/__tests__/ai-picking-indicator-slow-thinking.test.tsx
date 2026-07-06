/**
 * Long-Task-driven "thinking slowly" affordance — issue #1245.
 *
 * Verifies that `AiPickingIndicator` / `AiPickingBadge` switch to a
 * `slow` sub-state of "picking" when the consumer passes `slowThinking`,
 * matching the behavior wired up by `game-board-client.tsx` when the
 * Long-Task observer reports >3 main-thread blocks >50ms in a 1s window.
 *
 * The Long-Task observer itself is exercised separately in
 * `src/lib/perf/__tests__/long-task-observer.test.ts`; here we just
 * exercise the visual contract so the badge renders reliably with the
 * right data-* hooks for the global HCM layer in `globals.css`.
 */

import { render, screen } from "@testing-library/react";

import {
  AiPickingIndicator,
  AiPickingBadge,
} from "../ai-picking-indicator";

describe("AiPickingIndicator — slowThinking affordance (#1245)", () => {
  it("defaults to data-state='picking' and no data-slow when slowThinking is off", () => {
    render(<AiPickingIndicator isPicking />);
    const node = screen.getByTestId("ai-picking-indicator");
    expect(node).toHaveAttribute("data-state", "picking");
    expect(node).not.toHaveAttribute("data-slow");
    expect(screen.queryByTestId("ai-picking-slow-badge")).toBeNull();
  });

  it("flips to data-state='slow' + data-slow='true' and surfaces the badge when slowThinking is on", () => {
    render(<AiPickingIndicator isPicking slowThinking />);
    const node = screen.getByTestId("ai-picking-indicator");
    expect(node).toHaveAttribute("data-state", "slow");
    expect(node).toHaveAttribute("data-slow", "true");
    expect(screen.getByTestId("ai-picking-slow-badge")).toBeInTheDocument();
    // Tighter match: the visually-prominent badge label ("thinking slowly")
    // rather than the longer header text, which also contains the phrase.
    expect(screen.getByText("thinking slowly")).toBeInTheDocument();
  });

  it("does not render the slow badge when isPicking is false, even if slowThinking is true", () => {
    render(<AiPickingIndicator isPicking={false} slowThinking />);
    const node = screen.getByTestId("ai-picking-indicator");
    expect(node).toHaveAttribute("data-state", "idle");
    expect(node).not.toHaveAttribute("data-slow");
    expect(screen.queryByTestId("ai-picking-slow-badge")).toBeNull();
  });
});

describe("AiPickingBadge — slowThinking affordance (#1245)", () => {
  it("defaults to data-state='picking' and no data-slow when slowThinking is off", () => {
    render(<AiPickingBadge isPicking />);
    const node = screen.getByTestId("ai-picking-badge");
    expect(node).toHaveAttribute("data-state", "picking");
    expect(node).not.toHaveAttribute("data-slow");
    expect(screen.queryByTestId("ai-picking-slow-badge")).toBeNull();
  });

  it("flips to data-slow='true' with the hourglass badge when slowThinking is on", () => {
    render(<AiPickingBadge isPicking slowThinking />);
    const node = screen.getByTestId("ai-picking-badge");
    expect(node).toHaveAttribute("data-state", "picking");
    expect(node).toHaveAttribute("data-slow", "true");
    expect(screen.getByTestId("ai-picking-slow-badge")).toBeInTheDocument();
  });
});
