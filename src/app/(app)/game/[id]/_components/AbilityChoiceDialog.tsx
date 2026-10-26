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
 * Issue #2418 (SLICE 5) — the "activated ability choice (CR 602)" dialog of
 * the single-player board.
 *
 * This is the modal `GameBoardContent` shows when the player has to pick
 * between activated abilities of a card (or between the hand activations of a
 * card in hand — channel / ninjutsu, #2479). It lists one button per
 * available choice.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks.
 */

/** A single choice of the dialog: which ability to activate. */
export interface AbilityChoiceOption {
  /** Index of the ability on the card (-1 = "cast normally" for hand cards). */
  abilityIndex: number;
  /** Human readable label of the choice (the button text). */
  label: string;
}

export interface AbilityChoiceDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choices belong to. */
  cardName: string;
  /**
   * `true` when the choices come from a card in hand (channel / ninjutsu),
   * `false` when they are the activated abilities of a card on the board.
   */
  isHandActivation: boolean;
  /** The choices to offer, one button each. */
  options: AbilityChoiceOption[];
  /** Called with the picked choice. */
  onSelect: (option: AbilityChoiceOption) => void;
}

export const AbilityChoiceDialog = memo(function AbilityChoiceDialog({
  isOpen,
  onClose,
  cardName,
  isHandActivation,
  options,
  onSelect,
}: AbilityChoiceDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isHandActivation
              ? "Use a card from your hand"
              : "Activate an ability"}
          </DialogTitle>
          <DialogDescription>
            {isHandActivation
              ? `Choose what to do with ${cardName}.`
              : `Choose an ability of ${cardName}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {options.map((o) => (
            <Button
              key={o.abilityIndex}
              variant="outline"
              className="h-auto whitespace-normal text-left"
              onClick={() => onSelect(o)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
