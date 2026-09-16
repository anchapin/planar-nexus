/**
 * Saved Games page tests — issue #1817.
 *
 * The rules engine's only public API is the full `@/lib/game-state` barrel,
 * which re-exports the entire engine (layer system, spell-casting, …).
 * A static value import of `decompressReplayJson` pulled that whole chunk
 * into the saved-games list route even though the engine is only needed
 * when the user actually shares a replay.
 *
 * These tests pin the post-fix invariants:
 *   1. The page source contains no static value import of the engine
 *      barrel (type-only imports are fine — they erase at build time).
 *   2. `decompressReplayJson` is loaded via `await import("@/lib/game-state")`
 *      at the share call site.
 *   3. The Share Replay flow still works end-to-end through the dynamic
 *      import (link-copy success and decompress-failure toast paths).
 */

import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SavedGameMeta } from "@/lib/saved-games";
import SavedGamesPage from "../page";

const pageSource = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");

// Every `import ... "@/lib/game-state"` line in the page source.
const engineImportLines = pageSource
  .split("\n")
  .filter(
    (line) => /^\s*import\b/.test(line) && line.includes("@/lib/game-state"),
  );

// --- Module mocks -----------------------------------------------------------

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => pushMock(...args) }),
}));

const toastMock = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (...args: unknown[]) => toastMock(...args) }),
}));

const getAllSavedGamesMock = jest.fn();
const getSavedGamePayloadMock = jest.fn();
jest.mock("@/lib/saved-games", () => ({
  savedGamesManager: {
    getAllSavedGames: (...args: unknown[]) => getAllSavedGamesMock(...args),
    getSavedGamePayload: (...args: unknown[]) =>
      getSavedGamePayloadMock(...args),
  },
  formatSavedAt: (savedAt: number) => new Date(savedAt).toISOString(),
  getStatusDisplay: (status: string) => status,
}));

const canShareViaURLMock = jest.fn();
const copyShareableLinkMock = jest.fn();
const exportReplayToFileMock = jest.fn();
jest.mock("@/lib/replay-sharing", () => ({
  canShareViaURL: (...args: unknown[]) => canShareViaURLMock(...args),
  copyShareableLink: (...args: unknown[]) => copyShareableLinkMock(...args),
  exportReplayToFile: (...args: unknown[]) => exportReplayToFileMock(...args),
}));

// The engine barrel stands in as a mock so the test can observe the
// dynamic `await import("@/lib/game-state")` resolving to it.
const decompressReplayJsonMock = jest.fn();
jest.mock("@/lib/game-state", () => ({
  decompressReplayJson: (...args: unknown[]) =>
    decompressReplayJsonMock(...args),
}));

// Stub the radix DropdownMenu so menu items render inline as buttons —
// same pattern as deck-coach's coach-components tests.
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="stub-dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

// --- Fixtures ---------------------------------------------------------------

function makeGame(overrides: Partial<SavedGameMeta> = {}): SavedGameMeta {
  return {
    id: "game-1",
    name: "Test Game",
    format: "commander",
    playerNames: ["Alex", "Sam"],
    savedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    turnNumber: 5,
    currentPhase: "main1",
    status: "in_progress",
    isAutoSave: false,
    hasReplay: true,
    ...overrides,
  };
}

// --- Static lazy-import guards (#1817) --------------------------------------

describe("#1817 — engine barrel is dynamically imported", () => {
  it("has no static value import of @/lib/game-state (type-only is allowed)", () => {
    // If an engine import ever returns, it must stay type-only — erased at
    // compile time, so it cannot pull the engine chunk into the route.
    for (const line of engineImportLines) {
      expect(line).toMatch(/^\s*import\s+type\b/);
    }
  });

  it("loads decompressReplayJson via await import at the share call site", () => {
    expect(pageSource).toMatch(
      /await\s+import\(\s*["']@\/lib\/game-state["']\s*\)/,
    );
  });
});

// --- Share Replay behavior ---------------------------------------------------

describe("SavedGamesPage Share Replay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAllSavedGamesMock.mockResolvedValue([makeGame()]);
    getSavedGamePayloadMock.mockResolvedValue({
      replayJson: "gzn:H4sIAAAAA",
    });
    decompressReplayJsonMock.mockResolvedValue(JSON.stringify({ actions: [] }));
    canShareViaURLMock.mockReturnValue(true);
    copyShareableLinkMock.mockResolvedValue(true);
  });

  it("shares via the dynamically imported engine and copies a link", async () => {
    render(<SavedGamesPage />);

    expect(await screen.findByText("Test Game")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /share replay/i }));

    // The payload row is fetched, the engine barrel is dynamically
    // imported, and the inflated replay is handed to the share helper.
    await waitFor(() => {
      expect(decompressReplayJsonMock).toHaveBeenCalledWith("gzn:H4sIAAAAA");
    });
    expect(getSavedGamePayloadMock).toHaveBeenCalledWith("game-1");
    expect(canShareViaURLMock).toHaveBeenCalledTimes(1);
    expect(copyShareableLinkMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Link Copied" }),
    );

    // The pending state clears once the share completes.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /share replay/i }),
      ).toBeEnabled();
    });
  });

  it("surfaces a Share Failed toast when decompression throws", async () => {
    decompressReplayJsonMock.mockRejectedValue(new Error("inflate failed"));

    render(<SavedGamesPage />);

    expect(await screen.findByText("Test Game")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /share replay/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Share Failed",
          variant: "destructive",
        }),
      );
    });
    expect(copyShareableLinkMock).not.toHaveBeenCalled();
  });

  it("disables Share Replay while the engine chunk is loading", async () => {
    let resolveDecompress: (value: string) => void = () => {};
    decompressReplayJsonMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveDecompress = resolve;
        }),
    );

    render(<SavedGamesPage />);

    expect(await screen.findByText("Test Game")).toBeInTheDocument();

    const shareButton = screen.getByRole("button", { name: /share replay/i });
    fireEvent.click(shareButton);

    await waitFor(() => {
      expect(shareButton).toBeDisabled();
    });

    resolveDecompress(JSON.stringify({ actions: [] }));

    await waitFor(() => {
      expect(shareButton).toBeEnabled();
    });
  });
});
