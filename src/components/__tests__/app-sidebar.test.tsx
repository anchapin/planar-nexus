import React from "react";
import { render, screen } from "@testing-library/react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "../app-sidebar";

// ---------------------------------------------------------------------------
// Test rig: a controlled wrapper that swaps the pathname value returned by
// `next/navigation#usePathname`. This lets us deterministically simulate a
// client-side navigation without needing a real Next.js app router.
// ---------------------------------------------------------------------------

interface RouterStubProps {
  pathname: string;
}

let currentPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

// next-intl is a client-only library that requires a provider to translate.
// Replace `useTranslations` with a thin shim that returns the message key as
// a deterministic label so we can assert against stable text.
jest.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string): string =>
      `${namespace}.${key}`,
}));

// jsdom polyfills required by Radix primitives used by the sidebar
// (ResizeObserver for the responsive shell, matchMedia for `useIsMobile`).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

function RouterStub({ pathname }: RouterStubProps) {
  currentPathname = pathname;
  return (
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>
  );
}

function renderAt(pathname: string) {
  currentPathname = pathname;
  return render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  currentPathname = "/dashboard";
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HREFS = [
  "/dashboard",
  "/deck-builder",
  "/card-studio",
  "/collection",
  "/draft-assistant",
  "/deck-coach",
  "/coach-report",
  "/meta",
  "/game-analysis",
  "/saved-games",
  "/single-player",
  "/multiplayer",
  "/game-board",
  "/card-interactions-demo",
  "/settings",
] as const;

function linkFor(href: string): HTMLAnchorElement {
  // Next.js Link renders an <a> tag; locate it by href.
  return screen.getByRole("link", { name: new RegExp(href, "i") });
}

// `SidebarMenuButton` collapses its visible label when the sidebar is in the
// `icon` state and shows it as a tooltip. Our render path always renders the
// expanded sidebar, so the visible label is the message key returned by the
// mocked `useTranslations`. We resolve the rendered link by visible text.

function navLinkByLabel(href: string): HTMLAnchorElement {
  // `useTranslations("sidebar")(labelKey)` returns `"sidebar.<labelKey>"`.
  // The mapping below mirrors the menuItem declarations in app-sidebar.tsx.
  const labelKeyByHref: Record<string, string> = {
    "/dashboard": "dashboard",
    "/deck-builder": "deckBuilder",
    "/card-studio": "cardStudio",
    "/collection": "collection",
    "/draft-assistant": "draftAssistant",
    "/deck-coach": "aiDeckCoach",
    "/coach-report": "coachReport",
    "/meta": "metaAnalysis",
    "/game-analysis": "gameAnalysis",
    "/saved-games": "savedGames",
    "/single-player": "singlePlayer",
    "/multiplayer": "multiplayer",
    "/game-board": "gameBoardDemo",
    "/card-interactions-demo": "cardInteractions",
    "/settings": "settings",
  };
  const label = labelKeyByHref[href];
  if (!label) throw new Error(`unknown href: ${href}`);
  // Find the anchor inside the menu button that contains the visible label.
  const buttons = document.querySelectorAll(
    '[data-sidebar="menu-button"]',
  ) as NodeListOf<HTMLAnchorElement>;
  for (const button of Array.from(buttons)) {
    if (button.getAttribute("href") === href) {
      return button;
    }
  }
  // Fall back to a label-based search so the failure message is informative.
  return screen.getByRole("link", { name: new RegExp(label, "i") });
}

// ---------------------------------------------------------------------------
// Tests for issue #1270 — aria-current + active-page indicators
// ---------------------------------------------------------------------------

describe("AppSidebar — aria-current on active nav link (#1270)", () => {
  it("marks the dashboard link with aria-current='page' on /dashboard", () => {
    renderAt("/dashboard");

    const dashboardLink = navLinkByLabel("/dashboard");
    expect(dashboardLink).toHaveAttribute("aria-current", "page");
  });

  it("does not mark the dashboard link as current when on /deck-builder", () => {
    renderAt("/deck-builder");

    const dashboardLink = navLinkByLabel("/dashboard");
    expect(dashboardLink).not.toHaveAttribute("aria-current");
  });

  it.each(HREFS.filter((href) => href !== "/dashboard"))(
    "marks %s with aria-current='page' when the pathname matches exactly",
    (href) => {
      renderAt(href);

      const link = navLinkByLabel(href);
      expect(link).toHaveAttribute("aria-current", "page");
    },
  );

  it("only one nav link carries aria-current='page' per route", () => {
    renderAt("/deck-builder");

    const linksWithPage = Array.from(
      document.querySelectorAll('a[aria-current="page"]'),
    );
    expect(linksWithPage).toHaveLength(1);
    expect((linksWithPage[0] as HTMLAnchorElement).getAttribute("href")).toBe(
      "/deck-builder",
    );
  });
});

describe("AppSidebar — aria-current='true' on parent link for descendants (#1270)", () => {
  it("marks /deck-builder as aria-current='true' for /deck-builder/123", () => {
    renderAt("/deck-builder/123");

    const deckBuilderLink = navLinkByLabel("/deck-builder");
    expect(deckBuilderLink).toHaveAttribute("aria-current", "true");
  });

  it("marks /collection as aria-current='true' for /collection/abc", () => {
    renderAt("/collection/abc");

    const collectionLink = navLinkByLabel("/collection");
    expect(collectionLink).toHaveAttribute("aria-current", "true");
  });

  it("does not mark sibling sections as current for descendant routes", () => {
    renderAt("/deck-builder/123");

    // `/collection` shares the `/co...` prefix with `/collection/abc` but is
    // a sibling section — the trailing-slash guard must prevent it from
    // matching `/deck-builder`.
    expect(navLinkByLabel("/collection")).not.toHaveAttribute("aria-current");
    // And the dashboard must not match either.
    expect(navLinkByLabel("/dashboard")).not.toHaveAttribute("aria-current");
  });

  it("does not match /deck-builder-other when active route is /deck-builder", () => {
    renderAt("/deck-builder-other");

    expect(navLinkByLabel("/deck-builder")).not.toHaveAttribute("aria-current");
  });

  it("marks parent as aria-current='true' for query-string descendants", () => {
    renderAt("/deck-builder?deck=d1");

    const deckBuilderLink = navLinkByLabel("/deck-builder");
    expect(deckBuilderLink).toHaveAttribute("aria-current", "true");
  });

  it("still issues aria-current='page' (not 'true') on exact nested paths", () => {
    // Sanity check: `/deck-builder` (no trailing segment) is itself an
    // authenticated route and must announce 'page', not 'true'.
    renderAt("/deck-builder");
    expect(navLinkByLabel("/deck-builder")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("AppSidebar — data-active visual indicator (#1270)", () => {
  it("sets data-active='true' on the active menu button", () => {
    renderAt("/deck-builder");

    const activeButtons = document.querySelectorAll(
      '[data-sidebar="menu-button"][data-active="true"]',
    );
    expect(activeButtons).toHaveLength(1);
  });

  it("sets data-active on a parent menu button for nested routes", () => {
    renderAt("/collection/abc");

    const collectionButton = navLinkByLabel("/collection");
    expect(collectionButton).toHaveAttribute("data-active", "true");
  });

  it("leaves every menu button data-active='false' when no route matches", () => {
    // Pick a route that is NOT a descendant of any menu item to assert that
    // nothing is highlighted.
    renderAt("/this-route-does-not-exist");

    const activeButtons = Array.from(
      document.querySelectorAll(
        '[data-sidebar="menu-button"][data-active="true"]',
      ),
    );
    expect(activeButtons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lightweight accessibility-style assertions. The repo does not depend on
// `jest-axe`, so we verify the acceptance-criteria properties directly:
//   - every nav link is reachable via accessible role/name;
//   - exactly one link is marked current per route;
//   - no nav link is missing an accessible name.
// ---------------------------------------------------------------------------

describe("AppSidebar — accessible-name coverage (#1270)", () => {
  it.each(HREFS)("exposes an accessible name for the %s nav link", (href) => {
    renderAt(href);
    const link = navLinkByLabel(href);
    expect(link).toBeInTheDocument();
    // The link must contain a visible text node (the label) and therefore
    // have a non-empty accessible name.
    const text = (link.textContent || "").trim();
    expect(text.length).toBeGreaterThan(0);
  });

  it("renders exactly 15 nav links (one per menu item)", () => {
    renderAt("/dashboard");

    const links = document.querySelectorAll(
      '[data-sidebar="menu-button"]',
    ) as NodeListOf<HTMLAnchorElement>;
    expect(links).toHaveLength(HREFS.length);
  });
});

describe("AppSidebar — route-change behavior (#1270)", () => {
  it("updates aria-current when the pathname changes via a client navigation", () => {
    const { rerender } = render(<RouterStub pathname="/dashboard" />);

    expect(navLinkByLabel("/dashboard")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(navLinkByLabel("/deck-builder")).not.toHaveAttribute("aria-current");

    rerender(<RouterStub pathname="/deck-builder" />);

    expect(navLinkByLabel("/dashboard")).not.toHaveAttribute("aria-current");
    expect(navLinkByLabel("/deck-builder")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
