"use client";

import { DeckCard } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MinusCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useMemo } from "react";

interface DeckListProps {
  deck: DeckCard[];
  deckName: string;
  onDeckNameChange: (name: string) => void;
  onRemoveCard: (cardId: string) => void;
}

type CategorizedDeck = {
  [key: string]: DeckCard[];
};

export function DeckList({ deck, deckName, onDeckNameChange, onRemoveCard }: DeckListProps) {
  const totalCards = useMemo(() => deck.reduce((sum, card) => sum + card.count, 0), [deck]);

  const categorizedDeck = useMemo(() => {
    return deck.reduce((acc, card) => {
      let type = "Other";
      if (card.type_line?.includes("Creature")) type = "Creatures";
      else if (card.type_line?.includes("Land")) type = "Lands";
      else if (card.type_line?.includes("Instant")) type = "Instants";
      else if (card.type_line?.includes("Sorcery")) type = "Sorceries";
      else if (card.type_line?.includes("Artifact")) type = "Artifacts";
      else if (card.type_line?.includes("Enchantment")) type = "Enchantments";
      else if (card.type_line?.includes("Planeswalker")) type = "Planeswalkers";
      
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(card);
      return acc;
    }, {} as CategorizedDeck);
  }, [deck]);

  const categoryOrder = ["Creatures", "Instants", "Sorceries", "Artifacts", "Enchantments", "Planeswalkers", "Lands", "Other"];

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <Input
            className="text-lg font-headline font-bold border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
            value={deckName}
            onChange={(e) => onDeckNameChange(e.target.value)}
        />
        <CardDescription>
          {totalCards} cards
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="p-0 flex-grow">
        <ScrollArea className="h-[calc(100vh-20rem)]">
          <div className="p-4 space-y-4">
            {deck.length === 0 ? (
                <div className="text-center text-muted-foreground py-10">
                    Your deck is empty.
                </div>
            ) : (
                categoryOrder.map(category => {
                    if (categorizedDeck[category]) {
                        const categoryCount = categorizedDeck[category].reduce((sum: number, card: DeckCard) => sum + card.count, 0);
                        return (
                            <div key={category}>
                                <h4 className="font-semibold text-muted-foreground mb-2">{category} ({categoryCount})</h4>
                                <ul className="space-y-1">
                                    {categorizedDeck[category].sort((a: DeckCard, b: DeckCard) => a.name.localeCompare(b.name)).map(card => (
                                        <li key={card.id} className="group flex items-center justify-between text-sm p-1 rounded-md hover:bg-secondary">
                                            <span>{card.count}x {card.name}</span>
                                            <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => onRemoveCard(card.id)}>
                                                <MinusCircle className="size-4 text-destructive"/>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                    }
                    return null;
                })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
