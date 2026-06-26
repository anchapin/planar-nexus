import { render } from "@testing-library/react";
import { DamageIndicator, type DamageEvent } from "../damage-indicator";

/**
 * Sets the global `window.matchMedia` implementation so the
 * `usePrefersReducedMotion` hook reports the requested preference. The hook
 * subscribes via `addEventListener`, so the stub records listeners and the
 * initial `.matches` value drives the first effect.
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
      addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) =>
        listeners.push(cb),
      removeEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      addListener: (cb: (event: { matches: boolean }) => void) => listeners.push(cb),
      removeListener: (cb: (event: { matches: boolean }) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      dispatchEvent: () => true,
    })),
  });
}

const event: DamageEvent = {
  id: "dmg-1",
  amount: 5,
  type: "combat",
  targetId: "t1",
  sourceName: "Goblin",
  timestamp: 0,
};

describe("DamageIndicator — prefers-reduced-motion (#1103)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the floating transition when motion is allowed", () => {
    setReducedMotion(false);
    const { container } = render(
      <DamageIndicator event={event} onComplete={() => {}} />,
    );

    const indicator = container.firstElementChild as HTMLElement;
    expect(indicator.className).toContain("transition-all");
    expect(indicator.className).toContain("duration-500");
  });

  it("omits the floating transition and completes without motion when reduced", () => {
    setReducedMotion(true);
    const onComplete = jest.fn();
    const { container } = render(
      <DamageIndicator event={event} onComplete={onComplete} />,
    );

    const indicator = container.firstElementChild as HTMLElement;
    // #1103: no transition / float classes under reduced motion.
    expect(indicator.className).not.toContain("transition-all");
    expect(indicator.className).not.toContain("duration-500");

    // onComplete still fires so the parent can retire the event.
    jest.advanceTimersByTime(1500);
    expect(onComplete).toHaveBeenCalledWith("dmg-1");
  });
});
