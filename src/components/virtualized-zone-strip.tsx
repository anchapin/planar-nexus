"use client";

import * as React from "react";
import { memo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Image from "next/image";
import type { CardState, ZoneType } from "@/types/game";
import { cn } from "@/lib/utils";

interface BattlefieldCardProps {
  card: CardState;
  zone: ZoneType;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
}

/**
 * A single zone card thumbnail.
 *
 * Extracted so the exact same markup is reused by both the small-board
 * (non-virtualized) render path and any windowed zone strip. Memoized so
 * re-renders triggered by game-state deltas (#1024 delta-sync) skip cards
 * whose props did not change. Re-exported from `virtualized-battlefield.tsx`
 * for backward compatibility.
 */
export const BattlefieldCard = memo(function BattlefieldCard({
  card,
  zone,
  onCardClick,
}: BattlefieldCardProps) {
  const testId = `battlefield-card-${card.card.name.toLowerCase().replace(/\s+/g, "-")}`;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onCardClick?.(card.id, zone);
    },
    [onCardClick, card.id, zone],
  );

  return (
    <div
      data-testid={testId}
      onClick={handleClick}
      className="relative w-10 h-14 sm:w-12 sm:h-16 md:w-14 md:h-20 rounded overflow-hidden border border-primary/30 hover:scale-[3] hover:z-50 hover:shadow-2xl transition-all duration-300 cursor-pointer group shrink-0"
      title={card.card.name}
    >
      {card.card.image_uris?.normal ? (
        <Image
          src={card.card.image_uris.normal}
          alt={card.card.name}
          fill
          sizes="80px"
          className="object-cover rounded"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
          <span className="text-[8px] text-center leading-tight px-0.5 line-clamp-2">
            {card.card.name}
          </span>
        </div>
      )}
      {card.tapped && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
          <span className="text-[8px] text-white font-bold rotate-45">
            TAPPED
          </span>
        </div>
      )}
    </div>
  );
});

/**
 * Per-zone windowing thresholds. A zone is rendered through the virtualizer
 * once its card count exceeds its threshold; below it every card renders
 * directly (no virtualizer overhead). Tuned for realistic Commander board
 * states — see #1390 (windowing every player's battlefield independently on
 * the 4-player board).
 *
 * `battlefield` preserves the original `BATTLEFIELD_WINDOWING_THRESHOLD` (20)
 * introduced in #1082.
 */
export const ZONE_WINDOWING_THRESHOLDS: Record<ZoneType, number> = {
  battlefield: 20,
  graveyard: 40,
  exile: 25,
  library: 15,
  commandZone: 12,
  companion: 4,
  hand: 20,
  stack: 20,
  sideboard: 20,
  anticipate: 20,
};

/** The battlefield threshold preserved from #1082 for backward compatibility. */
export const BATTLEFIELD_WINDOWING_THRESHOLD =
  ZONE_WINDOWING_THRESHOLDS.battlefield;

/** Resolve the windowing threshold for a zone (defaults to 20). */
export function getZoneThreshold(zone: ZoneType): number {
  return ZONE_WINDOWING_THRESHOLDS[zone] ?? BATTLEFIELD_WINDOWING_THRESHOLD;
}

export interface VirtualizedZoneStripProps {
  cards: CardState[];
  /** Which zone this strip renders — drives the accessible label. */
  zone: ZoneType;
  /** Strip axis. Horizontal suits battlefield rows; vertical suits the
   *  stacked library/graveyard zones in the 4-player layout. */
  orientation?: "horizontal" | "vertical";
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  /** Class applied to the scroll container. */
  className?: string;
  /** Estimated card size in px along the scroll axis. */
  estimateSize?: number;
  /** Gap between cards in px (mirrors Tailwind `gap-1` = 4px). */
  gap?: number;
  /** Number of cards rendered outside the visible window on each side. */
  overscan?: number;
}

/**
 * Windowed zone strip — generalizes `VirtualizedBattlefield` (#1082) to any
 * horizontal OR vertical zone. Only the visible window of cards (plus
 * `overscan`) is mounted to the DOM; the rest are reachable by scroll.
 *
 * On the 4-player board every player's battlefield (and the stacked
 * graveyard/exile/library zones) renders through this component once its
 * count exceeds the per-zone threshold, so a late-game Commander board no
 * longer mounts 100+ card thumbnails simultaneously (#1390).
 *
 * Built on `@tanstack/react-virtual` (already a project dependency, same
 * primitive used by `VirtualCardList` / `VirtualizedCardGrid`). Because every
 * card lives at a stable virtual index keyed by `card.id`, targeting resolves
 * to the correct card whether or not it is currently mounted — scrolling
 * reveals it rather than missing it.
 */
export function VirtualizedZoneStrip({
  cards,
  zone,
  orientation = "horizontal",
  onCardClick,
  className,
  estimateSize = 56,
  gap = 4,
  overscan = 6,
}: VirtualizedZoneStripProps) {
  const horizontal = orientation === "horizontal";
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    gap,
    horizontal,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className={cn(
        horizontal
          ? "overflow-x-auto overflow-y-hidden"
          : "overflow-y-auto overflow-x-hidden",
        "outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      role="list"
      aria-label={`${zone} (${cards.length} cards)`}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      tabIndex={0}
    >
      <div
        style={
          horizontal
            ? {
                width: `${totalSize}px`,
                height: "100%",
                position: "relative",
              }
            : {
                height: `${totalSize}px`,
                width: "100%",
                position: "relative",
              }
        }
      >
        {virtualItems.map((virtualItem) => {
          const card = cards[virtualItem.index];
          if (!card) return null;
          return (
            <div
              key={card.id ?? virtualItem.key}
              data-index={virtualItem.index}
              role="listitem"
              style={
                horizontal
                  ? {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      height: "100%",
                      transform: `translateX(${virtualItem.start}px)`,
                      display: "flex",
                      alignItems: "center",
                    }
                  : {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                      display: "flex",
                      alignItems: "center",
                    }
              }
            >
              <BattlefieldCard
                card={card}
                zone={zone}
                onCardClick={onCardClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
