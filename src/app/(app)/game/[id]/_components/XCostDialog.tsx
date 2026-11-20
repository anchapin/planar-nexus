"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Issue #2418 (SLICE 9) — the "choose X value" dialog of the single-player
 * board.
 *
 * This is the modal `GameBoardContent` shows when the player casts a spell
 * with an X in its mana cost (e.g. "Alchemist's Torrent"): the player picks
 * the value of X with a stepper, a few presets or the "cast with" button.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks. The chosen value lives in the
 * parent (so this component stays a dumb, presentational leaf) and every
 * interaction is reported through a callback.
 */

export interface XCostDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choice belongs to. */
  cardName: string;
  /** Description of the spell; falls back to a generic wording when empty. */
  description: string;
  /** The currently selected X value. */
  value: number;
  /** Called with the newly selected X value (stepper / presets). */
  onValueChange: (value: number) => void;
  /** Called with the X value the spell should be cast for. */
  onCast: (value: number) => void;
}

/** The preset X values offered next to the stepper. */
const X_PRESETS: readonly number[] = [0, 1, 2, 3];

export const XCostDialog = memo(function XCostDialog({
  isOpen,
  onClose,
  cardName,
  description,
  value,
  onValueChange,
  onCast,
}: XCostDialogProps) {
  const currentValue = value || 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose X Value</DialogTitle>
          <DialogDescription>
            {description || `Choose a value for ${cardName}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="flex items-center gap-6">
            <Button
              variant="outline"
              size="icon"
              onClick={() => onValueChange(Math.max(0, currentValue - 1))}
              disabled={currentValue <= 0}
            >
              <span className="text-xl">−</span>
            </Button>
            <div className="text-5xl font-bold tabular-nums min-w-[80px] text-center">
              {currentValue}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onValueChange(currentValue + 1)}
            >
              <span className="text-xl">+</span>
            </Button>
          </div>
          <div className="text-sm text-muted-foreground">
            Max: {currentValue}
          </div>
          <div className="flex gap-2 mt-2">
            {X_PRESETS.map((n) => (
              <Button
                key={n}
                variant={currentValue === n ? "default" : "outline"}
                size="sm"
                onClick={() => onValueChange(n)}
                disabled={n > currentValue}
              >
                {n}
              </Button>
            ))}
            {currentValue > 3 && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onCast(currentValue)}
              >
                Cast X={currentValue}
              </Button>
            )}
          </div>
        </div>
        <DialogFooter className="flex-row gap-2 sm:flex-col">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onCast(currentValue)}>
            Cast with X={currentValue}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
