/**
 * `<LongTaskProbe>` — issue #1575.
 *
 * Render-once component that subscribes a `LongTaskListener` to the singleton
 * long-task observer for the lifetime of the current route layout. Mounted in
 * `src/app/(app)/layout.tsx` so every top-level App-Router route
 * (dashboard, deck-builder, deck-coach, collection, multiplayer, draft,
 * single-player, …) inherits observability for >50ms main-thread stalls.
 *
 * Why a separate probe component instead of wiring
 * `subscribeLongTask(...)` straight into the layout?
 *   - It guarantees a single subscription per page even though the App
 *     Router re-renders layouts on every navigation.
 *   - It encapsulates the unsubscribe handle so callers don't have to
 *     remember the cleanup contract.
 *   - It exposes a `useLongTaskObserver` hook for pages that want to read
 *     `getLongTaskLog()` inline (e.g. a future "Performance" diagnostics
 *     panel) without re-implementing the mount/unmount dance.
 *
 * SSR-safe: the singleton observer is a no-op when `window` is undefined
 * (see `long-task-observer.ts`), and this component renders nothing, so it
 * costs zero bytes in the server-rendered tree.
 *
 * The component renders `null` — it is intentionally invisible. Its only
 * observable effect is the side-effect of subscribing. Routes that need to
 * surface the data should consume `getLongTaskLog()` from a separate
 * diagnostics component.
 *
 * @example
 * ```tsx
 * // src/app/(app)/layout.tsx
 * export default function AppLayout({ children }) {
 *   return (
 *     <SidebarProvider>
 *       <LongTaskProbe />
 *       {children}
 *     </SidebarProvider>
 *   );
 * }
 * ```
 */

"use client";

import { useEffect } from "react";

import {
  getLongTaskLog,
  recordLongTaskEntry,
  subscribeLongTask,
  type LongTaskEntry,
  type LongTaskLogEntry,
} from "./long-task-observer";

/**
 * Default props for `<LongTaskProbe>`. The component renders nothing and
 * takes no runtime props; the prop bag exists so tests can mount the probe
 * with the same shape callers use in production code.
 */
export interface LongTaskProbeProps {
  /**
   * Optional minimum duration (ms) the probe will accept. Entries with
   * `duration < threshold` are dropped on the floor before they hit the
   * ring buffer. Defaults to the spec-mandated 50 ms (long-task threshold).
   * Issue #1575 asks for `> 50ms` only; this hook leaves the knob
   * available for future tuning (e.g. a stricter `>200ms` budget) without
   * breaking the default behavior.
   */
  thresholdMs?: number;
}

/**
 * Threshold below which a long-task entry is ignored. The browser's
 * Long-Task API already filters to >50ms, but we keep the explicit knob
 * here so tests and future "200ms regression budget" budgets (issue #1575
 * acceptance criterion #5) can tighten the floor without forking the
 * observer.
 */
const DEFAULT_THRESHOLD_MS = 50;

/**
 * Subscribe a single listener for the lifetime of the host component.
 * Returns the unsubscribe handle. SSR-safe — the singleton observer is a
 * no-op without `window`, so the returned handle is effectively a no-op
 * during server render but the call site doesn't need to branch.
 */
export function useLongTaskObserver(options?: { thresholdMs?: number }): void {
  const thresholdMs = options?.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  useEffect(() => {
    // The singleton guard inside `subscribeLongTask` already handles
    // SSR/unsupported runtimes, so we don't have to gate on `typeof
    // window` here. The `useEffect` callback runs only on the client
    // anyway (React skips effects during SSR), but a defensive check
    // costs nothing and makes the SSR-safety contract obvious to readers.
    if (typeof window === "undefined") return;
    const stop = subscribeLongTask((entry: LongTaskEntry) => {
      if (entry.duration < thresholdMs) return;
      recordLongTaskEntry(entry);
    });
    return stop;
  }, [thresholdMs]);
}

/**
 * Read the rolling ring buffer. Returns a defensive snapshot (frozen,
 * chronological, oldest-first) of the entries recorded by the singleton
 * long-task observer. Useful for diagnostics overlays that want to show
 * recent main-thread stalls without re-subscribing.
 */
export function useLongTaskLog(): readonly LongTaskLogEntry[] {
  // Reading a module-level singleton from React doesn't need state —
  // consumers are expected to re-read on demand. We expose a function
  // hook so callers can `setInterval(() => refresh(), 1000)` without
  // each call reconstructing the snapshot themselves.
  return getLongTaskLog();
}

/**
 * Mount-once probe that subscribes to the long-task observer for the
 * lifetime of the host route layout. Renders nothing. See file-level
 * docstring for usage.
 */
export function LongTaskProbe(props: LongTaskProbeProps = {}): null {
  useLongTaskObserver({ thresholdMs: props.thresholdMs });
  return null;
}
