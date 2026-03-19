'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeckArchetype, MagicFormat } from '@/lib/meta';
import TrendIndicator from './TrendIndicator';
import { AntiMetaRecommendations } from './AntiMetaRecommendations';
import { ChevronDown, ChevronUp, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DeckArchetypeCardProps {
  archetype: DeckArchetype;
}

export default function DeckArchetypeCard({ archetype }: DeckArchetypeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAntiMeta, setShowAntiMeta] = useState(false);

  const getWinRateColor = (winRate: number) => {
    if (winRate >= 55) return 'text-green-500';
    if (winRate >= 45) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'aggro':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'control':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'midrange':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'combo':
        return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'tempo':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  const getColorIdentityDisplay = (colors: string[]) => {
    const colorMap: Record<string, string> = {
      'W': '⚪',
      'U': '🔵',
      'B': '⚫',
      'R': '🔴',
      'G': '🟢',
    };
    return colors.map(c => colorMap[c] || c).join(' ');
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="font-headline text-lg">{archetype.name}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('text-xs', getCategoryColor(archetype.category))}>
                {archetype.category}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {getColorIdentityDisplay(archetype.colorIdentity)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className={cn('text-2xl font-bold', getWinRateColor(archetype.winRate))}>
              {archetype.winRate.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Meta Share Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Meta Share</span>
            <span className="font-medium">{archetype.metaShare.toFixed(1)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div 
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(archetype.metaShare * 3, 100)}%` }}
            />
          </div>
        </div>

        {/* Top Cards Preview */}
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Top Cards</div>
          <div className="flex flex-wrap gap-1">
            {archetype.topCards.slice(0, 3).map((card, idx) => (
              <div 
                key={idx}
                className="flex items-center gap-1 rounded bg-secondary/50 px-2 py-1 text-xs"
              >
                <span className="truncate max-w-[80px]">{card.cardName}</span>
                <TrendIndicator 
                  direction={card.trend} 
                  change={card.trendChange} 
                  size="sm" 
                />
              </div>
            ))}
            {archetype.topCards.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{archetype.topCards.length - 3} more
              </span>
            )}
          </div>
        </div>

        {/* Expandable Card List */}
        {expanded && (
          <div className="space-y-2 pt-2">
            <div className="text-sm font-medium">All Top Cards</div>
            <div className="space-y-1">
              {archetype.topCards.map((card, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1 text-sm"
                >
                  <span className="truncate">{card.cardName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{card.inclusionRate}%</span>
                    <TrendIndicator 
                      direction={card.trend} 
                      change={card.trendChange} 
                      size="sm" 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-4" />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown className="size-4" />
              Show More
            </>
          )}
        </button>

        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2"
          onClick={() => setShowAntiMeta(true)}
        >
          <Target className="size-4 mr-2" />
          Counter Advice
        </Button>

        <AntiMetaRecommendations
          archetype={archetype}
          format={archetype.format}
          open={showAntiMeta}
          onOpenChange={setShowAntiMeta}
        />
      </CardContent>
    </Card>
  );
}
