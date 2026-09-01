/**
 * TriggerDialog accessibility tests — issue #1601.
 *
 * Covers the WCAG 4.1.2 (Name, Role, Value) gaps called out in the issue:
 *   - The trigger-order up/down icon buttons (ArrowUpDown, icon-only) now
 *     expose descriptive aria-labels ("Move trigger <name> up"/"... down")
 *     instead of relying on the visual icon and position.
 *   - The Yes/No choice buttons expose aria-pressed reflecting the current
 *     choice, so a screen-reader user can tell which option is active
 *     without re-reading the visual variant.
 *   - Choice changes are announced via an sr-only aria-live="polite" region.
 *
 * Existing behavior (handleChoiceChange, moveTriggerUp/Down, handleConfirm)
 * is guarded by regression tests so only ARIA attributes were added.
 *
 * axe-core is used to assert no WCAG regressions are introduced. It is
 * pulled in via the same transitive path used by
 * src/components/__tests__/mana-badge-a11y.test.tsx (the dev
 * eslint-plugin-jsx-a11y dependency tree installs axe-core).
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axe = require("axe-core") as typeof import("axe-core");

import { TriggerDialog } from "../trigger-dialog";
import type { OptionalTrigger } from "../trigger-dialog";

type TriggerDialogProps = Parameters<typeof TriggerDialog>[0];

// jsdom polyfills required by Radix primitives used by ScrollArea/Dialog.
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

function makeTrigger(
  id: string,
  name: string,
  overrides: Partial<OptionalTrigger> = {},
): OptionalTrigger {
  return {
    id,
    name,
    description: `${name} description`,
    isOptional: true,
    sourceCardName: name.split(" - ")[0],
    sourceCardId: `card-${id}`,
    timing: "immediate",
    hasMultipleTriggers: true,
    orderIndex: 0,
    ...overrides,
  };
}

const twoTriggers = [
  makeTrigger("t-1", "Chromatic Star - ETB"),
  makeTrigger("t-2", "Manakin - ETB"),
];

/**
 * Stable empty-preferences reference. The dialog's open-effect lists
 * `savedPreferences` in its deps, so the component's `= []` default (a fresh
 * array per render) would re-trigger the effect every render and loop; in-app
 * callers always pass a stable state array. See report note in issue #1601.
 */
const EMPTY_PREFERENCES: TriggerDialogProps["savedPreferences"] = [];

function renderDialog(props: Partial<TriggerDialogProps> = {}) {
  return render(
    <TriggerDialog
      open
      onOpenChange={() => {}}
      triggers={twoTriggers}
      onTriggerChoice={() => {}}
      savedPreferences={EMPTY_PREFERENCES}
      {...props}
    />,
  );
}

/**
 * axe cannot compute color contrast in jsdom, so filter that rule out.
 * Everything else must be clean.
 */
function meaningfulViolations(results: { violations: { id: string }[] }) {
  return results.violations.filter((v) => v.id !== "color-contrast");
}

// ---------------------------------------------------------------------------
// Trigger-order icon buttons

describe("TriggerDialog order buttons (issue #1601)", () => {
  it("exposes 'Move trigger <name> up/down' aria-labels on the order buttons", () => {
    renderDialog();

    const upButtons = screen.getAllByRole("button", {
      name: /move trigger .* up/i,
    });
    expect(upButtons).toHaveLength(2);

    const downButtons = screen.getAllByRole("button", {
      name: /move trigger .* down/i,
    });
    expect(downButtons).toHaveLength(2);

    expect(
      screen.getByRole("button", {
        name: "Move trigger Chromatic Star - ETB up",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move trigger Manakin - ETB down" }),
    ).toBeInTheDocument();
  });

  it("disables the move buttons at the list boundaries", () => {
    renderDialog();

    const ups = screen.getAllByRole("button", {
      name: /move trigger .* up/i,
    });
    expect(ups[0]).toBeDisabled();
    expect(ups[1]).toBeEnabled();

    const downs = screen.getAllByRole("button", {
      name: /move trigger .* down/i,
    });
    expect(downs[0]).toBeEnabled();
    expect(downs[1]).toBeDisabled();
  });

  it("still reorders triggers when the labeled move buttons are used", () => {
    const onTriggerOrder = jest.fn();
    renderDialog({ onTriggerOrder });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Move trigger Chromatic Star - ETB down",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm choices/i }));

    expect(onTriggerOrder).toHaveBeenCalledWith(["t-2", "t-1"]);
  });
});

// ---------------------------------------------------------------------------
// Yes/No choice buttons

describe("TriggerDialog Yes/No buttons (issue #1601)", () => {
  it("exposes aria-pressed reflecting the current choice", () => {
    renderDialog({ triggers: [twoTriggers[0]] });

    const yes = screen.getByRole("button", { name: "Yes" });
    const no = screen.getByRole("button", { name: "No" });

    // Choices default to "no" when the dialog opens.
    expect(yes).toHaveAttribute("aria-pressed", "false");
    expect(no).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(yes);
    expect(yes).toHaveAttribute("aria-pressed", "true");
    expect(no).toHaveAttribute("aria-pressed", "false");

    // The exact verification query from the issue: pressed Yes is findable.
    expect(
      screen.getByRole("button", { name: /yes/i, pressed: true }),
    ).toBeInTheDocument();

    fireEvent.click(no);
    expect(
      screen.queryByRole("button", { name: /yes/i, pressed: true }),
    ).not.toBeInTheDocument();
  });

  it("announces choice changes via a polite live region", () => {
    renderDialog({ triggers: [twoTriggers[0]] });

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(liveRegion).toHaveTextContent(/chromatic star.*set to yes/i);

    fireEvent.click(screen.getByRole("button", { name: "Yes to All" }));
    expect(liveRegion).toHaveTextContent(/all triggers set to yes/i);

    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(liveRegion).toHaveTextContent(/chromatic star.*set to no/i);
  });
});

// ---------------------------------------------------------------------------
// Behavior regression guard + axe

describe("TriggerDialog a11y scan (issue #1601)", () => {
  it("still reports choices and order on confirm", () => {
    const onTriggerChoice = jest.fn();
    const onTriggerOrder = jest.fn();
    renderDialog({ onTriggerChoice, onTriggerOrder });

    fireEvent.click(screen.getAllByRole("button", { name: "Yes" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /confirm choices/i }));

    expect(onTriggerOrder).toHaveBeenCalledWith(["t-1", "t-2"]);
    const choices = onTriggerChoice.mock.calls[0][0] as {
      triggerId: string;
      choice: string;
    }[];
    const byId = Object.fromEntries(
      choices.map((c) => [c.triggerId, c.choice]),
    );
    expect(byId["t-1"]).toBe("yes");
    expect(byId["t-2"]).toBe("no");
  });

  it("has no axe violations for the order and Yes/No controls", async () => {
    renderDialog();
    // Radix portals the dialog into document.body, so scan the body.
    const results = await axe.run(document.body);
    expect(meaningfulViolations(results)).toEqual([]);
  });
});
