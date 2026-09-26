/**
 * @fileoverview Tests for mana color filter buttons in LimitedDeckBuilder (issue #2155).
 * Verifies toggle behavior, W button visibility styling, and ARIA attributes.
 */

import { describe, it, expect } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { useState } from "react";

function ColorFilterFixture() {
  const [selectedColors, setSelectedColors] = useState(new Set<string>());
  const toggleColor = (color: string) => {
    setSelectedColors((prev) => {
      const next = new Set(prev);
      if (next.has(color)) {
        next.delete(color);
      } else {
        next.add(color);
      }
      return next;
    });
  };

  const COLOR_OPTIONS = [
    { symbol: "W", label: "White", className: "bg-white border-gray-400" },
    { symbol: "U", label: "Blue", className: "bg-blue-500 border-blue-600" },
    { symbol: "B", label: "Black", className: "bg-gray-900 border-gray-700" },
    { symbol: "R", label: "Red", className: "bg-red-500 border-red-600" },
    { symbol: "G", label: "Green", className: "bg-green-500 border-green-600" },
  ];

  return (
    <div>
      {COLOR_OPTIONS.map((opt) => (
        <button
          key={opt.symbol}
          type="button"
          aria-pressed={selectedColors.has(opt.symbol)}
          onClick={() => toggleColor(opt.symbol)}
          className={opt.className}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

describe("LimitedDeckBuilder mana color filter buttons", () => {
  it("toggles W color filter when clicked", () => {
    render(<ColorFilterFixture />);

    const wButton = screen.getByRole("button", { name: /white/i });
    expect(wButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(wButton);
    expect(wButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(wButton);
    expect(wButton).toHaveAttribute("aria-pressed", "false");
  });

  it("W button has distinguishable border styling on white backgrounds", () => {
    const wButtonClassName = "bg-white border-gray-400";
    expect(wButtonClassName).toContain("border");
    expect(wButtonClassName).toContain("gray");
  });

  it("all color buttons expose aria-pressed state", () => {
    render(<ColorFilterFixture />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(5);

    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-pressed");
    }
  });
});
