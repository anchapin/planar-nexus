"use client";

import { memo } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CardInstance } from "@/lib/game-state";
import type { ZoneType } from "@/types/game";

/**
 * Issue #2418 (SLICE 4) — the "zone viewer" dialog of the single-player board.
 *
 * This is the modal `GameBoardContent` shows when the player inspects a
 * hidden zone (opponent's hand, a library, an exile pile, …): it lists the
 * cards of the zone as a grid of card frames and tells whose zone it is.
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * values below plus the stable close callback.
 */

export interface ZoneViewerDialogProps {
  /** Whether the dialog is open (i.e. a zone is being inspected). */
  isOpen: boolean;
  /** The inspected zone, `undefined` while no zone is being inspected. */
  zone?: ZoneType;
  /** The cards of the inspected zone, `undefined` while none is inspected. */
  cards?: CardInstance[];
  /** Whether the inspected zone belongs to the local player. */
  isLocalPlayerZone: boolean;
  /** Closes the dialog (the parent clears the inspected zone). */
  onClose: () => void;
}

export const ZoneViewerDialog = memo(function ZoneViewerDialog({
  isOpen,
  zone,
  cards,
  isLocalPlayerZone,
  onClose,
}: ZoneViewerDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {isLocalPlayerZone ? "Your" : "Opponent's"} {zone}
          </DialogTitle>
          <DialogDescription>{cards?.length || 0} cards</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 py-4">
          {cards?.map((card) => (
            <div
              key={card.id}
              className="relative aspect-[5/7] rounded-lg overflow-hidden shadow-md bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30"
            >
              {card.cardData.image_uris?.normal ? (
                <Image
                  src={card.cardData.image_uris.normal}
                  alt={card.cardData.name}
                  fill
                  sizes="120px"
                  className="object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center p-2">
                  <p className="text-center text-xs font-medium line-clamp-3">
                    {card.cardData.name}
                  </p>
                  {card.cardData.mana_cost && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {card.cardData.mana_cost}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          {(cards?.length || 0) === 0 && (
            <p className="col-span-full text-center text-muted-foreground text-sm py-8">
              No cards in {zone}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
