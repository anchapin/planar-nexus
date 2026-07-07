"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CollectionCard } from "@/hooks/use-collection";
import { cn } from "@/lib/utils";

export interface VirtualCardListProps {
  cards: CollectionCard[];
  renderRow: (card: CollectionCard, index: number) => React.ReactNode;
  /** Class applied to the scroll container (e.g. height / flex sizing). */
  className?: string;
  /** Class applied to the inner content wrapper (e.g. padding). */
  contentClassName?: string;
  /** Estimated row height in px, used before a row is measured. */
  estimateSize?: number;
  /** Gap between rows in px (mirrors Tailwind `space-y-2` = 8px). */
  gap?: number;
  /** Number of rows rendered outside the visible window. */
  overscan?: number;
}

/**
 * Virtualized single-column list of collection cards.
 *
 * Only the visible window of rows (+ overscan) is mounted to the DOM, so large
 * collections render in constant time. Built on `@tanstack/react-virtual` which
 * is already a project dependency. Row heights are measured dynamically so the
 * exact existing card markup (badges, wrapping text, etc.) is preserved.
 */
export function VirtualCardList({
  cards,
  renderRow,
  className,
  contentClassName,
  estimateSize = 80,
  gap = 8,
  overscan = 6,
}: VirtualCardListProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    gap,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={cn(
        "overflow-y-auto overflow-x-hidden outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      role="list"
      aria-label="Collection cards"
      tabIndex={0}
    >
      <div className={contentClassName}>
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const card = cards[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                role="listitem"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderRow(card, virtualRow.index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
