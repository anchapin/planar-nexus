"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SavedSideboardPlan } from '@/lib/sideboard-plans';

interface SideboardPlanCardProps {
  plan: SavedSideboardPlan;
  onView?: (plan: SavedSideboardPlan) => void;
  onEdit?: (plan: SavedSideboardPlan) => void;
  onDelete?: (plan: SavedSideboardPlan) => void;
}

/**
 * Component displaying a saved sideboard plan
 */
export function SideboardPlanCard({ plan, onView, onEdit, onDelete }: SideboardPlanCardProps) {
  const totalInCards = plan.inCards.reduce((sum, card) => sum + card.count, 0);
  const totalOutCards = plan.outCards.reduce((sum, card) => sum + card.count, 0);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Card className="w-full hover:shadow-md transition-shadow cursor-pointer" onClick={() => onView?.(plan)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          <Badge variant="outline">{plan.format}</Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          vs. {plan.opponentArchetypeName}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Archetype Info */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{plan.archetypeName}</Badge>
          </div>

          {/* In/Out Counts */}
          <div className="flex gap-4">
            <div className="flex items-center gap-1">
              <span className="text-green-500 font-medium">+{totalInCards}</span>
              <span className="text-sm text-muted-foreground">in</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-red-500 font-medium">-{totalOutCards}</span>
              <span className="text-sm text-muted-foreground">out</span>
            </div>
          </div>

          {/* Cards Preview */}
          {plan.inCards.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">In:</span>
              <div className="flex flex-wrap gap-1">
                {plan.inCards.slice(0, 3).map((card, index) => (
                  <Badge key={index} variant="outline" className="text-xs bg-green-50">
                    {card.cardName} x{card.count}
                  </Badge>
                ))}
                {plan.inCards.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{plan.inCards.length - 3} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {plan.outCards.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Out:</span>
              <div className="flex flex-wrap gap-1">
                {plan.outCards.slice(0, 3).map((card, index) => (
                  <Badge key={index} variant="outline" className="text-xs bg-red-50">
                    {card.cardName} x{card.count}
                  </Badge>
                ))}
                {plan.outCards.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{plan.outCards.length - 3} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Date */}
          <div className="text-xs text-muted-foreground">
            Updated {formatDate(plan.updatedAt)}
          </div>

          {/* Actions */}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {onEdit && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => onEdit(plan)}
              >
                Edit
              </Button>
            )}
            {onDelete && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => onDelete(plan)}
                className="text-red-500 hover:text-red-700"
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SideboardPlanCard;
