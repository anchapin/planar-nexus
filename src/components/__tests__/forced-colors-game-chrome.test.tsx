/**
 * Forced-colors / Windows High Contrast Mode affordances (#1269).
 *
 * Verifies that the chrome indicators expose the markup needed for the global
 * `@media (forced-colors: active)` block in `src/app/globals.css` to render
 * distinguishable state. The CSS layer is the system of record for colors;
 * JS tests can only assert:
 *   - persistent `border` so the HCM override can promote it to Highlight
 *   - `data-state` / `data-*-state` so the override can target a single state
 *   - `data-hcm-affordance` markers where the indicator is informational
 *   - accessible roles + names survive the change (no regression to #1101)
 *
 * Tests use read-only `className`/attribute inspection — no live `getComputedStyle`
 * — because jsdom does not honor CSS media queries.
 */

import { render, screen, act } from "@testing-library/react";

import { AiPickingIndicator, AiPickingBadge } from "../ai-picking-indicator";
import { TurnTimer, CompactTimer } from "../turn-timer";
import {
  ConnectionStatusIndicator,
  ConnectionQualityBar,
  ReconnectingOverlay,
} from "../connection-status-indicator";
import type { ConnectionHealth } from "@/hooks/use-connection-health";

describe("AiPickingIndicator — forced-colors affordances (#1269)", () => {
  it("renders a stable data-state attribute in both states", () => {
    const { rerender } = render(<AiPickingIndicator isPicking={false} />);
    expect(screen.getByTestId("ai-picking-indicator")).toHaveAttribute(
      "data-state",
      "idle",
    );

    rerender(<AiPickingIndicator isPicking />);
    expect(screen.getByTestId("ai-picking-indicator")).toHaveAttribute(
      "data-state",
      "picking",
    );
  });

  it("always renders a `border` so the HCM override can promote it to Highlight", () => {
    const { rerender } = render(<AiPickingIndicator isPicking={false} />);
    expect(screen.getByTestId("ai-picking-indicator").className).toMatch(
      /\bborder\b/,
    );

    rerender(<AiPickingIndicator isPicking />);
    expect(screen.getByTestId("ai-picking-indicator").className).toMatch(
      /\bborder\b/,
    );
  });

  it("marks aria-live when actively picking so SRs announce state changes", () => {
    render(<AiPickingIndicator isPicking />);
    expect(screen.getByTestId("ai-picking-indicator")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });
});

describe("AiPickingBadge — forced-colors affordances (#1269)", () => {
  it("renders data-state attribute and a border in both states", () => {
    const { rerender } = render(<AiPickingBadge isPicking={false} />);
    const badge = screen.getByTestId("ai-picking-badge");
    expect(badge).toHaveAttribute("data-state", "idle");
    expect(badge.className).toMatch(/\bborder\b/);

    rerender(<AiPickingBadge isPicking />);
    expect(screen.getByTestId("ai-picking-badge")).toHaveAttribute(
      "data-state",
      "picking",
    );
  });
});

describe("TurnTimer — forced-colors affordances (#1269)", () => {
  it("exposes data-timer-state and role=timer for the global CSS override", () => {
    render(<TurnTimer totalSeconds={60} autoStart isCurrentPlayer />);
    const timer = screen.getByTestId("turn-timer");
    expect(timer).toHaveAttribute("data-timer-state", "running");
    expect(timer).toHaveAttribute("role", "timer");
  });

  it("carries data-timer-state='warning' once timeRemaining drops below threshold", () => {
    jest.useFakeTimers();
    try {
      const { rerender } = render(
        <TurnTimer totalSeconds={35} autoStart isCurrentPlayer />,
      );
      act(() => {
        jest.advanceTimersByTime(10_000);
      });
      rerender(<TurnTimer totalSeconds={25} autoStart isCurrentPlayer />);
      expect(screen.getByTestId("turn-timer")).toHaveAttribute(
        "data-timer-state",
        "warning",
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("CompactTimer — forced-colors affordances (#1269)", () => {
  it("exposes data-timer-state for color overrides", () => {
    render(
      <CompactTimer totalSeconds={60} timeRemaining={5} timerState="warning" />,
    );
    expect(screen.getByTestId("compact-timer")).toHaveAttribute(
      "data-timer-state",
      "warning",
    );
  });
});

describe("ConnectionStatusIndicator — forced-colors affordances (#1269)", () => {
  const baseHealth: ConnectionHealth = {
    state: "connected",
    latency: 50,
    lastStateChange: new Date(0),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    isReconnecting: false,
    isHealthy: true,
    connectionQuality: "excellent",
  };

  const reconnectingHealth: ConnectionHealth = {
    ...baseHealth,
    state: "reconnecting",
    isReconnecting: true,
    isHealthy: false,
    connectionQuality: "poor",
  };

  it("renders data-connection-state/data-connection-quality for color overrides", () => {
    render(<ConnectionStatusIndicator health={baseHealth} />);
    const ind = screen.getByTestId("connection-status-indicator");
    expect(ind).toHaveAttribute("data-connection-state", "connected");
    expect(ind).toHaveAttribute("data-connection-quality", "excellent");
    expect(ind.className).toMatch(/\bborder\b/);
  });

  it("flags degraded/reconnecting states with data-hcm-affordance", () => {
    render(<ConnectionStatusIndicator health={reconnectingHealth} />);
    const ind = screen.getByTestId("connection-status-indicator");
    expect(ind).toHaveAttribute("data-hcm-affordance", "true");
  });

  it("renders an accessible name via status text (#1101 regression guard)", () => {
    render(<ConnectionStatusIndicator health={baseHealth} />);
    // Status text is rendered so screen-reader users (and HCM users relying
    // on a screen reader because color is removed) can identify the state.
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });
});

describe("ConnectionQualityBar — forced-colors affordances (#1269)", () => {
  const health: ConnectionHealth = {
    state: "connected",
    lastStateChange: new Date(0),
    reconnectAttempts: 0,
    maxReconnectAttempts: 3,
    isReconnecting: false,
    isHealthy: true,
    connectionQuality: "fair",
  };

  it("exposes a role=progressbar so the HCM progress fill rule applies", () => {
    render(<ConnectionQualityBar health={health} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
});

describe("ReconnectingOverlay — forced-colors affordances (#1269)", () => {
  const health: ConnectionHealth = {
    state: "failed",
    lastStateChange: new Date(0),
    reconnectAttempts: 3,
    maxReconnectAttempts: 3,
    isReconnecting: false,
    isHealthy: false,
    connectionQuality: "lost",
  };

  it("renders an alertdialog with an accessible title for HCM users", () => {
    render(<ReconnectingOverlay health={health} />);
    const overlay = screen.getByTestId("connection-reconnecting-overlay");
    expect(overlay).toHaveAttribute("role", "alertdialog");
    expect(
      screen.getByRole("heading", { name: /connection lost/i }),
    ).toBeInTheDocument();
    // HCM highlight rule target.
    expect(overlay.querySelector("[data-hcm-affordance]")).toBeInTheDocument();
  });
});
