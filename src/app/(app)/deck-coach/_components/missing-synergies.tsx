"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MissingSynergyItem {
  synergy: string;
  missing: string;
  description: string;
  suggestion: string;
  impact: "high" | "medium" | "low";
}

export interface MissingSynergiesProps {
  missing: MissingSynergyItem[];
  className?: string;
}

/**
 * Get impact styling
 */
function getImpactStyling(impact: "high" | "medium" | "low"): {
  icon: React.ReactNode;
  bgClass: string;
  borderClass: string;
  textClass: string;
  badgeVariant: "destructive" | "secondary" | "outline";
} {
  switch (impact) {
    case "high":
      return {
        icon: <AlertTriangle className="h-5 w-5 text-red-500" />,
        bgClass: "bg-red-500/5",
        borderClass: "border-red-500/30",
        textClass: "text-red-600 dark:text-red-400",
        badgeVariant: "destructive",
      };
    case "medium":
      return {
        icon: <AlertCircle className="h-5 w-5 text-yellow-500" />,
        bgClass: "bg-yellow-500/5",
        borderClass: "border-yellow-500/30",
        textClass: "text-yellow-600 dark:text-yellow-400",
        badgeVariant: "secondary",
      };
    case "low":
      return {
        icon: <Info className="h-5 w-5 text-muted-foreground" />,
        bgClass: "bg-muted/30",
        borderClass: "border-muted",
        textClass: "text-muted-foreground",
        badgeVariant: "outline",
      };
  }
}

/**
 * MissingSynergyItem Component
 */
function MissingSynergyItemComponent({ item }: { item: MissingSynergyItem }) {
  const styling = getImpactStyling(item.impact);
  
  return (
    <Alert className={cn("mb-3", styling.bgClass, styling.borderClass)}>
      {styling.icon}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <AlertTitle className={cn("font-semibold", styling.textClass)}>
            {item.synergy}
          </AlertTitle>
          <Badge variant={styling.badgeVariant} className="text-xs">
            {item.impact.toUpperCase()} IMPACT
          </Badge>
        </div>
        <AlertDescription className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">Missing:</span> {item.description}
          </p>
          <div className="bg-background/50 rounded p-2 mt-2">
            <p className="text-xs">
              <span className="font-medium text-primary">💡 Suggestion:</span>{" "}
              <span className="text-muted-foreground">{item.suggestion}</span>
            </p>
          </div>
        </AlertDescription>
      </div>
    </Alert>
  );
}

/**
 * MissingSynergies Component
 * 
 * Displays missing synergy opportunities with actionable suggestions.
 * Color-coded by impact level (high=red, medium=yellow, low=gray).
 */
export function MissingSynergies({ missing, className }: MissingSynergiesProps) {
  if (!missing || missing.length === 0) {
    return null;
  }
  
  // Sort by impact (high > medium > low)
  const impactOrder = { high: 0, medium: 1, low: 2 };
  const sortedMissing = [...missing].sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
  
  const highImpactCount = sortedMissing.filter(m => m.impact === "high").length;
  const mediumImpactCount = sortedMissing.filter(m => m.impact === "medium").length;
  
  return (
    <Card className={cn("border-warning/50", className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="h-5 w-5" />
              Missing Synergies
            </CardTitle>
            <CardDescription>
              Opportunities to strengthen your deck ({highImpactCount} high, {mediumImpactCount} medium impact)
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-sm">
            {missing.length} gaps
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {sortedMissing.map((item, index) => (
            <MissingSynergyItemComponent key={`${item.synergy}-${item.missing}-${index}`} item={item} />
          ))}
        </div>
        
        {highImpactCount > 0 && (
          <div className="mt-4 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">
              <strong>⚠️ Priority:</strong> Addressing high-impact missing synergies can significantly improve your deck's performance.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
