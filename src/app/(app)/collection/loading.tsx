import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the collection.
// Approximates the stats row + list + sidebar cards layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="collection" />;
}
