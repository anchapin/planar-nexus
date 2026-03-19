"use client";

import React from 'react';
import { ManaCurveChart } from './ManaCurveChart';
import { 
  DeckManaCurve, 
  ManaCurveRecommendation, 
  getManaCurveRecommendations, 
  getLandCountRecommendations,
  getStrategyProfile,
  determineStrategy,
  analyzeDeckManaCurve
} from '@/lib/mana-curve';
import { DeckCard } from '@/app/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ManaCurveAnalysisProps {
  deck: DeckCard[];
  archetype?: string;
}

/**
 * Full mana curve analysis component with chart, stats, and recommendations
 */
export function ManaCurveAnalysis({ deck, archetype }: ManaCurveAnalysisProps) {
  // Analyze the deck's mana curve
  const deckCurve = analyzeDeckManaCurve(deck);
  
  // Get strategy profile
  const strategyName = archetype || determineStrategy(deckCurve.averageCMC);
  const strategyProfile = getStrategyProfile(strategyName);
  
  // Get recommendations
  const recommendations = getManaCurveRecommendations(deckCurve, archetype);
  const landRec = getLandCountRecommendations(deckCurve, archetype);

  // Calculate metrics
  const curveRating = getCurveRating(deckCurve.curveScore);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Average CMC</div>
            <div className="text-2xl font-bold">{deckCurve.averageCMC.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Total Cards</div>
            <div className="text-2xl font-bold">{deckCurve.totalCards}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Lands</div>
            <div className="text-2xl font-bold">{deckCurve.lands}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Curve Score</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              {curveRating.icon}
              {deckCurve.curveScore.toFixed(0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strategy Badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Detected Strategy:</span>
        <Badge variant="secondary" className="text-sm">
          {strategyName.charAt(0).toUpperCase() + strategyName.slice(1)}
        </Badge>
        <span className="text-xs text-muted-foreground">({strategyProfile.description})</span>
      </div>

      {/* Mana Curve Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Mana Curve</CardTitle>
          <CardDescription>
            Your deck's spell distribution compared to recommended {strategyName} curve
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManaCurveChart 
            deckCurve={deckCurve} 
            strategyProfile={strategyProfile}
          />
        </CardContent>
      </Card>

      {/* Land Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Lands</CardTitle>
          <CardDescription>Recommended land count for your deck</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">
                {deckCurve.lands}
                <span className="text-lg text-muted-foreground font-normal">
                  {' '}/ {deckCurve.totalCards}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Current (Total cards)
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-green-600">
                {landRec.recommended}
              </div>
              <div className="text-sm text-muted-foreground">
                Recommended ({landRec.min}-{landRec.max})
              </div>
            </div>
          </div>
          <Separator />
          <p className="text-sm text-muted-foreground">
            {landRec.reasoning}
          </p>
          {deckCurve.lands < landRec.min && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Consider adding {landRec.min - deckCurve.lands} more lands
            </div>
          )}
          {deckCurve.lands > landRec.max && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Consider removing {deckCurve.lands - landRec.max} lands
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Optimization Suggestions</CardTitle>
            <CardDescription>Specific changes to improve your mana curve</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((rec, index) => (
                <div 
                  key={index} 
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                >
                  {rec.type === 'add' ? (
                    <TrendingUp className="h-5 w-5 text-green-600 mt-0.5" />
                  ) : rec.type === 'remove' ? (
                    <TrendingDown className="h-5 w-5 text-red-600 mt-0.5" />
                  ) : (
                    <Minus className="h-5 w-5 text-amber-600 mt-0.5" />
                  )}
                  <div>
                    <div className="font-medium">
                      {rec.type === 'add' ? 'Add' : rec.type === 'remove' ? 'Remove' : 'Adjust'}{' '}
                      {rec.cardCount} {rec.cmc}-drop{rec.cardCount > 1 ? 's' : ''}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {rec.reason}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Get curve rating based on score
 */
function getCurveRating(score: number): { 
  label: string; 
  color: string; 
  icon: React.ReactNode 
} {
  if (score >= 80) {
    return { 
      label: 'Excellent', 
      color: 'text-green-600',
      icon: <span className="text-green-600">★★★★★</span>
    };
  }
  if (score >= 60) {
    return { 
      label: 'Good', 
      color: 'text-green-500',
      icon: <span className="text-green-500">★★★★☆</span>
    };
  }
  if (score >= 40) {
    return { 
      label: 'Average', 
      color: 'text-yellow-500',
      icon: <span className="text-yellow-500">★★★☆☆</span>
    };
  }
  if (score >= 20) {
    return { 
      label: 'Below Average', 
      color: 'text-orange-500',
      icon: <span className="text-orange-500">★★☆☆☆</span>
    };
  }
  return { 
    label: 'Poor', 
    color: 'text-red-500',
    icon: <span className="text-red-500">★☆☆☆☆</span>
  };
}

export default ManaCurveAnalysis;
