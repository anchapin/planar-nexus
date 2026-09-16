"use client";

import * as React from "react";
import { memo, useCallback } from "react";
import { CardState } from "@/types/game";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Hand } from "lucide-react";
import Image from "next/image";

/**
 * Memoized per-card children of `HandDisplay` (#1818).
 *
 * Extracted into their own module — mirroring `BattlefieldCard` in
 * `virtualized-zone-strip.tsx` — so the hand fan gets the same render
 * discipline as the battlefield: `HandDisplay` passes stable references
 * (`card` from engine state, a single stable `onCardClick`), so a
 * game-state delta that does not touch the hand re-renders none of these
 * components. Click handlers take the `cardId` argument instead of a
 * pre-bound closure so the callback identity never changes per card.
 */

export interface HandCardProps {
  card: CardState;
  isSelected: boolean;
  isSelectable: boolean;
  onCardClick: (cardId: string) => void;
  showManaCost?: boolean;
  showType?: boolean;
}

export const HandCard = memo(function HandCard({
  card,
  isSelected,
  isSelectable,
  onCardClick,
  showManaCost = true,
  showType = true,
}: HandCardProps) {
  const { card: scryfallCard } = card;
  const manaCost = scryfallCard.mana_cost || "";
  const typeLine = scryfallCard.type_line || "";
  const colors = scryfallCard.colors || [];

  const handleClick = useCallback(() => {
    onCardClick(card.id);
  }, [onCardClick, card.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (isSelectable && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onCardClick(card.id);
      }
    },
    [isSelectable, onCardClick, card.id],
  );

  // Color indicators
  const colorBadges = colors.map((color) => {
    const colorMap: Record<
      string,
      { bg: string; text: string; border: string }
    > = {
      W: {
        bg: "bg-yellow-100",
        text: "text-yellow-700",
        border: "border-yellow-400",
      },
      U: {
        bg: "bg-blue-100",
        text: "text-blue-700",
        border: "border-blue-400",
      },
      B: {
        bg: "bg-gray-800",
        text: "text-gray-100",
        border: "border-gray-600",
      },
      R: { bg: "bg-red-100", text: "text-red-700", border: "border-red-400" },
      G: {
        bg: "bg-green-100",
        text: "text-green-700",
        border: "border-green-400",
      },
    };
    const style = colorMap[color];
    return style ? (
      <div
        key={color}
        className={`flex items-center justify-center size-4 rounded-full border ${style.bg} ${style.border} shadow-xs`}
        title={color}
      >
        <span className={`text-[10px] font-bold ${style.text}`}>
          {style.text.includes("gray-100") ? color : color}
        </span>
      </div>
    ) : null;
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleClick}
            disabled={!isSelectable}
            className={`
              relative aspect-[5/7] w-full min-w-[60px] max-w-[90px] sm:min-w-[80px] sm:max-w-[120px] md:min-w-[100px] md:max-w-[140px] lg:max-w-[160px]
              shrink-0
              transform transition-all duration-300 ease-out
              hover:scale-[1.75] hover:-translate-y-12 hover:z-50 hover:shadow-2xl
              origin-center
              focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background
              ${isSelectable ? "cursor-pointer" : "cursor-default"}
              ${isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105" : ""}
              touch-manipulation min-h-[60px] sm:min-h-[80px] md:min-h-[100px]
            `}
            data-testid={`hand-card-${card.card.name.toLowerCase().replace(/\s+/g, "-")}`}
            aria-label={`Card: ${card.card.name}${isSelected ? ", selected" : ""}`}
            aria-pressed={isSelectable ? isSelected : undefined}
            role={isSelectable ? "checkbox" : "img"}
            tabIndex={isSelectable ? 0 : -1}
            onKeyDown={handleKeyDown}
          >
            {scryfallCard.image_uris?.large ||
            scryfallCard.image_uris?.normal ? (
              <Image
                src={scryfallCard.image_uris?.normal || ""}
                alt={scryfallCard.name}
                fill
                sizes="(max-width: 120px) 100vw, 120px"
                className="rounded-lg object-cover shadow-md"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 p-2 shadow-md">
                <p className="text-center text-xs font-medium line-clamp-3">
                  {scryfallCard.name}
                </p>
                {showManaCost && manaCost && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {manaCost}
                  </p>
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
            {(showManaCost && manaCost && scryfallCard.image_uris?.large) ||
              (scryfallCard.image_uris?.normal && (
                <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5">
                  <span className="text-xs font-mono text-white">
                    {manaCost}
                  </span>
                </div>
              ))}

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
            {typeLine && (
              <p className="text-xs text-muted-foreground">{typeLine}</p>
            )}
            {manaCost && <p className="text-xs">{manaCost}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

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

export interface OpponentHandCardProps {
  cardId: string;
  onCardClick?: (cardId: string) => void;
}

/**
 * A face-down card in an opponent's hand (#1818). Extracted from the inline
 * markup in `HandDisplay`'s map so opponent-hand deltas skip untouched cards;
 * props are a primitive `cardId` plus `HandDisplay`'s own stable
 * `onCardClick` prop.
 */
export const OpponentHandCard = memo(function OpponentHandCard({
  cardId,
  onCardClick,
}: OpponentHandCardProps) {
  return (
    <button
      type="button"
      aria-label="Opponent card (face down)"
      onClick={() => onCardClick?.(cardId)}
      className="transition-transform hover:scale-105 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <CardBack />
    </button>
  );
});
