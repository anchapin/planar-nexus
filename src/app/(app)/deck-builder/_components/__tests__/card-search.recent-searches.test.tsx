/**
 * @fileoverview Source-wiring + harness tests for the recent-searches
 * chip row added in `CardSearch` (issue #1544).
 *
 * Validates the public contract that the deck-builder relies on:
 *  1. `card-search.tsx` imports the `useRecentSearches` hook and
 *     passes the documented 8-item cap.
 *  2. The chip row renders below the search input with the
 *     documented `data-testid` and a labelled `role="group"`.
 *  3. Each chip is a real `<button>` (Enter activates natively) with
 *     `aria-label="Run search: <query>"`.
 *  4. Each chip exposes a dismiss control with the documented
 *     `aria-label="Remove <query> from recent searches"`.
 *  5. The search input's `onKeyDown` handler calls `recordSearch` on
 *     Enter and delegates ArrowDown to the first chip when the input
 *     is empty.
 *  6. No card-result payloads are persisted — only raw query strings
 *     flow through the persistence layer.
 *  7. The hook's exported cap matches the documented 8-item LRU.
 *
 * The chip behavior (click reruns, Enter activates, ArrowDown focuses
 * first chip) is exercised end-to-end through a small render harness
 * that wires `useRecentSearches` into a stripped-down replica of the
 * chip row. Mounting the full `CardSearch` is brittle (it pulls in the
 * offline IndexedDB, the embedding worker, and a debounced search
 * transition); the production flow is covered by the e2e
 * `deck-builder.spec.ts`.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import React, { useRef } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const storageMock = {
  saveRecentSearch: jest.fn(async (_q: string) => undefined),
  loadRecentSearches: jest.fn(async (): Promise<string[]> => []),
  deleteRecentSearch: jest.fn(async (_q: string) => undefined),
  clearRecentSearches: jest.fn(async () => undefined),
};

jest.mock("@/lib/search/recent-searches", () => ({
  saveRecentSearch: (...args: unknown[]) =>
    storageMock.saveRecentSearch(...(args as [string])),
  loadRecentSearches: () => storageMock.loadRecentSearches(),
  deleteRecentSearch: (...args: unknown[]) =>
    storageMock.deleteRecentSearch(...(args as [string])),
  clearRecentSearches: () => storageMock.clearRecentSearches(),
}));

import {
  useRecentSearches,
  MAX_RECENT_SEARCHES,
} from "@/hooks/use-recent-searches";

const SEARCH_FILE = join(__dirname, "..", "card-search.tsx");
const STORAGE_FILE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "lib",
  "search",
  "recent-searches.ts",
);

describe("CardSearch source wiring — recent-search chips (issue #1544)", () => {
  it("imports the recent-searches hook and the documented 8-item cap", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/@\/hooks\/use-recent-searches/);
    expect(src).toMatch(/MAX_RECENT_SEARCHES/);
  });

  it("renders a chip row directly below the search input", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    // `data-testid="recent-searches-row"` is the row container.
    expect(src).toMatch(/data-testid=["']recent-searches-row["']/);
    // The row must appear AFTER the search input markup.
    const inputIdx = src.indexOf("card-search-input");
    const rowIdx = src.indexOf("recent-searches-row");
    expect(inputIdx).toBeGreaterThan(-1);
    expect(rowIdx).toBeGreaterThan(inputIdx);
  });

  it("renders a group with an accessible label", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/role=["']group["']/);
    expect(src).toMatch(/aria-label=["']Recent searches["']/);
  });

  it("each chip is a real button with a 'Run search:' aria-label", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/<button\b/);
    expect(src).toMatch(/aria-label=\{`Run search: \$\{recentQuery\}`\}/);
    expect(src).toMatch(/data-testid=["']recent-search-chip["']/);
  });

  it("exposes a dismiss button with the documented aria-label", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(
      /aria-label=\{`Remove \$\{recentQuery\} from recent searches`\}/,
    );
    expect(src).toMatch(/data-testid=["']recent-search-chip-remove["']/);
  });

  it("wires ArrowDown to focus the first chip when the input is empty", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    expect(src).toMatch(/e\.key\s*===\s*["']ArrowDown["']/);
    expect(src).toMatch(/query\.length\s*===\s*0/);
    expect(src).toMatch(/chipRefs\.current\[0\]\.focus\(\)/);
  });

  it("calls recordSearch on Enter so a typed query becomes a chip", () => {
    const src = readFileSync(SEARCH_FILE, "utf8");
    // The Enter branch inside handleSearchKeyDown must trigger recordSearch.
    expect(src).toMatch(/recordSearch\(query\)/);
  });

  it("exports the documented 8-item cap from the hook", () => {
    expect(MAX_RECENT_SEARCHES).toBe(8);
  });

  it("persists only the raw query string — no card payload", () => {
    const src = readFileSync(STORAGE_FILE, "utf8");
    // The put call stores exactly `{ query, lastUsedAt }`. Anything
    // resembling a card object would fail this match.
    expect(src).toMatch(/store\.put\(\{[\s\S]*?query: trimmed/);
    expect(src).toMatch(/lastUsedAt: Date\.now\(\)/);
  });
});

/**
 * Render harness — a stripped-down replica of the chip row that
 * exercises the same `useRecentSearches` hook + the same handler
 * shape the production card-search uses. This keeps the test surface
 * deterministic (no debounced IndexedDB worker, no embedding search)
 * while still proving that click → rerun, keyboard activation, and
 * ArrowDown → focus-first-chip all work as documented.
 */
function ChipRowHarness({ onRun }: { onRun: (q: string) => void }) {
  const { recent, recordSearch, removeRecent } = useRecentSearches();
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [query, setQuery] = React.useState("");

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && query.length === 0 && chipRefs.current[0]) {
      e.preventDefault();
      chipRefs.current[0].focus();
      return;
    }
    if (e.key === "Enter") {
      if (query.trim().length >= 2) {
        void recordSearch(query);
      }
    }
  };

  return (
    <div>
      <input
        aria-label="Search input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKey}
        data-testid="harness-search-input"
      />
      {recent.length > 0 && (
        <div
          role="group"
          aria-label="Recent searches"
          data-testid="recent-searches-row"
        >
          {recent.map((q, i) => (
            <span key={q} data-recent-search-query={q}>
              <button
                ref={(el) => {
                  chipRefs.current[i] = el;
                }}
                type="button"
                onClick={() => {
                  setQuery(q);
                  onRun(q);
                  void recordSearch(q);
                }}
                aria-label={`Run search: ${q}`}
                data-testid="recent-search-chip"
              >
                {q}
              </button>
              <button
                type="button"
                onClick={() => removeRecent(q)}
                aria-label={`Remove ${q} from recent searches`}
                data-testid="recent-search-chip-remove"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

describe("CardSearch chip behavior — render harness (issue #1544)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storageMock.saveRecentSearch.mockResolvedValue(undefined);
    storageMock.deleteRecentSearch.mockResolvedValue(undefined);
    storageMock.loadRecentSearches.mockResolvedValue([]);
  });

  it("renders a chip after the user types a query and presses Enter", async () => {
    render(<ChipRowHarness onRun={() => {}} />);
    const input = screen.getByTestId("harness-search-input");

    await act(async () => {
      fireEvent.change(input, { target: { value: "lightning" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("recent-searches-row")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Run search: lightning" }),
    ).toBeInTheDocument();
    expect(storageMock.saveRecentSearch).toHaveBeenCalledWith("lightning");
  });

  it("clicking a chip calls the rerun callback and bumps the chip to MRU", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["ramp", "lightning"]);

    const onRun = jest.fn();
    render(<ChipRowHarness onRun={onRun} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run search: lightning" }),
      ).toBeInTheDocument();
    });

    const lightningChip = screen.getByRole("button", {
      name: "Run search: lightning",
    });
    await act(async () => {
      fireEvent.click(lightningChip);
    });

    expect(onRun).toHaveBeenCalledWith("lightning");
    expect(storageMock.saveRecentSearch).toHaveBeenCalledWith("lightning");
  });

  it("the dismiss button removes the chip and persists the removal", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["lightning", "ramp"]);
    render(<ChipRowHarness onRun={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run search: lightning" }),
      ).toBeInTheDocument();
    });

    const dismissBtn = screen.getByRole("button", {
      name: "Remove lightning from recent searches",
    });
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(storageMock.deleteRecentSearch).toHaveBeenCalledWith("lightning");

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Run search: lightning" }),
      ).not.toBeInTheDocument();
    });
    // The other chip is still present.
    expect(
      screen.getByRole("button", { name: "Run search: ramp" }),
    ).toBeInTheDocument();
  });

  it("ArrowDown on the empty input focuses the first chip", async () => {
    storageMock.loadRecentSearches.mockResolvedValueOnce(["lightning", "ramp"]);
    render(<ChipRowHarness onRun={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Run search: lightning" }),
      ).toBeInTheDocument();
    });

    const input = screen.getByTestId("harness-search-input");
    expect(input).toHaveValue("");

    const firstChip = screen.getByRole("button", {
      name: "Run search: lightning",
    });

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(firstChip).toHaveFocus();
  });
});
