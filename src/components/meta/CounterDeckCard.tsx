"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CounterRecommendation } from '@/lib/anti-meta';

interface CounterDeckCardProps {
  recommendation: CounterRecommendation;
  onViewDetails?: (recommendation: CounterRecommendation) => void;
}

/**
 * Component displaying a counter deck recommendation
 */
export function CounterDeckCard({ recommendation, onViewDetails }: CounterDeckCardProps) {
  const getWinRateColor = (winRate: number) => {
    if (winRate >= 55) return "bg-green-500";
    if (winRate >= 50) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getCategoryBadgeVariant = (category: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (category.toLowerCase()) {
      case 'aggro':
        return "destructive";
      case 'control':
        return "default";
      case 'midrange':
        return "secondary";
      case 'combo':
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <Card className="w-full hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{recommendation.counterArchetypeName}</CardTitle>
          <Badge variant={getCategoryBadgeVariant(recommendation.counterArchetypeName.split(' ')[0])}>
            Counter
          </Badge>
        </div>
        <CardDescription>
          Beats {recommendation.archetypeName}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Win Rate */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Matchup Win Rate:</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-2 rounded-full bg-gray-200 overflow-hidden">
                <div 
                  className={`h-full rounded-full ${getWinRateColor(recommendation.matchupWinRate)}`}
                  style={{ width: `${recommendation.matchupWinRate}%` }}
                />
              </div>
              <span className="text-sm font-medium">{recommendation.matchupWinRate}%</span>
            </div>
          </div>

          {/* Key Cards Preview */}
          <div>
            <span className="text-sm text-muted-foreground block mb-1">Key Cards:</span>
            <div className="flex flex-wrap gap-1">
              {recommendation.keyCards.slice(0, 3).map((card, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {card}
                </Badge>
              ))}
              {recommendation.keyCards.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  +{recommendation.keyCards.length - 3} more
                </Badge>
              )}
            </div>
          </div>

          {/* Action */}
          {onViewDetails && (
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full mt-2"
              onClick={() => onViewDetails(recommendation)}
            >
              View Details
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default CounterDeckCard;
