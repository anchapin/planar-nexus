"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CoachReportSkeletonProps {
  className?: string;
}

/**
 * CoachReportSkeleton Component
 * 
 * Displays a skeleton loader while the coach report is being generated.
 * Shows progress indication and prevents layout shift when report loads.
 */
export function CoachReportSkeleton({ className }: CoachReportSkeletonProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Header section */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-6 w-32" />
          </div>
          <Skeleton className="h-4 w-48" />
        </CardHeader>
      </Card>
      
      {/* Archetype section */}
      <Card>
        <CardHeader className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
        </CardHeader>
      </Card>
      
      {/* Synergies section */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </CardContent>
      </Card>
      
      {/* Key Cards section */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 border rounded-lg">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-10" />
            </div>
          ))}
        </CardContent>
      </Card>
      
      {/* Missing Synergies section */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * LoadingProgress Component
 * 
 * Shows a progress indicator with estimated time during analysis.
 */
export interface LoadingProgressProps {
  message?: string;
  className?: string;
}

export function LoadingProgress({ 
  message = "Analyzing your deck...", 
  className 
}: LoadingProgressProps) {
  return (
    <Card className={cn("flex-1 flex items-center justify-center", className)}>
      <div className="text-center space-y-4 p-8">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 bg-primary rounded-full animate-pulse" />
          </div>
        </div>
        
        <div className="space-y-2">
          <p className="text-muted-foreground font-medium">{message}</p>
          <p className="text-xs text-muted-foreground">
            This usually takes 5-10 seconds
          </p>
        </div>
        
        <div className="w-64 h-2 bg-muted rounded-full mx-auto overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-progress-indeterminate" />
        </div>
      </div>
    </Card>
  );
}
