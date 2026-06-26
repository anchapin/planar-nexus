import React from "react";
import { render, screen } from "@testing-library/react";
import { SpectatorView } from "../spectator-view";
import {
  LifeAdjustment,
  CounterAdjustment,
  type JudgePlayerState,
} from "../judge-tools";
import type { Spectator, SpectatorPermissions } from "@/lib/spectator";

// jsdom polyfills required by Radix primitives used by Card (ResizeObserver).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

const basePlayer: JudgePlayerState = {
  id: "p1",
  name: "Alice",
  life: 20,
  poisonCounters: 0,
  energyCounters: 2,
  isActive: true,
};

const fullPermissions: SpectatorPermissions = {
  canChat: true,
  canSeeHands: true,
  canSeeTimers: true,
  isHidden: false,
};

const spectators: Spectator[] = [{ id: "s1", name: "Bob", joinedAt: 0 }];

describe("SpectatorView — icon-only buttons expose accessible names (#1101)", () => {
  it("announces the chat, visibility, and settings buttons by name", () => {
    render(
      <SpectatorView
        spectators={spectators}
        permissions={fullPermissions}
        onOpenChat={jest.fn()}
        onToggleVisibility={jest.fn()}
        onOpenSettings={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open chat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide spectators" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Spectator settings" }),
    ).toBeInTheDocument();
  });

  it("flips the visibility button label when spectators are hidden", () => {
    render(
      <SpectatorView
        spectators={spectators}
        permissions={{ ...fullPermissions, isHidden: true }}
        onToggleVisibility={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Show spectators" }),
    ).toBeInTheDocument();
  });
});

describe("LifeAdjustment / CounterAdjustment — icon-only buttons expose accessible names (#1101)", () => {
  it("announces life increase/decrease buttons by name", () => {
    render(<LifeAdjustment player={basePlayer} onAdjust={jest.fn()} />);
    expect(
      screen.getByRole("button", { name: "Decrease life" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase life" }),
    ).toBeInTheDocument();
  });

  it("announces counter increase/decrease buttons by name", () => {
    const { rerender } = render(
      <CounterAdjustment
        player={basePlayer}
        counterType="poison"
        onAdjust={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Decrease poison counter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase poison counter" }),
    ).toBeInTheDocument();

    rerender(
      <CounterAdjustment
        player={basePlayer}
        counterType="energy"
        onAdjust={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Increase energy counter" }),
    ).toBeInTheDocument();
  });
});
