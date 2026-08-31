/**
 * SwissStandings accessibility tests — issue #1603.
 *
 * Covers the two WCAG gaps called out in the issue:
 *   - 1.3.1 (Info and Relationships): the standings are rendered as a
 *     semantic <table> with <thead>/<tbody>/<th>/<td> and a named
 *     region landmark wrapper. Screen readers can navigate row-by-row
 *     and column-by-column instead of receiving a flat list of names.
 *   - 1.4.1 (Use of Color): the podium position (1st / 2nd / 3rd) is
 *     announced via sr-only text "1st place" / "2nd place" / "3rd
 *     place" AND via a visible textual label, so the rank does not
 *     depend on the gold/silver/bronze background alone. The same
 *     text remains available in forced-colors mode where the medal
 *     backgrounds collapse.
 *
 * axe-core is used to assert no WCAG regressions are introduced.
 * It is pulled in via the same transitive path used by
 * src/components/__tests__/tournament-bracket.test.tsx (the dev
 * eslint-plugin-jsx-a11y dependency tree installs axe-core).
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axe = require("axe-core") as typeof import("axe-core");

import { SwissStandings, type SwissPlayer } from "../swiss-pairing";

// jsdom polyfills required by Radix primitives used by Card.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a SwissPlayer with sensible defaults. `name` is required; everything
 * else is optional so the focused test cases stay readable.
 */
function makePlayer(
  overrides: Partial<SwissPlayer> & { name: string },
): SwissPlayer {
  return {
    id: overrides.id ?? overrides.name.toLowerCase().replace(/\s+/g, "-"),
    name: overrides.name,
    seed: overrides.seed,
    points: overrides.points ?? 0,
    wins: overrides.wins ?? 0,
    losses: overrides.losses ?? 0,
    draws: overrides.draws ?? 0,
    opponentIds: overrides.opponentIds ?? [],
    matchHistory: overrides.matchHistory ?? [],
  };
}

/**
 * Five players with descending points so the top three form a podium
 * (1st, 2nd, 3rd) and the bottom two do not. Names are sorted so the
 * assertion message reads "Alex" — first — "Sam" — second and so on,
 * matching the points ordering (calculateStandings sorts by points).
 */
const PLAYERS: SwissPlayer[] = [
  makePlayer({
    name: "Alex",
    seed: 1,
    points: 9,
    wins: 3,
    draws: 0,
    losses: 0,
  }),
  makePlayer({ name: "Sam", seed: 2, points: 6, wins: 2, draws: 0, losses: 1 }),
  makePlayer({
    name: "Robin",
    seed: 3,
    points: 3,
    wins: 1,
    draws: 0,
    losses: 2,
  }),
  makePlayer({
    name: "Jordan",
    seed: 4,
    points: 3,
    wins: 1,
    draws: 0,
    losses: 2,
  }),
  makePlayer({
    name: "Casey",
    seed: 5,
    points: 0,
    wins: 0,
    draws: 0,
    losses: 3,
  }),
];

/**
 * Thin wrapper so individual tests don't have to repeat `await axe.run(...)`
 * and the violation formatting. Color contrast is enforced separately by
 * the existing docs/CONTRAST_AUDIT.md gate (npm run a11y:contrast) and is
 * enforced in real browsers; jsdom cannot compute it reliably, so disable
 * the rule here as the tournament-bracket test does.
 */
async function runAxe(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => {
        const impact = v.impact ?? "unknown";
        return `${v.id} (${impact}) — ${v.nodes
          .map((n) => n.target.join(","))
          .join(" | ")}`;
      })
      .join("\n");
    throw new Error(`axe violations:\n${summary}`);
  }
}

// ---------------------------------------------------------------------------
// Semantic table structure (WCAG 1.3.1)
// ---------------------------------------------------------------------------

describe("SwissStandings — semantic table (#1603, WCAG 1.3.1)", () => {
  it("wraps the standings in a named region landmark", () => {
    render(<SwissStandings players={PLAYERS} />);
    expect(
      screen.getByRole("region", { name: /swiss tournament standings/i }),
    ).toBeInTheDocument();
  });

  it("renders the standings inside a native <table>", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const region = screen.getByRole("region", {
      name: /swiss tournament standings/i,
    });
    const table = region.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.tagName).toBe("TABLE");
  });

  it("exposes a header row with the four required column labels", () => {
    render(<SwissStandings players={PLAYERS} />);
    // Column headers should be exposed via the implicit columnheader role on
    // <th scope="col">. Use the table semantics rather than getAllByRole
    // because Radix Card may also surface unrelated columnheader nodes.
    const region = screen.getByRole("region", {
      name: /swiss tournament standings/i,
    });
    const columnHeaders = within(region.getElementsByTagName("table")[0])
      .getAllByRole("columnheader")
      .map((el) => el.textContent?.trim());
    expect(columnHeaders).toEqual(["Rank", "Player", "Points", "Record"]);
  });

  it("renders one <tr> per player inside <tbody>", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll("tr");
    expect(rows).toHaveLength(PLAYERS.length);
  });

  it("provides an accessible table caption describing the standings", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const caption = container.querySelector("table > caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toMatch(/swiss tournament standings/i);
  });

  it("renders the players in points-descending order", () => {
    render(<SwissStandings players={PLAYERS} />);
    const region = screen.getByRole("region", {
      name: /swiss tournament standings/i,
    });
    const rowGroups = within(
      region.getElementsByTagName("table")[0],
    ).getAllByRole("row");
    // row 0 is the header in <thead>; rows 1..N are body rows.
    const bodyRows = rowGroups.slice(1);
    const names = bodyRows.map((row) => {
      // Each row's <th scope="row"> + 3 <td>s. The player name lives in the
      // second cell ("Player" column).
      const playerCell = row.querySelectorAll("th, td")[1];
      return playerCell?.textContent?.trim() ?? "";
    });
    expect(names[0]?.startsWith("Alex")).toBe(true);
    expect(names[1]?.startsWith("Sam")).toBe(true);
    expect(names[2]?.startsWith("Robin")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Podium rank is conveyed without color (WCAG 1.4.1)
// ---------------------------------------------------------------------------

describe("SwissStandings — podium rank is not conveyed by color alone (#1603, WCAG 1.4.1)", () => {
  it("announces the 1st-place position as sr-only text", () => {
    render(<SwissStandings players={PLAYERS} />);
    expect(screen.getAllByText(/1st place/i).length).toBeGreaterThanOrEqual(1);
  });

  it("announces the 2nd-place position as sr-only text", () => {
    render(<SwissStandings players={PLAYERS} />);
    expect(screen.getAllByText(/2nd place/i).length).toBeGreaterThanOrEqual(1);
  });

  it("announces the 3rd-place position as sr-only text", () => {
    render(<SwissStandings players={PLAYERS} />);
    expect(screen.getAllByText(/3rd place/i).length).toBeGreaterThanOrEqual(1);
  });

  it("places the sr-only podium labels inside the corresponding row", () => {
    render(<SwissStandings players={PLAYERS} />);
    // Each podium row should contain its label, both as a visible badge AND
    // as sr-only text. We assert that the sr-only label lives in the row
    // marked with the matching podium background.
    const tbody = document.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll("tr");
    expect(rows[0]).toHaveTextContent(/1st place/i);
    expect(rows[1]).toHaveTextContent(/2nd place/i);
    expect(rows[2]).toHaveTextContent(/3rd place/i);
    // Non-podium rows should NOT carry a podium label.
    expect(rows[3]).not.toHaveTextContent(/\d(st|nd|rd|th) place/i);
    expect(rows[4]).not.toHaveTextContent(/\d(st|nd|rd|th) place/i);
  });

  it("renders the podium label as a visible text element, not just sr-only", () => {
    // WCAG 1.4.1: color (the gold/silver/bronze bg) is one signal, but
    // sighted users in forced-colors mode still need a text marker. We
    // assert that the podium label text is present in the visible DOM
    // (i.e. it is not just an sr-only span) by querying for elements that
    // are NOT inside an .sr-only container.
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const allSpans = Array.from(container.querySelectorAll("span"));
    const visiblePodiumLabels = allSpans
      .filter(
        (el) =>
          !el.className.includes("sr-only") &&
          /(1st|2nd|3rd) place/i.test(el.textContent ?? ""),
      )
      .map((el) => el.textContent?.trim());
    expect(visiblePodiumLabels).toEqual(
      expect.arrayContaining(["1st place", "2nd place", "3rd place"]),
    );
  });

  it("still exposes the numeric rank as a visible badge so forced-colors users see it", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll("tr");
    // Each row's rank badge is a span with the literal index+1 text.
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[1]).toHaveTextContent("2");
    expect(rows[2]).toHaveTextContent("3");
  });

  it("uses sr-only 'Rank N' for non-podium rows so SR users get a position label too", () => {
    render(<SwissStandings players={PLAYERS} />);
    expect(screen.getAllByText(/^Rank 4$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Rank 5$/i).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Record / points / seed rendering (regression guard for the migration)
// ---------------------------------------------------------------------------

describe("SwissStandings — content rendering after the table migration", () => {
  it("renders each player's points and the W/D/L badges", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    // First row = Alex (9 points, 3W 0D 0L).
    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const firstRow = tbody!.querySelectorAll("tr")[0];
    expect(firstRow).toHaveTextContent("Alex");
    expect(firstRow).toHaveTextContent("9");
    expect(firstRow).toHaveTextContent("3W");
    expect(firstRow).toHaveTextContent("0D");
    expect(firstRow).toHaveTextContent("0L");
  });

  it("shows the seed after the player name when present", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const tbody = container.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll("tr");
    expect(rows[0]).toHaveTextContent("#1");
  });

  it("exposes an aria-label for the W/D/L badge group so SR users hear 'X wins, Y draws, Z losses'", () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    const rowGroup = container.querySelector('[aria-label*="wins"]');
    expect(rowGroup).not.toBeNull();
    expect(rowGroup?.getAttribute("aria-label")).toMatch(
      /3 wins, 0 draws, 0 losses/,
    );
  });
});

// ---------------------------------------------------------------------------
// axe-core: no new a11y violations
// ---------------------------------------------------------------------------

describe("SwissStandings — axe-core (#1603)", () => {
  it("reports zero violations on a fully-populated standings", async () => {
    const { container } = render(<SwissStandings players={PLAYERS} />);
    await runAxe(container);
  });

  it("reports zero violations on a podium-only (3 players) standings", async () => {
    const { container } = render(
      <SwissStandings players={PLAYERS.slice(0, 3)} />,
    );
    await runAxe(container);
  });
});
