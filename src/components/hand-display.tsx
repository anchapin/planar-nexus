"use client";

import * as React from "react";
import { CardState } from "@/types/game";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Hand,
  SortAsc,
  SortDesc,
  Layers,
  X
} from "lucide-react";
import Image from "next/image";

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

interface CardDisplayProps {
  card: CardState;
  isSelected: boolean;
  isSelectable: boolean;
  onClick: () => void;
  showManaCost?: boolean;
  showType?: boolean;
}

function CardDisplay({
  card,
  isSelected,
  isSelectable,
  onClick,
  showManaCost = true,
  showType = true
}: CardDisplayProps) {
  const { card: scryfallCard } = card;
  const manaCost = scryfallCard.mana_cost || "";
  const typeLine = scryfallCard.type_line || "";
  const colors = scryfallCard.colors || [];

  // Color indicators
  const colorBadges = colors.map((color) => {
    const colorMap: Record<string, { bg: string; text: string }> = {
      W: { bg: "bg-yellow-500/20", text: "W" },
      U: { bg: "bg-blue-500/20", text: "U" },
      B: { bg: "bg-gray-800/40", text: "B" },
      R: { bg: "bg-red-500/20", text: "R" },
      G: { bg: "bg-green-500/20", text: "G" },
    };
    const style = colorMap[color];
    return style ? (
      <Badge
        key={color}
        variant="outline"
        className={`${style.bg} text-xs px-1.5 py-0 h-4 border-${color === 'B' ? 'gray' : color.toLowerCase()}-500/30`}
      >
        {style.text}
      </Badge>
    ) : null;
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={!isSelectable}
            className={`
              relative aspect-[5/7] w-full min-w-[70px] max-w-[100px] sm:min-w-[80px] sm:max-w-[120px] md:min-w-[100px] md:max-w-[140px] lg:max-w-[160px]
              transform transition-all duration-200
              hover:scale-105 hover:-translate-y-1
              focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
              ${isSelectable ? "cursor-pointer" : "cursor-default"}
              ${isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105" : ""}
              touch-manipulation min-h-[60px] sm:min-h-[80px] md:min-h-[100px]
            `}
            aria-label={`Card: ${card.card.name}${isSelected ? ", selected" : ""}`}
            aria-pressed={isSelectable ? isSelected : undefined}
            role={isSelectable ? "checkbox" : "img"}
            tabIndex={isSelectable ? 0 : -1}
            onKeyDown={(e) => {
              if (isSelectable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onClick();
              }
            }}
          >
            {scryfallCard.image_uris?.normal ? (
              <Image
                src={scryfallCard.image_uris.normal}
                alt={scryfallCard.name}
                fill
                sizes="(max-width: 120px) 100vw, 120px"
                className="rounded-lg object-cover shadow-md"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 p-2 shadow-md">
                <p className="text-center text-xs font-medium line-clamp-3">
                  {scryfallCard.name}
                </p>
                {showManaCost && manaCost && (
                  <p className="mt-1 text-xs text-muted-foreground">{manaCost}</p>
                )}
              </div>
            )}

            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                <div className="h-2 w-2 rounded-full bg-background" />
              </div>
            )}

            {/* Mana cost overlay */}
            {showManaCost && manaCost && scryfallCard.image_uris?.normal && (
              <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5">
                <span className="text-xs font-mono text-white">{manaCost}</span>
              </div>
            )}

            {/* Type indicator */}
            {showType && (
              <div className="absolute top-1 right-1 flex gap-0.5">
                {colorBadges}
              </div>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">{scryfallCard.name}</p>
            {typeLine && <p className="text-xs text-muted-foreground">{typeLine}</p>}
            {manaCost && <p className="text-xs">{manaCost}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CardBack() {
  return (
    <div className="relative aspect-[5/7] w-full min-w-[80px] max-w-[120px] rounded-lg bg-gradient-to-br from-blue-900 to-blue-950 border-2 border-blue-700 shadow-md overflow-hidden">
      {/* MTG card back pattern simulation */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-4 border-2 border-blue-600 rounded-full" />
        <div className="absolute inset-8 border-2 border-blue-500 rounded-full" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <Hand className="h-12 w-12 text-blue-600" />
      </div>
    </div>
  );
}

export function HandDisplay({
  cards,
  isCurrentPlayer,
  onCardSelect,
  onCardClick,
  selectedCardIds = [],
  className = ""
}: HandDisplayProps) {
  const [sortOption, setSortOption] = React.useState<HandSortOption>("name");
  const [displayMode, setDisplayMode] = React.useState<HandDisplayMode>("overlapping");
  const [internalSelection, setInternalSelection] = React.useState<Set<string>>(new Set(selectedCardIds));

  // Update internal selection when external selection changes
  React.useEffect(() => {
    setInternalSelection(new Set(selectedCardIds));
  }, [selectedCardIds]);

  // Sort cards based on current sort option
  const sortedCards = React.useMemo(() => {
    const sorted = [...cards];
    
    // Define sort functions outside switch to avoid lexical declarations in case blocks
    const sortByName = (a: CardState, b: CardState) => a.card.name.localeCompare(b.card.name);
    
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
      const colorIndexA = colorsA.length > 0 ? colorOrder.indexOf(colorsA[0]) : 999;
      const colorIndexB = colorsB.length > 0 ? colorOrder.indexOf(colorsB[0]) : 999;
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

  const handleCardClick = (cardId: string) => {
    if (!isCurrentPlayer) {
      // Opponent's hand - just notify click, don't select
      onCardClick?.(cardId);
      return;
    }

    // Current player's hand - handle selection
    const newSelection = new Set(internalSelection);

    if (newSelection.has(cardId)) {
      newSelection.delete(cardId);
    } else {
      newSelection.add(cardId);
    }

    setInternalSelection(newSelection);
    onCardSelect?.(Array.from(newSelection));
    onCardClick?.(cardId);
  };

  const handleClearSelection = () => {
    setInternalSelection(new Set());
    onCardSelect?.([]);
  };

  const isCardSelected = (cardId: string) => internalSelection.has(cardId);

  // Don't render anything if no cards
  if (cards.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center text-muted-foreground">
          <Hand className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Empty hand</p>
        </div>
      </div>
    );
  }

  const selectedCount = internalSelection.size;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
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
                    className="h-7 w-7 p-0"
                    onClick={() => {
                      const options: HandSortOption[] = ["name", "manaCost", "type", "color"];
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
                    className="h-7 w-7 p-0"
                    onClick={() => setDisplayMode(displayMode === "overlapping" ? "spread" : "overlapping")}
                  >
                    <Layers className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Display: {displayMode === "overlapping" ? "Overlapping" : "Spread"}</p>
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
                      className="h-7 w-7 p-0"
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

      {/* Card display area */}
      <ScrollArea className={`w-full ${displayMode === "overlapping" ? "overflow-x-auto" : ""}`}>
        <div
          className={`
            flex gap-2 p-1
            ${displayMode === "overlapping" ? "items-center" : "flex-wrap justify-center"}
          `}
        >
          {sortedCards.map((card) => {
            if (isCurrentPlayer) {
              // Show face-up cards for current player
              return (
                <CardDisplay
                  key={card.id}
                  card={card}
                  isSelected={isCardSelected(card.id)}
                  isSelectable={true}
                  onClick={() => handleCardClick(card.id)}
                  showManaCost={true}
                  showType={true}
                />
              );
            } else {
              // Show card backs for opponents
              return (
                <div
                  key={card.id}
                  onClick={() => onCardClick?.(card.id)}
                  className="transition-transform hover:scale-105 cursor-pointer"
                >
                  <CardBack />
                </div>
              );
            }
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
