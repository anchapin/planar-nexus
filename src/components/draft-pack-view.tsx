/**
 * Draft Pack View Component
 *
 * Displays the current pack during drafting.
 * DRFT-03: Shows face-down cards until pack is opened
 * DRFT-04: Shows face-up cards for picking once opened
 *
 * Phase 15: Draft Core
 */

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FaceDownCard, DraftCard } from "./face-down-card";
import type { DraftPack, DraftCard as DraftCardType } from "@/lib/limited/types";

// ============================================================================
// Types
// ============================================================================

export interface DraftPackViewProps {
  /** Current pack to display */
  pack: DraftPack;
  /** Which pick we're on (0-13) */
  currentPickIndex: number;
  /** Called when user clicks a card to pick it */
  onCardClick: (cardId: string) => void;
  /** Called when user hovers over a card (DRFT-08) */
  onCardHover: (cardId: string | null) => void;
  /** Called when user clicks a face-down card to open pack */
  onOpenPack: () => void;
  /** Optional className */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DraftPackView - Shows cards face-down or face-up for picking
 *
 * DRFT-03: Initially shows 14 face-down cards
 * DRFT-04: After opening, shows cards for picking
 */
export function DraftPackView({
  pack,
  currentPickIndex,
  onCardClick,
  onCardHover,
  onOpenPack,
  className,
}: DraftPackViewProps) {
  // Check if pack is opened
  const isOpened = pack.isOpened;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Pack Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Current Pack</h2>
        <PickIndicator
          currentPick={currentPickIndex + 1}
          totalPicks={14}
          isOpened={isOpened}
        />
      </div>

      {/* Cards Grid */}
      <div
        className={cn(
          "grid gap-3",
          "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7",
          "justify-items-center"
        )}
      >
        {isOpened ? (
          // Show face-up cards for picking
          pack.cards.map((card) => (
            <DraftCard
              key={card.id}
              card={card as DraftCardType}
              onClick={() => onCardClick(card.id)}
              onHover={() => onCardHover(card.id)}
              onHoverEnd={() => onCardHover(null)}
              isPicked={pack.pickedCardIds.includes(card.id)}
            />
          ))
        ) : (
          // Show face-down cards
          pack.cards.map((card) => (
            <FaceDownCard
              key={card.id}
              onClick={onOpenPack}
              isDisabled={false}
            />
          ))
        )}
      </div>

      {/* Open Pack Prompt */}
      {!isOpened && (
        <div className="text-center py-4">
          <p className="text-muted-foreground mb-2">
            Click any card to open this pack
          </p>
          <p className="text-xs text-muted-foreground">
            {14} cards await inside
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Pick Indicator
// ============================================================================

interface PickIndicatorProps {
  currentPick: number;
  totalPicks: number;
  isOpened: boolean;
}

function PickIndicator({
  currentPick,
  totalPicks,
  isOpened,
}: PickIndicatorProps) {
  if (!isOpened) {
    return (
      <Badge variant="secondary" className="text-sm">
        {totalPicks} cards
      </Badge>
    );
  }

  return (
    <Badge
      variant={currentPick > totalPicks ? "default" : "secondary"}
      className={cn(
        "text-sm",
        currentPick <= totalPicks && "bg-primary"
      )}
    >
      Pick {currentPick} of {totalPicks}
    </Badge>
  );
}

// ============================================================================
// Exports
// ============================================================================
