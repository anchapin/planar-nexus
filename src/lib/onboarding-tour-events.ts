/**
 * Leaf module for onboarding-tour cross-triggering (issue #1958).
 *
 * Settings only needs to dispatch the "restart tour" custom event, but the
 * previous direct import of `@/components/onboarding-tour` dragged the whole
 * 500-line tour component (plus its card UI graph) into the /settings eager
 * chunk. The tour component itself is code-split behind `next/dynamic` in
 * the (app) layout, so this module is the single shared definition of the
 * event vocabulary: the lazy tour listens, any page can dispatch.
 */

/** localStorage flag suppressing the tour for already-onboarded visitors. */
export const ONBOARDING_STORAGE_KEY = "planar-nexus:onboarded";

/** Custom event dispatched to re-trigger the tour from anywhere (e.g. Settings). */
export const START_TOUR_EVENT = "planar-nexus:start-tour";

/** Re-trigger the tour from anywhere. The mounted <OnboardingTour /> listens. */
export function restartOnboardingTour(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
}
