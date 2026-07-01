/**
 * Tests for <combat-animations> suite (issue #1263).
 *
 * The component module exports a small family of combat-related primitives
 * (AttackAnimation, BlockAnimation, DamageAnimation, the routing
 * <CombatAnimation>, the overlay <CombatAnimations>, the useCombatActions
 * hook, CombatCard, CombatPhaseIndicator, and CombatDeclaration). They are
 * the largest untested React surface in the project — 891 lines, 213
 * statements, all 0% — and they encode the timing-sensitive attacker
 * declare / blocker place / damage step / cleanup state machine that
 * E2E tests cover only on the happy path.
 *
 * Coverage goals (from the issue):
 *   - ≥ 8 passing tests covering each phase transition
 *   - combat-animations.tsx ≥ 60% statements, ≥ 40% branches
 *   - Zero flake — run 3× in CI and locally
 *
 * Strategy: drive every phase transition with `jest.useFakeTimers()`,
 * matching the conventions in `damage-indicator.test.tsx` and
 * `game-announcer.test.tsx`. The hook helper `setReducedMotion` mirrors
 * the one in `damage-indicator.test.tsx` because the `usePrefersReducedMotion`
 * hook subscribes via `addEventListener` and we need a real listener channel
 * to flip the preference mid-test if we ever want to.
 */
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import {
  AttackAnimation,
  BlockAnimation,
  CombatAnimation,
  CombatAnimations,
  CombatCard,
  CombatDeclaration,
  CombatPhaseIndicator,
  DamageAnimation,
  useCombatActions,
  type CombatAction,
} from "../combat-animations";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeAction(
  type: CombatAction["type"],
  overrides: Partial<CombatAction> = {},
): CombatAction {
  return {
    id: `act-${type}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    sourceId: "src-1",
    sourceName: "Goblin Guide",
    targetId: "tgt-1",
    targetName: "Llanowar Elf",
    amount: 3,
    timestamp: 0,
    ...overrides,
  };
}

/**
 * Set the global matchMedia stub for the `usePrefersReducedMotion` hook.
 * The hook calls `addEventListener('change', …)` and reads `.matches`
 * synchronously on mount, so we capture the listener list so tests can
 * drive the preference mid-flight if needed.
 */
function setReducedMotion(matches: boolean) {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: jest.fn().mockImplementation(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: (
        _type: string,
        cb: (event: { matches: boolean }) => void,
      ) => listeners.push(cb),
      removeEventListener: (
        _type: string,
        cb: (event: { matches: boolean }) => void,
      ) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      addListener: (cb: (event: { matches: boolean }) => void) =>
        listeners.push(cb),
      removeListener: (cb: (event: { matches: boolean }) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      dispatchEvent: () => true,
    })),
  });
  return listeners;
}

// ---------------------------------------------------------------------------
// AttackAnimation
// ---------------------------------------------------------------------------

describe("AttackAnimation", () => {
  beforeEach(() => {
    setReducedMotion(false);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing on the idle phase (initial render)", () => {
    const { container } = render(
      <AttackAnimation action={makeAction("attack")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("transitions idle → windup → strike → impact → recoil → fadeout and fires onComplete", () => {
    const onComplete = jest.fn();
    const action = makeAction("attack");
    render(<AttackAnimation action={action} onComplete={onComplete} />);

    // idle -> windup at 50ms
    act(() => {
      jest.advanceTimersByTime(50);
    });

    // windup -> strike at 200ms cumulative (so +150ms here)
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // strike -> impact at 400ms cumulative (+200ms)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // impact -> recoil at 600ms (+200ms)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // recoil -> fadeout at 800ms (+200ms)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // complete at 1000ms (+200ms)
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(action.id);
  });

  it("uses the ⚡ icon for first-strike and ⚡⚡ for double-strike", () => {
    const fs = makeAction("first-strike");
    const { container: fsContainer, rerender } = render(
      <AttackAnimation action={fs} />,
    );
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(fsContainer.textContent).toContain("⚡");
    // Should not contain the double-strike glyph
    expect(fsContainer.textContent).not.toContain("⚡⚡");

    const ds = makeAction("double-strike");
    rerender(<AttackAnimation action={ds} />);
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(document.body.textContent).toContain("⚡⚡");
  });

  it("gates the trail effect on the strike phase (no trails in idle/impact)", () => {
    // The trail map is conditional on `phase === 'strike'`. The interval
    // only `slice(-5)`s — it never adds — so we assert the conditional
    // gate rather than a populated trail.
    const { container } = render(
      <AttackAnimation action={makeAction("attack")} />,
    );
    // idle: no trails, no impact particles.
    expect(container.querySelector(".bg-red-500\\/30")).toBeNull();
    expect(container.querySelector(".bg-yellow-400")).toBeNull();

    act(() => {
      jest.advanceTimersByTime(50 + 150); // strike
    });
    // In strike the parent is rendered but the .bg-red-500/30 trail
    // children are still empty (the interval is a slice no-op).
    expect(container.querySelector(".bg-yellow-400")).toBeNull();

    act(() => {
      jest.advanceTimersByTime(200); // impact
    });
    // impact: 8 yellow impact particles render.
    expect(container.querySelectorAll(".bg-yellow-400").length).toBe(8);
  });

  it("renders impact particles during the impact phase", () => {
    const { container } = render(
      <AttackAnimation action={makeAction("attack")} />,
    );
    act(() => {
      jest.advanceTimersByTime(50 + 150 + 200); // impact
    });
    // The 8 impact particles share the `bg-yellow-400` class.
    expect(container.querySelectorAll(".bg-yellow-400").length).toBe(8);
  });

  it("skips trails and impact particles under prefers-reduced-motion (#1103)", () => {
    setReducedMotion(true);
    const onComplete = jest.fn();
    const action = makeAction("attack");
    const { container } = render(
      <AttackAnimation action={action} onComplete={onComplete} />,
    );

    // #1103: under reduced motion, the indicator reaches the static "strike"
    // state immediately, with no transforms / filter, and no decorative
    // trail dots or impact particles.
    expect(container.querySelector(".bg-red-500\\/30")).toBeNull();
    expect(container.querySelector(".bg-yellow-400")).toBeNull();
    // No transition class either.
    const main = container.querySelector(".bg-gradient-to-r");
    expect(main?.className).not.toContain("transition-all");

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onComplete).toHaveBeenCalledWith(action.id);
  });

  it("cleans up pending timers on unmount (no late onComplete)", () => {
    const onComplete = jest.fn();
    const { unmount } = render(
      <AttackAnimation action={makeAction("attack")} onComplete={onComplete} />,
    );
    act(() => {
      jest.advanceTimersByTime(100);
    });
    unmount();
    // Advance well past the 1000ms complete timer; onComplete should not
    // fire on an unmounted tree.
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BlockAnimation
// ---------------------------------------------------------------------------

describe("BlockAnimation", () => {
  beforeEach(() => {
    setReducedMotion(false);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing on the idle phase", () => {
    const { container } = render(
      <BlockAnimation action={makeAction("block")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("advances raise → block → hold → lower → complete and fires onComplete", () => {
    const onComplete = jest.fn();
    const action = makeAction("block");
    render(<BlockAnimation action={action} onComplete={onComplete} />);

    act(() => {
      jest.advanceTimersByTime(50); // raise
    });
    act(() => {
      jest.advanceTimersByTime(150); // block
    });
    act(() => {
      jest.advanceTimersByTime(200); // hold
    });
    act(() => {
      jest.advanceTimersByTime(400); // lower
    });
    act(() => {
      jest.advanceTimersByTime(200); // complete (1000ms)
    });

    expect(onComplete).toHaveBeenCalledWith(action.id);
  });

  it("renders the shield-particle fan only while in the block phase", () => {
    const { container } = render(
      <BlockAnimation action={makeAction("block")} />,
    );
    act(() => {
      jest.advanceTimersByTime(50 + 150); // block
    });
    // 6 shield particles share `bg-blue-300`.
    expect(container.querySelectorAll(".bg-blue-300").length).toBe(6);

    act(() => {
      jest.advanceTimersByTime(200 + 400); // hold -> lower
    });
    // After the block phase, the particle fan is gone.
    expect(container.querySelectorAll(".bg-blue-300").length).toBe(0);
  });

  it("unmounts on the complete phase (returns null)", () => {
    const action = makeAction("block");
    const { container } = render(<BlockAnimation action={action} />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    // The component returns null on `complete`.
    expect(container).toBeEmptyDOMElement();
  });

  it("skips the sequence under prefers-reduced-motion and still fires onComplete (#1103)", () => {
    setReducedMotion(true);
    const onComplete = jest.fn();
    const action = makeAction("block");
    const { container } = render(
      <BlockAnimation action={action} onComplete={onComplete} />,
    );
    // No transition class, no decorative fan.
    const main = container.querySelector(".bg-gradient-to-r");
    expect(main?.className).not.toContain("transition-all");
    expect(container.querySelector(".bg-blue-300")).toBeNull();
    // No animate-pulse on the shield glow (decorative, gated by reduceMotion).
    const glow = container.querySelector(".bg-blue-500\\/30");
    expect(glow?.className).not.toContain("animate-pulse");

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onComplete).toHaveBeenCalledWith(action.id);
  });
});

// ---------------------------------------------------------------------------
// DamageAnimation
// ---------------------------------------------------------------------------

describe("DamageAnimation", () => {
  beforeEach(() => {
    setReducedMotion(false);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when action.amount is missing (no animation)", () => {
    const { container } = render(
      <DamageAnimation action={makeAction("damage", { amount: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the damage up to the full amount and lands on the final value", () => {
    const action = makeAction("damage", { amount: 10 });
    const { container } = render(<DamageAnimation action={action} />);
    // Count-up uses setInterval(_, 30ms) with 10 steps, so 10*30 = 300ms.
    // 300ms also lines up with the appear -> float transition.
    act(() => {
      jest.advanceTimersByTime(300);
    });
    // The display should have reached the full amount (-10).
    expect(container.textContent).toContain("-10");
  });

  it("uses the target-specific color (lifelink, deathtouch, trample, default)", () => {
    const cases: Array<[CombatAction["type"], string]> = [
      ["lifelink", "text-green-400"],
      ["deathtouch", "text-purple-400"],
      ["trample", "text-orange-400"],
      ["damage", "text-red-400"],
    ];
    for (const [type, color] of cases) {
      const { container } = render(
        <DamageAnimation action={makeAction(type, { amount: 4 })} />,
      );
      act(() => {
        jest.advanceTimersByTime(50); // appear
      });
      const damageNumber = container.querySelector(".text-5xl");
      expect(damageNumber).toBeTruthy();
      expect(damageNumber?.className).toContain(color);
    }
  });

  it("fires onComplete after the fade-out window", () => {
    const onComplete = jest.fn();
    const action = makeAction("damage", { amount: 5 });
    render(<DamageAnimation action={action} onComplete={onComplete} />);
    // 1500ms total. Advance through count-up, appear, float, fade, complete.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(onComplete).toHaveBeenCalledWith(action.id);
  });

  it("renders the target name under the damage number when provided", () => {
    const action = makeAction("damage", {
      amount: 7,
      targetName: "Serra Angel",
    });
    const { container } = render(<DamageAnimation action={action} />);
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(container.textContent).toContain("Serra Angel");
  });

  it("skips count-up under prefers-reduced-motion and shows the full amount (#1103)", () => {
    setReducedMotion(true);
    const onComplete = jest.fn();
    const action = makeAction("damage", { amount: 12 });
    const { container } = render(
      <DamageAnimation action={action} onComplete={onComplete} />,
    );
    // #1103: full amount shown immediately.
    expect(container.textContent).toContain("-12");
    // No motion classes.
    const motion = container.querySelector(".transition-all");
    expect(motion).toBeNull();
    const bounce = container.querySelector(".animate-bounce");
    expect(bounce).toBeNull();
    // No decorative ping impact bubble.
    const ping = container.querySelector(".animate-ping");
    expect(ping).toBeNull();
    // No text-shadow on the damage number under reduced motion.
    const damage = container.querySelector(".text-5xl");
    expect(damage?.className).not.toContain("animate-pulse");

    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(onComplete).toHaveBeenCalledWith(action.id);
  });
});

// ---------------------------------------------------------------------------
// CombatAnimation — routing
// ---------------------------------------------------------------------------

describe("CombatAnimation (router)", () => {
  beforeEach(() => {
    setReducedMotion(false);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["attack", "attacking!"],
    ["first-strike", "attacking!"],
    ["double-strike", "attacking!"],
    ["block", "blocking"],
  ] as const)("routes %s to the matching indicator", (type, hint) => {
    const action = makeAction(type);
    const { container } = render(<CombatAnimation action={action} />);
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(container.textContent).toContain(hint);
  });

  it.each([
    ["damage"],
    ["lifelink"],
    ["trample"],
    ["deathtouch"],
  ] as const)("routes %s to the damage indicator", (type) => {
    const action = makeAction(type, { amount: 6 });
    const { container } = render(<CombatAnimation action={action} />);
    // Wait through the count-up (10 × 30ms = 300ms) so the display lands
    // on the final amount.
    act(() => {
      jest.advanceTimersByTime(350);
    });
    expect(container.textContent).toContain("-6");
  });

  it("renders nothing for unknown action types", () => {
    // 'remove-from-combat' is in the union but the router's switch has no
    // case for it — it should fall through to the default `return null`.
    const { container } = render(
      <CombatAnimation action={makeAction("remove-from-combat")} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// CombatAnimations — overlay
// ---------------------------------------------------------------------------

describe("CombatAnimations (overlay)", () => {
  beforeEach(() => {
    setReducedMotion(false);
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders one indicator per action and routes the right type to each", () => {
    const attack = makeAction("attack");
    const block = makeAction("block");
    const damage = makeAction("damage", { amount: 4 });
    const { container } = render(
      <CombatAnimations
        actions={[attack, block, damage]}
        onActionComplete={() => {}}
      />,
    );
    // Drive past attack windup + block raise + damage count-up.
    act(() => {
      jest.advanceTimersByTime(350);
    });
    // attack + block + damage indicators all present.
    expect(container.textContent).toContain("attacking!");
    expect(container.textContent).toContain("blocking");
    expect(container.textContent).toContain("-4");
  });

  it("calls onActionComplete with the id of each action as it finishes", () => {
    const onActionComplete = jest.fn();
    const actions: CombatAction[] = [
      makeAction("attack", { id: "a-1" }),
      makeAction("block", { id: "b-1" }),
    ];
    render(
      <CombatAnimations
        actions={actions}
        onActionComplete={onActionComplete}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onActionComplete).toHaveBeenCalledWith("a-1");
    expect(onActionComplete).toHaveBeenCalledWith("b-1");
  });

  it("applies a className passthrough to the overlay root", () => {
    const { container } = render(
      <CombatAnimations actions={[]} className="extra-class" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("extra-class");
    expect(root.className).toContain("pointer-events-none");
  });
});

// ---------------------------------------------------------------------------
// useCombatActions — hook
// ---------------------------------------------------------------------------

function HookHarness({
  onReady,
  options,
}: {
  onReady: (api: ReturnType<typeof useCombatActions>) => void;
  options?: { maxActions?: number };
}) {
  const api = useCombatActions(options);
  // Expose to the test on first render.
  if ((api as unknown as { _ready?: boolean })._ready !== true) {
    (api as unknown as { _ready?: boolean })._ready = true;
    onReady(api);
  }
  return null;
}

describe("useCombatActions", () => {
  it("starts with no actions", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    expect(captured!.actions).toEqual([]);
  });

  it("triggerAttack appends an attack action with source/target info", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    act(() => {
      captured!.triggerAttack("src-1", "Goblin Guide", "tgt-1", "Llanowar Elf");
    });
    expect(captured!.actions).toHaveLength(1);
    expect(captured!.actions[0]).toMatchObject({
      type: "attack",
      sourceId: "src-1",
      sourceName: "Goblin Guide",
      targetId: "tgt-1",
      targetName: "Llanowar Elf",
    });
    expect(typeof captured!.actions[0].id).toBe("string");
    expect(typeof captured!.actions[0].timestamp).toBe("number");
  });

  it("triggerAttack with isFirstStrike=true uses the 'first-strike' type", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    act(() => {
      captured!.triggerAttack("src-1", "Goblin Guide", undefined, undefined, true);
    });
    expect(captured!.actions[0]?.type).toBe("first-strike");
  });

  it("triggerBlock / triggerDamage / triggerLifelink / triggerTrample / triggerDeathtouch all append", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    act(() => {
      captured!.triggerBlock("b-1", "Squire", "a-1");
    });
    act(() => {
      captured!.triggerDamage("s-1", "Goblin", 3, "t-1", "Elf");
    });
    act(() => {
      captured!.triggerLifelink("s-2", "Healer", 2);
    });
    act(() => {
      captured!.triggerTrample("s-3", "Rhino", 5, "t-2", "Bear");
    });
    act(() => {
      captured!.triggerDeathtouch("s-4", "Wraith", "t-3", "Wall");
    });
    const types = captured!.actions.map((a) => a.type);
    expect(types).toEqual([
      "block",
      "damage",
      "lifelink",
      "trample",
      "deathtouch",
    ]);
    expect(captured!.actions[1]?.amount).toBe(3);
    expect(captured!.actions[2]?.amount).toBe(2);
  });

  it("caps the action history at maxActions", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        options={{ maxActions: 2 }}
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    act(() => {
      captured!.triggerAttack("a", "A");
      captured!.triggerAttack("b", "B");
      captured!.triggerAttack("c", "C");
      captured!.triggerAttack("d", "D");
    });
    expect(captured!.actions).toHaveLength(2);
    // The two most recent — drop the oldest when over capacity.
    expect(captured!.actions.map((a) => a.sourceName)).toEqual(["C", "D"]);
  });

  it("clearActions empties the action list", () => {
    let captured: ReturnType<typeof useCombatActions> | null = null;
    render(
      <HookHarness
        onReady={(api) => {
          captured = api;
        }}
      />,
    );
    act(() => {
      captured!.triggerAttack("a", "A");
    });
    expect(captured!.actions).toHaveLength(1);
    act(() => {
      captured!.clearActions();
    });
    expect(captured!.actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CombatCard
// ---------------------------------------------------------------------------

describe("CombatCard", () => {
  it("renders the card name and P/T", () => {
    const { container } = render(
      <CombatCard
        cardId="c-1"
        cardName="Goblin Guide"
        power={2}
        toughness={2}
      />,
    );
    expect(screen.getByText("Goblin Guide")).toBeInTheDocument();
    // power and toughness both render "2" — verify both are present.
    const twos = container.querySelectorAll(".font-bold");
    const powerToughness = Array.from(twos).map((el) => el.textContent);
    expect(powerToughness).toEqual(["2", "2"]);
    expect(screen.getByText("/")).toBeInTheDocument();
  });

  it("tints the power green when it exceeds toughness, red otherwise", () => {
    const { rerender } = render(
      <CombatCard cardId="c" cardName="X" power={5} toughness={2} />,
    );
    let power = screen.getByText("5");
    expect(power.className).toContain("text-green-500");

    rerender(<CombatCard cardId="c" cardName="X" power={1} toughness={2} />);
    power = screen.getByText("1");
    expect(power.className).toContain("text-red-500");
  });

  it("calls onTap when the card is clicked", () => {
    const onTap = jest.fn();
    render(
      <CombatCard cardId="c-1" cardName="G" power={1} toughness={1} onTap={onTap} />,
    );
    fireEvent.click(screen.getByText("G"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("shows attack / block / blocked-by indicators when those flags are set", () => {
    const { container } = render(
      <CombatCard
        cardId="c"
        cardName="Knight"
        power={3}
        toughness={3}
        isAttacking
        isBlocking
        blockedBy={["b1", "b2"]}
      />,
    );
    // Attack icon (⚔️) + block icon (🛡️) + blocked-by badge text.
    expect(container.textContent).toContain("⚔️");
    expect(container.textContent).toContain("🛡️");
    expect(container.textContent).toContain("Blocked by 2");
  });

  it("toggles the tap rotation class when isTapped", () => {
    const { container } = render(
      <CombatCard cardId="c" cardName="X" power={1} toughness={1} isTapped />,
    );
    expect(container.firstElementChild?.className).toContain("rotate-90");
  });

  it("renders ability indicators (first strike, double strike, deathtouch, trample)", () => {
    const { container } = render(
      <CombatCard
        cardId="c"
        cardName="A"
        power={1}
        toughness={1}
        hasFirstStrike
        hasDoubleStrike
        hasDeathtouch
        hasTrample
      />,
    );
    expect(container.textContent).toContain("⚡");
    expect(container.textContent).toContain("⚡⚡");
    expect(container.textContent).toContain("💀");
    expect(container.textContent).toContain("🐘");
  });
});

// ---------------------------------------------------------------------------
// CombatPhaseIndicator
// ---------------------------------------------------------------------------

describe("CombatPhaseIndicator", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["declare-attackers", "Declare Attackers", "⚔️"],
    ["declare-blockers", "Declare Blockers", "🛡️"],
    ["first-strike", "First Strike Damage", "⚡"],
    ["combat-damage", "Combat Damage", "💥"],
    ["end", "End of Combat", "✅"],
  ] as const)("renders the %s phase", (phase, text, icon) => {
    render(<CombatPhaseIndicator phase={phase} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(icon)).toBeInTheDocument();
  });

  it("auto-hides after 2 seconds", () => {
    const { container } = render(
      <CombatPhaseIndicator phase="declare-attackers" />,
    );
    expect(container.textContent).toContain("Declare Attackers");
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("resets the visibility timer when the phase prop changes", () => {
    const { rerender, container } = render(
      <CombatPhaseIndicator phase="declare-attackers" />,
    );
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    // Still visible, but 500ms away from auto-hide.
    expect(container.textContent).toContain("Declare Attackers");

    rerender(<CombatPhaseIndicator phase="combat-damage" />);
    // After rerender the timer restarts; we should still see content.
    expect(container.textContent).toContain("Combat Damage");

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    // 1500ms after the rerender — still inside the 2s window.
    expect(container.textContent).toContain("Combat Damage");

    act(() => {
      jest.advanceTimersByTime(600);
    });
    // Now 2100ms after the rerender — auto-hidden.
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// CombatDeclaration
// ---------------------------------------------------------------------------

describe("CombatDeclaration", () => {
  const attackers = [
    { id: "a1", name: "Goblin Guide", power: 2 },
    { id: "a2", name: "Champion", power: 3 },
  ];
  const blockers = [
    { id: "b1", name: "Squire", power: 1, toughness: 2 },
    { id: "b2", name: "Wall", power: 0, toughness: 5 },
  ];

  it("declares attackers and confirms when in declare-attackers phase", () => {
    const onDeclareAttacker = jest.fn();
    const onConfirmAttackers = jest.fn();
    render(
      <CombatDeclaration
        attackers={attackers}
        blockers={blockers}
        onDeclareAttacker={onDeclareAttacker}
        onDeclareBlocker={() => {}}
        onConfirmAttackers={onConfirmAttackers}
        phase="declare-attackers"
      />,
    );
    expect(screen.getByText(/Declare Attackers/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Goblin Guide/ }));
    expect(onDeclareAttacker).toHaveBeenCalledWith("a1");

    fireEvent.click(screen.getByRole("button", { name: /Confirm Attackers/ }));
    expect(onConfirmAttackers).toHaveBeenCalledTimes(1);
  });

  it("gates blocker declarations on a selected attacker (declare-blockers phase)", () => {
    const onDeclareBlocker = jest.fn();
    const onConfirmBlockers = jest.fn();
    render(
      <CombatDeclaration
        attackers={attackers}
        blockers={blockers}
        onDeclareAttacker={() => {}}
        onDeclareBlocker={onDeclareBlocker}
        onConfirmBlockers={onConfirmBlockers}
        phase="declare-blockers"
      />,
    );

    // Blocker buttons should be disabled until an attacker is selected.
    const blockerButtons = screen
      .getAllByRole("button")
      .filter((b) => /Squire|Wall/.test(b.textContent ?? ""));
    blockerButtons.forEach((b) => expect(b).toBeDisabled());

    // Select an attacker first.
    fireEvent.click(screen.getByRole("button", { name: /Goblin Guide/ }));
    blockerButtons.forEach((b) => expect(b).not.toBeDisabled());

    // Now click a blocker; it should fire onDeclareBlocker with (blockerId, attackerId).
    fireEvent.click(screen.getByRole("button", { name: /Squire/ }));
    expect(onDeclareBlocker).toHaveBeenCalledWith("b1", "a1");

    // Confirm blockers.
    fireEvent.click(screen.getByRole("button", { name: /Confirm Blockers/ }));
    expect(onConfirmBlockers).toHaveBeenCalledTimes(1);
  });

  it("highlights the selected attacker visually", () => {
    const { container } = render(
      <CombatDeclaration
        attackers={attackers}
        blockers={blockers}
        onDeclareAttacker={() => {}}
        onDeclareBlocker={() => {}}
        phase="declare-blockers"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Champion/ }));
    // Selected attacker gets the red-500/20 highlight class.
    const championBtn = screen.getByRole("button", { name: /Champion/ });
    expect(championBtn.className).toContain("border-red-500");
    expect(championBtn.className).toContain("bg-red-500/20");
    // Goblin Guide should NOT be highlighted.
    const goblinBtn = screen.getByRole("button", { name: /Goblin Guide/ });
    expect(goblinBtn.className).not.toContain("bg-red-500/20");
    // Suppress unused var lint.
    expect(container).toBeInTheDocument();
  });
});
