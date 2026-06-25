"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CardGridSkeleton } from "./card-grid-skeleton";

/**
 * Full-page skeleton for the Deck Builder route.
 *
 * Mirrors the layout of {@link DeckBuilderPage} so that the transition from
 * the initial IndexedDB load into the hydrated page produces no layout shift.
 * Shown while saved decks (and the rest of the client state) hydrate from
 * IndexedDB on first navigation.
 */
export function DeckBuilderSkeleton() {
  return (
    <div
      className="flex h-full min-h-svh w-full flex-col p-4 md:p-6"
      role="status"
      aria-label="Loading deck builder"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <Skeleton className="h-9 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-9 w-40 rounded-md border" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      {/* Main grid */}
      <div className="flex-grow grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Card search column */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-20" />
          </div>
          <div className="flex-grow rounded-lg border bg-card p-4">
            <CardGridSkeleton />
          </div>
        </div>

        {/* Deck list / mana curve column */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card>
            <CardHeader className="py-4">
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="pb-4 space-y-3">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </CardContent>
          </Card>
        </div>

        {/* Side panel column */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card>
            <CardHeader className="py-4">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="pb-4 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-4">
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="pb-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
