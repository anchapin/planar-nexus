"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, AlertTriangle } from "lucide-react";
import type { BannedCardSuggestion } from "@/lib/game-rules";

interface BannedCardAlternativesProps {
  suggestions: BannedCardSuggestion[];
  /**
   * Called when the user clicks an alternative. The parent decides whether
   * to add the card directly or pre-fill the card search box.
   */
  onSelectAlternative: (cardName: string) => void;
  className?: string;
}

/**
 * Groups alternatives by card type so the most relevant substitutes
 * (matching the banned card's type) surface first, then orders each type
 * group by ascending mana cost (closest-cost match first).
 */
function groupAlternatives(suggestion: BannedCardSuggestion) {
  const byType = new Map<string, typeof suggestion.alternatives>();
  for (const alt of suggestion.alternatives) {
    const list = byType.get(alt.type) ?? [];
    list.push(alt);
    byType.set(alt.type, list);
  }
  return Array.from(byType.entries())
    .map(([type, alts]) => ({
      type,
      alts: [...alts].sort((a, b) => a.manaValue - b.manaValue),
    }))
    .sort((a, b) => b.alts.length - a.alts.length);
}

/**
 * Banned Card Alternatives panel.
 *
 * Renders one block per banned card detected in the deck, showing 2-3
 * curated legal substitutes grouped by card type and ordered by mana cost.
 * Each alternative has a one-click action to add it to the deck (or search
 * for it) via {@link BannedCardAlternativesProps.onSelectAlternative}.
 */
export function BannedCardAlternatives({
  suggestions,
  onSelectAlternative,
  className,
}: BannedCardAlternativesProps) {
  const grouped = useMemo(
    () => suggestions.map((s) => ({ suggestion: s, groups: groupAlternatives(s) })),
    [suggestions],
  );

  if (suggestions.length === 0) return null;

  return (
    <Card className={className} data-testid="banned-card-alternatives">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Banned Card Alternatives
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {grouped.map(({ suggestion, groups }) => (
          <div
            key={suggestion.bannedCard}
            className="space-y-2"
            data-testid={`banned-suggestion-${suggestion.bannedCard.replace(/\s+/g, "-")}`}
          >
            <div className="text-sm">
              <span className="font-medium capitalize text-amber-600 dark:text-amber-400">
                {suggestion.bannedCard}
              </span>
              <span className="text-muted-foreground"> is banned — try:</span>
            </div>
            {groups.map(({ type, alts }) => (
              <div key={type} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {type}
                  </Badge>
                </div>
                <div className="flex flex-col gap-1 pl-1">
                  {alts.map((alt) => (
                    <div
                      key={alt.name}
                      className="flex items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {alt.name}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {alt.manaValue} CMC
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {alt.reason}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => onSelectAlternative(alt.name)}
                          aria-label={`Add ${alt.name} to deck`}
                          title={`Add ${alt.name} to deck`}
                          data-testid={`add-alternative-${alt.name.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => onSelectAlternative(alt.name)}
                          aria-label={`Search for ${alt.name}`}
                          title={`Search for ${alt.name}`}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
