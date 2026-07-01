import React from "react";
import { render, screen, act } from "@testing-library/react";
import { RouteAnnouncer, __testing } from "../route-announcer";

// ---------------------------------------------------------------------------
// Test rig: a controlled wrapper that swaps the pathname value returned by
// `next/navigation#usePathname`. This lets us deterministically simulate a
// client-side navigation without needing a real Next.js app router.
// ---------------------------------------------------------------------------

interface RouterStubProps {
  pathname: string;
}

let currentPathname = "/";

jest.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

function RouterStub({ pathname }: RouterStubProps) {
  currentPathname = pathname;
  return <RouteAnnouncer />;
}

beforeEach(() => {
  jest.useFakeTimers();
  currentPathname = "/";
});

afterEach(() => {
  jest.useRealTimers();
});

describe("RouteAnnouncer — static shape", () => {
  it("renders a visually hidden polite live region with status role", () => {
    render(<RouterStub pathname="/dashboard" />);

    const region = screen.getByTestId("route-announcer");

    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    // sr-only class is provided by globals.css; the component opts in via class
    expect(region.className).toContain("sr-only");
  });

  it("publishes the announcement within the 250ms acceptance window", () => {
    render(<RouterStub pathname="/dashboard" />);

    // Initially empty — the announcer does not speak before the page has
    // mounted the new content.
    expect(screen.getByTestId("route-announcer")).toHaveTextContent("");

    // Advance just past the post-route-change debounce.
    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Dashboard",
    );
  });

  it("speaks `Navigated to Home` for the root path", () => {
    render(<RouterStub pathname="/" />);

    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Home",
    );
  });
});

describe("RouteAnnouncer — route change behavior (#1271)", () => {
  it("updates the live region after a route change", () => {
    const { rerender } = render(<RouterStub pathname="/dashboard" />);

    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });
    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Dashboard",
    );

    // Simulate a client-side navigation to /deck-builder.
    rerender(<RouterStub pathname="/deck-builder" />);

    // Before the debounce fires, the previous announcement is still visible.
    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Dashboard",
    );

    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Deck Builder",
    );
  });

  it("publishes each route label from the static map", () => {
    const cases: Array<[string, string]> = [
      ["/dashboard", "Dashboard"],
      ["/deck-builder", "Deck Builder"],
      ["/deck-coach", "Deck Coach"],
      ["/game", "Game"],
      ["/draft", "Draft"],
      ["/sealed", "Sealed"],
      ["/multiplayer", "Multiplayer"],
      ["/meta", "Meta"],
      ["/settings", "Settings"],
    ];

    for (const [pathname, label] of cases) {
      const { unmount } = render(<RouterStub pathname={pathname} />);
      act(() => {
        jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
      });
      expect(screen.getByTestId("route-announcer")).toHaveTextContent(
        `Navigated to ${label}`,
      );
      unmount();
    }
  });

  it("derives a fallback label for unmapped routes", () => {
    render(<RouterStub pathname="/multiplayer/browse" />);

    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Multiplayer — Browse",
    );
  });

  it("falls back to Title-Case for unmapped first-level routes", () => {
    render(<RouterStub pathname="/never-seen-before" />);

    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Never Seen Before",
    );
  });

  it("re-announces when the route changes back to the previous label", () => {
    const { rerender } = render(<RouterStub pathname="/dashboard" />);
    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });
    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Dashboard",
    );

    rerender(<RouterStub pathname="/draft" />);
    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });
    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Draft",
    );

    rerender(<RouterStub pathname="/dashboard" />);
    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });
    // Coming back to Dashboard must still publish a fresh announcement so
    // screen-reader users hear the route change.
    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Dashboard",
    );
  });
});

describe("RouteAnnouncer — debounce cleanup", () => {
  it("cancels a pending announcement if the route changes again before it fires", () => {
    const { rerender } = render(<RouterStub pathname="/dashboard" />);

    // Change path before the timer has fired.
    rerender(<RouterStub pathname="/draft" />);

    // The previously-scheduled timer must NOT publish its original label.
    act(() => {
      jest.advanceTimersByTime(__testing.ANNOUNCEMENT_DELAY_MS);
    });

    expect(screen.getByTestId("route-announcer")).toHaveTextContent(
      "Navigated to Draft",
    );
    // And specifically it must NOT contain the stale Dashboard announcement.
    expect(screen.getByTestId("route-announcer").textContent).not.toMatch(
      /Dashboard/,
    );
  });
});
