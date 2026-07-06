/**
 * Issue #1253 — Lobby spectator count badge.
 *
 * Reads the host's `lobbyManager.getSpectatorCount()` on a short polling
 * cadence so the badge stays current as spectators join / leave the
 * roster. Hidden when the count is 0 (no active lobby, or no spectators
 * yet) so the page does not render a "0 spectators" pill by default.
 *
 * This is the multiplayer-page surface of the spectator transport; the
 * `P2PDiagnosticsPanel` separately renders its own `Spectators: N` chip
 * (also from the same source) so a host can see the count from either
 * the page header or the diagnostics panel without duplication.
 *
 * The component is intentionally tiny — it does not own the roster
 * (the `lobbyManager` does), it just subscribes to it. A custom event
 * hook (`useLobbySpectatorCount`) lives in the same file so the
 * `useEffect` setup / teardown stays colocated.
 */

"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Eye } from "lucide-react";
import { lobbyManager } from "@/lib/lobby-manager";

const POLL_INTERVAL_MS = 1000;

/**
 * Hook: subscribe to the host's `lobbyManager.getSpectatorCount()` with a
 * 1 s polling cadence. The roster is mutated outside React (the
 * `lobbyManager` is a singleton), so a poll is the simplest
 * reconciler. Returns the current count (0 when no lobby is active).
 */
function useLobbySpectatorCount(): number {
  const [count, setCount] = useState(() => lobbyManager.getSpectatorCount());

  useEffect(() => {
    // Initial sync — the constructor's `useState` initializer reads
    // from the singleton at mount time but a hydration mismatch (or a
    // race during SSR) could leave the first paint stale. Re-read on
    // mount so the badge is consistent with the actual roster.
    setCount(lobbyManager.getSpectatorCount());
    const id = setInterval(() => {
      setCount(lobbyManager.getSpectatorCount());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return count;
}

/**
 * Page-header badge showing the current spectator count for the active
 * lobby. Hidden when no lobby is active or when the count is 0 so a
 * fresh page does not show an empty "0 spectators" pill. Renders a
 * `data-testid="spectator-count"` so the E2E test in
 * `e2e/multiplayer-lobby.spec.ts` can pin the count.
 */
export function LobbySpectatorCount() {
  const count = useLobbySpectatorCount();
  if (count <= 0) return null;
  return (
    <Badge
      variant="secondary"
      className="gap-1"
      data-testid="spectator-count"
      aria-label={`${count} ${count === 1 ? "spectator" : "spectators"}`}
    >
      <Eye className="h-3 w-3" aria-hidden="true" />
      {count} {count === 1 ? "spectator" : "spectators"}
    </Badge>
  );
}
