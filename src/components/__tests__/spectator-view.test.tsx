/**
 * @fileoverview Accessibility tests for the SpectatorView component (issue #1447).
 *
 * The spectator list is the primary multiplayer readout on `/multiplayer/*`
 * routes. These tests verify the ARIA semantics added by issue #1447 to
 * satisfy WCAG 1.3.1 (Info and Relationships), 1.4.1 (Use of Color), and
 * 4.1.2 (Name, Role, Value):
 *
 *   1. The spectator region is a `role="region"` landmark with an
 *      accessible name.
 *   2. The spectator rows render in `<ul role="list">` with `<li>` children.
 *   3. The `<ul>` exposes a programmatic name that includes the count so a
 *      screen-reader user hears "Spectators (3)" before the items.
 *   4. The current spectator row carries `aria-current="true"` and a
 *      non-color-only "You" marker (visible label + sr-only phrase + icon),
 *      so the "this is you" state is conveyed without relying on color.
 *   5. The empty-state still exposes the spectator region even when no
 *      `<ul>` renders (so screen-reader users still hear "Spectators (0)").
 */

import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

import { SpectatorView } from "@/components/spectator-view";
import type { Spectator, SpectatorPermissions } from "@/lib/spectator";

const basePermissions: SpectatorPermissions = {
  canChat: true,
  canSeeHands: false,
  canSeeTimers: true,
  isHidden: false,
};

const spectators: Spectator[] = [
  { id: "s1", name: "Alice", joinedAt: 0 },
  { id: "s2", name: "Bob", joinedAt: 1, isHidden: true },
  { id: "s3", name: "Carol", joinedAt: 2 },
];

function renderSpectatorView(
  overrides: Partial<{
    spectators: Spectator[];
    currentSpectatorId: string;
    permissions: SpectatorPermissions;
  }> = {},
) {
  return render(
    <SpectatorView
      spectators={overrides.spectators ?? spectators}
      currentSpectatorId={overrides.currentSpectatorId}
      permissions={overrides.permissions ?? basePermissions}
    />,
  );
}

describe("SpectatorView — region landmark (#1447)", () => {
  it("exposes the spectator list as a region landmark with an accessible name", () => {
    renderSpectatorView();

    const region = screen.getByRole("region", { name: /spectator list/i });
    expect(region).toBeInTheDocument();
  });

  it("includes the spectator count in the region's accessible name", () => {
    renderSpectatorView();

    const region = screen.getByRole("region", { name: /spectator list \(3\)/i });
    expect(region).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/3\)/),
    );
  });
});

describe("SpectatorView — list semantics (#1447, WCAG 1.3.1)", () => {
  it("renders the spectators in a <ul role='list'> with an accessible name", () => {
    renderSpectatorView();

    const list = screen.getByRole("list", { name: /spectators \(3\)/i });
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("role", "list");
  });

  it("renders one <li> per visible spectator", () => {
    renderSpectatorView();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(spectators.length);
    for (const item of items) {
      expect(item.tagName).toBe("LI");
    }
  });

  it("names each spectator row by its visible player name", () => {
    renderSpectatorView();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(spectators.length);
    for (const spectator of spectators) {
      // The <li> renders the player name as visible text content. We
      // assert against the rendered text directly because jsdom computes
      // accessible names for non-interactive descendants differently than
      // a real browser.
      const match = items.some((el) =>
        (el.textContent ?? "").includes(spectator.name),
      );
      expect(match).toBe(true);
    }
  });
});

describe("SpectatorView — 'current spectator' indicator (#1447, WCAG 1.4.1 + 4.1.2)", () => {
  it("marks the matching row with aria-current='true'", () => {
    renderSpectatorView({ currentSpectatorId: "s2" });

    const items = screen.getAllByRole("listitem");
    const current = items.find((el) =>
      (el.textContent ?? "").includes("Bob"),
    );
    expect(current).toBeDefined();
    expect(current).toHaveAttribute("aria-current", "true");
  });

  it("does not mark non-matching rows as current", () => {
    renderSpectatorView({ currentSpectatorId: "s2" });

    const items = screen.getAllByRole("listitem");
    const other = items.find((el) =>
      (el.textContent ?? "").includes("Alice"),
    );
    expect(other).toBeDefined();
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("exposes the visible 'You' marker and an sr-only 'Current spectator' phrase", () => {
    renderSpectatorView({ currentSpectatorId: "s3" });

    const items = screen.getAllByRole("listitem");
    const current = items.find((el) =>
      (el.textContent ?? "").includes("Carol"),
    );
    // Visible "You" marker — sighted users see this.
    expect(current).toHaveTextContent(/You/);
    // The same row also contains the sr-only phrase that screen-reader
    // users hear before the player name.
    expect(current).toHaveTextContent(/current spectator/i);
  });

  it("pairs the background tint with a border and outline so the state is not color-only", () => {
    renderSpectatorView({ currentSpectatorId: "s1" });

    const items = screen.getAllByRole("listitem");
    const current = items.find((el) =>
      (el.textContent ?? "").includes("Alice"),
    );
    // The CSS classes must include a paired visual cue (border + ring) so
    // WCAG 1.4.1 is satisfied.
    expect(current?.className).toMatch(/\bborder\b/);
    expect(current?.className).toMatch(/\bring\b/);
    // And a data-current hook for global forced-colors / non-color styling.
    expect(current).toHaveAttribute("data-current", "true");
  });

  it("leaves data-current unset on rows that are not the current spectator", () => {
    renderSpectatorView({ currentSpectatorId: "s1" });

    const items = screen.getAllByRole("listitem");
    const other = items.find((el) =>
      (el.textContent ?? "").includes("Bob"),
    );
    expect(other).not.toHaveAttribute("data-current");
  });
});

describe("SpectatorView — empty state (#1447)", () => {
  it("still announces the region landmark when no spectators are connected", () => {
    renderSpectatorView({ spectators: [] });

    const region = screen.getByRole("region", { name: /spectator list \(0\)/i });
    expect(region).toBeInTheDocument();
    // No list is rendered in the empty state — the empty placeholder takes
    // its place. This guards against a regression where we'd accidentally
    // render `<ul></ul>` and confuse SR users with a vacuous list.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/no spectators yet/i)).toBeInTheDocument();
  });

  it("filters out hidden spectators when the viewer has isHidden permission", () => {
    // With isHidden=true the viewer sees only spectators who haven't hidden,
    // plus themselves. From `spectators`, Bob is hidden and Carol/Alice
    // are not, so the visible list is 2.
    renderSpectatorView({
      permissions: { ...basePermissions, isHidden: true },
      currentSpectatorId: "s1",
    });

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items.some((el) => (el.textContent ?? "").includes("Bob"))).toBe(
      false,
    );
  });
});
