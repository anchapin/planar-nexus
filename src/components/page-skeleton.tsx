/**
 * PageSkeleton — shared route-level loading placeholder.
 *
 * Used by Next.js App Router `loading.tsx` files to render a layout-stable
 * skeleton that approximates each section's real layout (no full-page spinner).
 *
 * Reduced-motion note: the `animate-pulse` utility used by the `Skeleton`
 * primitive is globally neutralised under `prefers-reduced-motion: reduce` via
 * `src/app/globals.css`, so these placeholders render as static blocks when a
 * user has reduced motion enabled.
 *
 * Issue #1102.
 */

import { Skeleton } from "@/components/ui/skeleton";

export type PageSkeletonVariant =
  | "deck-builder"
  | "deck-coach"
  | "meta"
  | "multiplayer"
  | "draft"
  | "sealed"
  | "collection"
  | "game-analysis"
  | "coach-report"
  | "game";

function PageHeaderSkeleton({ titleWidth = "w-48" }: { titleWidth?: string }) {
  return (
    <header className="mb-6" aria-hidden="true">
      <Skeleton className={`h-8 ${titleWidth}`} />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
    </header>
  );
}

function StatRowSkeleton() {
  return (
    <div
      className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function ListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border bg-card p-3"
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border bg-card p-2">
          <Skeleton className="aspect-[3/4] w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card p-4" aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-1/2" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

function DeckBuilderSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Skeleton className="h-10 w-full" />
        <CardGridSkeleton count={8} />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <ListRowsSkeleton rows={8} />
      </div>
    </div>
  );
}

function SealedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <ListRowsSkeleton rows={5} />
      </div>
      <div className="lg:col-span-3">
        <CardGridSkeleton count={12} />
      </div>
    </div>
  );
}

function CollectionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <Skeleton className="h-10 w-full" />
        <ListRowsSkeleton rows={7} />
      </div>
      <div className="space-y-4">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={2} />
      </div>
    </div>
  );
}

function MultiplayerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={2} />
      </div>
      <div className="space-y-6 lg:col-span-2">
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

function MetaSkeleton() {
  return (
    <div className="space-y-6">
      <StatRowSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

function DraftSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Skeleton className="h-10 w-full" />
        <CardGridSkeleton count={9} />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-24" />
        <ListRowsSkeleton rows={10} />
      </div>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <CardSkeleton rows={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton rows={3} />
        <CardSkeleton rows={3} />
      </div>
    </div>
  );
}

function GameSkeleton() {
  return (
    <div className="flex h-full w-full flex-col gap-3 p-3 md:p-4">
      <Skeleton className="h-10 w-full shrink-0" />
      <Skeleton className="h-16 w-full shrink-0" />
      <div className="grid flex-1 grid-cols-2 gap-3">
        <Skeleton className="h-full w-full" />
        <Skeleton className="h-full w-full" />
      </div>
      <div className="flex shrink-0 justify-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-20" />
        ))}
      </div>
    </div>
  );
}

function renderVariant(variant: PageSkeletonVariant) {
  switch (variant) {
    case "deck-builder":
      return <DeckBuilderSkeleton />;
    case "sealed":
      return <SealedSkeleton />;
    case "collection":
      return <CollectionSkeleton />;
    case "multiplayer":
      return <MultiplayerSkeleton />;
    case "meta":
      return <MetaSkeleton />;
    case "draft":
      return <DraftSkeleton />;
    case "deck-coach":
    case "game-analysis":
      return <AnalysisSkeleton />;
    case "coach-report":
      return (
        <>
          <StatRowSkeleton />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CardSkeleton rows={4} />
            <CardSkeleton rows={4} />
          </div>
        </>
      );
    case "game":
      return <GameSkeleton />;
    default:
      return null;
  }
}

export function PageSkeleton({ variant }: { variant: PageSkeletonVariant }) {
  const isGame = variant === "game";
  return (
    <div
      role="status"
      aria-label="Loading"
      className={isGame ? "h-full" : "p-4 md:p-6"}
    >
      {!isGame && <PageHeaderSkeleton />}
      {renderVariant(variant)}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default PageSkeleton;
