/**
 * Face-Down / Draft Card keyboard-accessibility tests
 *
 * Issue #1272 — keyboard-accessible alternatives to pointer-only interactions
 * (https://github.com/anchapin/planar-nexus/issues/1272)
 *
 * Covers:
 *  - FaceDownCard + DraftCard advertise keyboard shortcuts (aria-keyshortcuts)
 *  - Native <button> activation: click, Enter, and Space all fire onClick
 *  - DraftCard fires onHover / onHoverEnd on focus / blur parity with mouse
 *  - axe-core accessibility scan reports no violations
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axe = require("axe-core");
import { FaceDownCard, DraftCard } from "../face-down-card";
import type { DraftCard as DraftCardType } from "@/lib/limited/types";

// jsdom polyfills required by Radix primitives used internally by some
// parent components (not by FaceDownCard/DraftCard themselves, but we keep
// the polyfill here in case consumers wrap the component).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

function buildDraftCard(overrides: Partial<DraftCardType> = {}): DraftCardType {
  return {
    id: "card-1",
    name: "Lightning Bolt",
    type_line: "Instant",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    legalities: { standard: "not_legal" },
    packId: 0,
    packSlot: 0,
    addedAt: new Date().toISOString(),
    image_uris: {
      small: "https://example.com/small.jpg",
      normal: "https://example.com/normal.jpg",
      large: "https://example.com/large.jpg",
      png: "https://example.com/png.png",
      art_crop: "https://example.com/art.jpg",
      border_crop: "https://example.com/border.jpg",
    },
    ...overrides,
  } as DraftCardType;
}

async function runAxe(container: Element): Promise<void> {
  // axe-core needs the DOM to be ready and a window context.
  const results = await axe.run(container, {
    // Limit to rules that we can plausibly address in a component test
    // (no network-driven rules, no color-contrast since jsdom can't measure it).
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

describe("FaceDownCard — keyboard activation (#1272)", () => {
  it("renders as a native button with a descriptive aria-label", () => {
    render(<FaceDownCard onClick={jest.fn()} />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("advertises its keyboard shortcut via aria-keyshortcuts", () => {
    render(<FaceDownCard onClick={jest.fn()} />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    expect(btn.getAttribute("aria-keyshortcuts")).toMatch(/Enter/);
    expect(btn.getAttribute("aria-keyshortcuts")).toMatch(/Space/);
  });

  it("links to an explanatory tooltip via aria-describedby", () => {
    render(<FaceDownCard onClick={jest.fn()} />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    const describedById = btn.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const hint = describedById ? document.getElementById(describedById) : null;
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toMatch(/activate to open/i);
  });

  it("fires onClick when activated by mouse", async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<FaceDownCard onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: /face-down card/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick when activated by Enter", async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<FaceDownCard onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick when activated by Space", async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<FaceDownCard onClick={onClick} />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    btn.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is focusable (tabIndex default) and disabled blocks activation", async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<FaceDownCard onClick={onClick} isDisabled />);
    const btn = screen.getByRole("button", { name: /face-down card/i });
    expect(btn).toBeDisabled();
    btn.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("axe-core: no violations", async () => {
    const { container } = render(<FaceDownCard onClick={jest.fn()} />);
    await runAxe(container);
  });
});

describe("DraftCard — keyboard activation + hover/focus parity (#1272)", () => {
  it("renders as a button with a card-name aria-label", () => {
    const card = buildDraftCard({ name: "Counterspell" });
    render(
      <DraftCard
        card={card}
        onClick={jest.fn()}
        onHover={jest.fn()}
        onHoverEnd={jest.fn()}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Counterspell/i });
    expect(btn).toBeInTheDocument();
  });

  it("advertises its keyboard shortcut via aria-keyshortcuts", () => {
    const card = buildDraftCard();
    render(
      <DraftCard
        card={card}
        onClick={jest.fn()}
        onHover={jest.fn()}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });
    expect(btn.getAttribute("aria-keyshortcuts")).toMatch(/Enter/);
    expect(btn.getAttribute("aria-keyshortcuts")).toMatch(/Space/);
  });

  it("fires onClick on Enter", async () => {
    const onClick = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard
        card={card}
        onClick={onClick}
        onHover={jest.fn()}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });
    btn.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick on Space", async () => {
    const onClick = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard
        card={card}
        onClick={onClick}
        onHover={jest.fn()}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });
    btn.focus();
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick on mouse click", async () => {
    const onClick = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard
        card={card}
        onClick={onClick}
        onHover={jest.fn()}
        isPicked={false}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /pick Lightning Bolt/i }),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mirrors onHover onto onFocus and onHoverEnd onto onBlur (DRFT-08 parity)", async () => {
    // This is the key behavioral fix: the auto-pick state machine that tracks
    // hover must also fire when the card receives keyboard focus, otherwise
    // keyboard users cannot trigger the auto-pick signal at all.
    const onHover = jest.fn();
    const onHoverEnd = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard
        card={card}
        onClick={jest.fn()}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });

    // Move focus to the card via tab
    btn.focus();
    expect(onHover).toHaveBeenCalled();
    expect(onHoverEnd).not.toHaveBeenCalled();

    // Move focus away via tab — onHoverEnd should fire
    await user.tab();
    expect(onHoverEnd).toHaveBeenCalled();
  });

  it("fires onHover on mouseEnter and onHoverEnd on mouseLeave", async () => {
    const onHover = jest.fn();
    const onHoverEnd = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard
        card={card}
        onClick={jest.fn()}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        isPicked={false}
      />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });
    await user.hover(btn);
    expect(onHover).toHaveBeenCalled();
    await user.unhover(btn);
    expect(onHoverEnd).toHaveBeenCalled();
  });

  it("is disabled once picked and refuses activation", async () => {
    const onClick = jest.fn();
    const card = buildDraftCard();
    const user = userEvent.setup();
    render(
      <DraftCard card={card} onClick={onClick} onHover={jest.fn()} isPicked />,
    );
    const btn = screen.getByRole("button", { name: /pick Lightning Bolt/i });
    expect(btn).toBeDisabled();
    btn.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("axe-core: no violations on the unpicked state", async () => {
    const card = buildDraftCard();
    const { container } = render(
      <DraftCard
        card={card}
        onClick={jest.fn()}
        onHover={jest.fn()}
        isPicked={false}
      />,
    );
    await runAxe(container);
  });
});
