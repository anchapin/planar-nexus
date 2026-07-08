/**
 * AI Telegraph Display (issue #993)
 *
 * A small, non-intrusive, dismissible surface that shows the beginner-friendly
 * "AI thought" coaching lines the telegraph system generates for the AI's
 * decisions. Verbosity is difficulty-gated upstream (easy = detailed coaching,
 * expert = silent), so at expert difficulty the parent simply feeds no entries
 * and this panel renders nothing.
 *
 * Accessibility:
 *   - The live region uses `role="status"` + `aria-live="polite"` so screen
 *     readers announce new coach lines without stealing focus.
 *   - Each entry has an accessible dismiss button (`aria-label`), and the panel
 *     exposes a labeled "Clear all" control.
 *   - The panel is keyboard-operable (buttons are real <button>s) and hides
 *     itself entirely from assistive tech when empty (`aria-hidden`).
 *
 * It is deliberately self-contained and presentational: the parent owns the
 * entry list (fed from the AI turn loop's `onCommentary` callback) and the
 * dismiss/clear handlers, so it can be unit-tested in isolation and reused
 * across game surfaces.
 */

"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Sparkles, EyeOff } from "lucide-react";

/**
 * One coach line surfaced to the player. `id` is the caller's stable key (used
 * for React keys and targeted dismiss); `turn` is shown as light context.
 */
export interface TelegraphEntry {
  id: string;
  text: string;
  turn?: number;
}

export interface AiTelegraphDisplayProps {
  /** Coach entries to show. Empty list → panel renders nothing. */
  entries: TelegraphEntry[];
  /** Remove a single entry by id. */
  onDismiss?: (id: string) => void;
  /** Remove every entry at once. */
  onClear?: () => void;
  /** Optional className override for layout integration. */
  className?: string;
}

/**
 * Dismissible, accessible AI-coach panel.
 *
 * Returns `null` (nothing in the DOM) when there are no entries, so the game
 * board stays uncluttered for experienced players or after everything is
 * dismissed.
 */
export function AiTelegraphDisplay({
  entries,
  onDismiss,
  onClear,
  className,
}: AiTelegraphDisplayProps) {
  const handleDismiss = useCallback(
    (id: string) => {
      onDismiss?.(id);
    },
    [onDismiss],
  );

  if (entries.length === 0) return null;

  return (
    <Card
      // role=status + aria-live=polite: SR users hear new coach lines as they
      // arrive, without focus theft. aria-hidden=false is the default but kept
      // explicit to document intent (the empty branch returns null above).
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-hidden={false}
      aria-label="AI coach tips"
      data-testid="ai-telegraph-display"
      className={`w-full max-w-sm border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/30 p-3 shadow-xs ${className ?? ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-amber-600" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            AI thinking
          </span>
        </div>
        {onClear && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onClear}
            aria-label="Dismiss all AI coach tips"
          >
            <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>

      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-testid="ai-telegraph-entry"
            className="flex items-start justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5"
          >
            <div className="flex min-w-0 items-start gap-1.5">
              {entry.turn !== undefined && (
                <Badge
                  variant="outline"
                  className="mt-0.5 shrink-0 text-[10px] font-normal text-muted-foreground"
                >
                  T{entry.turn}
                </Badge>
              )}
              <span className="text-sm leading-snug text-foreground">
                {entry.text}
              </span>
            </div>
            {onDismiss && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={() => handleDismiss(entry.id)}
                aria-label={`Dismiss tip: ${entry.text}`}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default AiTelegraphDisplay;
