'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  BarChart3,
  PieChart,
  Palette,
  ChevronDown,
  ChevronUp,
  Calculator,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  Ban,
} from 'lucide-react';
import type { DeckCard } from '@/app/actions';
import type { Format } from '@/lib/game-rules';
import { useDeckStatistics } from '@/hooks/use-deck-statistics';
import type { DeckLegalitySummary } from '@/hooks/use-format-legality-check';
import { ManaCurveChart, CardTypeChart, DeckColorChart } from '@/components/deck-statistics';
import {
  compareToOptimal,
  normalizeDeckFormat,
  getManaCurveTips,
  OPTIMAL_MANA_CURVES,
  type DeckFormat,
} from '@/lib/deck-analyzer';

interface DeckStatsPanelProps {
  deck: DeckCard[];
  /** Deck format string (any legacy Format value is normalized internally). */
  format?: string;
  /** Display name for the active format, used in summary copy. */
  formatLabel?: string;
  /** Pre-computed per-card legality summary for the active format. */
  legalitySummary?: DeckLegalitySummary;
  className?: string;
}

/**
 * Deck Statistics Panel Component
 * Displays deck analysis charts in the deck builder, plus a format-legality
 * summary that flags banned / not-legal cards in the active format.
 */
export function DeckStatsPanel({
  deck,
  format = 'commander',
  formatLabel,
  legalitySummary,
  className,
}: DeckStatsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeChart, setActiveChart] = useState<'mana' | 'type' | 'color'>('mana');

  const stats = useDeckStatistics(deck);
  const deckFormat: DeckFormat = normalizeDeckFormat(format);

  // Compare the deck against the format-optimal curve for actionable gaps.
  const comparison = useMemo(() => compareToOptimal(deck, deckFormat), [deck, deckFormat]);
  const tips = useMemo(() => getManaCurveTips(deckFormat), [deckFormat]);
  const optimalTargets = useMemo(() => {
    const targets: Record<number, number> = {};
    const profile = OPTIMAL_MANA_CURVES[deckFormat];
    for (let cmc = 1; cmc <= 7; cmc++) {
      targets[cmc] = profile.buckets[cmc].target;
    }
    return targets;
  }, [deckFormat]);

  // Don't render if deck is empty
  if (deck.length === 0) {
    return null;
  }

  const hasGaps = comparison.gaps.length > 0 || comparison.landGap !== null;
  const hasLegalityData = Boolean(format && legalitySummary);
  const hasIllegalCards = hasLegalityData && (legalitySummary?.illegalCardCount ?? 0) > 0;

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
            aria-label={isExpanded ? 'Collapse deck statistics' : 'Expand deck statistics'}
            aria-expanded={isExpanded}
            aria-controls="deck-statistics-content"
            className="h-8 w-8 p-0"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
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
        <CardContent id="deck-statistics-content" className="space-y-4">
          {/* Format legality summary */}
          {hasLegalityData && legalitySummary && format && (
            <div data-testid="deck-legality-summary">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  {hasIllegalCards ? (
                    <ShieldAlert className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <ShieldCheck className="w-4 h-4 text-green-500" />
                  )}
                  {formatLabel ?? format} Legality
                </span>
                <span
                  className={
                    hasIllegalCards
                      ? 'text-yellow-600 dark:text-yellow-500'
                      : 'text-green-600 dark:text-green-500'
                  }
                  data-testid="legality-summary-text"
                >
                  {legalitySummary.legalCardCount} legal, {legalitySummary.illegalCardCount} illegal
                </span>
              </div>

              {/* Detailed breakdown for problem decks */}
              {hasIllegalCards && (
                <Alert variant="destructive" className="mt-2">
                  <Ban className="h-4 w-4" />
                  <AlertDescription className="text-sm space-y-1">
                    {legalitySummary.bannedCardNames.length > 0 && (
                      <div data-testid="legality-banned-list">
                        <strong>Banned:</strong>{' '}
                        {legalitySummary.bannedCardNames.slice(0, 5).join(', ')}
                        {legalitySummary.bannedCardNames.length > 5
                          ? ` (+${legalitySummary.bannedCardNames.length - 5} more)`
                          : ''}
                      </div>
                    )}
                    {legalitySummary.illegalCardNames.length >
                      legalitySummary.bannedCardNames.length && (
                      <div data-testid="legality-notlegal-list">
                        <strong>Not legal:</strong>{' '}
                        {legalitySummary.illegalCardNames
                          .filter(
                            (name) =>
                              !legalitySummary.bannedCardNames.includes(name),
                          )
                          .slice(0, 5)
                          .join(', ')}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
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
              <ManaCurveChart
                manaCurve={stats.manaCurve}
                format={deckFormat}
                gaps={comparison.gaps}
                optimalTargets={optimalTargets}
              />
            </TabsContent>

            <TabsContent value="type" className="mt-4">
              <CardTypeChart typeDistribution={stats.typeDistribution} chartType="bar" />
            </TabsContent>

            <TabsContent value="color" className="mt-4">
              <DeckColorChart colorDistribution={stats.colorDistribution} />
            </TabsContent>
          </Tabs>

          {/* Mana curve optimization suggestions & format-specific guidance */}
          {activeChart === 'mana' && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                Mana Curve Optimization
                <span className="ml-auto text-xs text-muted-foreground capitalize">{deckFormat}</span>
              </div>

              {hasGaps ? (
                <ul className="space-y-1 text-xs">
                  {comparison.gaps.slice(0, 4).map((gap) => (
                    <li
                      key={gap.cmc}
                      className={
                        gap.difference > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      • {gap.difference > 0 ? 'Add' : 'Cut'}{' '}
                      {Math.abs(gap.difference) <= 1
                        ? Math.abs(gap.difference)
                        : `${Math.max(1, Math.abs(gap.difference) - 1)}-${Math.abs(gap.difference)}`}{' '}
                      {gap.difference > 0 ? 'more' : 'fewer'} {gap.label}s (have {gap.current}, target ~{gap.target})
                    </li>
                  ))}
                  {comparison.landGap && (
                    <li
                      className={
                        comparison.landGap.difference > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      • {comparison.landGap.difference > 0 ? 'Add' : 'Cut'}{' '}
                      {Math.abs(comparison.landGap.difference)} lands (have{' '}
                      {comparison.landGap.current}, target ~{comparison.landGap.target})
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Your mana curve matches the optimal {deckFormat} profile. Nice work!
                </p>
              )}

              <div className="border-t pt-2">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {deckFormat.charAt(0).toUpperCase() + deckFormat.slice(1)} curve tips
                </div>
                <ul className="space-y-0.5 text-xs text-muted-foreground list-disc list-inside">
                  {tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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
