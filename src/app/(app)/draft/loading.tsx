import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the draft session.
// Approximates the pack picker grid + draft pool sidebar. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="draft" />;
}
