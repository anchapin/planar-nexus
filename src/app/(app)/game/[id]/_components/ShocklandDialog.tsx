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
 * Issue #2418 (SLICE 6) — the "Shockland" ETB choice dialog of the
 * single-player board.
 *
 * This is the modal `GameBoardContent` shows when a Shockland enters the
 * battlefield: the card can enter tapped for free, or the player can pay 2
 * life to have it enter untapped.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the card name, the
 * open state and the stable callbacks below.
 */

export interface ShocklandDialogProps {
  /** Whether the dialog is open (i.e. a Shockland ETB choice is pending). */
  isOpen: boolean;
  /** The name of the Shockland that is entering the battlefield. */
  cardName?: string;
  /** Called with the new open state when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Enters the battlefield tapped (no life loss). */
  onEnterTapped: () => void;
  /** Pays 2 life to enter the battlefield untapped. */
  onPayLife: () => void;
}

export const ShocklandDialog = memo(function ShocklandDialog({
  isOpen,
  cardName,
  onOpenChange,
  onEnterTapped,
  onPayLife,
}: ShocklandDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Enter the Battlefield</DialogTitle>
          <DialogDescription>
            {cardName} can enter tapped or you can pay 2 life to have it enter
            untapped.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button
            variant="outline"
            onClick={onEnterTapped}
            className="justify-start h-auto py-3 px-4"
          >
            <div className="text-left">
              <div className="font-medium">Enter Tapped</div>
              <div className="text-xs text-muted-foreground">No life loss</div>
            </div>
          </Button>
          <Button
            variant="outline"
            onClick={onPayLife}
            className="justify-start h-auto py-3 px-4"
          >
            <div className="text-left">
              <div className="font-medium">Pay 2 Life</div>
              <div className="text-xs text-muted-foreground">
                Enters untapped
              </div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});
