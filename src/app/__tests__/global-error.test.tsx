/**
 * Tests for the root global-error boundary (issue #1731).
 *
 * `src/app/error.tsx` cannot catch errors thrown by the root layout — those
 * fall through to the platform default (white browser screen / blank Tauri
 * webview frame). `src/app/global-error.tsx` is the boundary that covers that
 * tier, and because it REPLACES the root layout when it activates, Next.js
 * requires it to render its own <html> and <body> tags.
 *
 * These tests pin that contract at the component level:
 *   1. the boundary renders a standalone <html>/<body> shell,
 *   2. it shows a friendly message (not a blank screen),
 *   3. it offers a working Reload action,
 *   4. it surfaces the error digest,
 *   5. raw error details stay dev-only (mirrors src/app/error.tsx).
 *
 * NOTE on asserting the <html>/<body> shell: under React 19 client
 * rendering, <html>, <head>, and <body> are document-level SINGLETONS —
 * React does not nest them inside the render container. Instead it applies
 * the component's attributes onto the real document elements
 * (document.documentElement, document.body) and hoists <title> into
 * document.head. The shell assertions below therefore target the live
 * document, which mirrors exactly what production does when the boundary
 * takes over a real page.
 *
 * NOTE on console.error handling (two harness artifacts live here):
 *  a) React's validateDOMNesting warns "In HTML, <html> cannot be a child of
 *     <div>" because the testing library mounts this document-level
 *     component inside a container <div>. Production renders it at the
 *     document root, so the warning is noise — it is filtered below.
 *  b) jsdom locks the Location object down (non-configurable, read-only
 *     `reload`), so neither `Object.defineProperty` nor `jest.spyOn` can
 *     intercept `window.location.reload`. Instead we rely on jsdom's
 *     observable side effect — invoking reload() emits a console.error
 *     "Not implemented: navigation (except hash changes)" — which proves the
 *     button really calls through to window.location.reload().
 *     The spy records every call so each test can assert on them.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import GlobalError from "../global-error";

/** Every console.error message emitted during the current test. */
let consoleErrors: string[] = [];

beforeAll(() => {
  // Capture the real fn BEFORE installing the spy — otherwise the "original"
  // would be the spy itself and passthrough would recurse infinitely.
  const realConsoleError = console.error.bind(console);
  jest
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      const message = args.map(String).join(" ");
      consoleErrors.push(message);
      // Two known harness artifacts are recorded but not printed:
      //  - DOM-nesting warning "<html> cannot be a child of <div>" (note a
      //    above). React reports it with printf-style args, so match on the
      //    stable phrase rather than the fully-formatted string.
      //  - "Not implemented: navigation" — jsdom's expected report when the
      //    Reload button exercises window.location.reload() (note b above)
      const isHarnessArtifact =
        message.includes("cannot be a child of") ||
        message.includes("Not implemented: navigation");
      if (!isHarnessArtifact) realConsoleError(...args);
    });
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  consoleErrors = [];
});

function renderBoundary(
  overrides: Partial<{ digest?: string; message?: string }> = {},
) {
  const error: Error & { digest?: string } = new Error(
    overrides.message ?? "IndexedDB open failed: quota exceeded",
  );
  if (overrides.digest !== undefined) {
    error.digest = overrides.digest;
  }
  const reset = jest.fn();
  const utils = render(<GlobalError error={error} reset={reset} />);
  return { ...utils, reset, error };
}

describe("GlobalError — standalone document shell (#1731)", () => {
  it("declares an <html> shell: lang and dark class land on documentElement", () => {
    renderBoundary();
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("declares a <body> shell: body font classes land on document.body", () => {
    renderBoundary();
    expect(document.body).toHaveClass("font-body", "antialiased");
  });

  it("includes a <title> (hoisted to document.head) so the window is not untitled", () => {
    renderBoundary();
    expect(document.head.querySelector("title")?.textContent).toBe(
      "Planar Nexus — Critical Error",
    );
  });

  it("renders the friendly content into the document body", () => {
    renderBoundary();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(document.body).toContainElement(heading);
  });
});

describe("GlobalError — friendly message (#1731)", () => {
  it("renders a friendly heading instead of a blank screen", () => {
    renderBoundary();
    expect(
      screen.getByRole("heading", { level: 1, name: /something went wrong/i }),
    ).toBeInTheDocument();
  });

  it("reassures the user that local decks are safe", () => {
    renderBoundary();
    expect(screen.getByText(/stored locally/i)).toBeInTheDocument();
  });

  it("is announced to assistive tech via role=alert", () => {
    renderBoundary();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("GlobalError — Reload action (#1731)", () => {
  it("offers a Reload button that calls window.location.reload()", () => {
    renderBoundary();
    fireEvent.click(screen.getByRole("button", { name: /^reload$/i }));
    // The only thing in this interaction that triggers jsdom's "Not
    // implemented: navigation" report is a real window.location.reload()
    // invocation (see file header note b).
    expect(consoleErrors.join("\n")).toContain(
      "Not implemented: navigation",
    );
  });

  it("also wires the Next.js reset callback as a secondary action", () => {
    const { reset } = renderBoundary();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("GlobalError — digest and dev-only details (#1731)", () => {
  it("always displays the error digest when present (support correlation)", () => {
    renderBoundary({ digest: "planar-collapse-42" });
    expect(screen.getByText(/planar-collapse-42/)).toBeInTheDocument();
  });

  it("renders no digest line when the digest is missing", () => {
    renderBoundary();
    expect(screen.queryByText(/error digest:/i)).not.toBeInTheDocument();
  });

  it("hides raw error details outside development", () => {
    renderBoundary({ message: "secret-internal-detail" });
    expect(
      screen.queryByText(/secret-internal-detail/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/error details/i)).not.toBeInTheDocument();
  });

  it("shows raw error details in development only (mirrors error.tsx)", () => {
    // Next.js's env typings mark NODE_ENV as read-only; assigning through a
    // widened view is the standard escape hatch for flipping it in tests.
    const previousEnv = process.env.NODE_ENV;
    const mutableEnv = process.env as { NODE_ENV: string };
    mutableEnv.NODE_ENV = "development";
    try {
      renderBoundary({ message: "secret-internal-detail" });
      fireEvent.click(screen.getByText(/error details/i));
      expect(screen.getByText(/secret-internal-detail/)).toBeInTheDocument();
    } finally {
      mutableEnv.NODE_ENV = previousEnv;
    }
  });
});
