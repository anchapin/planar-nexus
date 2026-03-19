"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MatchupGuide } from '@/lib/matchup-guides';

interface MatchupGuideCardProps {
  guide: MatchupGuide;
}

/**
 * Component displaying a matchup guide
 */
export function MatchupGuideCard({ guide }: MatchupGuideCardProps) {
  const getWinRateColor = (winRate: number) => {
    if (winRate >= 55) return "text-green-500";
    if (winRate >= 45) return "text-yellow-500";
    return "text-red-500";
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
      case 'tempo':
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {guide.playerArchetypeName} vs {guide.opponentArchetypeName}
          </CardTitle>
          <div className={getWinRateColor(guide.winRate)}>
            {guide.winRate}% win rate
          </div>
        </div>
        <CardDescription>
          {guide.format.charAt(0).toUpperCase() + guide.format.slice(1)} Format
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key Cards */}
        <div>
          <span className="text-sm font-medium">Key Cards:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {guide.keyCards.map((card, index) => (
              <Badge key={index} variant="outline">
                {card}
              </Badge>
            ))}
          </div>
        </div>

        {/* General Strategy */}
        <div>
          <span className="text-sm font-medium">General Strategy:</span>
          <p className="text-sm text-muted-foreground mt-1">
            {guide.gamePlan.generalStrategy}
          </p>
        </div>

        {/* Key Cards in each phase */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="bg-muted/50 p-2 rounded">
            <span className="text-xs font-medium block">Opening</span>
            <ul className="text-xs text-muted-foreground space-y-1">
              {guide.gamePlan.opening.slice(0, 2).map((tip, i) => (
                <li key={i}>• {tip}</li>
              ))}
            </ul>
          </div>
          <div className="bg-muted/50 p-2 rounded">
            <span className="text-xs font-medium block">Mid-Game</span>
            <ul className="text-xs text-muted-foreground space-y-1">
              {guide.gamePlan.midGame.slice(0, 2).map((tip, i) => (
                <li key={i}>• {tip}</li>
              ))}
            </ul>
          </div>
          <div className="bg-muted/50 p-2 rounded">
            <span className="text-xs font-medium block">Late-Game</span>
            <ul className="text-xs text-muted-foreground space-y-1">
              {guide.gamePlan.lateGame.slice(0, 2).map((tip, i) => (
                <li key={i}>• {tip}</li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default MatchupGuideCard;
