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
 * Issue #2418 (SLICE 9) — the "Attraction" dialog of the single-player board.
 *
 * This is the modal `GameBoardContent` shows when the player casts an
 * Unfinity "Attraction" spell: the die is spun to reveal cards.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks, so this component stays a dumb,
 * presentational leaf.
 */

export interface AttractionDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choice belongs to. */
  cardName: string;
  /** The rolled die value; `0` (or less) means the die was not spun yet. */
  spinResult: number;
  /** The names of the revealed cards (empty until the die was spun). */
  revealedCards: string[];
  /** Called when the player wants to spin the die and cast the spell. */
  onSpinAndCast: () => void;
}

export const AttractionDialog = memo(function AttractionDialog({
  isOpen,
  onClose,
  cardName,
  spinResult,
  revealedCards,
  onSpinAndCast,
}: AttractionDialogProps) {
  const cards = revealedCards ?? [];

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Attraction!</DialogTitle>
          <DialogDescription>
            {cardName} - Spin the die to reveal cards
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-6">
          {spinResult ? (
            <>
              <div className="text-6xl font-bold">{spinResult}</div>
              <div className="text-sm text-muted-foreground">Rolled!</div>
              {cards.length > 0 && (
                <div className="text-sm text-center">
                  <div className="font-medium">Revealed cards:</div>
                  <div className="text-xs text-muted-foreground">
                    {cards.join(", ")}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-4xl">🎲</div>
              <div className="text-sm text-muted-foreground text-center">
                Spin the Attraction die to determine the result
              </div>
            </>
          )}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {!spinResult ? (
            <Button onClick={onSpinAndCast} className="w-full">
              Spin & Cast
            </Button>
          ) : (
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
