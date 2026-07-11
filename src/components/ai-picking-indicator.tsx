/**
 * AI Picking Indicator Component
 *
 * Shows visual feedback when AI is picking cards in draft mode.
 * NEIB-05: Visual indicator shows when AI is actively picking
 *
 * Accessibility (#1269): the picking/idle states must be perceivable under
 * forced-colors / Windows High Contrast Mode. The container carries a
 * dedicated `border` (replaced by the global `forced-colors` block in
 * `globals.css` with `Highlight`) and a `data-state` attribute so the active
 * state is distinguishable without relying on translucent amber gradients or
 * the loader spin.
 *
 * Issue #1245: when the AI worker reports main-thread blocks > 50ms
 * (Long-Task API) we surface a subtle `slowThinking` badge so the user
 * knows the indicator reflects real activity, not a stuck event loop.
 *
 * Issue #1443: the `difficulty` prop now spans the canonical 4-tier union
 * (`'easy' | 'medium' | 'hard' | 'expert'`) instead of the legacy
 * 2-tier set, so the badge can label `'hard'` / `'expert'` sessions.
 */

"use client";

import { Loader2, Bot, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiDifficulty } from "@/lib/limited/types";

interface AiPickingIndicatorProps {
  /** Is the AI currently picking */
  isPicking: boolean;
  /** AI difficulty level */
  difficulty?: AiDifficulty;
  /** Additional class names */
  className?: string;
  /**
   * Surface a subtle "thinking slowly" hint when the AI is still picking
   * but the Long-Task API has reported >3 main-thread blocks >50ms in the
   * last second. Lets the user know the worker is alive, just working hard.
   * No effect when `isPicking` is false.
   * (issue #1245 — Phase 32 non-blocking status indicator)
   */
  slowThinking?: boolean;
}

/**
 * Visual indicator showing AI picking state
 * - Shows spinning loader when AI is picking
 * - Shows static bot icon when AI is waiting
 * - Adds a subtle hourglass + "thinking slowly" hint when Long-Task API
 *   reports >3 main-thread blocks in the last second (#1245).
 */
export function AiPickingIndicator({
  isPicking,
  difficulty = "medium",
  className,
  slowThinking = false,
}: AiPickingIndicatorProps) {
  // The slow-thinking hint only matters while the AI is actively picking.
  // Reading the data-state-driven HCM override off `data-slow` keeps the
  // global `forced-colors` block in `globals.css` in sync with the visible
  // state without forking the styling logic.
  const dataState = isPicking ? (slowThinking ? "slow" : "picking") : "idle";
  return (
    <div
      data-testid="ai-picking-indicator"
      data-state={dataState}
      data-slow={isPicking && slowThinking ? "true" : undefined}
      aria-live={isPicking ? "polite" : undefined}
      // `border` is the HCM-visible affordance — `globals.css` promotes it
      // to Highlight when `forced-colors: active`.
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300 border",
        isPicking
          ? "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border-current"
          : "bg-muted text-muted-foreground border-transparent",
        className,
      )}
    >
      {isPicking ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-sm font-medium">
            {slowThinking ? "AI Thinking Slowly..." : "AI Picking..."}
          </span>
          {slowThinking && (
            <span
              data-testid="ai-picking-slow-badge"
              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-200/60 dark:bg-amber-800/60"
              aria-label="Main thread has been blocked for more than 50ms at least three times in the last second"
            >
              <Hourglass className="h-3 w-3" aria-hidden="true" />
              <span>thinking slowly</span>
            </span>
          )}
        </>
      ) : (
        <>
          <Bot className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">AI Neighbor</span>
        </>
      )}
      <span className="text-xs opacity-75">({difficulty})</span>
    </div>
  );
}

/**
 * Compact version for inline use
 */
export function AiPickingBadge({
  isPicking,
  poolSize = 0,
  difficulty = "medium",
  slowThinking = false,
}: {
  isPicking: boolean;
  poolSize?: number;
  difficulty?: AiDifficulty;
  /**
   * Surface a "thinking slowly" hint when Long-Task API reports a stalled
   * main thread. See `AiPickingIndicator` for the full description
   * (issue #1245).
   */
  slowThinking?: boolean;
}) {
  return (
    <span
      data-testid="ai-picking-badge"
      data-state={isPicking ? "picking" : "idle"}
      data-slow={isPicking && slowThinking ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border",
        isPicking
          ? "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border-current"
          : "bg-secondary text-secondary-foreground border-transparent",
      )}
    >
      {isPicking ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span>🤖 {slowThinking ? "Thinking slowly..." : "Picking..."}</span>
          {slowThinking && (
            <Hourglass
              className="h-3 w-3"
              aria-hidden="true"
              data-testid="ai-picking-slow-badge"
            />
          )}
        </>
      ) : (
        <>
          <span>🤖 AI: {poolSize}</span>
        </>
      )}
      <span className="sr-only">({difficulty})</span>
    </span>
  );
}
