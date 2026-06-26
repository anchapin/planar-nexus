"use client";

import { useEffect, useState } from "react";

/**
 * Media query used by the OS / browser to signal that the user has asked the
 * system to minimize the amount of non-essential motion.
 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reactively tracks the user's `prefers-reduced-motion` OS / browser setting.
 *
 * - SSR-safe: returns `false` on the server and during the first client render
 *   so markup matches the server-rendered output, then re-syncs in an effect.
 * - Reactive: subscribes to media-query changes and re-renders when the user
 *   toggles the preference (or changes device) at runtime.
 * - Defensive: falls back gracefully on environments without `matchMedia`
 *   (older browsers, jsdom without a polyfill).
 *
 * @returns `true` when the user prefers reduced motion, `false` otherwise.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(mql.matches);

    // Sync immediately so the first paint after mount reflects the real value.
    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }

    // Safari < 14 legacy fallback.
    if (typeof (mql as MediaQueryList).addListener === "function") {
      const legacyListener = (event: MediaQueryListEvent) => setReduced(event.matches);
      mql.addListener(legacyListener);
      return () => mql.removeListener(legacyListener);
    }
  }, []);

  return reduced;
}
