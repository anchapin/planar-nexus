"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Target, Zap, Shield, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KeyCard {
  name: string;
  reason: string;
  count: number;
  category?: string;
}

export interface KeyCardsProps {
  cards: KeyCard[];
  className?: string;
}

/**
 * Get icon for card category
 */
function getCategoryIcon(category?: string) {
  switch (category?.toLowerCase()) {
    case "archetype":
      return <Star className="h-4 w-4 text-yellow-500" />;
    case "synergy":
      return <Zap className="h-4 w-4 text-blue-500" />;
    case "engine":
      return <Target className="h-4 w-4 text-green-500" />;
    case "protection":
      return <Shield className="h-4 w-4 text-purple-500" />;
    case "win-condition":
      return <TrendingUp className="h-4 w-4 text-red-500" />;
    default:
      return <Star className="h-4 w-4 text-muted-foreground" />;
  }
}

/**
 * KeyCardItem Component
 */
function KeyCardItem({ card }: { card: KeyCard }) {
  return (
    <div className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3 flex-1">
        <div className="mt-0.5">
          {getCategoryIcon(card.category)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{card.name}</span>
            <Badge variant="secondary" className="text-xs h-5">
              x{card.count}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{card.reason}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Identify key cards from archetype and synergies
 */
export function identifyKeyCards(
  archetype: string,
  synergies: Array<{ name: string; cards: string[]; score: number }>,
  deckCards: Array<{ name: string; count: number }>
): KeyCard[] {
  const keyCards: Map<string, KeyCard> = new Map();
  
  // Add cards from high-scoring synergies
  const highSynergies = synergies.filter(s => s.score >= 50);
  for (const synergy of highSynergies) {
    for (const cardName of synergy.cards.slice(0, 5)) {
      const deckCard = deckCards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (deckCard && !keyCards.has(cardName.toLowerCase())) {
        keyCards.set(cardName.toLowerCase(), {
          name: cardName,
          count: deckCard.count,
          reason: `Core to ${synergy.name} synergy`,
          category: "synergy",
        });
      }
    }
  }
  
  // Add archetype-defining cards
  const archetypeKeywords: Record<string, string[]> = {
    burn: ["lightning bolt", "lava spike", "skewer"],
    control: ["counterspell", "wrath", "draw"],
    combo: ["tutor", "ritual", "storm"],
    tribal: ["lord", "chieftain", "king", "archdruid"],
    aggro: ["guide", "spear", "efficient"],
  };
  
  const archetypeKey = Object.keys(archetypeKeywords).find(k => archetype.toLowerCase().includes(k));
  if (archetypeKey) {
    for (const keyword of archetypeKeywords[archetypeKey]) {
      const matchingCard = deckCards.find(c => c.name.toLowerCase().includes(keyword));
      if (matchingCard && !keyCards.has(matchingCard.name.toLowerCase())) {
        keyCards.set(matchingCard.name.toLowerCase(), {
          name: matchingCard.name,
          count: matchingCard.count,
          reason: `Defines ${archetype} archetype`,
          category: "archetype",
        });
      }
    }
  }
  
  // Add high-count cards (likely important)
  const highCountCards = deckCards
    .filter(c => c.count >= 4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  
  for (const card of highCountCards) {
    if (!keyCards.has(card.name.toLowerCase())) {
      keyCards.set(card.name.toLowerCase(), {
        name: card.name,
        count: card.count,
        reason: "High play count indicates importance",
        category: "engine",
      });
    }
  }
  
  // Return top 5-7 cards
  return Array.from(keyCards.values()).slice(0, 7);
}

/**
 * KeyCards Component
 * 
 * Displays the most important cards in the deck.
 * Identifies key cards from archetype and synergies.
 * Shows play count and reason for each card.
 */
export function KeyCards({ cards, className }: KeyCardsProps) {
  if (!cards || cards.length === 0) {
    return null;
  }
  
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-yellow-500" />
              Key Cards
            </CardTitle>
            <CardDescription>
              Most important cards that define your deck's strategy
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-sm">
            {cards.length} cards
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {cards.map((card, index) => (
            <KeyCardItem key={`${card.name}-${index}`} card={card} />
          ))}
        </div>
        
        <div className="mt-4 p-3 bg-muted/30 rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Tip:</strong> These cards are central to your deck's game plan. 
            Consider mulliganing hands that don't contain any of these cards.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
