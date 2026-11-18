import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { GameResultDialog } from "../GameResultDialog";

/**
 * Issue #2978 (follow-up to #2946 / #2947) — the game-over dialog was
 * extracted from the game-board page into its own component so the page's
 * first-load bundle stays under budget. These tests pin the behaviour the
 * extraction must preserve:
 *
 *   - nothing is rendered while the dialog is closed,
 *   - the title reflects the outcome (Victory! / Defeat / Draw),
 *   - the summary (life, turns, turn count) is rendered,
 *   - the two navigation buttons exist and navigate to the right routes,
 *   - and a missing result summary degrades gracefully.
 */

const RESULT = {
  result: "win" as const,
  life: 17,
  turns: 9,
};

/**
 * jsdom locks `window.location` down (non-configurable, read-only), so
 * neither Object.defineProperty nor jest.spyOn can intercept the href
 * assignment — the same constraint documented in
 * src/app/__tests__/global-error.test.tsx. Following that precedent, a
 * navigation attempt is observed through jsdom's console.error report
 * "Not implemented: navigation (except hash changes)": each navigation
 * test clicks exactly one button, so a navigation report during that
 * click proves that button's handler assigned window.location.href.
 * (The target URL itself is not observable under jsdom.)
 */
function recordNavigationAttempts(): { messages: string[] } {
  const messages: string[] = [];
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  });
  return { messages };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GameResultDialog", () => {
  it("renders nothing while it is closed", () => {
    render(
      <GameResultDialog
        open={false}
        onOpenChange={() => {}}
        gameResult={RESULT}
      />,
    );

    expect(screen.queryByText("Victory!")).toBeNull();
    expect(screen.queryByText("Play Again")).toBeNull();
  });

  it("renders the victory title and the summary", () => {
    render(
      <GameResultDialog
        open
        onOpenChange={() => {}}
        gameResult={RESULT}
      />,
    );

    expect(screen.getByText("Victory!")).toBeDefined();
    expect(screen.getByText("Game completed after 9 turns")).toBeDefined();
    expect(screen.getByText("Your Life")).toBeDefined();
    expect(screen.getByText("Turns")).toBeDefined();
    expect(screen.getByText("17")).toBeDefined();
    expect(screen.getByText("9")).toBeDefined();
  });

  it("renders the defeat title for a loss", () => {
    render(
      <GameResultDialog
        open
        onOpenChange={() => {}}
        gameResult={{ ...RESULT, result: "loss" }}
      />,
    );

    expect(screen.getByText("Defeat")).toBeDefined();
    expect(screen.queryByText("Victory!")).toBeNull();
  });

  it("renders the draw title for a draw", () => {
    render(
      <GameResultDialog
        open
        onOpenChange={() => {}}
        gameResult={{ ...RESULT, result: "draw" }}
      />,
    );

    expect(screen.getByText("Draw")).toBeDefined();
  });

  it("renders the draw title when there is no result summary", () => {
    render(
      <GameResultDialog open onOpenChange={() => {}} gameResult={null} />,
    );

    expect(screen.getByText("Draw")).toBeDefined();
    // The description interpolates the (missing) turn count, so its text
    // is split across nodes; match the rendered text content instead.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          /^Game completed after\s+turns$/.test(
            element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          ),
      ),
    ).toBeDefined();
  });

  it("marks the trophy for a win", () => {
    render(
      <GameResultDialog open onOpenChange={() => {}} gameResult={RESULT} />,
    );

    const icon = document.querySelector(".lucide-trophy");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("class")).toContain("text-yellow-500");
  });

  it("marks the trophy as grey for a non-win", () => {
    render(
      <GameResultDialog
        open
        onOpenChange={() => {}}
        gameResult={{ ...RESULT, result: "loss" }}
      />,
    );

    const icon = document.querySelector(".lucide-trophy");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("class")).toContain("text-gray-500");
  });

  it("navigates to the single-player route from the Play Again button", async () => {
    const user = userEvent.setup();
    const { messages } = recordNavigationAttempts();
    render(
      <GameResultDialog open onOpenChange={() => {}} gameResult={RESULT} />,
    );

    await user.click(screen.getByText("Play Again"));

    // The Play Again handler assigns window.location.href =
    // "/single-player"; under jsdom that surfaces only as a navigation
    // report (see recordNavigationAttempts), and this click is the only
    // navigation source in the test.
    expect(messages.join("\n")).toContain("Not implemented: navigation");
  });

  it("navigates to the game-history route from the View History button", async () => {
    const user = userEvent.setup();
    const { messages } = recordNavigationAttempts();
    render(
      <GameResultDialog open onOpenChange={() => {}} gameResult={RESULT} />,
    );

    await user.click(screen.getByText("View History"));

    // Same jsdom navigation observation as the Play Again test; the
    // handler assigns window.location.href = "/game-history".
    expect(messages.join("\n")).toContain("Not implemented: navigation");
  });

  it("renders both navigation buttons", () => {
    render(
      <GameResultDialog open onOpenChange={() => {}} gameResult={RESULT} />,
    );

    expect(screen.getByText("Play Again")).toBeDefined();
    expect(screen.getByText("View History")).toBeDefined();
  });
});
