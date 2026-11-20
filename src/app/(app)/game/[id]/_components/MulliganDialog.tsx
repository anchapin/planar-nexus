"use client";

import { memo } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Hand, Info, Shuffle, Sparkles } from "lucide-react";

/**
 * Issue #2418 (SLICE 3) — the "mulligan / opening hand" dialog of the
 * single-player board.
 *
 * This is the modal `GameBoardContent` shows right after the game is created:
 * it lists the opening hand, shows how many mulligans have been taken and
 * offers the two actions of the flow (keep the hand, or mulligan and draw a
 * new one).
 *
 * Extracting it keeps the re-render blast radius of a game-state delta small:
 * the dialog is `React.memo`-wrapped and receives narrow, stable props, so a
 * change to (say) the battlefield no longer re-renders it. The whole
 * `GameState` object is deliberately NOT passed down — only the handful of
 * primitives, the (memoized) hand view and the stable callbacks below.
 */

/** A single card of the opening hand, reduced to what the dialog renders. */
export interface MulliganCardView {
  /** Stable identity of the card instance (used as the React key). */
  id: string;
  /** Card name (also the image alt text). */
  name: string;
  /** Mana cost string, omitted when the card has none. */
  manaCost?: string;
  /** Type line, omitted when unknown. */
  typeLine?: string;
  /** Artwork URL, omitted when the card has no artwork. */
  imageUrl?: string;
}

export interface MulliganDialogProps {
  /** Whether the dialog is open. */
  isOpen: boolean;
  /** Called with the new open state when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** How many mulligans have already been taken (0 = first opening hand). */
  mulliganCount: number;
  /** The opening hand to display. */
  handCards: MulliganCardView[];
  /** Takes a mulligan: shuffles the hand back and draws a new one. */
  onMulligan: () => void;
  /** Keeps the hand and starts the game. */
  onKeepHand: () => void;
}

export const MulliganDialog = memo(function MulliganDialog({
  isOpen,
  onOpenChange,
  mulliganCount,
  handCards,
  onMulligan,
  onKeepHand,
}: MulliganDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hand className="h-5 w-5 text-primary" />
            Opening Hand
            {mulliganCount > 0 && (
              <Badge variant="secondary">Mulligan {mulliganCount}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Review your opening hand. You can keep it or take a mulligan to draw
            a new hand with one fewer card.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {handCards.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Your hand is empty</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
              {handCards.map((card) => (
                <div
                  key={card.id}
                  className="relative aspect-[5/7] rounded-lg border border-border/50 bg-gradient-to-br from-primary/10 to-primary/5 overflow-hidden group cursor-pointer hover:border-primary/50 hover:shadow-xl hover:scale-110 hover:z-10 transition-all duration-200"
                  title={`${card.name}${card.manaCost ? ` — ${card.manaCost}` : ""}`}
                >
                  {card.imageUrl ? (
                    <Image
                      src={card.imageUrl}
                      alt={card.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 140px"
                      className="object-cover rounded-lg"
                      loading="eager"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center">
                      <p className="text-xs font-medium line-clamp-2">
                        {card.name}
                      </p>
                      {card.manaCost && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {card.manaCost}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {card.typeLine}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            {mulliganCount === 0
              ? "First mulligan: draw 6 cards"
              : `Next mulligan: draw ${Math.max(1, 7 - mulliganCount - 1)} cards`}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onMulligan}
              disabled={mulliganCount >= 6}
              className="gap-1"
            >
              <Shuffle className="h-4 w-4" />
              Mulligan
            </Button>
            <Button
              onClick={onKeepHand}
              className="gap-1"
              data-testid="keep-hand-button"
            >
              <CheckCircle2 className="h-4 w-4" />
              Keep Hand
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
