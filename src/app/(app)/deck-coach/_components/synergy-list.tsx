"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SynergyItem {
  name: string;
  score: number;
  cards: string[];
  description: string;
  category: string;
}

export interface SynergyListProps {
  synergies: SynergyItem[];
  className?: string;
}

/**
 * Get score indicator color and label
 */
function getScoreIndicator(score: number): { color: string; label: string; bg: string } {
  if (score >= 70) {
    return { color: "text-green-500", label: "High", bg: "bg-green-500/10 border-green-500/20" };
  }
  if (score >= 45) {
    return { color: "text-yellow-500", label: "Medium", bg: "bg-yellow-500/10 border-yellow-500/20" };
  }
  return { color: "text-muted-foreground", label: "Low", bg: "bg-muted border-muted" };
}

/**
 * Get category badge variant
 */
function getCategoryVariant(category: string): "default" | "secondary" | "outline" | "destructive" {
  switch (category.toLowerCase()) {
    case "tribal":
      return "secondary";
    case "mechanic":
      return "default";
    case "engine":
      return "outline";
    case "combo":
      return "destructive";
    default:
      return "default";
  }
}

/**
 * SynergyItem Component
 * 
 * Displays a single synergy with expandable card list
 */
function SynergyItemComponent({ synergy }: { synergy: SynergyItem }) {
  const indicator = getScoreIndicator(synergy.score);
  const categoryVariant = getCategoryVariant(synergy.category);
  
  return (
    <Collapsible className="border rounded-lg p-3 mb-3 transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Sparkles className={cn("h-4 w-4", indicator.color)} />
          <div>
            <h4 className="font-semibold text-sm">{synergy.name}</h4>
            <p className="text-xs text-muted-foreground">{synergy.description}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant={categoryVariant} className="text-xs">
            {synergy.category}
          </Badge>
          
          <div className={cn("px-2 py-1 rounded text-xs font-medium border", indicator.bg, indicator.color)}>
            {indicator.label} ({synergy.score})
          </div>
          
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      
      <CollapsibleContent className="mt-3 pt-3 border-t">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Cards contributing ({synergy.cards.length}):
          </p>
          <div className="flex flex-wrap gap-1">
            {synergy.cards.slice(0, 12).map((card, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {card}
              </Badge>
            ))}
            {synergy.cards.length > 12 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                +{synergy.cards.length - 12} more
              </Badge>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * SynergyList Component
 * 
 * Displays all detected synergies sorted by strength.
 * Each synergy is expandable to show contributing cards.
 */
export function SynergyList({ synergies, className }: SynergyListProps) {
  if (!synergies || synergies.length === 0) {
    return null;
  }
  
  // Sort by score descending
  const sortedSynergies = [...synergies].sort((a, b) => b.score - a.score);
  
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-500" />
              Synergies
            </CardTitle>
            <CardDescription>
              Card combinations that work well together in your deck
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-sm">
            {synergies.length} found
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {sortedSynergies.map((synergy, index) => (
            <SynergyItemComponent key={`${synergy.name}-${index}`} synergy={synergy} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
