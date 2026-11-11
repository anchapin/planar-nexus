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
 * Issue #2418 (SLICE 9) — the "kicker option" dialog of the single-player
 * board.
 *
 * This is the modal `GameBoardContent` shows when the player casts a spell
 * with an optional additional "kicker" cost (e.g. "Burst Lightning"): the
 * player either pays the kicker or casts the spell normally.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable callbacks, so this component stays a dumb,
 * presentational leaf.
 */

export interface KickerDialogProps {
  /** Whether the dialog is open (i.e. a choice is pending). */
  isOpen: boolean;
  /** Closes the dialog (the parent clears the pending choice). */
  onClose: () => void;
  /** Name of the card the choice belongs to. */
  cardName: string;
  /** Description of the kicker cost; falls back to a generic wording. */
  description: string;
  /** Called with `true` to cast with kicker, `false` to cast normally. */
  onSelect: (withKicker: boolean) => void;
}

export const KickerDialog = memo(function KickerDialog({
  isOpen,
  onClose,
  cardName,
  description,
  onSelect,
}: KickerDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kicker Option</DialogTitle>
          <DialogDescription>
            {cardName} has an optional kicker cost.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button
            variant="outline"
            onClick={() => onSelect(false)}
            className="justify-start h-auto py-3 px-4"
          >
            <div className="text-left">
              <div className="font-medium">Cast without kicker</div>
              <div className="text-xs text-muted-foreground">
                Pay only the base mana cost
              </div>
            </div>
          </Button>
          <Button
            variant="default"
            onClick={() => onSelect(true)}
            className="justify-start h-auto py-3 px-4"
          >
            <div className="text-left">
              <div className="font-medium">Cast with kicker</div>
              <div className="text-xs text-muted-foreground">
                {description || "Pay extra cost for additional effect"}
              </div>
            </div>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
