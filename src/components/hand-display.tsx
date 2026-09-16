"use client";

import * as React from "react";
import { memo } from "react";
import { CardState } from "@/types/game";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Hand, SortAsc, Layers, X } from "lucide-react";
import { HandCard, OpponentHandCard } from "@/components/hand-card";

export type HandSortOption = "name" | "manaCost" | "type" | "color";
export type HandDisplayMode = "overlapping" | "spread";

interface HandDisplayProps {
  cards: CardState[];
  isCurrentPlayer: boolean;
  onCardSelect?: (cardIds: string[]) => void;
  onCardClick?: (cardId: string) => void;
  selectedCardIds?: string[];
  className?: string;
}

/**
 * HandDisplay — the local player's hand fan (#1818 render boundary).
 *
 * Memoized with the same discipline as `ZoneDisplay`/`PlayerArea` in
 * `game-board.tsx`: every engine state update (and in P2P multiplayer every
 * inbound game-sync envelope) re-renders the board subtree, but the hand only
 * re-renders when one of its props actually changes — i.e. the `cards` array
 * reference, the selection, or a parent-supplied callback. Per-card children
 * live in `hand-card.tsx` and are memoized independently, so even a hand
 * re-render (e.g. the external selection sync below) only re-renders cards
 * whose props changed.
 *
 * Parents must keep the callback props referentially stable (a `useCallback`
 * around anything closing over state) or the boundary is defeated.
 */
export const HandDisplay = memo(function HandDisplay({
  cards,
  isCurrentPlayer,
  onCardSelect,
  onCardClick,
  selectedCardIds = [],
  className = "",
}: HandDisplayProps) {
  const [sortOption, setSortOption] = React.useState<HandSortOption>("name");
  const [displayMode, setDisplayMode] =
    React.useState<HandDisplayMode>("overlapping");
  const [internalSelection, setInternalSelection] = React.useState<Set<string>>(
    new Set(selectedCardIds),
  );

  // Latest-selection mirror (#1818). `handleCardClick` reads this instead of
  // depending on `internalSelection`, so its identity stays stable across
  // selection toggles — otherwise every click would re-render every card in
  // the fan via a changed callback prop. The ref is only written from event
  // handlers and the external-sync effect below, never during render.
  const selectionRef = React.useRef<Set<string>>(new Set(selectedCardIds));

  // Update internal selection when external selection changes. Returning the
  // previous Set when the content is unchanged makes React bail out — without
  // this the fresh `new Set` on mount would force a second render of the
  // whole hand fan for no visual change (#1818).
  React.useEffect(() => {
    const next = new Set(selectedCardIds);
    selectionRef.current = next;
    setInternalSelection((prev) =>
      prev.size === next.size && [...next].every((id) => prev.has(id))
        ? prev
        : next,
    );
  }, [selectedCardIds]);

  // Sort cards based on current sort option
  const sortedCards = React.useMemo(() => {
    const sorted = [...cards];

    // Define sort functions outside switch to avoid lexical declarations in case blocks
    const sortByName = (a: CardState, b: CardState) =>
      a.card.name.localeCompare(b.card.name);

    const sortByManaCost = (a: CardState, b: CardState) => {
      const cmcA = a.card.cmc ?? 0;
      const cmcB = b.card.cmc ?? 0;
      return cmcA - cmcB;
    };

    const sortByType = (a: CardState, b: CardState) => {
      const typeLineA = a.card.type_line ?? "";
      const typeLineB = b.card.type_line ?? "";
      return typeLineA.localeCompare(typeLineB);
    };

    const sortByColor = (a: CardState, b: CardState) => {
      const colorOrder = ["W", "U", "B", "R", "G"];
      const colorsA = a.card.colors ?? [];
      const colorsB = b.card.colors ?? [];
      const colorIndexA =
        colorsA.length > 0 ? colorOrder.indexOf(colorsA[0]) : 999;
      const colorIndexB =
        colorsB.length > 0 ? colorOrder.indexOf(colorsB[0]) : 999;
      return colorIndexA - colorIndexB;
    };

    sorted.sort((a, b) => {
      switch (sortOption) {
        case "name":
          return sortByName(a, b);
        case "manaCost":
          return sortByManaCost(a, b);
        case "type":
          return sortByType(a, b);
        case "color":
          return sortByColor(a, b);
        default:
          return 0;
      }
    });
    return sorted;
  }, [cards, sortOption]);

  // Stable card-click handler (#1818): reads the selection ref instead of the
  // state so memoized `HandCard` children receive an unchanged callback.
  const handleCardClick = React.useCallback(
    (cardId: string) => {
      if (!isCurrentPlayer) {
        // Opponent's hand - just notify click, don't select
        onCardClick?.(cardId);
        return;
      }

      // Current player's hand - handle selection
      const newSelection = new Set(selectionRef.current);

      if (newSelection.has(cardId)) {
        newSelection.delete(cardId);
      } else {
        newSelection.add(cardId);
      }

      selectionRef.current = newSelection;
      setInternalSelection(newSelection);
      onCardSelect?.(Array.from(newSelection));
      onCardClick?.(cardId);
    },
    [isCurrentPlayer, onCardSelect, onCardClick],
  );

  const handleClearSelection = React.useCallback(() => {
    selectionRef.current = new Set();
    setInternalSelection(selectionRef.current);
    onCardSelect?.([]);
  }, [onCardSelect]);

  // Don't render anything if no cards
  if (cards.length === 0) {
    return (
      <section
        role="region"
        aria-label={isCurrentPlayer ? "Your hand" : "Opponent hand"}
        className={`flex items-center justify-center ${className}`}
      >
        <div className="text-center text-muted-foreground">
          <Hand className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Empty hand</p>
        </div>
      </section>
    );
  }

  const selectedCount = internalSelection.size;

  return (
    <section
      role="region"
      aria-label={isCurrentPlayer ? "Your hand" : "Opponent hand"}
      className={`flex flex-col gap-2 ${className}`}
    >
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Hand className="h-3 w-3" />
            {cards.length} {cards.length === 1 ? "card" : "cards"}
          </Badge>
          {selectedCount > 0 && (
            <Badge variant="default" className="gap-1">
              {selectedCount} selected
            </Badge>
          )}
        </div>

        {isCurrentPlayer && cards.length > 1 && (
          <div className="flex items-center gap-1">
            {/* Sort controls */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 w-11 p-0 md:h-7 md:w-7"
                    aria-label={`Sort hand, currently by ${sortOption}`}
                    onClick={() => {
                      const options: HandSortOption[] = [
                        "name",
                        "manaCost",
                        "type",
                        "color",
                      ];
                      const currentIndex = options.indexOf(sortOption);
                      const nextIndex = (currentIndex + 1) % options.length;
                      setSortOption(options[nextIndex]);
                    }}
                  >
                    <SortAsc className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Sort by: {sortOption}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Display mode toggle */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 w-11 p-0 md:h-7 md:w-7"
                    aria-label={
                      displayMode === "overlapping"
                        ? "Switch to spread layout"
                        : "Switch to overlapping layout"
                    }
                    onClick={() =>
                      setDisplayMode(
                        displayMode === "overlapping"
                          ? "spread"
                          : "overlapping",
                      )
                    }
                  >
                    <Layers className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    Display:{" "}
                    {displayMode === "overlapping" ? "Overlapping" : "Spread"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Clear selection */}
            {selectedCount > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 w-11 p-0 md:h-7 md:w-7"
                      aria-label={`Clear ${selectedCount} selected card${selectedCount === 1 ? "" : "s"}`}
                      onClick={handleClearSelection}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Clear selection</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )}
      </div>

      {/* Card display area — single-row scrollable on mobile */}
      <div
        className={`w-full overflow-x-auto py-12 -my-12 px-2 -mx-2 md:py-12 md:px-8 md:-mx-8 scrollbar-hide ${displayMode === "spread" ? "md:overflow-visible" : ""}`}
      >
        <div
          className={`
            flex gap-2 p-1
            ${displayMode === "overlapping" ? "items-center" : "flex-wrap justify-center"}
          `}
        >
          {sortedCards.map((card) =>
            isCurrentPlayer ? (
              // Show face-up cards for current player
              <HandCard
                key={card.id}
                card={card}
                isSelected={internalSelection.has(card.id)}
                isSelectable={true}
                onCardClick={handleCardClick}
                showManaCost={true}
                showType={true}
              />
            ) : (
              // Show card backs for opponents
              <OpponentHandCard
                key={card.id}
                cardId={card.id}
                onCardClick={onCardClick}
              />
            ),
          )}
        </div>
      </div>
    </section>
  );
});
