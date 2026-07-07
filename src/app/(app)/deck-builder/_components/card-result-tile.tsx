"use client";

/**
 * @fileOverview Memoized result tile for the deck-builder card-search panel.
 *
 * Issue #1246: extracted from `card-search.tsx` so the VirtualizedCardGrid's
 * visible row window does not re-render every cell when an unrelated piece of
 * the parent (debounced query, preset selection, save dialog state, etc.)
 * changes. The component owns the per-card JSX — image, synergy badge,
 * legality badge, click-to-add, and keyboard-selection styling — but receives
 * all derived data as props so `React.memo` can short-circuit unchanged cells.
 */

import React, { memo, useCallback, useMemo } from "react";
import { CardArt } from "@/components/card-art";
import { Badge } from "@/components/ui/badge";
import { LegalityBadge } from "./legality-badge";
import {
  checkCardLegality,
  type CardLegalityResult,
} from "@/hooks/use-format-legality-check";
import type { ScryfallCard } from "@/app/actions";
import type { Format } from "@/lib/game-rules";
import type { SynergyResult } from "./synergy-context";

export interface CardResultTileProps {
  /** The card to render. */
  card: ScryfallCard;
  /** Stable, virtualizer-aware row index. */
  index: number;
  /** Whether the tile is the current keyboard-highlighted result. */
  isSelected: boolean;
  /** Whether the tile is currently in the brief "added" flash state. */
  isFlashing: boolean;
  /** Pre-resolved synergy lookup for this card (Map.get is referentially stable). */
  synergy: SynergyResult | undefined;
  /** Active deck format. When provided, legality is computed for the badge. */
  format: Format | undefined;
  /**
   * When `true`, the format filter is active so every visible card is already
   * legal; the legality badge is hidden to avoid visual noise.
   */
  hideLegality: boolean;
  /** Add the card to the deck. `shift` indicates the 4-of quick-add gesture. */
  onAddCard: (card: ScryfallCard, shift: boolean) => void;
  /** Mark this index as the keyboard-highlighted result. */
  onSelect: (index: number) => void;
}

/**
 * Single result cell rendered inside one row of the VirtualizedCardGrid.
 *
 * Extracted from the inline JSX in `card-search.tsx` (issue #1246) so the
 * virtualizer's visible window can be skipped via `React.memo` when an
 * unrelated parent update fires. The component is self-contained: it takes the
 * card, a stable index, and pre-resolved lookup data; it computes the legality
 * result internally (memoised) and emits the same DOM the inline renderer
 * previously produced, so the existing `data-testid`/ARIA hooks are preserved.
 */
function CardResultTileImpl({
  card,
  index,
  isSelected,
  isFlashing,
  synergy,
  format,
  hideLegality,
  onAddCard,
  onSelect,
}: CardResultTileProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onSelect(index);
      onAddCard(card, e.shiftKey);
    },
    [card, index, onAddCard, onSelect],
  );

  const handleMouseEnter = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  const hasHighSynergy = !!synergy && synergy.score >= 60;

  const legality: CardLegalityResult | undefined = useMemo(() => {
    if (hideLegality || !format) return undefined;
    return checkCardLegality(card, format, format);
  }, [card, format, hideLegality]);

  return (
    <button
      data-card-index={index}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      className={`relative w-full h-full transform transition-transform duration-200 hover:scale-105 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded-lg touch-manipulation group ${
        isSelected ? "ring-4 ring-primary ring-offset-2" : ""
      } ${isFlashing ? "ring-4 ring-green-500 ring-offset-2" : ""}`}
      style={{
        aspectRatio: "5 / 7",
      }}
      title={`Add ${card.name} to deck${
        hasHighSynergy ? ` (Synergy: ${Math.round(synergy!.score)}%)` : ""
      } - Shift+Click for 4-of`}
      aria-label={`Add ${card.name} to deck${
        hasHighSynergy ? ` (Synergy: ${Math.round(synergy!.score)}%)` : ""
      } - Shift+Click for 4-of${isSelected ? " (selected)" : ""}`}
      data-testid={`card-result-${card.name
        .toLowerCase()
        .replace(/\s+/g, "-")}`}
    >
      {card.image_uris?.large || card.image_uris?.normal ? (
        <CardArt
          cardName={card.name}
          scryfallCard={{
            id: card.id,
            name: card.name,
            set: card.set,
            collector_number: card.collector_number,
            color_identity: card.color_identity,
            type_line: card.type_line,
            cmc: card.cmc,
            colors: card.colors,
          }}
          size="thumbnail"
          lazy
          showSkeleton
          fill
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-lg bg-secondary text-center text-secondary-foreground p-2 text-sm">
          {card.name}
        </div>
      )}

      {hasHighSynergy && (
        <div
          className="absolute top-2 right-2 z-10"
          data-testid="synergy-badge"
        >
          <Badge
            variant={synergy!.score >= 80 ? "default" : "secondary"}
            className={`${
              synergy!.score >= 80
                ? "bg-green-600 hover:bg-green-700"
                : "bg-orange-500 hover:bg-orange-600"
            } text-white border-none shadow-sm text-[10px] px-1.5 py-0`}
          >
            {Math.round(synergy!.score)}%
          </Badge>
        </div>
      )}

      {legality && (
        <div
          className="absolute top-2 left-2 z-10"
          data-testid={`search-legality-${legality.status}`}
        >
          <LegalityBadge
            status={legality.status}
            className="text-[10px] px-1.5 py-0 shadow-sm"
          />
        </div>
      )}
    </button>
  );
}

/**
 * Equality check: re-render only when a prop the tile actually paints has
 * changed. The handler callbacks must be stable (useCallback in the parent)
 * for this short-circuit to fire. `synergy` is the `Map.get` return value —
 * the Map is referentially stable across renders so a non-changed entry keeps
 * the same object reference.
 */
function arePropsEqual(
  prev: CardResultTileProps,
  next: CardResultTileProps,
): boolean {
  return (
    prev.card === next.card &&
    prev.index === next.index &&
    prev.isSelected === next.isSelected &&
    prev.isFlashing === next.isFlashing &&
    prev.synergy === next.synergy &&
    prev.format === next.format &&
    prev.hideLegality === next.hideLegality &&
    prev.onAddCard === next.onAddCard &&
    prev.onSelect === next.onSelect
  );
}

export const CardResultTile = memo(CardResultTileImpl, arePropsEqual);
CardResultTile.displayName = "CardResultTile";
