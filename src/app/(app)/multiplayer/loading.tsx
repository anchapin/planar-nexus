import { PageSkeleton } from "@/components/page-skeleton";

// Route-level Suspense fallback for the multiplayer lobby.
// Approximates the host/join + P2P info grid layout. (Issue #1102)
export default function Loading() {
  return <PageSkeleton variant="multiplayer" />;
}
