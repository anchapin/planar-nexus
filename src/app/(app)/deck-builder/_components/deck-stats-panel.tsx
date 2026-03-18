'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart3, 
  PieChart, 
  Palette, 
  ChevronDown, 
  ChevronUp,
  Calculator
} from 'lucide-react';
import type { DeckCard } from '@/app/actions';
import { useDeckStatistics } from '@/hooks/use-deck-statistics';
import { ManaCurveChart, CardTypeChart, DeckColorChart } from '@/components/deck-statistics';

interface DeckStatsPanelProps {
  deck: DeckCard[];
  className?: string;
}

/**
 * Deck Statistics Panel Component
 * Displays deck analysis charts in the deck builder
 */
export function DeckStatsPanel({ deck, className }: DeckStatsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeChart, setActiveChart] = useState<'mana' | 'type' | 'color'>('mana');
  
  const stats = useDeckStatistics(deck);

  // Don't render if deck is empty
  if (deck.length === 0) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Deck Statistics
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
        </div>
        
        {/* Quick stats summary */}
        {isExpanded && (
          <div className="flex gap-4 text-sm text-muted-foreground mt-2">
            <span>{stats.totalCards} cards</span>
            <span>Avg. CMC: {stats.averageManaValue.toFixed(1)}</span>
          </div>
        )}
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Chart type selector */}
          <Tabs 
            value={activeChart} 
            onValueChange={(v) => setActiveChart(v as 'mana' | 'type' | 'color')}
            className="w-full"
          >
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="mana" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Mana
              </TabsTrigger>
              <TabsTrigger value="type" className="flex items-center gap-2">
                <PieChart className="w-4 h-4" />
                Types
              </TabsTrigger>
              <TabsTrigger value="color" className="flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Colors
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="mana" className="mt-4">
              <ManaCurveChart manaCurve={stats.manaCurve} />
            </TabsContent>
            
            <TabsContent value="type" className="mt-4">
              <CardTypeChart typeDistribution={stats.typeDistribution} chartType="bar" />
            </TabsContent>
            
            <TabsContent value="color" className="mt-4">
              <DeckColorChart colorDistribution={stats.colorDistribution} />
            </TabsContent>
          </Tabs>
          
          {/* Quick type summary */}
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">Quick Summary</div>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(stats.typeDistribution)
                .filter(([, count]) => count > 0)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 4)
                .map(([type, count]) => (
                  <div key={type} className="flex justify-between">
                    <span className="capitalize">{type}:</span>
                    <span>{count}</span>
                  </div>
                ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
