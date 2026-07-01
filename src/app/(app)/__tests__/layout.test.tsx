/**
 * Regression test for issue #1266 — Nested <main> in (app) layout.
 *
 * The (app) route group used to wrap its children in a SECOND <main> element
 * on top of:
 *   - the root layout's <main id="main-content"> at src/app/layout.tsx
 *   - SidebarInset rendering a <main> at src/components/ui/sidebar.tsx
 *
 * That produced a deeply-nested, invalid HTML outline and the SkipLink's
 * `#main-content` anchor would land inside an empty inner <main> instead of
 * the focused content landmark. WCAG 2.4.1 (Bypass Blocks) was failing for
 * every authenticated route.
 *
 * This test pins the post-fix invariant: rendering <AppLayout> produces
 * exactly one element with role="main", and that element is the one the
 * SkipLink targets via #main-content + tabIndex={-1}.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

// Mock next/navigation so the layout's `usePathname` is deterministic.
let mockPathname = "/dashboard";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Replace the heavy side-effect components with cheap stand-ins so the test
// can run without IndexedDB, IntersectionObserver, framer-motion, or the real
// translations bundle. Each stub renders a data-testid we can use to assert
// presence without depending on the real markup shape.
jest.mock("@/components/indexeddb-migration", () => ({
  IndexedDBMigration: () => <div data-testid="stub-indexeddb-migration" />,
}));
jest.mock("@/components/onboarding-tour", () => ({
  OnboardingTour: () => <div data-testid="stub-onboarding-tour" />,
}));
jest.mock("@/components/app-footer", () => ({
  AppFooter: () => <div data-testid="stub-app-footer" />,
}));
jest.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => <div data-testid="stub-app-sidebar" />,
}));
jest.mock("@/components/route-announcer", () => ({
  RouteAnnouncer: () => <div data-testid="stub-route-announcer" />,
}));

// Replace the full Sidebar/SidebarProvider/SidebarInset UI machinery with a
// minimal shim that keeps the SidebarInset <main> semantics the real
// component ships with, forwards `id` and `tabIndex`, and avoids pulling in
// useIsMobile / ResizeObserver / matchMedia.
jest.mock("@/components/ui/sidebar", () => {
  type SidebarProps = { children?: React.ReactNode };
  const Sidebar = ({ children }: SidebarProps) => (
    <div data-testid="stub-sidebar">{children}</div>
  );
  const SidebarProvider = ({ children }: SidebarProps) => (
    <div data-testid="stub-sidebar-provider">{children}</div>
  );
  // The REAL SidebarInset renders a <main> element by default — the fix
  // relies on that intrinsic landmark being the SOLE <main> rendered by the
  // (app) layout. The shim mirrors it so the test exercises the same
  // JSX-tag-to-DOM mapping.
  const SidebarInset = React.forwardRef<
    HTMLElement,
    React.HTMLAttributes<HTMLElement>
  >(function SidebarInset(props, ref) {
    // tabIndex is forwarded verbatim so the SkipLink can move focus.
    const { children, ...rest } = props;
    return (
      <main ref={ref} {...rest}>
        {children}
      </main>
    );
  });
  return { Sidebar, SidebarProvider, SidebarInset };
});

// Import AFTER mocks are registered so the layout picks up the shims.
import AppLayout from "../layout";

function renderAt(pathname: string) {
  mockPathname = pathname;
  return render(
    <AppLayout>
      <p data-testid="child-marker">child content</p>
    </AppLayout>,
  );
}

describe("AppLayout — single <main> landmark (#1266)", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
  });

  it("renders exactly one <main> landmark on /dashboard", () => {
    renderAt("/dashboard");
    // getAllByRole throws if zero, returns 1+ if multiple — we assert exactly 1.
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
  });

  it("renders exactly one <main> landmark on /deck-builder", () => {
    renderAt("/deck-builder");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("renders exactly one <main> landmark on /multiplayer/host", () => {
    renderAt("/multiplayer/host");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("the single <main> carries id='main-content' (SkipLink target)", () => {
    renderAt("/dashboard");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
  });

  it("the single <main> is tabIndex={-1} so it accepts programmatic focus", () => {
    renderAt("/dashboard");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("SkipLink target #main-content is reachable by querySelector", () => {
    const { container } = renderAt("/dashboard");
    const target = container.querySelector("#main-content");
    expect(target).not.toBeNull();
    expect(target!.tagName.toLowerCase()).toBe("main");
  });

  it("the parent walking from {children} up to the lone <main> inserts no extra <main>", () => {
    // The bug introduced an extra <main> between SidebarInset and {children}.
    // SidebarInset is the legitimate sole <main>; the fix replaced the inner
    // wrap with a <div>. This guards against regression where the inner
    // wrapper is re-introduced as a <main>.
    const { container } = renderAt("/dashboard");
    const childMarker = container.querySelector("[data-testid='child-marker']");
    expect(childMarker).not.toBeNull();
    // Walk from {children} up to the first <main> ancestor — that ancestor
    // must BE the lone <main> carrying id="main-content" (the SidebarInset).
    let cursor: Element | null = childMarker!.parentElement;
    while (cursor && cursor.tagName.toLowerCase() !== "main") {
      cursor = cursor.parentElement;
      if (!cursor) break;
    }
    expect(cursor).not.toBeNull();
    expect(cursor!.getAttribute("id")).toBe("main-content");
    // If any extra <main> had been inserted between {children} and that
    // single <main>, the total count on the page would exceed 1.
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("the single <main> contains the rendered children", () => {
    renderAt("/dashboard");
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByTestId("child-marker"));
  });
});
