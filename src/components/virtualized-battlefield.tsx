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
 * A single battlefield permanent thumbnail.
 *
 * Extracted so the exact same markup is reused by both the small-board
 * (non-virtualized) render path and the windowed `VirtualizedBattlefield`.
 * Memoized so re-renders triggered by game-state deltas (#1024 delta-sync)
 * skip cards whose props did not change.
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

export interface VirtualizedBattlefieldProps {
  cards: CardState[];
  zone: ZoneType;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  /** Class applied to the scroll container (e.g. absolute fill / height). */
  className?: string;
  /** Estimated card width in px (cards are ~40-56px wide). */
  estimateSize?: number;
  /** Horizontal gap between cards in px (mirrors Tailwind `gap-1` = 4px). */
  gap?: number;
  /** Number of cards rendered outside the visible window on each side. */
  overscan?: number;
}

/**
 * Horizontally-windowed battlefield permanent strip.
 *
 * The game board is the single most re-render-heavy surface in the app, and
 * Commander / token-heavy boards can carry dozens of permanents. Mounting all
 * of them every render tanks performance (#1082). Only the visible window of
 * permanents (plus `overscan`) is mounted to the DOM; the rest are reachable
 * by horizontal scroll. Built on `@tanstack/react-virtual` (already a project
 * dependency, same primitive used by `VirtualCardList` / `VirtualizedCardGrid`)
 * in horizontal mode, which suits the single-row battlefield strip layout.
 *
 * Because every permanent lives at a stable virtual index keyed by `card.id`,
 * combat targeting / ability menus resolve to the correct card whether or not
 * it is currently mounted — scrolling reveals it rather than missing it.
 */
export function VirtualizedBattlefield({
  cards,
  zone,
  onCardClick,
  className,
  estimateSize = 56,
  gap = 4,
  overscan = 6,
}: VirtualizedBattlefieldProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    gap,
    horizontal: true,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={cn(
        "overflow-x-auto overflow-y-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      role="list"
      aria-label={`Battlefield (${cards.length} permanents)`}
      tabIndex={0}
    >
      <div
        style={{
          width: `${rowVirtualizer.getTotalSize()}px`,
          height: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const card = cards[virtualItem.index];
          if (!card) return null;
          return (
            <div
              key={card.id ?? virtualItem.key}
              data-index={virtualItem.index}
              role="listitem"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                transform: `translateX(${virtualItem.start}px)`,
                display: "flex",
                alignItems: "center",
              }}
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
