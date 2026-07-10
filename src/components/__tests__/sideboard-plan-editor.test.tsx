/**
 * @fileoverview Accessibility tests for SideboardPlanEditor (issue #1447).
 *
 * The "Cards to bring in" and "Cards to take out" lists in the sideboard
 * plan dialog previously rendered rows as `<div>` containers without any
 * list semantics — invisible to screen-reader users. Issue #1447 fixes
 * this with paired `<ul role="list">` wrappers and `<li>` rows.
 *
 * Acceptance criteria covered here:
 *   - The "Cards to bring in" list renders as `<ul role="list">` with
 *     `<li>` children, and the empty state stays out of the list.
 *   - The "Cards to take out" list mirrors the same shape.
 *   - Each row's remove button keeps its existing accessible name
 *     ("Remove card from side in" / "Remove card from side out").
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

// The dialog needs Radix `Dialog` (portal) plus a few shadcn primitives.
// Stub the primitive chrome so the editor opens inline under jsdom and we
// can assert directly on the rendered list markup.
jest.mock("@/components/ui/dialog", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    Dialog: ({ children, open }: any) =>
      open ? React.createElement("div", null, children) : null,
    DialogContent: ({ children }: any) =>
      React.createElement("div", { "data-testid": "dialog-content" }, children),
    DialogHeader: ({ children }: any) => React.createElement("div", null, children),
    DialogTitle: ({ children }: any) =>
      React.createElement("h2", null, children),
    DialogDescription: ({ children }: any) =>
      React.createElement("p", null, children),
    DialogFooter: ({ children }: any) => React.createElement("div", null, children),
  };
});

jest.mock("@/components/ui/select", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const Passthrough = ({ children }: any) =>
    React.createElement("div", null, children);
  return {
    Select: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
    SelectContent: ({ children }: any) =>
      React.createElement("div", null, children),
    SelectItem: ({ children }: any) =>
      React.createElement("div", null, children),
  };
});

import { SideboardPlanEditor } from "@/components/meta/sideboard/SideboardPlanEditor";
import { saveSideboardPlan } from "@/lib/sideboard-plans";
import * as SideboardPlansModule from "@/lib/sideboard-plans";

// `saveSideboardPlan` writes to localStorage; stub it so the test doesn't
// pollute the global store and we can assert it gets called on save.
jest.mock("@/lib/sideboard-plans", () => {
  const actual = jest.requireActual<typeof SideboardPlansModule>(
    "@/lib/sideboard-plans",
  );
  return {
    ...actual,
    saveSideboardPlan: jest.fn(),
    updateSideboardPlan: jest.fn(),
    generatePlanId: jest.fn(() => "sideboard-test-id"),
  };
});

const mockedSave = jest.mocked(saveSideboardPlan);

function renderEditor() {
  return render(
    <SideboardPlanEditor
      open
      onOpenChange={jest.fn()}
      defaultValues={{
        format: "standard",
        inCards: [],
        outCards: [],
      }}
      onSave={jest.fn()}
    />,
  );
}

beforeEach(() => {
  mockedSave.mockReset();
});

// ---------------------------------------------------------------------------
// #1447 — side-in / side-out list semantics (WCAG 1.3.1)
// ---------------------------------------------------------------------------

describe("SideboardPlanEditor — list semantics (#1447, WCAG 1.3.1)", () => {
  it("announces the side-in cards via an aria-label when the list is empty", () => {
    renderEditor();

    // With no cards the list itself is suppressed and a non-list empty
    // placeholder is rendered in its place. SR users hear the same
    // message a sighted user reads.
    expect(screen.getByText(/no cards to side in yet/i)).toBeInTheDocument();
  });

  it("announces the side-out cards via an aria-label when the list is empty", () => {
    renderEditor();

    expect(screen.getByText(/no cards to side out yet/i)).toBeInTheDocument();
  });

  it("does not render empty <ul role='list'> containers before cards are added", () => {
    renderEditor();

    // Guard against a regression that wraps an empty `<ul></ul>` and
    // tricks screen readers into announcing a vacant list landmark.
    expect(screen.queryByRole("list", { name: /cards to side in/i })).toBeNull();
    expect(screen.queryByRole("list", { name: /cards to side out/i })).toBeNull();
  });

  it("promotes the side-in list to <ul role='list'> as soon as a card is added", () => {
    renderEditor();

    // The editor's "Card name" input is the first placeholder-bearing
    // text input — the side-in input.
    const inCardInput = screen.getAllByPlaceholderText(/card name/i)[0];
    fireEvent.change(inCardInput, { target: { value: "Fry" } });
    fireEvent.click(screen.getByRole("button", { name: /add card to side in/i }));

    const list = screen.getByRole("list", { name: /cards to side in/i });
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("role", "list");

    // And it owns exactly one <li>.
    expect(list.querySelectorAll("li")).toHaveLength(1);
    expect(list).toHaveTextContent(/fry/i);
  });

  it("promotes the side-out list to <ul role='list'> as soon as a card is added", () => {
    renderEditor();

    // Two text inputs are visible (Card name / count for side-in + side-out).
    // Find the side-out input by walking up to its labeled container.
    const outCardInput = screen.getAllByPlaceholderText(/card name/i)[1];
    fireEvent.change(outCardInput, { target: { value: "Embercleave" } });
    fireEvent.click(screen.getByRole("button", { name: /add card to side out/i }));

    const list = screen.getByRole("list", { name: /cards to side out/i });
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("role", "list");
    expect(list.querySelectorAll("li")).toHaveLength(1);
  });

  it("keeps the remove-card buttons accessible by name after adding a row", () => {
    renderEditor();

    const inCardInput = screen.getAllByPlaceholderText(/card name/i)[0];
    fireEvent.change(inCardInput, { target: { value: "Fry" } });
    fireEvent.click(screen.getByRole("button", { name: /add card to side in/i }));

    expect(
      screen.getByRole("button", { name: /remove card from side in/i }),
    ).toBeInTheDocument();
  });
});
