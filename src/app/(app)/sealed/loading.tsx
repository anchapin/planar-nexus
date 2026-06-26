import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the sealed pool page.
// Approximates the filters sidebar + card grid layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="sealed" />;
}
