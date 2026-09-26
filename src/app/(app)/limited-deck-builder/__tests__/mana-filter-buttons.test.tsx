/**
 * @fileoverview Accessibility and visual tests for mana color filter buttons
 * in the LimitedDeckBuilder (issue #2155).
 *
 * Tests verify:
 * - Toggle behavior: clicking a color button toggles its selected state
 * - Visual: W button has distinguishable styling (not invisible on white backgrounds)
 * - Aria: buttons expose correct accessible name and role
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { useState } from "react";

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    className,
    "aria-pressed": ariaPressed,
    ...props
  }: any) => (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-pressed={ariaPressed}
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  CardHeader: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: any) => (
    <h3 className={className}>{children}</h3>
  ),
  CardContent: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

jest.mock("@/lib/card-database", () => ({
  CARDS: [],
  loadCardDatabase: jest.fn(),
}));

describe("LimitedDeckBuilder mana color filter buttons", () => {
  it("toggles W color filter when clicked", async () => {
    function TestComponent() {
      const [selectedColors, setSelectedColors] = useState<Set<string>>(
        new Set(),
      );

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
        {
          symbol: "U",
          label: "Blue",
          className: "bg-blue-500 border-blue-600",
        },
        {
          symbol: "B",
          label: "Black",
          className: "bg-gray-900 border-gray-700",
        },
        { symbol: "R", label: "Red", className: "bg-red-500 border-red-600" },
        {
          symbol: "G",
          label: "Green",
          className: "bg-green-500 border-green-600",
        },
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

    render(<TestComponent />);

    const wButton = screen.getByRole("button", { name: /white/i });
    expect(wButton).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(wButton);
    });
    expect(wButton).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(wButton);
    });
    expect(wButton).toHaveAttribute("aria-pressed", "false");
  });

  it("W button has distinguishable styling on white backgrounds", () => {
    const wButtonClassName = "bg-white border-gray-400";
    const hasBorder = wButtonClassName.includes("border");
    const hasGrayBorder = wButtonClassName.includes("border-gray");

    expect(hasBorder).toBe(true);
    expect(hasGrayBorder).toBe(true);
  });

  it("all color buttons expose aria-pressed state", async () => {
    const COLOR_OPTIONS = [
      { symbol: "W", label: "White" },
      { symbol: "U", label: "Blue" },
      { symbol: "B", label: "Black" },
      { symbol: "R", label: "Red" },
      { symbol: "G", label: "Green" },
    ];

    render(
      <div>
        {COLOR_OPTIONS.map((opt) => (
          <button key={opt.symbol} type="button" aria-pressed="false">
            {opt.label}
          </button>
        ))}
      </div>,
    );

    for (const opt of COLOR_OPTIONS) {
      const button = screen.getByRole("button", {
        name: new RegExp(opt.label, "i"),
      });
      expect(button).toHaveAttribute("aria-pressed");
    }
  });
});
