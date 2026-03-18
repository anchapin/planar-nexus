/**
 * AI Picking Indicator Component
 * 
 * Shows visual feedback when AI is picking cards in draft mode.
 * NEIB-05: Visual indicator shows when AI neighbor is actively picking
 */

"use client";

import { Loader2, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface AiPickingIndicatorProps {
  /** Is the AI currently picking */
  isPicking: boolean;
  /** AI difficulty level */
  difficulty?: 'easy' | 'medium';
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
  difficulty = 'medium',
  className 
}: AiPickingIndicatorProps) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300",
      isPicking 
        ? "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200" 
        : "bg-muted text-muted-foreground",
      className
    )}>
      {isPicking ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">
            AI Picking...
          </span>
        </>
      ) : (
        <>
          <Bot className="h-4 w-4" />
          <span className="text-sm font-medium">
            AI Neighbor
          </span>
        </>
      )}
      <span className="text-xs opacity-75">
        ({difficulty})
      </span>
    </div>
  );
}

/**
 * Compact version for inline use
 */
export function AiPickingBadge({ 
  isPicking, 
  poolSize = 0,
  difficulty = 'medium' 
}: { 
  isPicking: boolean;
  poolSize?: number;
  difficulty?: 'easy' | 'medium';
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono",
      isPicking 
        ? "bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200" 
        : "bg-secondary text-secondary-foreground"
    )}>
      {isPicking ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>🤖 Picking...</span>
        </>
      ) : (
        <>
          <span>🤖 AI: {poolSize}</span>
        </>
      )}
    </span>
  );
}
