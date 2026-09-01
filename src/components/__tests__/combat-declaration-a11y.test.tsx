/**
 * CombatDeclaration accessibility tests — issue #1600.
 *
 * Covers the three WCAG gaps called out in the issue:
 *   - 4.1.2 (Name, Role, Value): attacker/blocker card buttons expose
 *     aria-pressed reflecting the selected/assigned state, and creatures
 *     that cannot attack or block expose WHY ("tapped", "summoning
 *     sickness, cannot attack", "cannot block") in their accessible name —
 *     previously the state was conveyed only by color, ring, opacity,
 *     rotation and a hover-only tooltip.
 *   - 1.4.1 (Use of Color): the selection ring and the amber warning
 *     triangle are no longer the only cues; the state survives
 *     forced-colors mode because it is carried by aria-pressed and the
 *     accessible name.
 *   - 4.1.3 (Status Messages): attacker selection/deselection and blocker
 *     assignment changes are announced through an sr-only
 *     aria-live="polite" region.
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

import { CombatDeclaration } from "../combat-declaration";
import type { CombatCard } from "../combat-declaration";

type CombatDeclarationProps = Parameters<typeof CombatDeclaration>[0];

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

function makeCard(
  id: string,
  name: string,
  overrides: Partial<CombatCard> = {},
): CombatCard {
  return {
    id,
    name,
    power: 2,
    toughness: 2,
    isTapped: false,
    canAttack: true,
    canBlock: true,
    hasSummoningSickness: false,
    isAttacking: false,
    isBlocking: false,
    blockerAssignments: [],
    ...overrides,
  };
}

const goblinGuide = makeCard("a1", "Goblin Guide");
const sickElf = makeCard("a2", "Llanowar Elf", {
  power: 1,
  toughness: 1,
  canAttack: false,
  hasSummoningSickness: true,
});
const tappedTroll = makeCard("a3", "Tapped Troll", {
  power: 3,
  toughness: 3,
  isTapped: true,
});
const squire = makeCard("b1", "Squire", { power: 1, toughness: 2 });
const sleepyWall = makeCard("b2", "Sleepy Wall", {
  power: 0,
  toughness: 5,
  canBlock: false,
});

function renderCombat(
  props: {
    combatPhase?: CombatDeclarationProps["combatPhase"];
    attackers?: CombatCard[];
    blockers?: CombatCard[];
    declaredAttackers?: string[];
    currentBlockerAssignments?: Map<string, string[]>;
    currentDamageOrder?: Map<string, string[]>;
  } = {},
) {
  return render(
    <CombatDeclaration
      open
      onOpenChange={() => {}}
      combatPhase={props.combatPhase ?? "declare-attackers"}
      attackers={props.attackers ?? []}
      blockers={props.blockers ?? []}
      onDeclareAttackers={() => {}}
      onAssignBlockers={() => {}}
      onSetDamageOrder={() => {}}
      onConfirmCombat={() => {}}
      declaredAttackers={props.declaredAttackers ?? []}
      currentBlockerAssignments={props.currentBlockerAssignments ?? new Map()}
      currentDamageOrder={props.currentDamageOrder ?? new Map()}
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
// Attacker buttons: aria-pressed + disabled reasons (WCAG 4.1.2, 1.4.1)

describe("CombatDeclaration attacker buttons (issue #1600)", () => {
  it("exposes aria-pressed reflecting the selection state", () => {
    renderCombat({ attackers: [goblinGuide] });

    const goblin = screen.getByRole("button", { name: /goblin guide/i });
    expect(goblin).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(goblin);
    expect(goblin).toHaveAttribute("aria-pressed", "true");

    // The exact verification query from the issue: a pressed attacker
    // button is findable via role semantics, not color.
    expect(
      screen.getByRole("button", { name: /goblin guide/i, pressed: true }),
    ).toBeInTheDocument();

    fireEvent.click(goblin);
    expect(
      screen.queryByRole("button", { name: /goblin guide/i, pressed: true }),
    ).not.toBeInTheDocument();
  });

  it("includes 'summoning sickness, cannot attack' in a sick creature's accessible name", () => {
    renderCombat({ attackers: [sickElf] });

    const elf = screen.getByRole("button", {
      name: /llanowar elf.*summoning sickness, cannot attack/i,
    });
    expect(elf).toBeDisabled();
    expect(elf).toHaveAttribute("aria-disabled", "true");
    expect(elf).toHaveAttribute("aria-pressed", "false");
  });

  it("includes 'tapped' as the disabled reason for a tapped creature", () => {
    renderCombat({ attackers: [tappedTroll] });

    const troll = screen.getByRole("button", { name: /tapped troll/i });
    expect(troll).toBeDisabled();
    expect(troll).toHaveAttribute("aria-disabled", "true");
    expect(troll.getAttribute("aria-label")).toMatch(/tapped troll.*tapped/i);
  });

  it("keeps healthy creatures enabled with aria-disabled=false", () => {
    renderCombat({ attackers: [goblinGuide] });

    const goblin = screen.getByRole("button", { name: /goblin guide/i });
    expect(goblin).toBeEnabled();
    expect(goblin).toHaveAttribute("aria-disabled", "false");
  });
});

// ---------------------------------------------------------------------------
// Live region announcements (WCAG 4.1.3)

describe("CombatDeclaration live region (issue #1600)", () => {
  it("announces attacker selection changes via a polite live region", () => {
    renderCombat({ attackers: [goblinGuide] });

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    expect(live).toHaveTextContent(/goblin guide selected to attack/i);

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    expect(live).toHaveTextContent(/goblin guide deselected from attack/i);
  });

  it("starts with an empty announcement when the dialog reopens", () => {
    const baseProps: CombatDeclarationProps = {
      open: true,
      onOpenChange: () => {},
      combatPhase: "declare-attackers",
      attackers: [goblinGuide],
      blockers: [],
      onDeclareAttackers: () => {},
      onAssignBlockers: () => {},
      onSetDamageOrder: () => {},
      onConfirmCombat: () => {},
      declaredAttackers: [],
      currentBlockerAssignments: new Map(),
      currentDamageOrder: new Map(),
    };
    const { rerender } = render(<CombatDeclaration {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /goblin guide selected to attack/i,
    );

    rerender(<CombatDeclaration {...baseProps} open={false} />);
    rerender(<CombatDeclaration {...baseProps} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// Blocker buttons: aria-pressed + disabled reasons

describe("CombatDeclaration blocker buttons (issue #1600)", () => {
  const setupBlockers = () =>
    renderCombat({
      combatPhase: "declare-blockers",
      attackers: [goblinGuide],
      blockers: [squire, sleepyWall],
      declaredAttackers: ["a1"],
    });

  it("uses aria-pressed on the attacker selector and announces blocker assignment", () => {
    setupBlockers();

    const attackerBtn = screen.getByRole("button", { name: /goblin guide/i });
    expect(attackerBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(attackerBtn);
    expect(attackerBtn).toHaveAttribute("aria-pressed", "true");

    const squireBtn = screen.getByRole("button", { name: /squire/i });
    expect(squireBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(squireBtn);
    expect(
      screen.getByRole("button", { name: /squire/i, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /squire assigned as blocker for goblin guide/i,
    );

    fireEvent.click(squireBtn);
    expect(screen.getByRole("status")).toHaveTextContent(
      /squire removed as blocker for goblin guide/i,
    );
  });

  it("exposes the disabled reason on a blocker that cannot block", () => {
    setupBlockers();

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));

    const wall = screen.getByRole("button", { name: /sleepy wall/i });
    expect(wall).toBeDisabled();
    expect(wall).toHaveAttribute("aria-disabled", "true");
    expect(wall.getAttribute("aria-label")).toMatch(/cannot block/i);

    const squireBtn = screen.getByRole("button", { name: /squire/i });
    expect(squireBtn).toBeEnabled();
    expect(squireBtn).toHaveAttribute("aria-disabled", "false");
  });

  it("announces attacker selection for blocker assignment via the live region", () => {
    setupBlockers();

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /goblin guide selected for blocker assignment/i,
    );

    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /goblin guide deselected/i,
    );
  });
});

// ---------------------------------------------------------------------------
// axe scan

describe("CombatDeclaration a11y scan (issue #1600)", () => {
  it("has no axe violations in the declare-attackers view", async () => {
    renderCombat({ attackers: [goblinGuide, sickElf, tappedTroll] });

    // Radix portals the dialog into document.body, so scan the body.
    const results = await axe.run(document.body);
    expect(meaningfulViolations(results)).toEqual([]);
  });

  it("has no axe violations in the declare-blockers view with a blocker assigned", async () => {
    renderCombat({
      combatPhase: "declare-blockers",
      attackers: [goblinGuide],
      blockers: [squire, sleepyWall],
      declaredAttackers: ["a1"],
    });
    fireEvent.click(screen.getByRole("button", { name: /goblin guide/i }));
    fireEvent.click(screen.getByRole("button", { name: /squire/i }));

    const results = await axe.run(document.body);
    expect(meaningfulViolations(results)).toEqual([]);
  });
});
