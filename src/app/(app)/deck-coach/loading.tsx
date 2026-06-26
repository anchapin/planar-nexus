import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the deck coach.
// Approximates the decklist input + analysis cards layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="deck-coach" />;
}
