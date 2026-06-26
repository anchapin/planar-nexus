import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the post-game analysis page.
// Approximates the game-log input + analysis cards layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="game-analysis" />;
}
