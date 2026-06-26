import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the deck builder.
// Approximates the two-column search + deck-list layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="deck-builder" />;
}
