"use client";

import React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedCardGridProps<T> {
  items: T[];
  columns?: number;
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onScroll?: (offset: number) => void;
  scrollElementRef?: React.RefObject<HTMLElement>;
  gap?: number;
  overscan?: number;
}

/**
 * High-performance 2D grid virtualization component using @tanstack/react-virtual.
 * Efficiently renders large lists of items in a responsive grid layout.
 */
export const VirtualizedCardGrid = React.forwardRef<
  HTMLDivElement,
  VirtualizedCardGridProps<unknown>
>(
  (
    {
      items,
      columns = 4,
      itemHeight,
      renderItem,
      onScroll,
      scrollElementRef,
      gap = 16,
      overscan = 3,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [responsiveColumns, setResponsiveColumns] = useState(columns);
    const scrollElementToUse = scrollElementRef || containerRef;

    // Handle responsive column calculation
    useEffect(() => {
      if (!containerRef.current) return;

      const updateColumns = () => {
        if (!containerRef.current) return;
        const width = containerRef.current.clientWidth;
        
        // Calculate columns based on available width
        // Assumes items are roughly 180px wide + gap
        const itemWidth = 180;
        const calculatedColumns = Math.max(1, Math.floor(width / (itemWidth + gap)));
        setResponsiveColumns(calculatedColumns);
      };

      // Initial calculation
      updateColumns();

      // Create ResizeObserver for responsive updates
      const resizeObserver = new ResizeObserver(updateColumns);
      resizeObserver.observe(containerRef.current);

      return () => resizeObserver.disconnect();
    }, [gap]);

    // Calculate row count
    const rowCount = Math.ceil(items.length / responsiveColumns);

    // Set up virtualizer for rows
    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollElementToUse.current,
      estimateSize: () => itemHeight,
      overscan,
    });

    const virtualRows = virtualizer.getVirtualItems();
    const totalSize = virtualizer.getTotalSize();

    // Handle scroll event
    const handleScroll = useCallback(() => {
      if (scrollElementToUse.current) {
        onScroll?.(scrollElementToUse.current.scrollTop);
      }
    }, [onScroll, scrollElementToUse]);

    useEffect(() => {
      const scrollElement = scrollElementToUse.current;
      if (!scrollElement) return;

      scrollElement.addEventListener("scroll", handleScroll);
      return () => scrollElement.removeEventListener("scroll", handleScroll);
    }, [handleScroll, scrollElementToUse]);

    return (
      <div
        ref={ref || containerRef}
        className="w-full h-full overflow-auto"
      >
        <div
          style={{
            height: `${totalSize}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualRows.map((virtualRow) => {
            const rowStartIndex = virtualRow.index * responsiveColumns;
            const rowItems = items.slice(
              rowStartIndex,
              rowStartIndex + responsiveColumns
            );

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${responsiveColumns}, 1fr)`,
                  gap: `${gap}px`,
                  padding: "16px",
                }}
              >
                {rowItems.map((item, indexInRow) => (
                  <div
                    key={rowStartIndex + indexInRow}
                    className="overflow-hidden"
                  >
                    {renderItem(item, rowStartIndex + indexInRow)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

VirtualizedCardGrid.displayName = "VirtualizedCardGrid";
