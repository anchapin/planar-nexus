"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Issue #2418 (SLICE 7) — the "mana ability choice" dialog of the single-player
 * board.
 *
 * This is the modal `GameBoardContent` shows when a land (or another mana
 * producing permanent) can produce more than one colour of mana and the player
 * has to pick one (e.g. "Multiverse Elixir", "Reflecting Pool").
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks. The mana pools are pre-formatted by
 * the parent so this component stays a dumb, presentational leaf.
 */

/** A single choice of the dialog: which mana to produce. */
export interface ManaAbilityOptionView {
  /** Human readable description of the choice (e.g. "Tap: Add {U}"). */
  description: string;
  /** The mana the choice adds, already formatted (e.g. "2U"). */
  manaText: string;
}

export interface ManaAbilityDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choices belong to. */
  cardName: string;
  /** The choices to offer, one button each. */
  options: ManaAbilityOptionView[];
  /** Called with the index of the picked choice. */
  onSelect: (index: number) => void;
}

export const ManaAbilityDialog = memo(function ManaAbilityDialog({
  isOpen,
  onClose,
  cardName,
  options,
  onSelect,
}: ManaAbilityDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose Mana</DialogTitle>
          <DialogDescription>
            {cardName} can produce different colors of mana. Choose one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          {options.map((option, idx) => (
            <Button
              key={idx}
              variant="outline"
              onClick={() => onSelect(idx)}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{option.description}</div>
                <div className="text-xs text-muted-foreground">
                  Add {option.manaText} to your mana pool
                </div>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
