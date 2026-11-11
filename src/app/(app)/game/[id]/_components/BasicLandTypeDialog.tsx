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
import type { BasicLandTypeOptionView } from "./basic-land-type-options";

/**
 * Issue #2418 (SLICE 8) — the "choose a basic land type" dialog of the
 * single-player board.
 *
 * This is the modal `GameBoardContent` shows when a land the player is about
 * to play asks them to pick which of the five basic land types it becomes
 * (e.g. "Choose a basic land type").
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks. The land options are pre-formatted
 * by the parent so this component stays a dumb, presentational leaf.
 */

/**
 * The basic land type options live in their own module (issue #2903) so the
 * board can import them without pulling this dialog into the route's
 * first-load payload — the dialog itself is loaded lazily via `next/dynamic`.
 */
export {
  BASIC_LAND_TYPE_OPTIONS,
  type BasicLandTypeOptionView,
} from "./basic-land-type-options";

export interface BasicLandTypeDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choice belongs to. */
  cardName: string;
  /** The basic land types to offer, one button each. */
  options: BasicLandTypeOptionView[];
  /** Called with the picked basic land type. */
  onSelect: (landType: string) => void;
}

export const BasicLandTypeDialog = memo(function BasicLandTypeDialog({
  isOpen,
  onClose,
  cardName,
  options,
  onSelect,
}: BasicLandTypeDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose Basic Land Type</DialogTitle>
          <DialogDescription>
            {cardName} allows you to choose a basic land type. Select one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 py-4">
          {options.map((option) => (
            <Button
              key={option.name}
              variant="outline"
              onClick={() => onSelect(option.name)}
              className="justify-start h-auto py-3 px-4"
            >
              <div className="text-left">
                <div className="font-medium">{option.name}</div>
                <div className="text-xs text-muted-foreground">
                  {option.description}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
});
