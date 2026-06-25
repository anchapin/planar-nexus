"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface CardGridSkeletonProps {
  /**
   * Number of skeleton card placeholders to render.
   * @default 8
   */
  count?: number;
  /**
   * Optional className applied to the grid container. When omitted, the grid
   * uses responsive column counts that mirror the card-search virtualized
   * grid breakpoints so there is no layout shift between skeleton and content.
   */
  className?: string;
}

/**
 * Skeleton placeholder for a grid of card search results.
 *
 * The responsive column layout matches the breakpoints computed inline by
 * CardSearch (3 / md:4 / lg:3 / xl:4 / 2xl:5) so swapping between the
 * skeleton and real results produces no visible layout shift.
 *
 * Used both as the Suspense fallback for the card search boundary and as the
 * in-place loading state while the offline card database initialises or a
 * search is pending.
 */
export function CardGridSkeleton({
  count = 8,
  className,
}: CardGridSkeletonProps) {
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
        className,
      )}
      role="status"
      aria-label="Loading cards"
      aria-live="polite"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className="aspect-[5/7] rounded-lg"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
