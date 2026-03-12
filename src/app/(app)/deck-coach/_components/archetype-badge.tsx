"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArchetypeBadgeProps {
  archetype: string;
  confidence: number;
  secondary?: string;
  secondaryConfidence?: number;
  className?: string;
}

/**
 * Get badge variant based on archetype category
 */
function getArchetypeVariant(archetype: string): "default" | "secondary" | "destructive" | "outline" {
  const name = archetype.toLowerCase();
  
  // Aggro archetypes - red/destructive
  if (name.includes('burn') || name.includes('zoo') || name.includes('sligh') || name.includes('aggro')) {
    return "destructive";
  }
  
  // Control archetypes - blue (using default for now, could be customized)
  if (name.includes('draw-go') || name.includes('control') || name.includes('stax') || name.includes('prison')) {
    return "default";
  }
  
  // Combo archetypes - purple (using secondary)
  if (name.includes('storm') || name.includes('reanimator') || name.includes('infinite') || name.includes('combo')) {
    return "secondary";
  }
  
  // Tribal archetypes - green (using outline)
  if (name.includes('elf') || name.includes('goblin') || name.includes('zombie') || name.includes('dragon') || name.includes('tribal')) {
    return "outline";
  }
  
  // Midrange archetypes - yellow/orange (using secondary)
  if (name.includes('midrange') || name.includes('rock') || name.includes('value') || name.includes('good stuff')) {
    return "secondary";
  }
  
  // Special archetypes
  if (name.includes('land') || name.includes('superfriends')) {
    return "outline";
  }
  
  // Default
  return "default";
}

/**
 * Get category label for archetype
 */
function getCategoryLabel(archetype: string): string {
  const name = archetype.toLowerCase();
  
  if (name.includes('burn') || name.includes('zoo') || name.includes('sligh') || name.includes('aggro')) {
    return "Aggro";
  }
  if (name.includes('draw-go') || name.includes('control') || name.includes('stax') || name.includes('prison')) {
    return "Control";
  }
  if (name.includes('storm') || name.includes('reanimator') || name.includes('infinite') || name.includes('combo')) {
    return "Combo";
  }
  if (name.includes('elf') || name.includes('goblin') || name.includes('zombie') || name.includes('dragon') || name.includes('tribal')) {
    return "Tribal";
  }
  if (name.includes('midrange') || name.includes('rock') || name.includes('value') || name.includes('good stuff')) {
    return "Midrange";
  }
  if (name.includes('land') || name.includes('superfriends')) {
    return "Special";
  }
  
  return "Unknown";
}

/**
 * Format confidence as percentage with color
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-500";
  if (confidence >= 0.6) return "text-yellow-500";
  return "text-muted-foreground";
}

/**
 * ArchetypeBadge Component
 * 
 * Displays the detected archetype with confidence indicator.
 * Color-coded by archetype category (aggro=red, control=blue, etc.)
 * Shows checkmark for high-confidence detections (>=80%)
 */
export function ArchetypeBadge({ 
  archetype, 
  confidence, 
  secondary, 
  secondaryConfidence,
  className 
}: ArchetypeBadgeProps) {
  const variant = getArchetypeVariant(archetype);
  const category = getCategoryLabel(archetype);
  const isHighConfidence = confidence >= 0.8;
  
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant={variant} 
              className={cn(
                "text-sm px-3 py-1 h-auto",
                isHighConfidence && "ring-2 ring-green-500/50"
              )}
            >
              {archetype}
              {isHighConfidence && <CheckCircle2 className="ml-1 h-3 w-3" />}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-semibold">{category} Archetype</p>
            <p className="text-xs text-muted-foreground">
              Confidence: {Math.round(confidence * 100)}%
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      {/* Secondary archetype */}
      {secondary && secondaryConfidence && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                {secondary}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Secondary archetype: {Math.round(secondaryConfidence * 100)}% confidence
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      
      {/* Confidence indicator text */}
      <span className={cn("text-xs font-medium", getConfidenceColor(confidence))}>
        {Math.round(confidence * 100)}% confidence
      </span>
    </div>
  );
}
