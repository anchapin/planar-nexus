import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the meta analysis page.
// Approximates the stats row + chart blocks layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="meta" />;
}
