"use client";

import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The loading placeholder of the single-player game route.
 *
 * Issue #2418 (SLICE 12): the caption is now configurable so the board's
 * `isLoading` early return can reuse this leaf instead of inlining a
 * near-verbatim copy of its markup. The default caption is unchanged
 * ("Loading game..."), so the existing caller in `page.tsx` (the Suspense
 * fallback) is unaffected.
 */
export interface GameLoadingProps {
  /** Caption shown under the skeleton. Defaults to "Loading game...". */
  message?: string;
}

export const GameLoading = memo(function GameLoading({
  message = "Loading game...",
}: GameLoadingProps) {
  return (
    <div className="flex-1 p-2 md:p-4 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
          <p className="text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
});
