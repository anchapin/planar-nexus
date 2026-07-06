"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Layers, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeCardText } from "@/lib/security/sanitize-text";
import type {
  CurveBucketStatus,
  CurveRecommendation,
} from "@/ai/flows/coach-deck-analysis";

export interface CurveRecommendationCardProps {
  /** The recommendation block from {@link StructuredDeckAnalysis}. */
  recommendation: CurveRecommendation;
  className?: string;
}

/**
 * Render a "no status" badge for buckets the analysis considers close enough
 * to the archetype target to not warrant a suggestion.
 */
function statusBadge(status: CurveBucketStatus["status"], advice: string | null) {
  if (status === "lands") {
    return (
      <Badge variant="outline" className="text-xs">
        Lands
      </Badge>
    );
  }
  if (status === "over") {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <Minus className="h-3 w-3" />
        Over
      </Badge>
    );
  }
  if (status === "under") {
    return (
      <Badge variant="default" className="text-xs gap-1">
        <Plus className="h-3 w-3" />
        Under
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs gap-1">
      <CheckCircle2 className="h-3 w-3" />
      OK
    </Badge>
  );
}

/**
 * Visualisation card for the action-able mana-curve + land-count
 * recommendation (issue #1239).
 *
 * Shows the deck-vs-target land count delta, a per-CMC-bucket over/under grid
 * and the concrete suggestion list ("add 2 1-drops", "cut 1 5-drop").
 */
export function CurveRecommendationCard({
  recommendation,
  className,
}: CurveRecommendationCardProps) {
  if (!recommendation) return null;

  const {
    archetypeTarget,
    actualLands,
    recommendedLands,
    minLands,
    maxLands,
    landDelta,
    landAssessment,
    bucketStatus,
    actions,
    summary,
    source,
  } = recommendation;

  const inRange = actualLands >= minLands && actualLands <= maxLands;
  const landBadge = inRange
    ? { label: "On target", variant: "secondary" as const }
    : landDelta < 0
      ? { label: `Add ${Math.abs(landDelta)} land${Math.abs(landDelta) === 1 ? "" : "s"}`, variant: "default" as const }
      : { label: `Cut ${landDelta} land${landDelta === 1 ? "" : "s"}`, variant: "destructive" as const };

  return (
    <Card className={className} data-testid="curve-recommendation-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Mana-Curve Recommendation
            </CardTitle>
            <CardDescription>
              {sanitizeCardText(summary, 500)}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={landBadge.variant} className="gap-1">
              {inRange ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {landBadge.label}
            </Badge>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {source === "archetype" ? "Archetype data" : "Strategy profile"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Land-count summary row */}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Actual</div>
              <div className="text-lg font-semibold">{actualLands}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Recommended</div>
              <div className="text-lg font-semibold">{recommendedLands}</div>
              <div className="text-[10px] text-muted-foreground">
                range {minLands}–{maxLands}
              </div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">Delta</div>
              <div
                className={cn(
                  "text-lg font-semibold",
                  landDelta === 0
                    ? "text-muted-foreground"
                    : landDelta < 0
                      ? "text-amber-500"
                      : "text-red-500",
                )}
                data-testid="land-delta"
              >
                {landDelta > 0 ? `+${landDelta}` : landDelta}
              </div>
              <div className="text-[10px] text-muted-foreground">vs target</div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {sanitizeCardText(landAssessment, 500)}
          </p>

          {/* Per-bucket grid */}
          <div>
            <h4 className="text-sm font-semibold mb-2">
              CMC buckets vs {sanitizeCardText(archetypeTarget, 100)} target
            </h4>
            <div
              className="grid grid-cols-4 sm:grid-cols-8 gap-2"
              data-testid="bucket-grid"
            >
              {bucketStatus.map((bucket) => (
                <div
                  key={bucket.cmc}
                  className={cn(
                    "rounded-md border p-2 text-center text-xs",
                    bucket.status === "over" && "border-red-500/50 bg-red-500/5",
                    bucket.status === "under" && "border-primary/50 bg-primary/5",
                    bucket.status === "lands" && "border-muted bg-muted/30",
                    bucket.status === "balanced" && "border-muted",
                  )}
                  data-testid={`bucket-${bucket.cmc}`}
                >
                  <div className="font-semibold text-sm">{bucket.label}cmc</div>
                  <div className="text-muted-foreground">
                    {bucket.actual}
                    {bucket.status !== "lands" && bucket.target > 0
                      ? `/${bucket.target}`
                      : ""}
                  </div>
                  <div className="mt-1 flex justify-center">
                    {statusBadge(bucket.status, bucket.advice)}
                  </div>
                  {bucket.advice && (
                    <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                      {bucket.advice}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Concrete actions */}
          {actions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">Suggested actions</h4>
              <ul
                className="space-y-1 text-sm"
                data-testid="curve-actions"
              >
                {actions.map((action, idx) => (
                  <li
                    key={`${idx}-${action}`}
                    className="flex items-start gap-2"
                  >
                    <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="text-muted-foreground">
                      {sanitizeCardText(action, 500)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}