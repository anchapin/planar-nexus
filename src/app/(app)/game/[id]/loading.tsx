import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the in-game board.
// Approximates the control bar + battlefield + hand layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="game" />;
}
