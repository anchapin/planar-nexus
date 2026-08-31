/**
 * Mana badge + AbilityMenu accessibility tests — issue #1602.
 *
 * Covers the two WCAG gaps called out in the issue:
 *   - 1.4.1 (Use of Color): colored mana badges now render a visible letter
 *     (e.g. "R") inside the circle, so the mana type is not conveyed by the
 *     background color alone. The spectator mana pool exposes the color word
 *     via an accessible name.
 *   - 4.1.2 (Name, Role, Value): every mana badge exposes an accessible name
 *     ("Red mana") via role="img" + aria-label, and AbilityMenu exposes WHY
 *     an ability is disabled — aria-disabled plus aria-describedby pointing
 *     at sr-only reason text instead of a hover-only tooltip on a color-only
 *     icon.
 *
 * axe-core is used to assert no WCAG regressions are introduced. It is
 * pulled in via the same transitive path used by
 * src/components/__tests__/tournament-bracket.test.tsx (the dev
 * eslint-plugin-jsx-a11y dependency tree installs axe-core).
 */

import React from "react";
import { render, screen, within } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axe = require("axe-core") as typeof import("axe-core");

import { CustomCardPreview } from "../custom-card-preview";
import { DEFAULT_CUSTOM_CARD } from "@/lib/custom-card";
import type { CustomCardDefinition } from "@/lib/custom-card";
import { AbilityMenu } from "../ability-menu";
import type { CardAbility } from "@/types/card-interactions";
import { AIPlayerView } from "@/app/(app)/spectator/_components/ai-player-view";
import type { Player, PlayerId } from "@/lib/game-state/types";

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

function makeCard(manaCost: string): CustomCardDefinition {
  const now = Date.now();
  return {
    ...DEFAULT_CUSTOM_CARD,
    id: "card-1",
    name: "Test Card",
    manaCost,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAbilities(): CardAbility[] {
  return [
    {
      id: "ab-1",
      name: "Shock",
      text: "Deal 2 damage to any target.",
      isActivatable: true,
      hasTargets: false,
    },
    {
      id: "ab-2",
      name: "Drain Life",
      text: "Drain 2 life from any target.",
      manaCost: "{2}{B}",
      isActivatable: true,
      hasTargets: false,
    },
    {
      id: "ab-3",
      name: "Awaken",
      text: "Awaken a permanent.",
      isActivatable: false,
      activatableReason: "Card is not on the battlefield",
      hasTargets: false,
    },
  ];
}

const fakeAiPlayer = {
  id: "ai-1" as PlayerId,
  name: "AI Opponent",
  life: 20,
  poisonCounters: 0,
  manaPool: {
    colorless: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 3,
    green: 0,
  },
} as unknown as Player;

/**
 * axe cannot compute color contrast for the gradient-styled card preview in
 * jsdom, so filter that rule out. Everything else must be clean.
 */
function meaningfulViolations(results: { violations: { id: string }[] }) {
  return results.violations.filter((v) => v.id !== "color-contrast");
}

// ---------------------------------------------------------------------------
// ManaSymbol badges (CustomCardPreview)

describe("CustomCardPreview mana badges (issue #1602)", () => {
  it("shows a visible letter for colored mana so color is not the only cue", () => {
    render(<CustomCardPreview card={makeCard("{2}{R}")} />);
    const redBadge = screen.getByRole("img", { name: "Red mana" });
    expect(within(redBadge).getByText("R")).toBeInTheDocument();
  });

  it("exposes accessible names for all five colors plus colorless", () => {
    render(<CustomCardPreview card={makeCard("{W}{U}{B}{R}{G}{C}")} />);
    expect(screen.getByRole("img", { name: "White mana" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blue mana" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Black mana" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Red mana" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Green mana" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Colorless mana" }),
    ).toBeInTheDocument();
  });

  it("exposes accessible names for numeric, phyrexian and hybrid mana", () => {
    render(<CustomCardPreview card={makeCard("{3}{G/P}{2/W}")} />);
    expect(
      screen.getByRole("img", { name: "3 generic mana" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Phyrexian green mana" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Hybrid mana: 2 or white" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations in the card preview", async () => {
    const { container } = render(
      <CustomCardPreview card={makeCard("{2}{R}{G}")} />,
    );
    const results = await axe.run(container);
    expect(meaningfulViolations(results)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AbilityMenu disabled reason

describe("AbilityMenu disabled reason (issue #1602)", () => {
  const setup = () =>
    render(
      <AbilityMenu
        open
        onOpenChange={() => {}}
        abilities={makeAbilities()}
        cardName="Test Card"
        cardTypes={["Creature"]}
        onAbilityActivate={() => {}}
        onStartTargeting={() => {}}
        availableMana={{ blue: 5 }}
      />,
    );

  it("marks non-activatable abilities with aria-disabled", () => {
    setup();
    // "Drain Life" costs {2}{B} but only blue mana is available.
    const drain = screen.getByRole("button", { name: /drain life/i });
    expect(drain).toBeDisabled();
    expect(drain).toHaveAttribute("aria-disabled", "true");
    const shock = screen.getByRole("button", { name: /shock/i });
    expect(shock).toHaveAttribute("aria-disabled", "false");
  });

  it("exposes the disabled reason as sr-only text referenced by aria-describedby", () => {
    setup();
    const drain = screen.getByRole("button", { name: /drain life/i });
    expect(drain).toHaveAttribute("aria-describedby", "ability-reason-1");
    const reasonEl = document.getElementById("ability-reason-1");
    expect(reasonEl).not.toBeNull();
    expect(reasonEl).toHaveTextContent("Not enough mana");
    expect(
      screen.getByText(/not activatable: not enough mana/i),
    ).toBeInTheDocument();
  });

  it("exposes custom activatable reasons for non-activatable abilities", () => {
    setup();
    expect(
      screen.getByText(/not activatable: card is not on the battlefield/i),
    ).toBeInTheDocument();
  });

  it("keeps the activatable ability free of a reason description", () => {
    setup();
    const shock = screen.getByRole("button", { name: /shock/i });
    expect(shock).not.toHaveAttribute("aria-describedby");
  });

  it("has no axe violations in the ability menu", async () => {
    setup();
    // Radix portals the dialog into document.body, so scan the body.
    const results = await axe.run(document.body);
    expect(meaningfulViolations(results)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AIPlayerView mana pool badges

describe("AIPlayerView mana pool badges (issue #1602)", () => {
  it("exposes an accessible name that includes the color word", () => {
    render(<AIPlayerView player={fakeAiPlayer} gameState={null} />);
    const badge = screen.getByRole("img", { name: "3 red mana" });
    expect(badge).toBeInTheDocument();
  });

  it("has no axe violations in the player view", async () => {
    const { container } = render(
      <AIPlayerView player={fakeAiPlayer} gameState={null} />,
    );
    const results = await axe.run(container);
    expect(meaningfulViolations(results)).toEqual([]);
  });
});
