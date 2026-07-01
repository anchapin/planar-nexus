"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Static pathname -> human-readable label map.
 *
 * The Next.js App Router updates `document.title` correctly but provides no
 * audible signal to screen-reader users when a route change happens. Several
 * routes (deck-builder, draft, sealed, multi-page AI coach report) load
 * asynchronously; without a polite live region the user hears silence and
 * assumes nothing happened.
 *
 * The map intentionally matches the route segments shipped today. Unknown
 * pathnames fall back to a derived human-readable label so every navigation
 * still produces an announcement (see {@link deriveFallbackLabel}).
 */
const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/deck-builder": "Deck Builder",
  "/deck-builder/ai": "AI Deck Builder",
  "/limited-deck-builder": "Limited Deck Builder",
  "/deck-coach": "Deck Coach",
  "/game": "Game",
  "/game-board": "Game Board",
  "/draft": "Draft",
  "/draft/complete": "Draft — Complete",
  "/draft-assistant": "Draft Assistant",
  "/sealed": "Sealed",
  "/single-player": "Single Player",
  "/multiplayer": "Multiplayer",
  "/multiplayer/browse": "Multiplayer — Browse Games",
  "/multiplayer/join": "Multiplayer — Join",
  "/saved-games": "Saved Games",
  "/replay": "Replay",
  "/spectator": "Spectator",
  "/strategy": "Strategy",
  "/matchup": "Matchup Analysis",
  "/meta": "Meta",
  "/card-studio": "Card Studio",
  "/custom-card-editor": "Custom Card Editor",
  "/card-interactions-demo": "Card Interactions Demo",
  "/collection": "Collection",
  "/sideboards": "Sideboards",
  "/trade": "Trade",
  "/achievements": "Achievements",
  "/game-analysis": "Game Analysis",
  "/game-history": "Game History",
  "/set-browser": "Set Browser",
  "/hand-display-demo": "Hand Display Demo",
  "/procedural-art-demo": "Procedural Art Demo",
  "/database-management": "Database Management",
  "/settings": "Settings",
  "/coach-report": "Coach Report",
};

/**
 * Time, in milliseconds, we wait after a route change before publishing the
 * announcement. This lets the destination page render its own `<h1>` first so
 * screen-readers expose a coherent `Navigated to <h1>` pairing rather than
 * speaking before any content has mounted. 250ms is the upper bound from the
 * issue acceptance criteria.
 */
const ANNOUNCEMENT_DELAY_MS = 100;

/**
 * Derive a human label for paths that are not explicitly listed in
 * {@link ROUTE_LABELS}.
 *
 * Examples:
 *   "/deck-builder/deck-123" -> "Deck Builder — deck-123"
 *   "/game/abc-DEF"          -> "Game — abc-DEF"
 *   "/"                      -> "Home"
 */
function deriveFallbackLabel(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "Home";
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Home";

  const head = `/${segments[0]}`;
  const baseLabel = ROUTE_LABELS[head];
  const headLabel = baseLabel ?? titleCase(segments[0]);

  if (segments.length === 1) {
    return headLabel;
  }

  const tail = segments
    .slice(1)
    .map((segment) => decodeURIComponent(segment))
    .join(" — ");
  return `${headLabel} — ${tail}`;
}

function titleCase(segment: string): string {
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

/**
 * Visually hidden polite live region that announces client-side route changes
 * to assistive technology. Implements WCAG 2.4.2 (Page Titled) and 4.1.3
 * (Status Messages, AA).
 *
 * The region is mounted at the (app) layout level so every authenticated route
 * inherits it. Each call to `usePathname()` returns the active path; we resolve
 * it through {@link ROUTE_LABELS} (with a derived fallback) and write the label
 * into the live region shortly after the change so the new page's `<h1>` is
 * already in the DOM when the screen-reader speaks.
 *
 * Mounted consumers do not need to pass any props:
 *
 * ```tsx
 * <RouteAnnouncer />
 * ```
 */
export function RouteAnnouncer() {
  const pathname = usePathname() ?? "/";
  const [announcement, setAnnouncement] = useState<string>("");

  useEffect(() => {
    if (!pathname) return;
    const label = ROUTE_LABELS[pathname] ?? deriveFallbackLabel(pathname);
    // Clear, then set — screen readers only re-announce when textContent
    // changes, so identical labels across renders stay silent.
    const handle = window.setTimeout(() => {
      setAnnouncement((current) =>
        current === label ? current : `Navigated to ${label}`,
      );
    }, ANNOUNCEMENT_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [pathname]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="route-announcer"
    >
      {announcement}
    </div>
  );
}

/** @internal — exposed for unit tests only. */
export const __testing = {
  ROUTE_LABELS,
  deriveFallbackLabel,
  ANNOUNCEMENT_DELAY_MS,
};
