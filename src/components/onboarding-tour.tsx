"use client";

/**
 * OnboardingTour — app-wide first-run tour (#1106).
 *
 * Extends the per-tutorial pattern from `game-tutorial.tsx` to the whole app.
 * - Auto-starts on first launch when the `planar-nexus:onboarded` flag is absent.
 * - Dismissible (Skip / Escape / overlay click) and re-triggerable from Settings.
 * - Each step targets an element by a stable `data-tour="..."` attribute.
 * - Keyboard-navigable (Tab cycles within the callout, Enter advances, Escape cancels)
 *   and announced to screen readers (role="dialog" + aria-live announcer).
 * - Reuses existing UI primitives (Card, Button) rather than a tour dependency.
 * - Respects `prefers-reduced-motion` (#1103).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export const ONBOARDING_STORAGE_KEY = "planar-nexus:onboarded";
/** Custom event dispatched to re-trigger the tour from anywhere (e.g. Settings). */
export const START_TOUR_EVENT = "planar-nexus:start-tour";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** CSS selector for the highlighted element, e.g. "[data-tour='decks']". */
  target?: string;
  side?: "top" | "bottom" | "left" | "right" | "center";
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Planar Nexus",
    description:
      "Take a 30-second tour of the essentials. You can skip anytime and restart it later from Settings.",
    side: "center",
  },
  {
    id: "decks",
    title: "Build Your Deck",
    description:
      "The Deck Builder is where you craft and tune decks from a vast card library. Start here after importing or creating a deck.",
    target: "[data-tour='deck-builder']",
    side: "right",
  },
  {
    id: "collection",
    title: "Your Collection",
    description:
      "Browse and manage every card you own. Filter, sort, and track what's available across formats.",
    target: "[data-tour='collection']",
    side: "right",
  },
  {
    id: "coach",
    title: "AI Deck Coach",
    description:
      "Get instant analysis and improvement suggestions for your decks from the built-in AI coach.",
    target: "[data-tour='deck-coach']",
    side: "right",
  },
  {
    id: "play",
    title: "Play Against the AI",
    description:
      "Jump into Single Player to test your deck. Pick an AI opponent difficulty and start a match.",
    target: "[data-tour='single-player']",
    side: "right",
  },
  {
    id: "multiplayer",
    title: "Multiplayer",
    description:
      "Challenge friends in bring-your-own-code multiplayer. Share a game code to start a match.",
    target: "[data-tour='multiplayer']",
    side: "right",
  },
  {
    id: "settings",
    title: "Settings",
    description:
      "Configure card images, sound, auto-save, and privacy. You can restart this tour from here anytime.",
    target: "[data-tour='settings']",
    side: "right",
  },
  {
    id: "done",
    title: "You're All Set",
    description:
      "That's the tour! Build a deck, then jump into Single Player. Need a refresher? Restart the tour from Settings.",
    side: "center",
  },
];

/* ----------------------------- storage helpers ---------------------------- */

export function isOnboarded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function markOnboarded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    /* localStorage may be unavailable (private mode); tour still works in-session. */
  }
}

/** Re-trigger the tour from anywhere. The mounted <OnboardingTour /> listens. */
export function restartOnboardingTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
}

/* ------------------------------- primitives ------------------------------- */

// Reduced-motion awareness comes from the shared `@/hooks/use-prefers-reduced-motion`
// hook (see issue #1103) so every animation component honors the OS preference
// from a single source of truth.

/** Focusable element selector used by the lightweight focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/* ------------------------------- component -------------------------------- */

export function OnboardingTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  const steps = ONBOARDING_STEPS;
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  /* ---- auto-start on first run (after hydration to avoid SSR mismatch) ---- */
  useEffect(() => {
    setHydrated(true);
    if (typeof window === "undefined") return;
    if (!isOnboarded()) {
      const t = window.setTimeout(() => setIsOpen(true), 600);
      return () => window.clearTimeout(t);
    }
  }, []);

  /* ---- listen for restart requests (e.g. from Settings) ---- */
  useEffect(() => {
    const handler = () => {
      setIndex(0);
      setIsOpen(true);
    };
    window.addEventListener(START_TOUR_EVENT, handler);
    return () => window.removeEventListener(START_TOUR_EVENT, handler);
  }, []);

  /* ---- track the highlighted element's position ---- */
  useEffect(() => {
    if (!isOpen) return;

    const update = () => {
      if (!step.target || step.side === "center") {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el) {
        setTargetRect(null);
        return;
      }
      el.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
        inline: "center",
      });
      setTargetRect(el.getBoundingClientRect());
    };

    update();
    // Re-measure shortly after in case layout is still settling.
    const retry = window.setTimeout(update, 320);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, index, step, reduceMotion]);

  /* ---- focus management: focus the callout, restore focus on close ---- */
  const focusCallout = useCallback(() => {
    const node = dialogRef.current;
    if (!node) return;
    const primary = node.querySelector<HTMLElement>("[data-tour-primary]");
    (primary ?? node).focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    prevFocusRef.current =
      (document.activeElement as HTMLElement) || prevFocusRef.current;
    const t = window.setTimeout(focusCallout, reduceMotion ? 0 : 80);
    return () => window.clearTimeout(t);
  }, [isOpen, index, reduceMotion, focusCallout]);

  /* ---- navigation ---- */
  const close = useCallback(() => {
    setIsOpen(false);
    markOnboarded();
    window.requestAnimationFrame(() => {
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    });
  }, []);

  const next = useCallback(() => {
    if (isLast) {
      close();
      return;
    }
    setIndex((i) => i + 1);
  }, [isLast, close]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  /* ---- keyboard: Escape cancels; Tab is trapped within the callout ---- */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowRight" && !isLast) {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === "ArrowLeft" && !isFirst) {
        e.preventDefault();
        prev();
        return;
      }
      if (e.key !== "Tab") return;

      const node = dialogRef.current;
      if (!node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [close, next, prev, isFirst, isLast],
  );

  /* ---- render guards ---- */
  // Nothing to render until hydrated (avoids SSR/CSR markup mismatch).
  if (!hydrated) return null;

  return (
    <>
      {/* SR-only live region: announces each step as it changes. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isOpen
          ? `Step ${index + 1} of ${steps.length}: ${step.title}. ${step.description}`
          : ""}
      </div>

      {!isOpen ? null : (
        <>
          {/* Dimming overlay (click to dismiss). Pointer events only; SR hides it. */}
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={close}
            aria-hidden="true"
          />

          {/* Highlight ring around the target element. */}
          {targetRect && (
            <div
              className={cn(
                "fixed z-50 pointer-events-none rounded-lg border-2 border-primary shadow-[0_0_24px_rgba(99,102,241,0.45)]",
                reduceMotion ? "" : "transition-all duration-200",
              )}
              style={{
                top: targetRect.top - 4,
                left: targetRect.left - 4,
                width: targetRect.width + 8,
                height: targetRect.height + 8,
              }}
              aria-hidden="true"
            />
          )}

          {/* Callout (popover-styled card). */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="onboarding-tour-title"
            aria-describedby="onboarding-tour-desc"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            style={getPopupStyle(step.side, targetRect)}
            className={cn(
              "z-50 w-[min(380px,calc(100vw-2rem))] outline-none",
              reduceMotion ? "" : "transition-all duration-200",
            )}
          >
            <Card className="border-primary/30 shadow-xl">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <CardTitle
                      id="onboarding-tour-title"
                      className="text-base leading-tight"
                    >
                      {step.title}
                    </CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={close}
                    aria-label="Close tour"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
                <CardDescription>
                  Step {index + 1} of {steps.length}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
                <p
                  id="onboarding-tour-desc"
                  className="text-sm text-foreground"
                >
                  {step.description}
                </p>

                {/* Progress dots */}
                <div
                  className="flex items-center justify-center gap-1.5"
                  aria-hidden="true"
                >
                  {steps.map((_, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "h-2 w-2 rounded-full",
                        idx === index
                          ? "bg-primary"
                          : idx < index
                            ? "bg-primary/50"
                            : "bg-muted",
                      )}
                    />
                  ))}
                </div>

                {/* Navigation buttons */}
                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={prev}
                    disabled={isFirst}
                    className="h-8 text-xs"
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Back
                  </Button>

                  <div className="flex items-center gap-2">
                    {!isLast && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={close}
                        className="h-8 text-xs"
                      >
                        Skip tour
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={next}
                      data-tour-primary
                      className="h-8 gap-1 text-xs"
                    >
                      {isLast ? "Get started" : "Next"}
                      {!isLast && (
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* --------------------------- positioning helper --------------------------- */

function getPopupStyle(
  side: OnboardingStep["side"],
  rect: DOMRect | null,
): React.CSSProperties {
  if (!rect || side === "center") {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const padding = 12;
  const width = 380;
  const height = 200;
  let top = 0;
  let left = 0;

  switch (side) {
    case "top":
      top = rect.top - height - padding;
      left = rect.left + rect.width / 2 - width / 2;
      break;
    case "bottom":
      top = rect.bottom + padding;
      left = rect.left + rect.width / 2 - width / 2;
      break;
    case "left":
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.left - width - padding;
      break;
    case "right":
    default:
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.right + padding;
      break;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Clamp into the viewport.
  top = Math.max(padding, Math.min(top, vh - height - padding));
  left = Math.max(padding, Math.min(left, vw - width - padding));

  return { position: "fixed", top, left };
}
