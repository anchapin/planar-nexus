import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the coach report.
// Approximates the stat cards + report sections layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="coach-report" />;
}
