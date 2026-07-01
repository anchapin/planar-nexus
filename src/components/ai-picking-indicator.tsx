/**
 * AI Picking Indicator Component
 *
 * Shows visual feedback when AI is picking cards in draft mode.
 * NEIB-05: Visual indicator shows when AI neighbor is actively picking
 *
 * Accessibility (#1269): the picking/idle states must be perceivable under
 * forced-colors / Windows High Contrast Mode. The container carries a
 * dedicated `border` (replaced by the global `forced-colors` block in
 * `globals.css` with `Highlight`) and a `data-state` attribute so the active
 * state is distinguishable without relying on translucent amber gradients or
 * the loader spin.
 */

"use client";

import { Loader2, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface AiPickingIndicatorProps {
  /** Is the AI currently picking */
  isPicking: boolean;
  /** AI difficulty level */
  difficulty?: "easy" | "medium";
  /** Additional class names */
  className?: string;
}

/**
 * Visual indicator showing AI picking state
 * - Shows spinning loader when AI is picking
 * - Shows static bot icon when AI is waiting
 */
export function AiPickingIndicator({
  isPicking,
  difficulty = "medium",
  className,
}: AiPickingIndicatorProps) {
  return (
    <div
      data-testid="ai-picking-indicator"
      data-state={isPicking ? "picking" : "idle"}
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
          <span className="text-sm font-medium">AI Picking...</span>
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
}: {
  isPicking: boolean;
  poolSize?: number;
  difficulty?: "easy" | "medium";
}) {
  return (
    <span
      data-testid="ai-picking-badge"
      data-state={isPicking ? "picking" : "idle"}
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
          <span>🤖 Picking...</span>
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
