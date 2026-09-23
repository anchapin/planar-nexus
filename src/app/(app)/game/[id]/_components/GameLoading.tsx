"use client";

import { Card, CardContent } from "@/components/ui/card";

export function GameLoading() {
  return (
    <div className="flex-1 p-2 md:p-4 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center space-y-4">
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
          </div>
          <p className="text-muted-foreground">Loading game...</p>
        </CardContent>
      </Card>
    </div>
  );
}
